import { afterEach, describe, expect, it, vi } from "vitest";

const createRuntime = (context = { label: "offline" }) => ({
  context,
  nowMs: vi.fn(() => 123),
  setTimeout: vi.fn(),
  clearTimeout: vi.fn(),
  setInterval: vi.fn(),
  clearInterval: vi.fn(),
  queueMicrotask: vi.fn(),
});

describe("audio runtime configuration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses a configured context and timing driver", async () => {
    const {
      configureAudioRuntime,
      getAudioContext,
      getAudioRuntime,
      resetAudioRuntime,
    } = await import("../../src/audioContext.js");
    const runtime = createRuntime();

    configureAudioRuntime(runtime);

    expect(getAudioRuntime()).toBe(runtime);
    expect(getAudioContext()).toBe(runtime.context);
    resetAudioRuntime();
  });

  it.each([
    "nowMs",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "queueMicrotask",
  ])("rejects an audio runtime without %s", async (method) => {
    const { configureAudioRuntime } = await import("../../src/audioContext.js");
    const runtime = createRuntime();
    delete runtime[method];

    expect(() => configureAudioRuntime(runtime)).toThrow(
      `Audio runtime must provide ${method}().`,
    );
  });

  it.each([
    [null, "Audio runtime must be an object."],
    [{}, "Audio runtime must provide a context."],
  ])("rejects an invalid audio runtime %#", async (runtime, message) => {
    const { configureAudioRuntime } = await import("../../src/audioContext.js");

    expect(() => configureAudioRuntime(runtime)).toThrow(message);
  });

  it("restores and preserves the existing browser AudioContext after reset", async () => {
    const browserContext = { state: "running" };
    const AudioContextMock = vi.fn(function AudioContextMock() {
      return browserContext;
    });
    window.AudioContext = AudioContextMock;
    window.webkitAudioContext = undefined;
    const { configureAudioRuntime, getAudioContext, resetAudioRuntime } =
      await import("../../src/audioContext.js");

    expect(getAudioContext()).toBe(browserContext);
    configureAudioRuntime(createRuntime());
    resetAudioRuntime();

    expect(getAudioContext()).toBe(browserContext);
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
  });
});
