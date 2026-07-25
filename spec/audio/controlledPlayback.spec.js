import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAudioParam = (initialValue = 0) => {
  const param = {
    value: initialValue,
    cancelScheduledValues: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    setValueAtTime: vi.fn((value) => {
      param.value = value;
    }),
    linearRampToValueAtTime: vi.fn((value) => {
      param.value = value;
    }),
  };
  return param;
};

const createAudioContextMock = ({ startImpl } = {}) => {
  const context = {
    currentTime: 10,
    state: "running",
    destination: { label: "destination" },
    sources: [],
    resume: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => ({
      gain: createAudioParam(1),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createStereoPanner: vi.fn(() => ({
      pan: createAudioParam(0),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: createAudioParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(startImpl),
        stop: vi.fn(),
        onended: null,
      };
      context.sources.push(source);
      return source;
    }),
  };
  return context;
};

const flushMicrotasks = async () => {
  for (let index = 0; index < 6; index++) {
    await Promise.resolve();
  }
};

const playbackSound = ({ commandId, operation, positionMs, ...overrides }) => ({
  id: "player",
  type: "sound",
  src: "track",
  ...overrides,
  playback: {
    commandId,
    operation,
    ...(positionMs !== undefined ? { positionMs } : {}),
  },
});

const setupControlledStage = async ({
  assets = new Map([["track", { duration: 10 }]]),
  pendingAssets = new Map(),
  contextOptions,
} = {}) => {
  vi.resetModules();
  const context = createAudioContextMock(contextOptions);
  window.AudioContext = vi.fn(function AudioContextMock() {
    return context;
  });
  window.webkitAudioContext = undefined;

  vi.doMock("../../src/AudioAsset.js", () => ({
    AudioAsset: {
      getAsset: vi.fn((src) => assets.get(src)),
      getAssetPromise: vi.fn((src) => pendingAssets.get(src)),
    },
  }));

  const { createAudioStage } = await import("../../src/AudioStage.js");
  const stage = createAudioStage();
  const eventHandler = vi.fn();
  let currentAudio = [];
  const render = (nextAudio) => {
    stage.renderGraph({
      prevAudio: currentAudio,
      nextAudio,
      eventHandler,
    });
    currentAudio = nextAudio;
  };

  return { context, eventHandler, render, stage };
};

const eventsByName = (eventHandler, eventName) =>
  eventHandler.mock.calls
    .filter(([name]) => name === eventName)
    .map(([, payload]) => payload);

describe("command-controlled sound playback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock("../../src/AudioAsset.js");
    vi.resetModules();
  });

  it("plays a decoded segment and emits soundReady under _event", async () => {
    const { context, eventHandler, render } = await setupControlledStage({
      assets: new Map([["track", { duration: 200 }]]),
    });

    render([
      playbackSound({
        commandId: 42,
        operation: "play",
        positionMs: 83000,
        startAt: 10,
        endAt: 190,
      }),
    ]);
    await flushMicrotasks();

    expect(eventsByName(eventHandler, "soundReady")).toEqual([
      {
        _event: {
          id: "player",
          commandId: 42,
          positionMs: 83000,
          durationMs: 180000,
        },
      },
    ]);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 93, 97);
  });

  it("does not restart for mixer-only renders or repeated commands", async () => {
    const { context, render } = await setupControlledStage();
    const initial = playbackSound({
      commandId: 1,
      operation: "play",
      positionMs: 0,
    });

    render([initial]);
    await flushMicrotasks();
    render([{ ...initial, volume: 40, muted: true }]);
    render([
      playbackSound({
        commandId: 0,
        operation: "play",
        positionMs: 0,
        volume: 60,
      }),
    ]);

    expect(context.sources).toHaveLength(1);
  });

  it("pauses at the renderer cursor and resumes without a supplied position", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();

    context.currentTime = 12;
    render([playbackSound({ commandId: 2, operation: "pause" })]);
    await flushMicrotasks();

    expect(context.sources[0].stop).toHaveBeenCalledWith(12);
    expect(eventsByName(eventHandler, "soundProgress").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        positionMs: 2000,
        durationMs: 10000,
      },
    });

    render([playbackSound({ commandId: 3, operation: "resume" })]);
    expect(context.sources).toHaveLength(2);
    const [startTime, offset, duration] =
      context.sources[1].start.mock.calls[0];
    expect(startTime).toBe(12);
    expect(offset).toBeCloseTo(2);
    expect(duration).toBeCloseTo(8);
  });

  it("rebinds natural completion after an accepted no-op", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 10,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();
    const source = context.sources[0];

    render([playbackSound({ commandId: 11, operation: "resume" })]);
    expect(context.sources).toHaveLength(1);
    source.onended();
    await flushMicrotasks();

    expect(eventsByName(eventHandler, "soundComplete")).toEqual([
      {
        _event: {
          id: "player",
          commandId: 11,
          positionMs: 10000,
          durationMs: 10000,
        },
      },
    ]);
  });

  it("seeks active playback and suppresses the replaced source callback", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();
    const replacedSource = context.sources[0];

    render([
      playbackSound({
        commandId: 2,
        operation: "seek",
        positionMs: 4000,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].start).toHaveBeenCalledWith(10, 4, 6);
    expect(replacedSource.onended).toBeNull();
    expect(eventsByName(eventHandler, "soundProgress").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        positionMs: 4000,
        durationMs: 10000,
      },
    });
  });

  it("keeps resume and seek as no-ops after stop", async () => {
    const { context, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();

    render([playbackSound({ commandId: 2, operation: "stop" })]);
    render([playbackSound({ commandId: 3, operation: "resume" })]);
    render([
      playbackSound({
        commandId: 4,
        operation: "seek",
        positionMs: 5000,
      }),
    ]);
    expect(context.sources).toHaveLength(1);

    render([
      playbackSound({
        commandId: 5,
        operation: "play",
        positionMs: 3000,
      }),
    ]);
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].start).toHaveBeenCalledWith(10, 3, 7);
  });

  it("does not let pause arm resume after stop", async () => {
    const { context, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();

    render([playbackSound({ commandId: 2, operation: "stop" })]);
    render([playbackSound({ commandId: 3, operation: "pause" })]);
    render([playbackSound({ commandId: 4, operation: "resume" })]);

    expect(context.sources).toHaveLength(1);
  });

  it("reports invalid positions without replacing retained playback", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();
    const source = context.sources[0];

    render([
      playbackSound({
        commandId: 2,
        operation: "play",
        positionMs: 10001,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources).toHaveLength(1);
    expect(source.stop).not.toHaveBeenCalled();
    expect(eventsByName(eventHandler, "soundError").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        errorCode: "invalid-position",
      },
    });

    source.onended();
    await flushMicrotasks();
    expect(
      eventsByName(eventHandler, "soundComplete").at(-1)._event.commandId,
    ).toBe(2);
  });

  it("rebinds a pending decode to the latest pause and resumes it", async () => {
    let resolveDecode;
    const decodePromise = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    const { context, eventHandler, render } = await setupControlledStage({
      assets: new Map(),
      pendingAssets: new Map([["track", decodePromise]]),
    });

    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 2000,
      }),
    ]);
    render([playbackSound({ commandId: 2, operation: "pause" })]);
    resolveDecode({ duration: 10 });
    await flushMicrotasks();

    expect(context.sources).toHaveLength(0);
    expect(
      eventsByName(eventHandler, "soundReady").at(-1)._event.commandId,
    ).toBe(2);
    expect(eventsByName(eventHandler, "soundProgress").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        positionMs: 2000,
        durationMs: 10000,
      },
    });

    render([playbackSound({ commandId: 3, operation: "resume" })]);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 2, 8);
  });

  it("queues a seek during decode and applies it after soundReady", async () => {
    let resolveDecode;
    const decodePromise = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    const { context, eventHandler, render } = await setupControlledStage({
      assets: new Map(),
      pendingAssets: new Map([["track", decodePromise]]),
    });

    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 1000,
      }),
    ]);
    render([
      playbackSound({
        commandId: 2,
        operation: "seek",
        positionMs: 4000,
      }),
    ]);
    resolveDecode({ duration: 10 });
    await flushMicrotasks();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 4, 6);
    expect(eventHandler.mock.calls.map(([name]) => name).slice(-2)).toEqual([
      "soundReady",
      "soundProgress",
    ]);
    expect(
      eventsByName(eventHandler, "soundProgress").at(-1)._event.commandId,
    ).toBe(2);
  });

  it("starts a seek issued reentrantly from soundReady", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    eventHandler.mockImplementation((eventName) => {
      if (eventName === "soundReady") {
        render([
          playbackSound({
            commandId: 2,
            operation: "seek",
            positionMs: 4000,
          }),
        ]);
      }
    });

    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 1000,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 4, 6);
    expect(eventsByName(eventHandler, "soundProgress").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        positionMs: 4000,
        durationMs: 10000,
      },
    });
  });

  it("starts pending play after a reentrant no-op resume from soundReady", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    eventHandler.mockImplementation((eventName) => {
      if (eventName === "soundReady") {
        render([playbackSound({ commandId: 2, operation: "resume" })]);
      }
    });

    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 2000,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 2, 8);
  });

  it("reports only an error for an out-of-range seek queued during decode", async () => {
    let resolveDecode;
    const decodePromise = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    const { context, eventHandler, render } = await setupControlledStage({
      assets: new Map(),
      pendingAssets: new Map([["track", decodePromise]]),
    });

    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 1000,
      }),
    ]);
    render([
      playbackSound({
        commandId: 2,
        operation: "seek",
        positionMs: 11000,
      }),
    ]);
    resolveDecode({ duration: 10 });
    await flushMicrotasks();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 1, 9);
    expect(eventHandler.mock.calls.map(([name]) => name)).toEqual([
      "soundReady",
      "soundError",
    ]);
    expect(eventsByName(eventHandler, "soundError").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        errorCode: "invalid-position",
      },
    });
  });

  it("preserves a valid pending play when a later play is out of range", async () => {
    let resolveDecode;
    const decodePromise = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    const { context, eventHandler, render } = await setupControlledStage({
      assets: new Map(),
      pendingAssets: new Map([["track", decodePromise]]),
    });

    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 1000,
      }),
    ]);
    render([
      playbackSound({
        commandId: 2,
        operation: "play",
        positionMs: 11000,
      }),
    ]);
    resolveDecode({ duration: 10 });
    await flushMicrotasks();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 1, 9);
    expect(eventsByName(eventHandler, "soundReady").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        positionMs: 1000,
        durationMs: 10000,
      },
    });
    expect(eventsByName(eventHandler, "soundError").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        errorCode: "invalid-position",
      },
    });
  });

  it("keeps resume stopped after stop supersedes pending decode", async () => {
    let resolveDecode;
    const decodePromise = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    const { context, eventHandler, render } = await setupControlledStage({
      assets: new Map(),
      pendingAssets: new Map([["track", decodePromise]]),
    });

    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 1000,
      }),
    ]);
    render([playbackSound({ commandId: 2, operation: "stop" })]);
    render([playbackSound({ commandId: 3, operation: "resume" })]);
    resolveDecode({ duration: 10 });
    await flushMicrotasks();

    expect(context.sources).toHaveLength(0);
    expect(eventsByName(eventHandler, "soundProgress").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 3,
        positionMs: 0,
        durationMs: 10000,
      },
    });
  });

  it("preserves remaining start delay across pause and resume", async () => {
    const { context, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
        startDelayMs: 100,
      }),
    ]);
    await flushMicrotasks();

    vi.advanceTimersByTime(40);
    render([
      playbackSound({
        commandId: 2,
        operation: "pause",
        startDelayMs: 100,
      }),
    ]);
    vi.advanceTimersByTime(100);
    expect(context.sources).toHaveLength(0);

    render([
      playbackSound({
        commandId: 3,
        operation: "resume",
        startDelayMs: 100,
      }),
    ]);
    vi.advanceTimersByTime(59);
    expect(context.sources).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(context.sources).toHaveLength(1);
  });

  it("commits source replacement and leaves an invalid new source stopped", async () => {
    const { context, eventHandler, render, stage } = await setupControlledStage(
      {
        assets: new Map([
          ["track", { duration: 10 }],
          ["next", { duration: 5 }],
        ]),
      },
    );
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();

    render([
      playbackSound({
        commandId: 2,
        operation: "play",
        positionMs: 6000,
        src: "next",
      }),
    ]);
    await flushMicrotasks();

    const currentKey = stage._inspect().currentSoundKeyById.get("player");
    const current = stage._inspect().sounds.get(currentKey);
    expect(current.src).toBe("next");
    expect(current.control.status).toBe("stopped");
    expect(context.sources).toHaveLength(1);
    expect(eventsByName(eventHandler, "soundError").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        errorCode: "invalid-position",
      },
    });
  });

  it("rejects retained playback-mode and invalid source transitions", async () => {
    const { render } = await setupControlledStage();
    const controlled = playbackSound({
      commandId: 4,
      operation: "play",
      positionMs: 0,
    });
    render([controlled]);
    await flushMicrotasks();

    expect(() =>
      render([{ id: "player", type: "sound", src: "track" }]),
    ).toThrow("cannot change command-controlled playback mode");
    expect(() =>
      render([
        playbackSound({
          commandId: 4,
          operation: "play",
          positionMs: 0,
          src: "next",
        }),
      ]),
    ).toThrow("must change source identity with a higher play command");
  });

  it("emits progress on the 250ms cadence with playback rate applied", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
        playbackRate: 2,
      }),
    ]);
    await flushMicrotasks();
    eventHandler.mockClear();

    context.currentTime = 10.25;
    vi.advanceTimersByTime(250);
    await flushMicrotasks();

    expect(eventsByName(eventHandler, "soundProgress")).toEqual([
      {
        _event: {
          id: "player",
          commandId: 1,
          positionMs: 500,
          durationMs: 10000,
        },
      },
    ]);
  });

  it("rebinds deferred progress to the latest accepted command", async () => {
    const { eventHandler, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();
    eventHandler.mockClear();

    render([playbackSound({ commandId: 2, operation: "pause" })]);
    render([playbackSound({ commandId: 3, operation: "resume" })]);
    await flushMicrotasks();

    expect(eventsByName(eventHandler, "soundProgress")).toEqual([
      {
        _event: {
          id: "player",
          commandId: 3,
          positionMs: 0,
          durationMs: 10000,
        },
      },
    ]);
  });

  it("uses the decoded segment as the loop and preserves cursor on loop changes", async () => {
    const { context, render } = await setupControlledStage({
      assets: new Map([["track", { duration: 20 }]]),
    });
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 2000,
        startAt: 5,
        endAt: 15,
        loop: true,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources[0].loopStart).toBe(5);
    expect(context.sources[0].loopEnd).toBe(15);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 7);

    context.currentTime = 12;
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 2000,
        startAt: 5,
        endAt: 15,
        loop: false,
      }),
    ]);

    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].stop).toHaveBeenCalledWith(12);
    expect(context.sources[1].loop).toBe(false);
    const [startTime, offset, duration] =
      context.sources[1].start.mock.calls[0];
    expect(startTime).toBe(12);
    expect(offset).toBeCloseTo(9);
    expect(duration).toBeCloseTo(6);
  });

  it("reports asset, segment, and playback failures with stable codes", async () => {
    const unavailable = await setupControlledStage({
      assets: new Map(),
    });
    unavailable.render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();
    expect(eventsByName(unavailable.eventHandler, "soundError").at(-1)).toEqual(
      {
        _event: {
          id: "player",
          commandId: 1,
          errorCode: "asset-unavailable",
        },
      },
    );
    unavailable.stage.destroy();

    const invalidSegment = await setupControlledStage({
      assets: new Map([["track", { duration: 10 }]]),
    });
    invalidSegment.render([
      playbackSound({
        commandId: 2,
        operation: "play",
        positionMs: 0,
        startAt: 10,
      }),
    ]);
    await flushMicrotasks();
    expect(
      eventsByName(invalidSegment.eventHandler, "soundError").at(-1),
    ).toEqual({
      _event: {
        id: "player",
        commandId: 2,
        errorCode: "invalid-segment",
      },
    });
    invalidSegment.stage.destroy();

    const playbackFailure = await setupControlledStage({
      contextOptions: {
        startImpl: () => {
          throw new Error("browser start failure");
        },
      },
    });
    playbackFailure.render([
      playbackSound({
        commandId: 3,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();
    expect(
      eventsByName(playbackFailure.eventHandler, "soundError").at(-1),
    ).toEqual({
      _event: {
        id: "player",
        commandId: 3,
        errorCode: "playback-failed",
      },
    });
    expect(playbackFailure.context.sources[0].disconnect).toHaveBeenCalled();
  });

  it("retries an unavailable asset on a later play command", async () => {
    const assets = new Map();
    const { context, eventHandler, render } = await setupControlledStage({
      assets,
    });
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();
    expect(eventsByName(eventHandler, "soundError")).toHaveLength(1);

    assets.set("track", { duration: 10 });
    render([
      playbackSound({
        commandId: 2,
        operation: "play",
        positionMs: 1000,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 1, 9);
    expect(
      eventsByName(eventHandler, "soundReady").at(-1)._event.commandId,
    ).toBe(2);
  });

  it("enters ended at the terminal cursor without natural completion", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 10000,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources).toHaveLength(0);
    expect(eventsByName(eventHandler, "soundProgress").at(-1)).toEqual({
      _event: {
        id: "player",
        commandId: 1,
        positionMs: 10000,
        durationMs: 10000,
      },
    });
    expect(eventsByName(eventHandler, "soundComplete")).toEqual([]);
  });

  it("controls multiple sounds independently", async () => {
    const { context, eventHandler, render } = await setupControlledStage({
      assets: new Map([
        ["story", { duration: 30 }],
        ["music", { duration: 20 }],
      ]),
    });
    render([
      playbackSound({
        id: "story:bgm",
        src: "story",
        commandId: 1,
        operation: "pause",
      }),
      playbackSound({
        id: "music-room:player",
        src: "music",
        commandId: 2,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources).toHaveLength(1);
    expect(eventsByName(eventHandler, "soundReady")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _event: expect.objectContaining({
            id: "story:bgm",
            commandId: 1,
          }),
        }),
        expect.objectContaining({
          _event: expect.objectContaining({
            id: "music-room:player",
            commandId: 2,
          }),
        }),
      ]),
    );
  });

  it("suppresses decode callbacks after immediate removal", async () => {
    let resolveDecode;
    const decodePromise = new Promise((resolve) => {
      resolveDecode = resolve;
    });
    const { context, eventHandler, render } = await setupControlledStage({
      assets: new Map(),
      pendingAssets: new Map([["track", decodePromise]]),
    });
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    render([]);
    resolveDecode({ duration: 10 });
    await flushMicrotasks();

    expect(context.sources).toHaveLength(0);
    expect(eventHandler).not.toHaveBeenCalled();
  });

  it("does not start when a soundReady handler removes the sound", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    eventHandler.mockImplementation((eventName) => {
      if (eventName === "soundReady") {
        render([]);
      }
    });

    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();

    expect(context.sources).toHaveLength(0);
  });

  it("suppresses progress and completion after destruction", async () => {
    const { context, eventHandler, render, stage } =
      await setupControlledStage();
    render([
      playbackSound({
        commandId: 1,
        operation: "play",
        positionMs: 0,
      }),
    ]);
    await flushMicrotasks();
    const source = context.sources[0];
    eventHandler.mockClear();

    stage.destroy();
    context.currentTime = 11;
    vi.advanceTimersByTime(500);
    source.onended?.();
    await flushMicrotasks();

    expect(eventHandler).not.toHaveBeenCalled();
  });

  it("finishes loopEnd playback as an event-suppressed outgoing tail", async () => {
    const { context, eventHandler, render } = await setupControlledStage();
    const channel = {
      id: "music",
      type: "audio-channel",
      loop: false,
      interruption: "loopEnd",
      children: [
        playbackSound({
          commandId: 1,
          operation: "play",
          positionMs: 0,
          loop: true,
        }),
      ],
    };
    render([channel]);
    await flushMicrotasks();
    eventHandler.mockClear();
    const source = context.sources[0];

    render([{ ...channel, children: [] }]);
    expect(source.loop).toBe(false);
    expect(source.stop).toHaveBeenCalledWith(20);
    source.onended();
    await flushMicrotasks();

    expect(eventsByName(eventHandler, "soundComplete")).toEqual([]);
  });
});
