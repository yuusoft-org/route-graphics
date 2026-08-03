const DEFAULT_RENDER_QUANTUM_SIZE = 128;
const DEFAULT_MAX_CALLBACKS = 100_000;
const TIME_EPSILON_MS = 1e-7;

const assertFiniteNonNegative = (value, name) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a finite non-negative number.`);
  }
  return parsed;
};

const assertPositiveInteger = (value, name) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
};

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
};

/**
 * Creates a deterministic driver around the browser's OfflineAudioContext.
 * JavaScript timers and authored render steps are advanced on the same
 * quantized audio clock as Web Audio instead of wall time.
 *
 * @param {Object} options
 * @param {number} options.durationMs
 * @param {number} [options.sampleRate=48000]
 * @param {number} [options.numberOfChannels=2]
 * @param {number} [options.renderQuantumSize=128]
 * @param {number} [options.maxCallbacks=100000]
 * @param {typeof OfflineAudioContext} [options.OfflineAudioContextCtor]
 */
export const createDeterministicAudioRuntime = ({
  durationMs,
  sampleRate = 48_000,
  numberOfChannels = 2,
  renderQuantumSize = DEFAULT_RENDER_QUANTUM_SIZE,
  maxCallbacks = DEFAULT_MAX_CALLBACKS,
  OfflineAudioContextCtor = globalThis.OfflineAudioContext,
} = {}) => {
  const normalizedDurationMs = assertFiniteNonNegative(
    durationMs,
    "durationMs",
  );
  if (normalizedDurationMs === 0) {
    throw new Error("durationMs must be greater than zero.");
  }
  const normalizedSampleRate = assertPositiveInteger(sampleRate, "sampleRate");
  const normalizedChannelCount = assertPositiveInteger(
    numberOfChannels,
    "numberOfChannels",
  );
  const normalizedQuantumSize = assertPositiveInteger(
    renderQuantumSize,
    "renderQuantumSize",
  );
  const normalizedMaxCallbacks = assertPositiveInteger(
    maxCallbacks,
    "maxCallbacks",
  );
  if (typeof OfflineAudioContextCtor !== "function") {
    throw new Error(
      "OfflineAudioContext is not available in this environment.",
    );
  }

  const frameCount = Math.ceil(
    (normalizedDurationMs / 1000) * normalizedSampleRate,
  );
  const offlineContext = new OfflineAudioContextCtor({
    numberOfChannels: normalizedChannelCount,
    length: frameCount,
    sampleRate: normalizedSampleRate,
  });
  const context = new Proxy(offlineContext, {
    get(target, property) {
      // OfflineAudioContext stays suspended while its graph is authored. The
      // AudioStage must still schedule sources immediately at currentTime;
      // the deterministic runner alone owns actual suspend/resume operations.
      if (property === "state") return "running";
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const tasks = new Map();
  let nextTaskId = 1;
  let nextOrder = 1;
  let callbackCount = 0;
  let renderingStarted = false;
  let destroyed = false;

  const nowMs = () => offlineContext.currentTime * 1000;
  const quantizeTimeMs = (timeMs) => {
    const frame = Math.ceil((timeMs / 1000) * normalizedSampleRate);
    const quantizedFrame =
      Math.ceil(frame / normalizedQuantumSize) * normalizedQuantumSize;
    return (quantizedFrame / normalizedSampleRate) * 1000;
  };

  const addTask = ({ callback, dueTimeMs, intervalMs = null }) => {
    if (destroyed) {
      throw new Error("Deterministic audio runtime has been destroyed.");
    }
    if (typeof callback !== "function") {
      throw new Error("Scheduled audio callback must be a function.");
    }

    const id = nextTaskId++;
    tasks.set(id, {
      id,
      callback,
      dueTimeMs: Math.max(nowMs(), dueTimeMs),
      intervalMs,
      order: nextOrder++,
    });
    return id;
  };

  const setTimeout = (callback, delayMs = 0) =>
    addTask({
      callback,
      dueTimeMs: nowMs() + assertFiniteNonNegative(delayMs, "delayMs"),
    });
  const clearTimeout = (id) => {
    tasks.delete(id);
  };
  const setInterval = (callback, intervalMs = 0) => {
    const normalizedIntervalMs = assertFiniteNonNegative(
      intervalMs,
      "intervalMs",
    );
    if (normalizedIntervalMs === 0) {
      throw new Error("intervalMs must be greater than zero.");
    }
    return addTask({
      callback,
      dueTimeMs: nowMs() + normalizedIntervalMs,
      intervalMs: normalizedIntervalMs,
    });
  };
  const clearInterval = clearTimeout;
  const scheduleAt = (timeMs, callback) =>
    addTask({
      callback,
      dueTimeMs: assertFiniteNonNegative(timeMs, "timeMs"),
    });

  const getSortedDueTasks = (boundaryMs) =>
    [...tasks.values()]
      .filter(
        (task) =>
          quantizeTimeMs(task.dueTimeMs) <= boundaryMs + TIME_EPSILON_MS,
      )
      .sort(
        (left, right) =>
          left.dueTimeMs - right.dueTimeMs || left.order - right.order,
      );

  const drainDueTasks = async (boundaryMs) => {
    while (true) {
      const dueTasks = getSortedDueTasks(boundaryMs);
      if (dueTasks.length === 0) return;

      for (const task of dueTasks) {
        if (tasks.get(task.id) !== task) continue;
        callbackCount += 1;
        if (callbackCount > normalizedMaxCallbacks) {
          throw new Error(
            `Deterministic audio runtime exceeded ${normalizedMaxCallbacks} callbacks.`,
          );
        }

        if (task.intervalMs === null) {
          tasks.delete(task.id);
        } else {
          task.dueTimeMs += task.intervalMs;
        }
        await task.callback();
        await flushMicrotasks();
      }
    }
  };

  const getNextBoundaryMs = () => {
    let nextBoundaryMs = Number.POSITIVE_INFINITY;
    for (const task of tasks.values()) {
      nextBoundaryMs = Math.min(nextBoundaryMs, quantizeTimeMs(task.dueTimeMs));
    }
    return nextBoundaryMs;
  };

  const render = async () => {
    if (destroyed) {
      throw new Error("Deterministic audio runtime has been destroyed.");
    }
    if (renderingStarted) {
      throw new Error("Deterministic audio runtime can only render once.");
    }
    renderingStarted = true;

    let failure;
    const activeHandlers = new Set();
    const armNextSuspension = () => {
      if (failure) return;
      const boundaryMs = getNextBoundaryMs();
      if (
        !Number.isFinite(boundaryMs) ||
        boundaryMs >= normalizedDurationMs - TIME_EPSILON_MS
      ) {
        return;
      }

      const handler = offlineContext
        .suspend(boundaryMs / 1000)
        .then(async () => {
          try {
            await drainDueTasks(nowMs());
            armNextSuspension();
          } catch (error) {
            failure = error;
          } finally {
            try {
              await offlineContext.resume();
            } catch (error) {
              failure ??= error;
            }
          }
        })
        .catch((error) => {
          failure ??= error;
        })
        .finally(() => {
          activeHandlers.delete(handler);
        });
      activeHandlers.add(handler);
    };

    await flushMicrotasks();
    await drainDueTasks(0);
    armNextSuspension();
    const renderedBuffer = await offlineContext.startRendering();
    await Promise.allSettled(activeHandlers);
    if (failure) throw failure;
    return renderedBuffer;
  };

  const destroy = () => {
    destroyed = true;
    tasks.clear();
  };

  return {
    context,
    offlineContext,
    durationMs: normalizedDurationMs,
    sampleRate: normalizedSampleRate,
    numberOfChannels: normalizedChannelCount,
    nowMs,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask: (callback) => globalThis.queueMicrotask(callback),
    scheduleAt,
    render,
    destroy,
    getPendingTaskCount: () => tasks.size,
  };
};
