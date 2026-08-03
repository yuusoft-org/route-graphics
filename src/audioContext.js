let audioContext;
let configuredAudioRuntime;

const isAudioDebugEnabled = () =>
  globalThis.window?.RTGL_AUDIO_DEBUG === true ||
  globalThis.window?.RTGL_VT_DEBUG === true;

const debugAudioContext = (message, details = {}) => {
  if (!isAudioDebugEnabled()) {
    return;
  }

  console.log(`[AudioContext] ${message}`, details);
};

const getBrowserAudioContext = () => {
  if (audioContext) return audioContext;

  const AudioContextCtor =
    globalThis.window?.AudioContext ?? globalThis.window?.webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("AudioContext is not available in this environment.");
  }

  audioContext = new AudioContextCtor();
  debugAudioContext("context created", { state: audioContext.state });
  return audioContext;
};

const browserAudioRuntime = {
  get context() {
    return getBrowserAudioContext();
  },
  nowMs: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timeoutId) => globalThis.clearTimeout(timeoutId),
  setInterval: (callback, intervalMs) =>
    globalThis.setInterval(callback, intervalMs),
  clearInterval: (intervalId) => globalThis.clearInterval(intervalId),
  queueMicrotask: (callback) => globalThis.queueMicrotask(callback),
};

const assertAudioRuntime = (runtime) => {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("Audio runtime must be an object.");
  }
  if (!runtime.context) {
    throw new Error("Audio runtime must provide a context.");
  }

  for (const method of [
    "nowMs",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "queueMicrotask",
  ]) {
    if (typeof runtime[method] !== "function") {
      throw new Error(`Audio runtime must provide ${method}().`);
    }
  }
};

/**
 * Installs the timing and context driver used by audio rendering.
 * Intended for deterministic offline rendering and advanced hosts. Calling
 * this before creating/loading audio keeps the normal public state interface
 * unchanged while replacing only the environment-facing clock.
 *
 * @param {Object} runtime
 */
export const configureAudioRuntime = (runtime) => {
  assertAudioRuntime(runtime);
  configuredAudioRuntime = runtime;
};

/** Restore the browser AudioContext and wall-clock timing. */
export const resetAudioRuntime = () => {
  configuredAudioRuntime = undefined;
};

export const getAudioRuntime = () =>
  configuredAudioRuntime ?? browserAudioRuntime;

export const getAudioContext = () => getAudioRuntime().context;
