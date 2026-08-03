import { describe, expect, it, vi } from "vitest";
import { createDeterministicAudioRuntime } from "../../src/audio/deterministicAudioRuntime.js";

const flushMicrotasks = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

class FakeOfflineAudioContext {
  constructor({ numberOfChannels, length, sampleRate }) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = { label: "destination" };
    this.suspensions = [];
    this.started = false;
    this.resumeCurrentBoundary = null;
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
