import { describe, expect, it, vi } from "vitest";
import { createDeterministicAudioRuntime } from "../../src/audio/deterministicAudioRuntime.js";

const flushMicrotasks = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

class FakeBufferSource {
  constructor(context) {
    this.context = context;
    this.buffer = null;
    this.loop = false;
    this.onended = null;
    this.playbackRate = { value: 1 };
    this.listeners = [];
    this.endTime = null;
    this.endedQueued = false;
  }

  addEventListener(name, callback) {
    if (name === "ended") this.listeners.push(callback);
  }

  start(when = 0, offset = 0, duration) {
    const sourceDuration =
      duration ?? (this.buffer.duration - offset) / this.playbackRate.value;
    this.endTime = Math.max(this.context.currentTime, when) + sourceDuration;
  }

  stop(when = this.context.currentTime) {
    this.endTime = when;
  }

  queueEndedAt(time) {
    if (
      this.endedQueued ||
      this.loop ||
      this.endTime === null ||
      this.endTime - time > Number.EPSILON * 16
    ) {
      return;
    }

    this.endedQueued = true;
    globalThis.setTimeout(() => {
      for (const listener of this.listeners) listener();
      this.onended?.();
    }, 0);
  }
}

class FakeOfflineAudioContext {
  constructor({ numberOfChannels, length, sampleRate }) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = { label: "destination" };
    this.suspensions = [];
    this.sources = [];
    this.started = false;
    this.resumeCurrentBoundary = null;
  }

  createBufferSource() {
    const source = new FakeBufferSource(this);
    this.sources.push(source);
    return source;
  }

  suspend(time) {
    if (this.started && time <= this.currentTime) {
      return Promise.reject(new Error("suspension must be in the future"));
    }
    let resolve;
    const promise = new Promise((nextResolve) => {
      resolve = nextResolve;
    });
    this.suspensions.push({ time, resolve, consumed: false });
    return promise;
  }

  resume() {
    this.state = "running";
    this.resumeCurrentBoundary?.();
    this.resumeCurrentBoundary = null;
    return Promise.resolve();
  }

  async startRendering() {
    this.started = true;
    while (true) {
      await flushMicrotasks();
      const next = this.suspensions
        .filter((entry) => !entry.consumed)
        .sort((left, right) => left.time - right.time)[0];
      if (!next) break;

      next.consumed = true;
      this.currentTime = next.time;
      this.state = "suspended";
      const resumed = new Promise((resolve) => {
        this.resumeCurrentBoundary = resolve;
      });
      for (const source of this.sources) {
        source.queueEndedAt(this.currentTime);
      }
      next.resolve();
      await resumed;
    }

    this.currentTime = this.length / this.sampleRate;
    this.state = "closed";
    return {
      length: this.length,
      sampleRate: this.sampleRate,
      numberOfChannels: this.numberOfChannels,
    };
  }
}

const createRuntime = (overrides = {}) =>
  createDeterministicAudioRuntime({
    durationMs: 200,
    sampleRate: 1000,
    numberOfChannels: 2,
    renderQuantumSize: 10,
    OfflineAudioContextCtor: FakeOfflineAudioContext,
    ...overrides,
  });

