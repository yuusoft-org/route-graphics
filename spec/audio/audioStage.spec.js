import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAudioParam = (
  initialValue = 0,
  { reflectScheduledValue = true, supportCancelAndHold = true } = {},
) => {
  const param = {
    value: initialValue,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((value) => {
      if (!Number.isFinite(value)) {
        throw new TypeError("AudioParam value must be finite");
      }
      if (reflectScheduledValue) {
        param.value = value;
      }
      return param;
    }),
    linearRampToValueAtTime: vi.fn((value) => {
      if (!Number.isFinite(value)) {
        throw new TypeError("AudioParam value must be finite");
      }
      if (reflectScheduledValue) {
        param.value = value;
      }
      return param;
    }),
  };
  if (supportCancelAndHold) {
    param.cancelAndHoldAtTime = vi.fn();
  }
  return param;
};

const createAudioContextMock = ({
  decodedBuffer = { duration: 1 },
  reflectScheduledAudioParamValue = true,
  startImpl,
  supportCancelAndHold = true,
  supportStereoPanner = true,
} = {}) => {
  const audioParamOptions = {
    reflectScheduledValue: reflectScheduledAudioParamValue,
    supportCancelAndHold,
  };
  const context = {
    currentTime: 10,
    state: "running",
    destination: { label: "destination" },
    gainNodes: [],
    pannerNodes: [],
    sources: [],
    decodeAudioData: vi.fn(() => Promise.resolve(decodedBuffer)),
    resume: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => {
      const node = {
        type: "gain",
        gain: createAudioParam(1, audioParamOptions),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      context.gainNodes.push(node);
      return node;
    }),
    createStereoPanner: vi.fn(() => {
      const node = {
        type: "panner",
        pan: createAudioParam(0, audioParamOptions),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      context.pannerNodes.push(node);
      return node;
    }),
    createBufferSource: vi.fn(() => {
      const node = {
        type: "source",
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: createAudioParam(1, audioParamOptions),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(startImpl),
        stop: vi.fn(),
      };
      context.sources.push(node);
      return node;
    }),
  };

  if (!supportStereoPanner) {
    context.createStereoPanner = undefined;
  }

  return context;
};

const setupAudioStage = async ({
  assetMap = new Map(),
  contextOptions = {},
  getAssetImpl,
} = {}) => {
  vi.resetModules();
  const context = createAudioContextMock(contextOptions);
  const AudioContextMock = vi.fn(function AudioContextMock() {
    return context;
  });
  window.AudioContext = AudioContextMock;
  window.webkitAudioContext = undefined;

  const getAsset = vi.fn(
    getAssetImpl ?? ((src) => assetMap.get(src) ?? { src }),
  );
  vi.doMock("../../src/AudioAsset.js", () => ({
    AudioAsset: {
      getAsset,
    },
  }));

  const { createAudioStage } = await import("../../src/AudioStage.js");
  const stage = createAudioStage();

  return {
    stage,
    context,
    getAsset,
  };
};

const findSound = (stage, id) =>
  [...stage._inspect().sounds.values()].find((sound) => sound.id === id);

const findCurrentSound = (stage, id) => {
  const inspect = stage._inspect();
  const key = inspect.currentSoundKeyById.get(id);
  return inspect.sounds.get(key);
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const keyframePhase = (
  value,
  duration,
  { initialValue, easing = "linear", relative } = {},
) => ({
  ...(initialValue !== undefined ? { initialValue } : {}),
  keyframes: [
    {
      value,
      duration,
      easing,
      ...(relative !== undefined ? { relative } : {}),
    },
  ],
});

describe("AudioStage graph rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock("../../src/AudioAsset.js");
    vi.resetModules();
  });

  it("renders channels, child sounds, and flat sounds through the graph", async () => {
    const { stage, context, getAsset } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "music",
          type: "audio-channel",
          volume: 50,
          children: [
            {
              id: "bgm",
              type: "sound",
              src: "theme",
              volume: 40,
              loop: true,
            },
          ],
        },
        {
          id: "click",
          type: "sound",
          src: "click-sfx",
        },
      ],
    });

    const music = stage._inspect().channels.get("music");
    const bgm = findSound(stage, "bgm");
    const click = findSound(stage, "click");

    expect(music.gainNode.gain.value).toBe(0.5);
    expect(bgm.gainNode.gain.value).toBe(0.4);
    expect(click.gainNode.gain.value).toBe(1);
    expect(getAsset).toHaveBeenCalledWith("theme");
    expect(getAsset).toHaveBeenCalledWith("click-sfx");
    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].loop).toBe(true);
    expect(context.sources[0].start).toHaveBeenCalledWith(
      context.currentTime,
      0,
    );
    expect(context.sources[0].connect).toHaveBeenCalledWith(bgm.gainNode);
    expect(bgm.gainNode.connect).toHaveBeenCalledWith(bgm.pannerNode);
    expect(bgm.pannerNode.connect).toHaveBeenCalledWith(bgm.muteGainNode);
    expect(bgm.muteGainNode.connect).toHaveBeenCalledWith(music.gainNode);
    expect(music.gainNode.connect).toHaveBeenCalledWith(music.pannerNode);
    expect(music.pannerNode.connect).toHaveBeenCalledWith(music.muteGainNode);
    expect(music.muteGainNode.connect).toHaveBeenCalledWith(
      context.destination,
    );
  });

  it("restarts a looping channel only after its complete delayed schedule finishes", async () => {
    const { stage, context } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "music",
          type: "audio-channel",
          loop: true,
          children: [
            { id: "intro", type: "sound", src: "intro" },
            {
              id: "outro",
              type: "sound",
              src: "outro",
              startDelayMs: 100,
            },
          ],
        },
      ],
    });

    expect(context.sources).toHaveLength(1);
    context.sources[0].onended();
    expect(context.sources).toHaveLength(1);

    vi.advanceTimersByTime(100);
    expect(context.sources).toHaveLength(2);
    context.sources[1].onended();

    expect(context.sources).toHaveLength(3);
    expect(findCurrentSound(stage, "outro").pendingTimeoutId).not.toBeNull();

    vi.advanceTimersByTime(100);
    expect(context.sources).toHaveLength(4);
    expect(context.sources[0].disconnect).toHaveBeenCalled();
    expect(context.sources[1].disconnect).toHaveBeenCalled();
  });

  it("can enable channel looping after the current schedule has finished", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [
      {
        id: "music",
        type: "audio-channel",
        children: [{ id: "theme", type: "sound", src: "theme" }],
      },
    ];
    const loopingAudio = [
      {
        ...firstAudio[0],
        loop: true,
      },
    ];

    stage.renderGraph({ nextAudio: firstAudio });
    context.sources[0].onended();

    stage.renderGraph({ prevAudio: firstAudio, nextAudio: loopingAudio });

    expect(context.sources).toHaveLength(2);
    expect(stage._inspect().channels.get("music").loop).toBe(true);
  });

  it("finishes active channel sounds without playing the rest of the schedule when looping is disabled", async () => {
    const { stage, context } = await setupAudioStage();
    const loopingAudio = [
      {
        id: "music",
        type: "audio-channel",
        loop: true,
        children: [
          { id: "current", type: "sound", src: "current" },
          {
            id: "next",
            type: "sound",
            src: "next",
            startDelayMs: 100,
          },
        ],
      },
    ];
    const finishingAudio = [
      {
        ...loopingAudio[0],
        loop: false,
      },
    ];

    stage.renderGraph({ nextAudio: loopingAudio });
    const activeSource = context.sources[0];

    stage.renderGraph({
      prevAudio: loopingAudio,
      nextAudio: finishingAudio,
    });

    expect(findCurrentSound(stage, "next").pendingTimeoutId).toBeNull();
    expect(activeSource.stop).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    activeSource.onended();

    expect(context.sources).toHaveLength(1);
  });

  it("finishes the active channel schedule when interruption uses loopEnd", async () => {
    const { stage, context } = await setupAudioStage();
    const audio = [
      {
        id: "music",
        type: "audio-channel",
        loop: true,
        interruption: "loopEnd",
        children: [
          { id: "current", type: "sound", src: "current" },
          {
            id: "next",
            type: "sound",
            src: "next",
            startDelayMs: 100,
          },
        ],
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    const activeSource = context.sources[0];

    stage.renderGraph({ prevAudio: audio, nextAudio: [] });

    expect(activeSource.stop).not.toHaveBeenCalled();
    expect(findCurrentSound(stage, "next")).toBeUndefined();
    expect(stage._inspect().channels.has("music")).toBe(true);

    activeSource.onended();
    vi.advanceTimersByTime(100);

    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].stop).not.toHaveBeenCalled();

    context.sources[1].onended();

    expect(findSound(stage, "current")).toBeUndefined();
    expect(findSound(stage, "next")).toBeUndefined();
    expect(stage._inspect().channels.has("music")).toBe(false);
  });

  it("applies sound exit transitions while finishing at loop end", async () => {
    const { stage, context } = await setupAudioStage();
    const populatedAudio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [
          {
            id: "outgoing",
            type: "sound",
            src: "outgoing",
            loop: true,
            playbackRate: 1,
          },
        ],
      },
    ];
    const emptyAudio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [],
      },
    ];

    stage.renderGraph({ nextAudio: populatedAudio });
    const outgoing = findCurrentSound(stage, "outgoing");
    const source = context.sources[0];

    stage.renderGraph({
      prevAudio: populatedAudio,
      nextAudio: emptyAudio,
      nextAudioEffects: [
        {
          id: "outgoing-exit",
          type: "audio-transition",
          targetId: "outgoing",
          properties: {
            volume: { exit: keyframePhase(0, 300) },
            pan: { exit: keyframePhase(1, 400) },
            playbackRate: { exit: keyframePhase(0.5, 500) },
          },
        },
      ],
    });

    expect(outgoing.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      10.3,
    );
    expect(
      outgoing.pannerNode.pan.linearRampToValueAtTime,
    ).toHaveBeenCalledWith(1, 10.4);
    expect(source.playbackRate.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.5,
      10.5,
    );
    expect(source.loop).toBe(false);

    source.onended();
    expect(findSound(stage, "outgoing")).toBeDefined();
    vi.advanceTimersByTime(499);
    expect(findSound(stage, "outgoing")).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(findSound(stage, "outgoing")).toBeUndefined();
  });

  it("stops bounded loops at their current configured loop boundary", async () => {
    const { stage, context } = await setupAudioStage();
    const audio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [
          {
            id: "bounded",
            type: "sound",
            src: "bounded",
            loop: true,
            startAt: 1,
            endAt: 4,
          },
        ],
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    const source = context.sources[0];
    context.currentTime = 11;

    stage.renderGraph({ prevAudio: audio, nextAudio: [] });

    expect(source.loop).toBe(false);
    expect(source.stop).toHaveBeenCalledWith(13);
    expect(stage._inspect().channels.has("music")).toBe(true);

    source.onended();
    expect(stage._inspect().channels.has("music")).toBe(false);
  });

  it("explicitly cleans up loop-end sounds with zero playback rate", async () => {
    const { stage, context } = await setupAudioStage();
    const audio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [
          {
            id: "paused",
            type: "sound",
            src: "paused",
            loop: true,
            playbackRate: 0,
          },
        ],
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    const source = context.sources[0];

    stage.renderGraph({ prevAudio: audio, nextAudio: [] });

    expect(source.stop).toHaveBeenCalledWith(context.currentTime);
    expect(findSound(stage, "paused")).toBeUndefined();
    expect(stage._inspect().channels.has("music")).toBe(false);
  });

  it("uses a new bus when a deferred channel is re-added", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [
          { id: "outgoing", type: "sound", src: "outgoing", loop: true },
        ],
      },
    ];
    const readdedAudio = [
      {
        id: "music",
        type: "audio-channel",
        volume: 25,
        pan: 0.5,
        interruption: "loopEnd",
        children: [{ id: "incoming", type: "sound", src: "incoming" }],
      },
    ];

    stage.renderGraph({ nextAudio: firstAudio });
    const outgoingChannel = stage._inspect().channels.get("music");
    const outgoingSource = context.sources[0];

    stage.renderGraph({ prevAudio: firstAudio, nextAudio: [] });
    stage.renderGraph({ prevAudio: [], nextAudio: readdedAudio });

    const incomingChannel = stage._inspect().channels.get("music");
    const incomingSound = findCurrentSound(stage, "incoming");
    expect(incomingChannel).not.toBe(outgoingChannel);
    expect(incomingChannel.gainNode.gain.value).toBe(0.25);
    expect(incomingChannel.pannerNode.pan.value).toBe(0.5);
    expect(outgoingChannel.gainNode.gain.value).toBe(1);
    expect(outgoingChannel.pannerNode.pan.value).toBe(0);
    expect(incomingSound.muteGainNode.connect).toHaveBeenCalledWith(
      incomingChannel.gainNode,
    );

    outgoingSource.onended();

    expect(outgoingChannel.gainNode.disconnect).toHaveBeenCalled();
    expect(stage._inspect().channels.get("music")).toBe(incomingChannel);
  });

  it("retains a removed channel bus for sounds already finishing on it", async () => {
    const { stage, context } = await setupAudioStage();
    const populatedAudio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [
          { id: "outgoing", type: "sound", src: "outgoing", loop: true },
        ],
      },
    ];
    const emptyAudio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [],
      },
    ];

    stage.renderGraph({ nextAudio: populatedAudio });
    const channel = stage._inspect().channels.get("music");
    const outgoingSource = context.sources[0];

    stage.renderGraph({
      prevAudio: populatedAudio,
      nextAudio: emptyAudio,
    });
    stage.renderGraph({ prevAudio: emptyAudio, nextAudio: [] });

    expect(channel.gainNode.disconnect).not.toHaveBeenCalled();
    expect(stage._inspect().channels.get("music")).toBe(channel);

    outgoingSource.onended();

    expect(channel.gainNode.disconnect).toHaveBeenCalled();
    expect(stage._inspect().channels.has("music")).toBe(false);
  });

  it("cleans up a deferred channel when its pending sound cannot start", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stage, getAsset } = await setupAudioStage({
      getAssetImpl: () => null,
    });
    const audio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [
          {
            id: "missing",
            type: "sound",
            src: "missing",
            startDelayMs: 100,
          },
        ],
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    stage.renderGraph({ prevAudio: audio, nextAudio: [] });

    expect(findSound(stage, "missing")?.finishing).toBe(true);
    expect(stage._inspect().channels.has("music")).toBe(true);

    vi.advanceTimersByTime(100);

    expect(getAsset).toHaveBeenCalledWith("missing");
    expect(warn).toHaveBeenCalledWith("AudioStage: asset not found", "missing");
    expect(findSound(stage, "missing")).toBeUndefined();
    expect(stage._inspect().channels.has("music")).toBe(false);
  });

  it("stops an interrupted channel schedule immediately by default", async () => {
    const { stage, context } = await setupAudioStage();
    const audio = [
      {
        id: "music",
        type: "audio-channel",
        children: [
          { id: "current", type: "sound", src: "current" },
          {
            id: "next",
            type: "sound",
            src: "next",
            startDelayMs: 100,
          },
        ],
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    const activeSource = context.sources[0];

    stage.renderGraph({ prevAudio: audio, nextAudio: [] });
    vi.advanceTimersByTime(100);

    expect(activeSource.stop).toHaveBeenCalled();
    expect(context.sources).toHaveLength(1);
    expect(stage._inspect().channels.has("music")).toBe(false);
  });

  it("sanitizes direct audio defaults across repeated ticks", async () => {
    const { stage } = await setupAudioStage();

    stage.add({ id: "blip", url: "message-display1", volume: Number.NaN });

    expect(() => stage.tick()).not.toThrow();
    expect(() => stage.tick()).not.toThrow();

    const blip = findCurrentSound(stage, "blip");
    expect(blip.gainNode.gain.value).toBe(1);
    expect(blip.pannerNode.pan.value).toBe(0);
    expect(blip.source.playbackRate.value).toBe(1);
  });

  it("sanitizes invalid direct audio volume before scheduling playback", async () => {
    const { stage } = await setupAudioStage();

    stage.add({ id: "sfx", url: "click", volume: Number.NaN });

    expect(() => stage.tick()).not.toThrow();
    expect(findCurrentSound(stage, "sfx").gainNode.gain.value).toBe(1);
  });

  it("finishes direct audio at its active loop end", async () => {
    const { stage, context } = await setupAudioStage();

    stage.add({ id: "typing", url: "voice-blip", loop: true });
    stage.tick();

    const source = context.sources[0];
    expect(source.loop).toBe(true);

    stage.finish("typing");
    stage.tick();

    expect(source.loop).toBe(false);
    expect(source.stop).not.toHaveBeenCalled();
    expect(stage.getById("typing")).toBeUndefined();
    expect(findSound(stage, "typing")?.finishing).toBe(true);

    source.onended();

    expect(findSound(stage, "typing")).toBeUndefined();
  });

  it("does not start delayed direct audio after it is finished", async () => {
    const { stage, context, getAsset } = await setupAudioStage();

    stage.add({
      id: "typing",
      url: "voice-blip",
      loop: true,
      startDelayMs: 100,
    });
    stage.tick();
    stage.finish("typing");

    vi.advanceTimersByTime(100);

    expect(getAsset).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
    expect(findSound(stage, "typing")).toBeUndefined();
  });

  it("stops a finishing direct sound before reusing its id", async () => {
    const { stage, context } = await setupAudioStage();

    stage.add({ id: "typing", url: "voice-blip", loop: true });
    stage.tick();
    const finishingSource = context.sources[0];

    stage.finish("typing");
    stage.add({ id: "typing", url: "voice-blip", loop: true });
    stage.tick();

    expect(finishingSource.stop).toHaveBeenCalled();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].loop).toBe(true);
  });

  it("stops rather than defers a finishing sound in a suspended context", async () => {
    const { stage, context } = await setupAudioStage();
    context.state = "suspended";
    context.resume.mockRejectedValue(new Error("autoplay blocked"));

    stage.add({ id: "typing", url: "voice-blip", loop: true });
    stage.tick();
    await flushPromises();

    const source = context.sources[0];
    stage.finish("typing");

    expect(source.stop).toHaveBeenCalled();
    expect(findSound(stage, "typing")).toBeUndefined();
  });

  it("resumes a suspended audio context before playback starts", async () => {
    const { stage, context } = await setupAudioStage();
    context.state = "suspended";

    stage.renderGraph({
      nextAudio: [{ id: "sfx", type: "sound", src: "click" }],
    });

    expect(context.resume).toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);

    context.state = "running";
    await flushPromises();

    expect(context.sources).toHaveLength(1);
  });

  it("cancels suspended-context playback before resume resolves", async () => {
    const { stage, context, getAsset } = await setupAudioStage();
    let resolveResume;
    context.state = "suspended";
    context.resume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = () => {
            context.state = "running";
            resolve();
          };
        }),
    );
    const audio = [{ id: "sfx", type: "sound", src: "click" }];

    stage.renderGraph({ nextAudio: audio });

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(0);

    stage.renderGraph({ prevAudio: audio, nextAudio: [] });
    resolveResume();
    await flushPromises();

    expect(getAsset).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
  });

  it("uses one audio context for asset decode and playback", async () => {
    vi.resetModules();
    vi.doUnmock("../../src/AudioAsset.js");

    const decodedBuffer = { duration: 1.25 };
    const context = createAudioContextMock({ decodedBuffer });
    const AudioContextMock = vi.fn(function AudioContextMock() {
      return context;
    });
    window.AudioContext = AudioContextMock;
    window.webkitAudioContext = undefined;

    const { AudioAsset } = await import("../../src/AudioAsset.js");
    const { createAudioStage } = await import("../../src/AudioStage.js");
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;

    await AudioAsset.load("theme", arrayBuffer);

    const stage = createAudioStage();
    stage.renderGraph({
      nextAudio: [{ id: "theme-sound", type: "sound", src: "theme" }],
    });

    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledWith(arrayBuffer);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].buffer).toBe(decodedBuffer);
  });

  it("exposes an explicit resume hook for user input unlocks", async () => {
    const { stage, context } = await setupAudioStage();
    context.state = "suspended";

    await stage.resume();

    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended audio context before scheduling delayed playback", async () => {
    const { stage, context, getAsset } = await setupAudioStage();
    context.state = "suspended";
    context.resume.mockImplementation(() => {
      context.state = "running";
      return Promise.resolve();
    });

    stage.renderGraph({
      nextAudio: [
        {
          id: "sfx",
          type: "sound",
          src: "click",
          startDelayMs: 100,
        },
      ],
    });

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(getAsset).not.toHaveBeenCalled();

    await flushPromises();
    vi.advanceTimersByTime(100);

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(getAsset).toHaveBeenCalledWith("click");
  });

  it("applies enter, update, and exit volume transitions", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [
      {
        id: "music",
        type: "audio-channel",
        volume: 80,
        children: [{ id: "bgm", type: "sound", src: "theme" }],
      },
    ];

    stage.renderGraph({
      nextAudio: firstAudio,
      nextAudioEffects: [
        {
          id: "music-enter",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              enter: keyframePhase(80, 1000, { initialValue: 0 }),
            },
          },
        },
      ],
    });

    const music = stage._inspect().channels.get("music");
    expect(music.gainNode.gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
    expect(music.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.8,
      11,
    );

    const secondAudio = [
      {
        id: "music",
        type: "audio-channel",
        volume: 30,
        children: [{ id: "bgm", type: "sound", src: "theme" }],
      },
    ];

    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: secondAudio,
      nextAudioEffects: [
        {
          id: "music-update",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              update: keyframePhase(30, 500),
            },
          },
        },
      ],
    });

    expect(music.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.3,
      10.5,
    );

    const bgmSource = context.sources[0];
    stage.renderGraph({
      prevAudio: secondAudio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "music-exit",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              exit: keyframePhase(0, 1000),
            },
          },
        },
      ],
    });

    expect(music.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      11,
    );
    expect(bgmSource.stop).toHaveBeenCalledWith(11);
  });

  it("uses the explicit enter start when AudioParam readback is stale", async () => {
    const { stage } = await setupAudioStage({
      contextOptions: { reflectScheduledAudioParamValue: false },
    });

    stage.renderGraph({
      nextAudio: [
        {
          id: "bgm",
          type: "sound",
          src: "theme",
          volume: 80,
        },
      ],
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              enter: keyframePhase(80, 1000, { initialValue: 0 }),
            },
          },
        },
      ],
    });

    const bgm = findCurrentSound(stage, "bgm");
    expect(bgm.gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10);
    expect(bgm.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.8,
      11,
    );
  });

  it("schedules multi-stage keyframes and animation easings", async () => {
    const { stage } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "bgm",
          type: "sound",
          src: "theme",
          volume: 80,
        },
      ],
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              enter: {
                initialValue: 0,
                keyframes: [
                  { value: 40, duration: 200, easing: "linear" },
                  { value: 80, duration: 300, easing: "easeInQuad" },
                ],
              },
            },
          },
        },
      ],
    });

    const gain = findCurrentSound(stage, "bgm").gainNode.gain;
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.4, 10.2);
    expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.8, 10.5);
    expect(gain.linearRampToValueAtTime.mock.calls.length).toBeGreaterThan(2);
  });

  it("holds through delay, jumps to startValue, and ramps to the endpoint", async () => {
    const { stage } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "bgm",
          type: "sound",
          src: "theme",
          volume: 50,
        },
      ],
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              enter: {
                initialValue: 100,
                keyframes: [
                  {
                    delay: 200,
                    startValue: 20,
                    value: 50,
                    duration: 300,
                    easing: "linear",
                  },
                ],
              },
            },
          },
        },
      ],
    });

    const gain = findCurrentSound(stage, "bgm").gainNode.gain;
    expect(gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(1, 1, 10.2);
    expect(gain.setValueAtTime).toHaveBeenCalledWith(0.2, 10.2);
    expect(gain.linearRampToValueAtTime).toHaveBeenNthCalledWith(2, 0.5, 10.5);
  });

  it("clamps a relative start before resolving its relative endpoint", async () => {
    const { stage } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [{ id: "bgm", type: "sound", src: "theme", pan: 0.8 }],
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: {
              enter: {
                initialValue: 0.8,
                keyframes: [
                  {
                    startValue: 0.5,
                    value: -0.2,
                    relative: true,
                    duration: 100,
                  },
                  { value: 0.8, duration: 0 },
                ],
              },
            },
          },
        },
      ],
    });

    const pan = findCurrentSound(stage, "bgm").pannerNode.pan;
    expect(pan.setValueAtTime).toHaveBeenCalledWith(1, 10);
    expect(pan.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 10.1);
  });

  it("tracks the held value before startValue and the ramp after it", async () => {
    const { stage, context } = await setupAudioStage({
      contextOptions: {
        reflectScheduledAudioParamValue: false,
        supportCancelAndHold: false,
      },
    });
    const initialAudio = [{ id: "bgm", type: "sound", src: "theme", pan: 1 }];

    stage.renderGraph({
      nextAudio: initialAudio,
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: {
              enter: {
                initialValue: -1,
                keyframes: [
                  {
                    delay: 500,
                    startValue: 0.5,
                    value: 1,
                    duration: 500,
                  },
                ],
              },
            },
          },
        },
      ],
    });

    context.currentTime = 10.25;
    stage.renderGraph({
      prevAudio: initialAudio,
      nextAudio: [{ id: "bgm", type: "sound", src: "theme", pan: 0 }],
      nextAudioEffects: [
        {
          id: "bgm-update",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: { update: keyframePhase(0, 100) },
          },
        },
      ],
    });
    let pan = findCurrentSound(stage, "bgm").pannerNode.pan;
    expect(pan.setValueAtTime).toHaveBeenLastCalledWith(-1, 10.25);

    stage.renderGraph({
      prevAudio: [{ id: "bgm", type: "sound", src: "theme", pan: 0 }],
      nextAudio: [{ id: "bgm", type: "sound", src: "theme", pan: 1 }],
      nextAudioEffects: [
        {
          id: "bgm-enter-again",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: {
              update: {
                initialValue: -1,
                keyframes: [
                  {
                    delay: 500,
                    startValue: 0.5,
                    value: 1,
                    duration: 500,
                  },
                ],
              },
            },
          },
        },
      ],
    });
    context.currentTime = 11;
    stage.renderGraph({
      prevAudio: [{ id: "bgm", type: "sound", src: "theme", pan: 1 }],
      nextAudio: [{ id: "bgm", type: "sound", src: "theme", pan: 0 }],
      nextAudioEffects: [
        {
          id: "bgm-update-after-start",
          type: "audio-transition",
          targetId: "bgm",
          properties: { pan: { update: keyframePhase(0, 100) } },
        },
      ],
    });
    pan = findCurrentSound(stage, "bgm").pannerNode.pan;
    expect(pan.setValueAtTime).toHaveBeenLastCalledWith(0.75, 11);
  });

  it("accumulates relative keyframes from clamped audible endpoints", async () => {
    const { stage } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "bgm",
          type: "sound",
          src: "theme",
          pan: 0.8,
        },
      ],
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: {
              enter: {
                initialValue: 0.8,
                keyframes: [
                  { value: 0.5, duration: 100, relative: true },
                  { value: -0.2, duration: 100, relative: true },
                  { value: 0.8, duration: 0 },
                ],
              },
            },
          },
        },
      ],
    });

    const pan = findCurrentSound(stage, "bgm").pannerNode.pan;
    expect(pan.linearRampToValueAtTime).toHaveBeenNthCalledWith(1, 1, 10.1);
    expect(pan.linearRampToValueAtTime).toHaveBeenNthCalledWith(2, 0.8, 10.2);
  });

  it("bounds easing samples for long non-linear keyframes", async () => {
    const { stage } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "bgm",
          type: "sound",
          src: "theme",
          volume: 80,
        },
      ],
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              enter: {
                initialValue: 0,
                keyframes: [
                  { value: 80, duration: 600_000, easing: "easeInQuad" },
                ],
              },
            },
          },
        },
      ],
    });

    const gain = findCurrentSound(stage, "bgm").gainNode.gain;
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1024);
    expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.8, 610);
  });

  it("uses the summed keyframe duration for exit cleanup", async () => {
    const { stage, context } = await setupAudioStage();
    const audio = [{ id: "bgm", type: "sound", src: "theme", volume: 100 }];

    stage.renderGraph({ nextAudio: audio });
    const source = context.sources[0];
    const gain = findCurrentSound(stage, "bgm").gainNode.gain;
    stage.renderGraph({
      prevAudio: audio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "bgm-exit",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              exit: {
                keyframes: [
                  {
                    value: -50,
                    duration: 400,
                    easing: "linear",
                    relative: true,
                  },
                  { value: 0, duration: 600, easing: "linear" },
                ],
              },
            },
          },
        },
      ],
    });

    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 10.4);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 11);
    expect(source.stop).toHaveBeenCalledWith(11);
  });

  it("holds tracked pan and playback-rate values when ramps are interrupted", async () => {
    const { stage, context } = await setupAudioStage({
      contextOptions: { reflectScheduledAudioParamValue: false },
    });
    const firstAudio = [
      {
        id: "bgm",
        type: "sound",
        src: "theme",
        pan: 1,
        playbackRate: 2,
      },
    ];

    stage.renderGraph({
      nextAudio: firstAudio,
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: {
              enter: keyframePhase(1, 1000, { initialValue: -1 }),
            },
            playbackRate: {
              enter: keyframePhase(2, 1000, { initialValue: 0.5 }),
            },
          },
        },
      ],
    });

    context.currentTime = 10.25;
    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: [
        {
          id: "bgm",
          type: "sound",
          src: "theme",
          pan: -1,
          playbackRate: 1,
        },
      ],
      nextAudioEffects: [
        {
          id: "bgm-update",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: { update: keyframePhase(-1, 500) },
            playbackRate: { update: keyframePhase(1, 500) },
          },
        },
      ],
    });

    const bgm = findCurrentSound(stage, "bgm");
    expect(bgm.pannerNode.pan.cancelAndHoldAtTime).toHaveBeenCalledWith(10.25);
    expect(bgm.pannerNode.pan.setValueAtTime).toHaveBeenLastCalledWith(
      -0.5,
      10.25,
    );
    expect(bgm.source.playbackRate.cancelAndHoldAtTime).toHaveBeenCalledWith(
      10.25,
    );
    expect(bgm.source.playbackRate.setValueAtTime).toHaveBeenLastCalledWith(
      0.875,
      10.25,
    );
  });

  it("tracks interrupted ramp values without cancelAndHoldAtTime", async () => {
    const { stage, context } = await setupAudioStage({
      contextOptions: {
        reflectScheduledAudioParamValue: false,
        supportCancelAndHold: false,
      },
    });
    const firstAudio = [{ id: "bgm", type: "sound", src: "theme", pan: 1 }];

    stage.renderGraph({
      nextAudio: firstAudio,
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: {
              enter: keyframePhase(1, 1000, { initialValue: -1 }),
            },
          },
        },
      ],
    });

    context.currentTime = 10.25;
    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: [{ id: "bgm", type: "sound", src: "theme", pan: 0 }],
      nextAudioEffects: [
        {
          id: "bgm-update",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: { update: keyframePhase(0, 500) },
          },
        },
      ],
    });

    const pan = findCurrentSound(stage, "bgm").pannerNode.pan;
    expect(pan.cancelScheduledValues).toHaveBeenLastCalledWith(10.25);
    expect(pan.setValueAtTime).toHaveBeenLastCalledWith(-0.5, 10.25);
  });

  it("applies enter, update, and exit pan transitions", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [
      {
        id: "music",
        type: "audio-channel",
        pan: 0.5,
        children: [{ id: "bgm", type: "sound", src: "theme", pan: -0.5 }],
      },
    ];

    stage.renderGraph({
      nextAudio: firstAudio,
      nextAudioEffects: [
        {
          id: "music-enter",
          type: "audio-transition",
          targetId: "music",
          properties: {
            pan: {
              enter: keyframePhase(0.5, 1000, { initialValue: -1 }),
            },
          },
        },
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: {
              enter: keyframePhase(-0.5, 500, { initialValue: 1 }),
            },
          },
        },
      ],
    });

    const music = stage._inspect().channels.get("music");
    const bgm = findCurrentSound(stage, "bgm");
    expect(music.pannerNode.pan.setValueAtTime).toHaveBeenCalledWith(-1, 10);
    expect(music.pannerNode.pan.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.5,
      11,
    );
    expect(bgm.pannerNode.pan.setValueAtTime).toHaveBeenCalledWith(1, 10);
    expect(bgm.pannerNode.pan.linearRampToValueAtTime).toHaveBeenCalledWith(
      -0.5,
      10.5,
    );

    const secondAudio = [
      {
        id: "music",
        type: "audio-channel",
        pan: -0.25,
        children: [{ id: "bgm", type: "sound", src: "theme", pan: 0.25 }],
      },
    ];
    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: secondAudio,
      nextAudioEffects: [
        {
          id: "music-update",
          type: "audio-transition",
          targetId: "music",
          properties: {
            pan: { update: keyframePhase(-0.25, 200) },
          },
        },
        {
          id: "bgm-update",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: { update: keyframePhase(0.25, 300) },
          },
        },
      ],
    });

    expect(music.pannerNode.pan.linearRampToValueAtTime).toHaveBeenCalledWith(
      -0.25,
      10.2,
    );
    expect(bgm.pannerNode.pan.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.25,
      10.3,
    );

    const source = context.sources[0];
    stage.renderGraph({
      prevAudio: secondAudio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "music-exit",
          type: "audio-transition",
          targetId: "music",
          properties: {
            pan: { exit: keyframePhase(1, 700) },
          },
        },
        {
          id: "bgm-exit",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: { exit: keyframePhase(-1, 900) },
          },
        },
      ],
    });

    expect(music.pannerNode.pan.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      10.7,
    );
    expect(bgm.pannerNode.pan.linearRampToValueAtTime).toHaveBeenCalledWith(
      -1,
      10.9,
    );
    expect(source.stop).toHaveBeenCalledWith(10.9);
  });

  it("ignores pan-only exit duration when stereo panning is unavailable", async () => {
    const { stage, context } = await setupAudioStage({
      contextOptions: { supportStereoPanner: false },
    });
    const audio = [{ id: "bgm", type: "sound", src: "theme", pan: 1 }];

    stage.renderGraph({ nextAudio: audio });
    const source = context.sources[0];
    stage.renderGraph({
      prevAudio: audio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "bgm-exit",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            pan: { exit: keyframePhase(-1, 900) },
          },
        },
      ],
    });

    expect(source.stop).toHaveBeenCalledWith(10);
    expect(findSound(stage, "bgm")).toBeUndefined();
  });

  it("applies enter, update, and exit playback-rate transitions", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [
      {
        id: "bgm",
        type: "sound",
        src: "theme",
        playbackRate: 1.5,
      },
    ];

    stage.renderGraph({
      nextAudio: firstAudio,
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            playbackRate: {
              enter: keyframePhase(1.5, 1000, { initialValue: 0.5 }),
            },
          },
        },
      ],
    });

    const source = context.sources[0];
    expect(source.playbackRate.setValueAtTime).toHaveBeenCalledWith(0.5, 10);
    expect(source.playbackRate.linearRampToValueAtTime).toHaveBeenCalledWith(
      1.5,
      11,
    );

    const secondAudio = [
      { id: "bgm", type: "sound", src: "theme", playbackRate: 2 },
    ];
    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: secondAudio,
      nextAudioEffects: [
        {
          id: "bgm-update",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            playbackRate: {
              update: keyframePhase(2, 400),
            },
          },
        },
      ],
    });

    expect(source.playbackRate.linearRampToValueAtTime).toHaveBeenCalledWith(
      2,
      10.4,
    );

    stage.renderGraph({
      prevAudio: secondAudio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "bgm-exit",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            playbackRate: {
              exit: keyframePhase(0.25, 1200),
            },
          },
        },
      ],
    });

    expect(source.playbackRate.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.25,
      11.2,
    );
    expect(source.stop).toHaveBeenCalledWith(11.2);
  });

  it("starts delayed playback-rate transitions when the source starts", async () => {
    const { stage, context } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "bgm",
          type: "sound",
          src: "theme",
          startDelayMs: 100,
          playbackRate: 2,
        },
      ],
      nextAudioEffects: [
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            playbackRate: {
              enter: keyframePhase(2, 300, { initialValue: 0.5 }),
            },
          },
        },
      ],
    });

    expect(context.sources).toHaveLength(0);
    vi.advanceTimersByTime(100);

    const source = context.sources[0];
    expect(source.playbackRate.setValueAtTime).toHaveBeenCalledWith(0.5, 10);
    expect(source.playbackRate.linearRampToValueAtTime).toHaveBeenCalledWith(
      2,
      10.3,
    );
  });

  it("does not cancel unchanged channel or sound volume ramps", async () => {
    const { stage } = await setupAudioStage();
    const audio = [
      {
        id: "music",
        type: "audio-channel",
        volume: 80,
        children: [{ id: "bgm", type: "sound", src: "theme", volume: 60 }],
      },
    ];

    stage.renderGraph({
      nextAudio: audio,
      nextAudioEffects: [
        {
          id: "music-enter",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              enter: keyframePhase(80, 1000, { initialValue: 0 }),
            },
          },
        },
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              enter: keyframePhase(60, 1000, { initialValue: 0 }),
            },
          },
        },
      ],
    });

    const music = stage._inspect().channels.get("music");
    const bgm = findCurrentSound(stage, "bgm");
    music.gainNode.gain.cancelScheduledValues.mockClear();
    music.gainNode.gain.setValueAtTime.mockClear();
    bgm.gainNode.gain.cancelScheduledValues.mockClear();
    bgm.gainNode.gain.setValueAtTime.mockClear();

    stage.renderGraph({
      prevAudio: audio,
      nextAudio: audio,
      prevAudioEffects: [
        {
          id: "music-enter",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              enter: keyframePhase(80, 1000, { initialValue: 0 }),
            },
          },
        },
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              enter: keyframePhase(60, 1000, { initialValue: 0 }),
            },
          },
        },
      ],
      nextAudioEffects: [
        {
          id: "music-enter",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              enter: keyframePhase(80, 1000, { initialValue: 0 }),
            },
          },
        },
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              enter: keyframePhase(60, 1000, { initialValue: 0 }),
            },
          },
        },
      ],
    });

    expect(music.gainNode.gain.cancelScheduledValues).not.toHaveBeenCalled();
    expect(music.gainNode.gain.setValueAtTime).not.toHaveBeenCalled();
    expect(bgm.gainNode.gain.cancelScheduledValues).not.toHaveBeenCalled();
    expect(bgm.gainNode.gain.setValueAtTime).not.toHaveBeenCalled();
  });

  it("uses a fresh channel bus when re-adding a channel that is still exiting", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [
      {
        id: "music",
        type: "audio-channel",
        volume: 80,
        children: [{ id: "bgm", type: "sound", src: "track-a" }],
      },
    ];
    const nextAudio = [
      {
        id: "music",
        type: "audio-channel",
        volume: 80,
        children: [{ id: "bgm", type: "sound", src: "track-b" }],
      },
    ];

    stage.renderGraph({ nextAudio: firstAudio });
    const exitingChannel = stage._inspect().channels.get("music");
    const firstSource = context.sources[0];

    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "music-exit",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              exit: keyframePhase(0, 1000),
            },
          },
        },
      ],
    });

    stage.renderGraph({
      prevAudio: [],
      nextAudio,
      nextAudioEffects: [
        {
          id: "music-enter",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              enter: keyframePhase(80, 1000, { initialValue: 0 }),
            },
          },
        },
      ],
    });

    const activeChannel = stage._inspect().channels.get("music");
    expect(activeChannel).not.toBe(exitingChannel);
    expect(context.sources).toHaveLength(2);
    expect(firstSource.stop).toHaveBeenCalledWith(11);

    vi.advanceTimersByTime(1000);

    expect(stage._inspect().channels.get("music")).toBe(activeChannel);
    expect(findCurrentSound(stage, "bgm").src).toBe("track-b");
  });

  it("replaces same-id sounds with different sources using overlapping instances", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [{ id: "bgm", type: "sound", src: "track-a" }];
    const secondAudio = [{ id: "bgm", type: "sound", src: "track-b" }];

    stage.renderGraph({ nextAudio: firstAudio });
    const firstSource = context.sources[0];

    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: secondAudio,
      nextAudioEffects: [
        {
          id: "bgm-handoff",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              exit: keyframePhase(0, 1000),
              enter: keyframePhase(100, 1000, { initialValue: 0 }),
            },
          },
        },
      ],
    });

    expect(context.sources).toHaveLength(2);
    expect(firstSource.stop).toHaveBeenCalledWith(11);
    expect(findCurrentSound(stage, "bgm").src).toBe("track-b");
  });

  it.each([
    ["startAt", { startAt: 1 }],
    ["endAt", { endAt: 2 }],
    ["startDelayMs", { startDelayMs: 100 }],
  ])(
    "replaces same-id sounds when %s changes",
    async (_field, sourceIdentityChange) => {
      const { stage } = await setupAudioStage();
      const firstAudio = [{ id: "bgm", type: "sound", src: "track" }];
      const secondAudio = [
        {
          id: "bgm",
          type: "sound",
          src: "track",
          ...sourceIdentityChange,
        },
      ];

      stage.renderGraph({ nextAudio: firstAudio });
      const outgoing = findCurrentSound(stage, "bgm");

      stage.renderGraph({
        prevAudio: firstAudio,
        nextAudio: secondAudio,
        nextAudioEffects: [
          {
            id: "bgm-exit",
            type: "audio-transition",
            targetId: "bgm",
            properties: {
              volume: {
                exit: keyframePhase(0, 1000),
              },
            },
          },
        ],
      });

      const incoming = findCurrentSound(stage, "bgm");
      expect(incoming).not.toBe(outgoing);
      expect(stage._inspect().sounds.size).toBe(2);
      expect(outgoing.source.stop).toHaveBeenCalledWith(11);
    },
  );

  it.each([
    [
      "sound",
      "audio-channel",
      { id: "shared", type: "sound", src: "track" },
      { id: "shared", type: "audio-channel" },
    ],
    [
      "audio-channel",
      "sound",
      { id: "shared", type: "audio-channel" },
      { id: "shared", type: "sound", src: "track" },
    ],
  ])(
    "rejects changing an audio node from %s to %s",
    async (previousType, nextType, previousNode, nextNode) => {
      const { stage } = await setupAudioStage();

      expect(() =>
        stage.renderGraph({
          prevAudio: [previousNode],
          nextAudio: [nextNode],
        }),
      ).toThrow(`cannot change type from "${previousType}" to "${nextType}"`);
    },
  );

  it("reconnects continuing sounds when they move between channels", async () => {
    const { stage } = await setupAudioStage();
    const firstAudio = [
      {
        id: "music-a",
        type: "audio-channel",
        children: [{ id: "bgm", type: "sound", src: "track" }],
      },
      {
        id: "music-b",
        type: "audio-channel",
        children: [],
      },
    ];
    const secondAudio = [
      {
        id: "music-a",
        type: "audio-channel",
        children: [],
      },
      {
        id: "music-b",
        type: "audio-channel",
        children: [{ id: "bgm", type: "sound", src: "track" }],
      },
    ];

    stage.renderGraph({ nextAudio: firstAudio });
    const bgm = findCurrentSound(stage, "bgm");
    const firstChannel = stage._inspect().channels.get("music-a");
    const secondChannel = stage._inspect().channels.get("music-b");

    expect(bgm.muteGainNode.connect).toHaveBeenCalledWith(
      firstChannel.gainNode,
    );

    stage.renderGraph({ prevAudio: firstAudio, nextAudio: secondAudio });

    expect(bgm.muteGainNode.disconnect).toHaveBeenCalled();
    expect(bgm.muteGainNode.connect).toHaveBeenCalledWith(
      secondChannel.gainNode,
    );
    expect(findCurrentSound(stage, "bgm")).toBe(bgm);
  });

  it("cancels pending startDelayMs playback when a sound is removed", async () => {
    const { stage, getAsset } = await setupAudioStage();
    const delayedAudio = [
      {
        id: "sfx",
        type: "sound",
        src: "click",
        startDelayMs: 100,
      },
    ];

    stage.renderGraph({ nextAudio: delayedAudio });
    expect(getAsset).not.toHaveBeenCalled();

    stage.renderGraph({
      prevAudio: delayedAudio,
      nextAudio: [],
    });

    vi.advanceTimersByTime(100);

    expect(getAsset).not.toHaveBeenCalled();
    expect(findSound(stage, "sfx")).toBeUndefined();
  });

  it("replaces pending playback when startDelayMs changes", async () => {
    const { stage, getAsset } = await setupAudioStage();
    const firstAudio = [
      {
        id: "sfx",
        type: "sound",
        src: "click",
        startDelayMs: 100,
      },
    ];
    const secondAudio = [
      {
        id: "sfx",
        type: "sound",
        src: "click",
        startDelayMs: 300,
      },
    ];
    const immediateAudio = [
      {
        id: "sfx",
        type: "sound",
        src: "click",
        startDelayMs: 0,
      },
    ];

    stage.renderGraph({ nextAudio: firstAudio });
    const firstInstance = findCurrentSound(stage, "sfx");
    vi.advanceTimersByTime(50);

    stage.renderGraph({ prevAudio: firstAudio, nextAudio: secondAudio });
    const secondInstance = findCurrentSound(stage, "sfx");
    expect(secondInstance).not.toBe(firstInstance);
    vi.advanceTimersByTime(50);
    expect(getAsset).not.toHaveBeenCalled();

    stage.renderGraph({ prevAudio: secondAudio, nextAudio: immediateAudio });
    expect(findCurrentSound(stage, "sfx")).not.toBe(secondInstance);
    expect(getAsset).toHaveBeenCalledWith("click");
  });

  it("loops bounded sound segments instead of starting them with a duration", async () => {
    const { stage, context } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "loop",
          type: "sound",
          src: "track",
          loop: true,
          startAt: 1,
          endAt: 4,
        },
      ],
    });

    const source = context.sources[0];
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(1);
    expect(source.loopEnd).toBe(4);
    expect(source.start).toHaveBeenCalledWith(context.currentTime, 1);
    expect(source.start.mock.calls[0]).toHaveLength(2);
  });

  it("pauses and resumes a looping channel at each child cursor and remaining delay", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([
        ["intro", { duration: 10 }],
        ["outro", { duration: 10 }],
      ]),
    });
    const channel = (commandId, operation) => [
      {
        id: "music",
        type: "audio-channel",
        loop: true,
        playback: { commandId, operation },
        children: [
          { id: "intro", type: "sound", src: "intro" },
          {
            id: "outro",
            type: "sound",
            src: "outro",
            startDelayMs: 100,
          },
        ],
      },
    ];
    const playing = channel(1, "resume");
    const paused = channel(2, "pause");
    const resumed = channel(3, "resume");

    stage.renderGraph({ nextAudio: playing });
    context.currentTime = 10.04;
    vi.advanceTimersByTime(40);
    const firstSource = context.sources[0];

    stage.renderGraph({ prevAudio: playing, nextAudio: paused });

    expect(firstSource.stop).toHaveBeenCalledWith(10.04);
    expect(findCurrentSound(stage, "intro").channelPauseState).toMatchObject({
      kind: "active",
      remainingDelayMs: 0,
    });
    expect(
      findCurrentSound(stage, "intro").channelPauseState.offset,
    ).toBeCloseTo(0.04);
    expect(findCurrentSound(stage, "outro").channelPauseState).toEqual({
      kind: "pending",
      offset: 0,
      remainingDelayMs: 60,
    });

    vi.advanceTimersByTime(1000);
    expect(context.sources).toHaveLength(1);

    context.currentTime = 20;
    stage.renderGraph({ prevAudio: paused, nextAudio: resumed });

    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].start).toHaveBeenCalledTimes(1);
    expect(context.sources[1].start.mock.calls[0][0]).toBe(20);
    expect(context.sources[1].start.mock.calls[0][1]).toBeCloseTo(0.04);
    vi.advanceTimersByTime(59);
    expect(context.sources).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(context.sources).toHaveLength(3);
    expect(context.sources[2].start).toHaveBeenCalledWith(20, 0);

    context.sources[1].onended();
    expect(context.sources).toHaveLength(3);
    context.sources[2].onended();
    expect(context.sources).toHaveLength(4);
    expect(findCurrentSound(stage, "outro").pendingTimeoutId).not.toBeNull();
  });

  it("preserves a delayed child's remaining delay after a channel loop restarts", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([
        ["intro", { duration: 10 }],
        ["outro", { duration: 10 }],
      ]),
    });
    const channel = (commandId, operation) => [
      {
        id: "music",
        type: "audio-channel",
        loop: true,
        playback: { commandId, operation },
        children: [
          { id: "intro", type: "sound", src: "intro" },
          {
            id: "outro",
            type: "sound",
            src: "outro",
            startDelayMs: 100,
          },
        ],
      },
    ];
    const playing = channel(1, "resume");
    const paused = channel(2, "pause");
    const resumed = channel(3, "resume");

    stage.renderGraph({ nextAudio: playing });
    context.sources[0].onended();
    vi.advanceTimersByTime(100);
    context.sources[1].onended();

    expect(context.sources).toHaveLength(3);
    vi.advanceTimersByTime(40);
    context.currentTime = 10.04;
    stage.renderGraph({ prevAudio: playing, nextAudio: paused });

    expect(findCurrentSound(stage, "outro").channelPauseState).toEqual({
      kind: "pending",
      offset: 0,
      remainingDelayMs: 60,
    });

    context.currentTime = 20;
    stage.renderGraph({ prevAudio: paused, nextAudio: resumed });
    vi.advanceTimersByTime(59);
    expect(context.sources).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(context.sources).toHaveLength(5);
    expect(context.sources[4].start).toHaveBeenCalledWith(20, 0);
  });

  it("preserves a resumed cursor when a channel is paused before the audio context resumes", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([["theme", { duration: 10 }]]),
    });
    const channel = (commandId, operation) => [
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId, operation },
        children: [{ id: "theme", type: "sound", src: "theme" }],
      },
    ];
    const playing = channel(1, "resume");
    const paused = channel(2, "pause");
    const pendingResume = channel(3, "resume");
    const pausedAgain = channel(4, "pause");
    const resumed = channel(5, "resume");

    stage.renderGraph({ nextAudio: playing });
    context.currentTime = 10.5;
    stage.renderGraph({ prevAudio: playing, nextAudio: paused });

    let resolveResume;
    context.state = "suspended";
    context.resume.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = () => {
            context.state = "running";
            resolve();
          };
        }),
    );
    stage.renderGraph({ prevAudio: paused, nextAudio: pendingResume });
    stage.renderGraph({
      prevAudio: pendingResume,
      nextAudio: pausedAgain,
    });

    expect(findCurrentSound(stage, "theme").channelPauseState).toEqual({
      kind: "pending",
      offset: 0.5,
      remainingDelayMs: 0,
    });

    resolveResume();
    await flushPromises();
    expect(context.sources).toHaveLength(1);

    context.currentTime = 20;
    stage.renderGraph({ prevAudio: pausedAgain, nextAudio: resumed });
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].start).toHaveBeenCalledWith(20, 0.5);
  });

  it("starts children only after an initially paused channel resumes", async () => {
    const { stage, context, getAsset } = await setupAudioStage();
    const paused = [
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId: 1, operation: "pause" },
        children: [
          { id: "theme", type: "sound", src: "theme", startDelayMs: 100 },
        ],
      },
    ];
    const resumed = [
      {
        ...paused[0],
        playback: { commandId: 2, operation: "resume" },
      },
    ];

    stage.renderGraph({ nextAudio: paused });
    vi.advanceTimersByTime(500);
    expect(getAsset).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);

    stage.renderGraph({ prevAudio: paused, nextAudio: resumed });
    vi.advanceTimersByTime(99);
    expect(context.sources).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(context.sources).toHaveLength(1);
  });

  it("reconciles child additions and removals without starting a paused channel", async () => {
    const { stage, context, getAsset } = await setupAudioStage();
    const first = [
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId: 1, operation: "pause" },
        children: [{ id: "first", type: "sound", src: "first" }],
      },
    ];
    const replaced = [
      {
        ...first[0],
        children: [{ id: "second", type: "sound", src: "second" }],
      },
    ];
    const resumed = [
      {
        ...replaced[0],
        playback: { commandId: 2, operation: "resume" },
      },
    ];

    stage.renderGraph({ nextAudio: first });
    stage.renderGraph({ prevAudio: first, nextAudio: replaced });
    expect(getAsset).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
    expect(findCurrentSound(stage, "first")).toBeUndefined();

    stage.renderGraph({ prevAudio: replaced, nextAudio: resumed });
    expect(context.sources).toHaveLength(1);
    expect(getAsset).toHaveBeenCalledWith("second");
  });

  it("ignores repeated and stale channel playback commands", async () => {
    const { stage, context } = await setupAudioStage();
    const channel = (commandId, operation) => [
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId, operation },
        children: [{ id: "theme", type: "sound", src: "theme" }],
      },
    ];
    const paused = channel(5, "pause");

    stage.renderGraph({ nextAudio: paused });
    stage.renderGraph({
      prevAudio: paused,
      nextAudio: channel(4, "resume"),
    });
    expect(context.sources).toHaveLength(0);

    stage.renderGraph({
      prevAudio: channel(4, "resume"),
      nextAudio: channel(6, "resume"),
    });
    expect(context.sources).toHaveLength(1);

    stage.renderGraph({
      prevAudio: channel(6, "resume"),
      nextAudio: channel(6, "pause"),
    });
    expect(context.sources[0].stop).not.toHaveBeenCalled();
    expect(stage._inspect().channels.get("music").playback).toEqual({
      commandId: 6,
      operation: "resume",
    });

    stage.renderGraph({
      prevAudio: channel(6, "pause"),
      nextAudio: channel(7, "pause"),
    });
    expect(context.sources[0].stop).toHaveBeenCalledTimes(1);
    expect(stage._inspect().channels.get("music").playback).toEqual({
      commandId: 7,
      operation: "pause",
    });
  });

  it("accounts for playback rate and segment bounds when resuming a channel", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([["theme", { duration: 10 }]]),
    });
    const channel = (commandId, operation) => [
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId, operation },
        children: [
          {
            id: "theme",
            type: "sound",
            src: "theme",
            playbackRate: 2,
            startAt: 2,
            endAt: 8,
          },
        ],
      },
    ];
    const playing = channel(1, "resume");
    const paused = channel(2, "pause");
    const resumed = channel(3, "resume");

    stage.renderGraph({ nextAudio: playing });
    context.currentTime = 11.25;
    stage.renderGraph({ prevAudio: playing, nextAudio: paused });
    context.currentTime = 20;
    stage.renderGraph({ prevAudio: paused, nextAudio: resumed });

    expect(context.sources[1].start).toHaveBeenCalledWith(20, 4.5, 3.5);
  });

  it("preserves playback-rate history when capturing a channel cursor", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([["theme", { duration: 10 }]]),
    });
    const channel = (commandId, operation, playbackRate) => [
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId, operation },
        children: [
          {
            id: "theme",
            type: "sound",
            src: "theme",
            playbackRate,
          },
        ],
      },
    ];
    const playing = channel(1, "resume", 1);
    const faster = channel(1, "resume", 2);
    const paused = channel(2, "pause", 2);

    stage.renderGraph({ nextAudio: playing });
    context.currentTime = 12;
    stage.renderGraph({ prevAudio: playing, nextAudio: faster });
    context.currentTime = 13;
    stage.renderGraph({ prevAudio: faster, nextAudio: paused });

    expect(
      findCurrentSound(stage, "theme").channelPauseState.offset,
    ).toBeCloseTo(4);
  });

  it("uses the source's effective loop points when capturing a channel cursor", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([["theme", { duration: 10 }]]),
    });
    const channel = (commandId, operation) => [
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId, operation },
        children: [
          {
            id: "theme",
            type: "sound",
            src: "theme",
            loop: true,
            startAt: 5,
          },
        ],
      },
    ];
    const playing = channel(1, "resume");
    const paused = channel(2, "pause");
    const resumed = channel(3, "resume");

    stage.renderGraph({ nextAudio: playing });
    expect(context.sources[0].loopStart).toBe(0);
    context.currentTime = 16;
    stage.renderGraph({ prevAudio: playing, nextAudio: paused });

    expect(
      findCurrentSound(stage, "theme").channelPauseState.offset,
    ).toBeCloseTo(1);

    context.currentTime = 20;
    stage.renderGraph({ prevAudio: paused, nextAudio: resumed });
    expect(context.sources[1].start).toHaveBeenCalledTimes(1);
    expect(context.sources[1].start.mock.calls[0][0]).toBe(20);
    expect(context.sources[1].start.mock.calls[0][1]).toBeCloseTo(1);
  });

  it("preserves a wrapped channel cursor when child looping is disabled", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([["theme", { duration: 10 }]]),
    });
    const channel = (commandId, operation, loop) => [
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId, operation },
        children: [
          {
            id: "theme",
            type: "sound",
            src: "theme",
            loop,
          },
        ],
      },
    ];
    const looping = channel(1, "resume", true);
    const notLooping = channel(1, "resume", false);
    const paused = channel(2, "pause", false);
    const resumed = channel(3, "resume", false);

    stage.renderGraph({ nextAudio: looping });
    context.currentTime = 22;
    stage.renderGraph({ prevAudio: looping, nextAudio: notLooping });
    context.currentTime = 23;
    stage.renderGraph({ prevAudio: notLooping, nextAudio: paused });

    expect(
      findCurrentSound(stage, "theme").channelPauseState.offset,
    ).toBeCloseTo(3);

    context.currentTime = 30;
    stage.renderGraph({ prevAudio: paused, nextAudio: resumed });
    expect(context.sources[1].start).toHaveBeenCalledTimes(1);
    expect(context.sources[1].start.mock.calls[0][0]).toBe(30);
    expect(context.sources[1].start.mock.calls[0][1]).toBeCloseTo(3);
  });

  it("keeps continuing sounds synchronized when they move across a paused channel", async () => {
    const { stage, context } = await setupAudioStage();
    const outside = [
      {
        id: "theme",
        type: "sound",
        src: "theme",
      },
      {
        id: "music",
        type: "audio-channel",
        playback: { commandId: 1, operation: "pause" },
        children: [],
      },
    ];
    const inside = [
      {
        ...outside[1],
        children: [{ ...outside[0] }],
      },
    ];

    stage.renderGraph({ nextAudio: outside });
    const originalSource = context.sources[0];
    context.currentTime = 10.5;
    stage.renderGraph({ prevAudio: outside, nextAudio: inside });
    expect(originalSource.stop).toHaveBeenCalledWith(10.5);

    context.currentTime = 20;
    stage.renderGraph({ prevAudio: inside, nextAudio: outside });
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].start).toHaveBeenCalledWith(20, 0.5);
  });

  it("rejects changing channel playback mode before mutating audio", async () => {
    const { stage, context } = await setupAudioStage();
    const ordinary = [
      {
        id: "music",
        type: "audio-channel",
        children: [{ id: "theme", type: "sound", src: "theme" }],
      },
    ];
    const controlled = [
      {
        ...ordinary[0],
        playback: { commandId: 1, operation: "pause" },
      },
    ];

    stage.renderGraph({ nextAudio: ordinary });
    const source = context.sources[0];

    expect(() =>
      stage.renderGraph({ prevAudio: ordinary, nextAudio: controlled }),
    ).toThrow("cannot change command-controlled playback mode");
    expect(source.stop).not.toHaveBeenCalled();
    expect(stage._inspect().channels.get("music").control).toBeNull();
  });

  it("validates effects when renderGraph is called directly", async () => {
    const { stage } = await setupAudioStage();

    expect(() =>
      stage.renderGraph({
        nextAudio: [{ id: "bgm", type: "sound", src: "track" }],
        nextAudioEffects: [
          {
            id: "bad",
            type: "audio-transition",
            targetId: "missing",
            properties: {
              volume: {
                update: keyframePhase(100, 100),
              },
            },
          },
        ],
      }),
    ).toThrow('targetId "missing" does not resolve');
  });

  it("applies canonical channel enter, update, and exit effects", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [
      {
        id: "music",
        type: "audio-channel",
        volume: 80,
        children: [{ id: "bgm", type: "sound", src: "theme", loop: true }],
      },
    ];
    const secondAudio = [
      {
        id: "music",
        type: "audio-channel",
        volume: 40,
        children: [{ id: "bgm", type: "sound", src: "theme", loop: true }],
      },
    ];

    stage.renderGraph({
      nextAudio: firstAudio,
      nextAudioEffects: [
        {
          id: "music-enter",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              enter: {
                initialValue: 0,
                keyframes: [{ value: 80, duration: 500 }],
              },
            },
          },
        },
      ],
    });
    const music = stage._inspect().channels.get("music");
    expect(music.gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10);
    expect(music.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.8,
      10.5,
    );

    context.currentTime = 10.5;
    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: secondAudio,
      nextAudioEffects: [
        {
          id: "music-update",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              update: {
                keyframes: [{ delay: 100, value: 40, duration: 400 }],
              },
            },
          },
        },
      ],
    });
    expect(music.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.8,
      10.6,
    );
    expect(music.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.4,
      11,
    );

    const source = context.sources[0];
    stage.renderGraph({
      prevAudio: secondAudio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "music-exit",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              exit: {
                keyframes: [{ value: 0, duration: 750 }],
              },
            },
          },
        },
      ],
    });
    expect(music.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      11.25,
    );
    expect(source.stop).toHaveBeenCalledWith(11.25);
  });

  it("composes channel and sound effects on independent gain nodes", async () => {
    const { stage, context } = await setupAudioStage();

    stage.renderGraph({
      nextAudio: [
        {
          id: "music",
          type: "audio-channel",
          volume: 50,
          children: [
            {
              id: "bgm",
              type: "sound",
              src: "theme",
              volume: 80,
            },
          ],
        },
      ],
      nextAudioEffects: [
        {
          id: "music-enter",
          type: "audio-transition",
          targetId: "music",
          properties: {
            volume: {
              enter: {
                initialValue: 0,
                keyframes: [{ value: 50, duration: 1000 }],
              },
            },
          },
        },
        {
          id: "bgm-enter",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              enter: {
                initialValue: 0,
                keyframes: [{ value: 80, duration: 500 }],
              },
            },
          },
        },
      ],
    });

    const channel = stage._inspect().channels.get("music");
    const sound = findCurrentSound(stage, "bgm");
    expect(channel.gainNode).not.toBe(sound.gainNode);
    expect(channel.gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0,
      10,
    );
    expect(channel.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.5,
      11,
    );
    expect(sound.gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 10);
    expect(sound.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.8,
      10.5,
    );
    expect(context.sources[0].start).toHaveBeenCalledWith(10, 0);
  });

  it("does not restart an unchanged effect occurrence", async () => {
    const { stage, context } = await setupAudioStage();
    const audio = [
      {
        id: "bgm",
        type: "sound",
        src: "theme",
        volume: 80,
      },
    ];
    const audioEffects = [
      {
        id: "bgm-enter:visit-1",
        type: "audio-transition",
        targetId: "bgm",
        properties: {
          volume: {
            enter: {
              initialValue: 0,
              keyframes: [{ value: 80, duration: 1000 }],
            },
          },
        },
      },
    ];

    stage.renderGraph({ nextAudio: audio, nextAudioEffects: audioEffects });
    const sound = findCurrentSound(stage, "bgm");
    const gain = sound.gainNode.gain;
    const cancelCount = gain.cancelScheduledValues.mock.calls.length;
    const holdCount = gain.cancelAndHoldAtTime.mock.calls.length;
    const setCount = gain.setValueAtTime.mock.calls.length;
    const rampCount = gain.linearRampToValueAtTime.mock.calls.length;

    context.currentTime = 10.25;
    stage.renderGraph({
      prevAudio: audio,
      nextAudio: audio,
      prevAudioEffects: audioEffects,
      nextAudioEffects: audioEffects,
    });

    expect(context.sources).toHaveLength(1);
    expect(gain.cancelScheduledValues).toHaveBeenCalledTimes(cancelCount);
    expect(gain.cancelAndHoldAtTime).toHaveBeenCalledTimes(holdCount);
    expect(gain.setValueAtTime).toHaveBeenCalledTimes(setCount);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(rampCount);
    expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.8, 11);
  });

  it("waits for the longest delayed exit effect track before cleanup", async () => {
    const { stage, context } = await setupAudioStage();
    const audio = [
      {
        id: "bgm",
        type: "sound",
        src: "theme",
        volume: 100,
        pan: 0,
        playbackRate: 1,
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    const sound = findCurrentSound(stage, "bgm");
    const source = context.sources[0];
    stage.renderGraph({
      prevAudio: audio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "bgm-exit",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              exit: {
                keyframes: [{ delay: 200, value: 0, duration: 300 }],
              },
            },
            pan: {
              exit: {
                keyframes: [{ delay: 100, value: 1, duration: 800 }],
              },
            },
            playbackRate: {
              exit: {
                keyframes: [{ delay: 300, value: 0.5, duration: 400 }],
              },
            },
          },
        },
      ],
    });

    expect(sound.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      10.5,
    );
    expect(sound.pannerNode.pan.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      10.9,
    );
    expect(source.playbackRate.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.5,
      10.7,
    );
    expect(source.stop).toHaveBeenCalledWith(10.9);
    vi.advanceTimersByTime(899);
    expect(findSound(stage, "bgm")).toBe(sound);
    vi.advanceTimersByTime(1);
    expect(findSound(stage, "bgm")).toBeUndefined();
  });

  it("crossfades replacement instances with one effect and independent side delays", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([
        ["first", { duration: 20 }],
        ["second", { duration: 20 }],
      ]),
    });
    const outgoingAudio = [
      {
        id: "bgm",
        type: "sound",
        src: "first",
        loop: true,
        volume: 80,
      },
    ];
    const incomingAudio = [
      {
        id: "bgm",
        type: "sound",
        src: "second",
        loop: true,
        volume: 80,
      },
    ];

    stage.renderGraph({ nextAudio: outgoingAudio });
    const outgoing = findCurrentSound(stage, "bgm");
    const outgoingSource = context.sources[0];

    stage.renderGraph({
      prevAudio: outgoingAudio,
      nextAudio: incomingAudio,
      nextAudioEffects: [
        {
          id: "bgm-handoff:visit-1",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              exit: {
                keyframes: [{ delay: 1000, value: 0, duration: 2000 }],
              },
              enter: {
                initialValue: 0,
                keyframes: [{ delay: 500, value: 80, duration: 1500 }],
              },
            },
          },
        },
      ],
    });

    const incoming = findCurrentSound(stage, "bgm");
    const incomingSource = context.sources[1];
    expect(incoming).not.toBe(outgoing);
    expect(outgoingSource.stop).toHaveBeenCalledWith(13);
    expect(
      outgoing.gainNode.gain.linearRampToValueAtTime,
    ).toHaveBeenNthCalledWith(1, 0.8, 11);
    expect(
      outgoing.gainNode.gain.linearRampToValueAtTime,
    ).toHaveBeenNthCalledWith(2, 0, 13);
    expect(incomingSource.start).toHaveBeenCalledWith(10, 0);
    expect(incoming.gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0,
      10,
    );
    expect(
      incoming.gainNode.gain.linearRampToValueAtTime,
    ).toHaveBeenNthCalledWith(1, 0, 10.5);
    expect(
      incoming.gainNode.gain.linearRampToValueAtTime,
    ).toHaveBeenNthCalledWith(2, 0.8, 12);
    expect(stage._inspect().sounds.get(outgoing.internalId)).toBe(outgoing);

    vi.advanceTimersByTime(2999);
    expect(stage._inspect().sounds.get(outgoing.internalId)).toBe(outgoing);
    vi.advanceTimersByTime(1);
    expect(stage._inspect().sounds.has(outgoing.internalId)).toBe(false);
    expect(findCurrentSound(stage, "bgm")).toBe(incoming);
  });

  it("starts a delayed sound's enter effect when playback actually starts", async () => {
    const { stage, context, getAsset } = await setupAudioStage();
    stage.renderGraph({
      nextAudio: [
        {
          id: "delayed",
          type: "sound",
          src: "theme",
          startDelayMs: 1000,
          volume: 100,
        },
      ],
      nextAudioEffects: [
        {
          id: "delayed-enter",
          type: "audio-transition",
          targetId: "delayed",
          properties: {
            volume: {
              enter: {
                initialValue: 0,
                keyframes: [{ value: 100, duration: 1000 }],
              },
            },
          },
        },
      ],
    });

    const delayed = findCurrentSound(stage, "delayed");
    expect(getAsset).not.toHaveBeenCalled();
    expect(
      delayed.gainNode.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(context.sources).toHaveLength(0);

    context.currentTime = 11;
    vi.advanceTimersByTime(1);

    expect(context.sources).toHaveLength(1);
    expect(delayed.gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0,
      11,
    );
    expect(delayed.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      12,
    );
  });

  it("does not apply enter effects when declarative source start fails", async () => {
    const { stage, context } = await setupAudioStage({
      contextOptions: {
        startImpl: () => {
          throw new Error("browser start failure");
        },
      },
    });

    expect(() =>
      stage.renderGraph({
        nextAudio: [
          {
            id: "bgm",
            type: "sound",
            src: "theme",
            volume: 80,
            pan: 0.5,
            playbackRate: 2,
          },
        ],
        nextAudioEffects: [
          {
            id: "bgm-enter",
            type: "audio-transition",
            targetId: "bgm",
            properties: {
              volume: {
                enter: {
                  initialValue: 0,
                  keyframes: [{ value: 80, duration: 500 }],
                },
              },
              pan: {
                enter: {
                  initialValue: -1,
                  keyframes: [{ value: 0.5, duration: 500 }],
                },
              },
              playbackRate: {
                enter: {
                  initialValue: 0.5,
                  keyframes: [{ value: 2, duration: 500 }],
                },
              },
            },
          },
        ],
      }),
    ).toThrow("browser start failure");

    const sound = findCurrentSound(stage, "bgm");
    expect(sound.pendingEnterTransitions).not.toBeNull();
    expect(sound.gainNode.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(sound.pannerNode.pan.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(
      context.sources[0].playbackRate.linearRampToValueAtTime,
    ).not.toHaveBeenCalled();
  });

  it("supersedes a pending enter occurrence before delayed playback", async () => {
    const { stage, context } = await setupAudioStage();
    const firstAudio = [
      {
        id: "delayed",
        type: "sound",
        src: "theme",
        startDelayMs: 100,
        volume: 80,
        pan: 1,
        playbackRate: 2,
      },
    ];
    const updatedAudio = [
      {
        id: "delayed",
        type: "sound",
        src: "theme",
        startDelayMs: 100,
        volume: 40,
        pan: 1,
        playbackRate: 1,
      },
    ];

    stage.renderGraph({
      nextAudio: firstAudio,
      nextAudioEffects: [
        {
          id: "delayed-enter",
          type: "audio-transition",
          targetId: "delayed",
          properties: {
            volume: {
              enter: {
                initialValue: 0,
                keyframes: [{ value: 80, duration: 100 }],
              },
            },
            pan: {
              enter: {
                initialValue: -1,
                keyframes: [{ value: 1, duration: 100 }],
              },
            },
            playbackRate: {
              enter: {
                initialValue: 0,
                keyframes: [{ value: 2, duration: 100 }],
              },
            },
          },
        },
      ],
    });
    const delayed = findCurrentSound(stage, "delayed");
    context.currentTime = 10.05;
    vi.advanceTimersByTime(50);
    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: updatedAudio,
      nextAudioEffects: [
        {
          id: "delayed-update",
          type: "audio-transition",
          targetId: "delayed",
          properties: {
            volume: { update: { keyframes: [{ value: 40, duration: 100 }] } },
            playbackRate: {
              update: { keyframes: [{ value: 1, duration: 200 }] },
            },
          },
        },
      ],
    });

    expect(delayed.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.4,
      10.15,
    );
    context.currentTime = 10.1;
    vi.advanceTimersByTime(50);

    const source = context.sources[0];
    expect(delayed.gainNode.gain.setValueAtTime).not.toHaveBeenCalledWith(
      0,
      10.1,
    );
    expect(delayed.pannerNode.pan.setValueAtTime).toHaveBeenLastCalledWith(
      1,
      10.05,
    );
    expect(
      delayed.pannerNode.pan.linearRampToValueAtTime,
    ).not.toHaveBeenCalled();
    expect(source.playbackRate.setValueAtTime.mock.calls.at(-1)[0]).toBeCloseTo(
      1.75,
    );
    expect(source.playbackRate.setValueAtTime.mock.calls.at(-1)[1]).toBe(10.1);
    expect(source.playbackRate.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      10.25,
    );
  });

  it("keeps mute gating independent from active effect automation", async () => {
    const { stage } = await setupAudioStage();
    const mutedAudio = [
      {
        id: "bgm",
        type: "sound",
        src: "theme",
        volume: 100,
        muted: true,
      },
    ];
    const audibleAudio = [
      {
        id: "bgm",
        type: "sound",
        src: "theme",
        volume: 100,
        muted: false,
      },
    ];

    const audioEffects = [
      {
        id: "bgm-enter",
        type: "audio-transition",
        targetId: "bgm",
        properties: {
          volume: {
            enter: {
              initialValue: 0,
              keyframes: [{ value: 100, duration: 1000 }],
            },
          },
        },
      },
    ];
    stage.renderGraph({
      nextAudio: mutedAudio,
      nextAudioEffects: audioEffects,
    });
    const bgm = findCurrentSound(stage, "bgm");
    const volumeCancelCount =
      bgm.gainNode.gain.cancelScheduledValues.mock.calls.length;
    const volumeHoldCount =
      bgm.gainNode.gain.cancelAndHoldAtTime.mock.calls.length;
    expect(bgm.muteGainNode.gain.value).toBe(0);
    expect(bgm.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      11,
    );

    stage.renderGraph({
      prevAudio: mutedAudio,
      nextAudio: audibleAudio,
      prevAudioEffects: audioEffects,
      nextAudioEffects: audioEffects,
    });

    expect(bgm.muteGainNode.gain.value).toBe(1);
    expect(bgm.gainNode.gain.cancelScheduledValues).toHaveBeenCalledTimes(
      volumeCancelCount,
    );
    expect(bgm.gainNode.gain.cancelAndHoldAtTime).toHaveBeenCalledTimes(
      volumeHoldCount,
    );
    expect(bgm.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
  });

  it("lets a zero-rate loop-end tail resume through its complete exit timeline", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([["paused", { duration: 4 }]]),
    });
    const audio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [
          {
            id: "paused",
            type: "sound",
            src: "paused",
            loop: true,
            playbackRate: 0,
          },
        ],
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    const source = context.sources[0];
    stage.renderGraph({
      prevAudio: audio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "paused-exit",
          type: "audio-transition",
          targetId: "paused",
          properties: {
            playbackRate: {
              exit: { keyframes: [{ value: 1, duration: 1000 }] },
            },
          },
        },
      ],
    });

    expect(source.playbackRate.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      11,
    );
    expect(source.stop.mock.calls[0][0]).toBeCloseTo(14.5, 3);
    vi.advanceTimersByTime(1000);
    expect(findSound(stage, "paused")).toBeDefined();

    context.currentTime = 14.5;
    source.onended();
    expect(findSound(stage, "paused")).toBeUndefined();
    expect(stage._inspect().channels.has("music")).toBe(false);
  });

  it("uses the finite exit fallback when a rate timeline cannot reach loop end", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([["slowing", { duration: 4 }]]),
    });
    const audio = [
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
        children: [
          {
            id: "slowing",
            type: "sound",
            src: "slowing",
            loop: true,
            playbackRate: 1,
          },
        ],
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    const source = context.sources[0];
    stage.renderGraph({
      prevAudio: audio,
      nextAudio: [],
      nextAudioEffects: [
        {
          id: "slowing-exit",
          type: "audio-transition",
          targetId: "slowing",
          properties: {
            playbackRate: {
              exit: { keyframes: [{ value: 0, duration: 1000 }] },
            },
          },
        },
      ],
    });

    expect(source.stop).toHaveBeenCalledWith(11);
    expect(findSound(stage, "slowing")).toBeDefined();
    vi.advanceTimersByTime(999);
    expect(findSound(stage, "slowing")).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(findSound(stage, "slowing")).toBeUndefined();
    expect(stage._inspect().channels.has("music")).toBe(false);
  });

  it("settles an active retained update when its effect is removed", async () => {
    const { stage, context } = await setupAudioStage({
      contextOptions: { reflectScheduledAudioParamValue: false },
    });
    const initialAudio = [
      { id: "bgm", type: "sound", src: "theme", volume: 100 },
    ];
    const updatedAudio = [
      { id: "bgm", type: "sound", src: "theme", volume: 20 },
    ];
    const audioEffects = [
      {
        id: "bgm-update:visit-1",
        type: "audio-transition",
        targetId: "bgm",
        properties: {
          volume: { update: keyframePhase(20, 1000) },
        },
      },
    ];

    stage.renderGraph({ nextAudio: initialAudio });
    stage.renderGraph({
      prevAudio: initialAudio,
      nextAudio: updatedAudio,
      nextAudioEffects: audioEffects,
    });
    const sound = findCurrentSound(stage, "bgm");

    context.currentTime = 10.25;
    stage.renderGraph({
      prevAudio: updatedAudio,
      nextAudio: updatedAudio,
      prevAudioEffects: audioEffects,
    });

    expect(sound.gainNode.gain.cancelScheduledValues).toHaveBeenLastCalledWith(
      10.25,
    );
    expect(sound.gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0.2,
      10.25,
    );
    expect(stage._inspect().ownedAudioEffects.size).toBe(0);
  });

  it("continues a completed detached exit without recreating or retaining its instance", async () => {
    const { stage } = await setupAudioStage();
    const audio = [{ id: "bgm", type: "sound", src: "theme", volume: 80 }];
    const audioEffects = [
      {
        id: "bgm-exit:visit-1",
        type: "audio-transition",
        targetId: "bgm",
        properties: {
          volume: { exit: keyframePhase(0, 100) },
        },
      },
    ];

    stage.renderGraph({ nextAudio: audio });
    stage.renderGraph({
      prevAudio: audio,
      nextAudio: [],
      nextAudioEffects: audioEffects,
    });
    vi.advanceTimersByTime(100);

    const ownership = stage
      ._inspect()
      .ownedAudioEffects.get("bgm-exit:visit-1");
    expect(stage._inspect().sounds.size).toBe(0);
    expect(ownership.soundInstances.size).toBe(0);

    expect(() =>
      stage.renderGraph({
        prevAudio: [],
        nextAudio: [],
        prevAudioEffects: audioEffects,
        nextAudioEffects: audioEffects,
      }),
    ).not.toThrow();
    expect(stage._inspect().sounds.size).toBe(0);

    stage.renderGraph({
      prevAudio: [],
      nextAudio: [],
      prevAudioEffects: audioEffects,
    });
    expect(stage._inspect().ownedAudioEffects.size).toBe(0);
  });

  it("settles both sides of an active handoff when its effect is removed", async () => {
    const { stage, context } = await setupAudioStage({
      assetMap: new Map([
        ["first", { duration: 20 }],
        ["second", { duration: 20 }],
      ]),
    });
    const firstAudio = [{ id: "bgm", type: "sound", src: "first", volume: 80 }];
    const secondAudio = [
      { id: "bgm", type: "sound", src: "second", volume: 80 },
    ];
    const audioEffects = [
      {
        id: "bgm-handoff:visit-1",
        type: "audio-transition",
        targetId: "bgm",
        properties: {
          volume: {
            exit: keyframePhase(0, 1000),
            enter: keyframePhase(80, 1000, { initialValue: 0 }),
          },
        },
      },
    ];

    stage.renderGraph({ nextAudio: firstAudio });
    const outgoing = findCurrentSound(stage, "bgm");
    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: secondAudio,
      nextAudioEffects: audioEffects,
    });
    const incoming = findCurrentSound(stage, "bgm");

    context.currentTime = 10.25;
    stage.renderGraph({
      prevAudio: secondAudio,
      nextAudio: secondAudio,
      prevAudioEffects: audioEffects,
    });

    expect(outgoing.source.stop).toHaveBeenLastCalledWith(10.25);
    expect(stage._inspect().sounds.has(outgoing.internalId)).toBe(false);
    expect(incoming.gainNode.gain.setValueAtTime).toHaveBeenLastCalledWith(
      0.8,
      10.25,
    );
    expect(findCurrentSound(stage, "bgm")).toBe(incoming);
  });

  it("settles a pending delayed enter before its source starts", async () => {
    const { stage, context } = await setupAudioStage();
    const audio = [
      {
        id: "delayed",
        type: "sound",
        src: "theme",
        volume: 100,
        startDelayMs: 1000,
      },
    ];
    const audioEffects = [
      {
        id: "delayed-enter:visit-1",
        type: "audio-transition",
        targetId: "delayed",
        properties: {
          volume: {
            enter: keyframePhase(100, 1000, { initialValue: 0 }),
          },
        },
      },
    ];

    stage.renderGraph({ nextAudio: audio, nextAudioEffects: audioEffects });
    const delayed = findCurrentSound(stage, "delayed");
    stage.renderGraph({
      prevAudio: audio,
      nextAudio: audio,
      prevAudioEffects: audioEffects,
    });

    vi.advanceTimersByTime(1000);
    expect(context.sources).toHaveLength(1);
    expect(delayed.pendingEnterTransitions).toBeNull();
    expect(
      delayed.gainNode.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled();
    expect(delayed.gainNode.gain.value).toBe(1);
  });

  it("changes a shared channel master without rebasing an active sound fade", async () => {
    const { stage } = await setupAudioStage();
    const initialAudio = [
      {
        id: "music-master",
        type: "audio-channel",
        volume: 60,
        children: [{ id: "bgm", type: "sound", src: "theme", volume: 80 }],
      },
    ];
    const changedMasterAudio = [
      {
        ...initialAudio[0],
        volume: 30,
      },
    ];
    const audioEffects = [
      {
        id: "bgm-enter:visit-1",
        type: "audio-transition",
        targetId: "bgm",
        properties: {
          volume: {
            enter: keyframePhase(80, 1000, { initialValue: 0 }),
          },
        },
      },
    ];

    stage.renderGraph({
      nextAudio: initialAudio,
      nextAudioEffects: audioEffects,
    });
    const channel = stage._inspect().channels.get("music-master");
    const sound = findCurrentSound(stage, "bgm");
    const soundCancelCount =
      sound.gainNode.gain.cancelScheduledValues.mock.calls.length;
    const soundHoldCount =
      sound.gainNode.gain.cancelAndHoldAtTime.mock.calls.length;

    stage.renderGraph({
      prevAudio: initialAudio,
      nextAudio: changedMasterAudio,
      prevAudioEffects: audioEffects,
      nextAudioEffects: audioEffects,
    });

    expect(channel.gainNode.gain.value).toBe(0.3);
    expect(sound.gainNode.gain.cancelScheduledValues).toHaveBeenCalledTimes(
      soundCancelCount,
    );
    expect(sound.gainNode.gain.cancelAndHoldAtTime).toHaveBeenCalledTimes(
      soundHoldCount,
    );
    expect(sound.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.8,
      11,
    );
  });

  it("keeps outgoing sound state isolated from incoming replacement state", async () => {
    const { stage } = await setupAudioStage({
      assetMap: new Map([
        ["first", { duration: 20 }],
        ["second", { duration: 20 }],
      ]),
    });
    const firstAudio = [
      {
        id: "bgm",
        type: "sound",
        src: "first",
        volume: 80,
        pan: -0.5,
        muted: true,
      },
    ];
    const secondAudio = [
      {
        id: "bgm",
        type: "sound",
        src: "second",
        volume: 30,
        pan: 0.5,
        muted: false,
      },
    ];

    stage.renderGraph({ nextAudio: firstAudio });
    const outgoing = findCurrentSound(stage, "bgm");
    stage.renderGraph({
      prevAudio: firstAudio,
      nextAudio: secondAudio,
      nextAudioEffects: [
        {
          id: "bgm-handoff:visit-1",
          type: "audio-transition",
          targetId: "bgm",
          properties: {
            volume: {
              exit: keyframePhase(0, 1000),
              enter: keyframePhase(30, 1000, { initialValue: 0 }),
            },
            pan: {
              exit: keyframePhase(-1, 1000),
              enter: keyframePhase(0.5, 1000, { initialValue: 0 }),
            },
          },
        },
      ],
    });
    const incoming = findCurrentSound(stage, "bgm");

    expect(outgoing.volume).toBe(80);
    expect(outgoing.pan).toBe(-0.5);
    expect(outgoing.muted).toBe(true);
    expect(outgoing.muteGainNode.gain.value).toBe(0);
    expect(incoming.volume).toBe(30);
    expect(incoming.pan).toBe(0.5);
    expect(incoming.muted).toBe(false);
    expect(incoming.muteGainNode.gain.value).toBe(1);
  });
});