describe("deterministic audio runtime", () => {
  it("executes timeouts, external steps, and intervals in stable audio order", async () => {
    const runtime = createRuntime();
    const calls = [];
    runtime.setTimeout(() => calls.push(`timeout:${runtime.nowMs()}`), 100);
    runtime.scheduleAt(100, () => calls.push(`external:${runtime.nowMs()}`));
    let intervalRuns = 0;
    const intervalId = runtime.setInterval(() => {
      intervalRuns += 1;
      calls.push(`interval:${runtime.nowMs()}`);
      if (intervalRuns === 3) runtime.clearInterval(intervalId);
    }, 50);

    const rendered = await runtime.render();

    expect(calls).toEqual([
      "interval:50",
      "timeout:100",
      "external:100",
      "interval:100",
      "interval:150",
    ]);
    expect(rendered).toEqual({
      length: 200,
      sampleRate: 1000,
      numberOfChannels: 2,
    });
    expect(runtime.getPendingTaskCount()).toBe(0);
  });

  it("quantizes callbacks to Web Audio render boundaries", async () => {
    const runtime = createRuntime({ renderQuantumSize: 16 });
    const times = [];
    runtime.scheduleAt(1, () => times.push(runtime.nowMs()));
    runtime.scheduleAt(17, () => times.push(runtime.nowMs()));

    await runtime.render();

    expect(times).toEqual([16, 32]);
  });

  it("preserves exact render-quantum boundaries at production sample rates", async () => {
    const runtime = createRuntime({
      durationMs: 200,
      sampleRate: 48_000,
      renderQuantumSize: 128,
    });
    const times = [];
    runtime.scheduleAt(136, () => times.push(runtime.nowMs()));

    await runtime.render();

    expect(times).toEqual([136]);
    expect(runtime.offlineContext.suspensions[0].time).toBe(0.136);
  });

  it("converts exact millisecond durations without adding a floating-point frame", () => {
    const runtime = createRuntime({ durationMs: 2200, sampleRate: 48_000 });

    expect(runtime.offlineContext.length).toBe(105_600);
  });

  it("yields for source-ended callbacks that extend the audio graph", async () => {
    const runtime = createRuntime();
    const endedAt = [];
    const startIteration = () => {
      const source = runtime.context.createBufferSource();
      source.buffer = { duration: 0.03 };
      source.onended = () => {
        endedAt.push(runtime.nowMs());
        if (endedAt.length < 3) startIteration();
      };
      source.start();
    };
    startIteration();

    await runtime.render();

    expect(endedAt).toEqual([30, 60, 90]);
    expect(runtime.offlineContext.sources).toHaveLength(3);
  });

  it("does not add lifecycle checkpoints for a continuously looping source", async () => {
    const runtime = createRuntime();
    const source = runtime.context.createBufferSource();
    source.buffer = { duration: 0.03 };
    source.loop = true;
    source.start();

    await runtime.render();

    expect(runtime.offlineContext.suspensions).toHaveLength(0);
  });

  it("advances virtual time while an async callback waits for a later timeout", async () => {
    const runtime = createRuntime();
    const calls = [];
    runtime.scheduleAt(10, async () => {
      calls.push(`start:${runtime.nowMs()}`);
      await new Promise((resolve) => runtime.setTimeout(resolve, 20));
      calls.push(`end:${runtime.nowMs()}`);
    });

    await runtime.render();

    expect(calls).toEqual(["start:10", "end:30"]);
  });

  it("reports an async callback failure after later virtual work", async () => {
    const runtime = createRuntime();
    runtime.scheduleAt(10, async () => {
      await new Promise((resolve) => runtime.setTimeout(resolve, 20));
      throw new Error("deferred callback failed");
    });

    await expect(runtime.render()).rejects.toThrow("deferred callback failed");
  });

  it("advances audio while an async callback waits for a source-ended event", async () => {
    const runtime = createRuntime();
    const calls = [];
    runtime.scheduleAt(10, async () => {
      const source = runtime.context.createBufferSource();
      source.buffer = { duration: 0.03 };
      source.start();
      calls.push(`start:${runtime.nowMs()}`);
      await new Promise((resolve) => source.addEventListener("ended", resolve));
      calls.push(`end:${runtime.nowMs()}`);
    });

    await runtime.render();

    expect(calls).toEqual(["start:10", "end:40"]);
  });

  it("runs zero-time work before offline rendering starts", async () => {
    const runtime = createRuntime();
    const callback = vi.fn(() => {
      expect(runtime.nowMs()).toBe(0);
    });
    runtime.setTimeout(callback, 0);

    await runtime.render();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(runtime.offlineContext.suspensions).toHaveLength(0);
  });

  it("cancels scheduled work", async () => {
    const runtime = createRuntime();
    const callback = vi.fn();
    const timeoutId = runtime.setTimeout(callback, 50);
    runtime.clearTimeout(timeoutId);

    await runtime.render();

    expect(callback).not.toHaveBeenCalled();
  });

  it("rejects runaway timer callbacks", async () => {
    const runtime = createRuntime({ maxCallbacks: 3 });
    runtime.setInterval(() => {}, 10);

    await expect(runtime.render()).rejects.toThrow("exceeded 3 callbacks");
  });

  it("renders only once", async () => {
    const runtime = createRuntime();
    await runtime.render();

    await expect(runtime.render()).rejects.toThrow("can only render once");
  });

  it("exposes a running scheduling facade while retaining the offline context", () => {
    const runtime = createRuntime();

    expect(runtime.context.state).toBe("running");
    expect(runtime.offlineContext.state).toBe("suspended");
    expect(runtime.context.destination).toBe(
      runtime.offlineContext.destination,
    );
  });

  it.each([
    [{}, "durationMs must be a finite non-negative number"],
    [{ durationMs: 0 }, "durationMs must be greater than zero"],
    [
      { durationMs: 100, sampleRate: 0 },
      "sampleRate must be a positive integer",
    ],
    [
      { durationMs: 100, numberOfChannels: 0 },
      "numberOfChannels must be a positive integer",
    ],
    [
      { durationMs: 100, OfflineAudioContextCtor: undefined },
      "OfflineAudioContext is not available",
    ],
  ])("validates constructor options %#", (options, message) => {
    expect(() =>
      createDeterministicAudioRuntime({
        OfflineAudioContextCtor: FakeOfflineAudioContext,
        ...options,
      }),
    ).toThrow(message);
  });
});
