import {
  TRANSITION_PROPERTY_PATH_MAP,
  WhiteListAnimationProps,
} from "../../types.js";
import {
  applyAnimationProperty,
  createAnimationSubjectState,
  getTimelineInitialValue,
  isTranslateAnimationProperty,
} from "./animationPropertyUtils.js";
import {
  buildTimeline,
  calculateMaxDuration,
  getValueAtTime,
} from "../../util/animationTimeline.js";

const DEFAULT_PLAYBACK_SPEED = 1;
const DEFAULT_PLAYBACK_LOOP = false;

const hasTranslateProperties = (properties = {}) =>
  Object.keys(properties).some(isTranslateAnimationProperty);

const resolveAutoTargetValue = (targetState, property, animationId) => {
  if (
    !targetState ||
    !Object.prototype.hasOwnProperty.call(targetState, property)
  ) {
    throw new Error(
      `Animation "${animationId}" cannot auto-resolve property "${property}" from targetState.`,
    );
  }

  return targetState[property];
};

const buildPropertyTimelines = (
  element,
  properties,
  propertyPathMap,
  targetState,
  animationId,
  subjectState,
) =>
  Object.entries(properties)
    .map(([property, config]) => {
      if (!WhiteListAnimationProps[property]) {
        throw new Error(
          `${property} is not a supported property for animation.`,
        );
      }

      const currentValue = getTimelineInitialValue({
        object: element,
        property,
        propertyPathMap,
        subjectState,
        defaultValue: 0,
      });

      if (config.auto) {
        const targetValue = resolveAutoTargetValue(
          targetState,
          property,
          animationId,
        );

        if (currentValue === targetValue) {
          return null;
        }

        const timeline = buildTimeline([
          { value: currentValue },
          {
            duration: config.auto.duration,
            value: targetValue,
            easing: config.auto.easing,
          },
        ]);

        return { property, timeline };
      }

      const initialValue = config.initialValue ?? currentValue;
      const timeline = buildTimeline([
        { value: initialValue },
        ...config.keyframes,
      ]);

      return { property, timeline };
    })
    .filter(Boolean);

/**
 * Creates an animation bus that manages all active animations centrally.
 * It supports both update property animations and custom transition runners.
 * @returns {AnimationBus}
 */
export const createAnimationBus = () => {
  const commandQueue = [];
  const activeAnimations = new Map();
  const pendingAnimations = new Map();
  const listeners = new Map();
  let stateVersion = 0;
  let sampledTime = null;
  let hasDeferredQueueProcessing = false;

  const clampAnimationTime = (time, duration) => {
    return Math.min(Math.max(time, 0), Math.max(duration ?? 0, 0));
  };

  const wrapAnimationTime = (time, duration) =>
    ((Math.max(time, 0) % duration) + duration) % duration;

  const applyTimeToContext = (context, timeMS) => {
    const scaledTime = timeMS * context.playbackSpeed;
    const nextTime = context.loop
      ? wrapAnimationTime(scaledTime, context.duration)
      : clampAnimationTime(scaledTime, context.duration);
    context.currentTime = nextTime;
    context.applyFrame(nextTime);
    return !context.loop && nextTime >= context.duration;
  };

  const normalizePlaybackSpeed = (value, animationId) => {
    if (value === undefined || value === null) {
      return DEFAULT_PLAYBACK_SPEED;
    }

    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(
        `Animation "${animationId}" playback speed must be a finite number greater than 0.`,
      );
    }

    return value;
  };

  const normalizePlaybackLoop = (value, animationId) => {
    if (value === undefined || value === null) {
      return DEFAULT_PLAYBACK_LOOP;
    }

    if (typeof value !== "boolean") {
      throw new Error(
        `Animation "${animationId}" playback loop must be a boolean.`,
      );
    }

    return value;
  };

  const emit = (event, data) => {
    listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (_error) {
        // Listener errors should not break animation processing.
      }
    });
  };

  const fireCompleteEvent = (context) => {
    emit("completed", { id: context.id });

    if (context.onComplete) {
      try {
        context.onComplete();
      } catch (_error) {
        // Completion callbacks are best-effort.
      }
    }
  };

  const attachAnimationMetadata = (context, metadata = {}) => {
    context.animationType = metadata.animationType ?? context.animationType;
    context.targetId = metadata.targetId ?? context.targetId;
    context.signature = metadata.signature ?? context.signature;
    context.continuity = metadata.continuity ?? context.continuity ?? "render";
    context.playbackSpeed = normalizePlaybackSpeed(
      metadata.playbackSpeed ?? context.playbackSpeed,
      context.id,
    );
    context.loop = normalizePlaybackLoop(
      metadata.loop ?? context.loop,
      context.id,
    );
    context.onContinuationUpdate =
      metadata.onContinuationUpdate ?? context.onContinuationUpdate;
    return context;
  };

  const toContinuableDescriptor = (context) => ({
    id: context.id,
    type: context.animationType ?? null,
    targetId: context.targetId ?? null,
    signature: context.signature ?? null,
    continuity: context.continuity ?? "render",
    pending: context.pending === true,
  });

  const registerAnimation = (context) => {
    if (
      context.loop &&
      (!Number.isFinite(context.duration) || context.duration <= 0)
    ) {
      throw new Error(
        `Animation "${context.id}" must have a finite duration greater than 0 when playback loop is enabled.`,
      );
    }

    context.applyFrame(0);
    pendingAnimations.delete(context.id);
    activeAnimations.set(context.id, context);

    const completed =
      sampledTime !== null && applyTimeToContext(context, sampledTime);

    emit("started", { id: context.id });

    if (completed) {
      fireCompleteEvent(context);
      activeAnimations.delete(context.id);
    }
  };

  const startPropertyAnimation = (payload) => {
    const {
      id,
      element,
      properties,
      targetState,
      onComplete,
      onCancel,
      propertyPathMap = TRANSITION_PROPERTY_PATH_MAP,
      animationBaseState,
    } = payload;
    let subjectState =
      animationBaseState ??
      (hasTranslateProperties(properties)
        ? createAnimationSubjectState(element)
        : null);

    const getSubjectState = () => {
      if (!subjectState) {
        subjectState = createAnimationSubjectState(element);
      }

      return subjectState;
    };

    const timelines = buildPropertyTimelines(
      element,
      properties,
      propertyPathMap,
      targetState,
      id,
      subjectState,
    );

    if (timelines.length === 0) {
      fireCompleteEvent({ id, onComplete });
      return;
    }

    const context = {
      id,
      kind: "property",
      element,
      timelines,
      duration: calculateMaxDuration(timelines),
      currentTime: 0,
      playbackSpeed: DEFAULT_PLAYBACK_SPEED,
      stateVersion,
      targetState,
      onComplete,
      onCancel,
      applyFrame: (time) => {
        for (const { property, timeline } of timelines) {
          const value = getValueAtTime(timeline, time);
          try {
            applyAnimationProperty({
              object: element,
              property,
              propertyPathMap,
              subjectState: isTranslateAnimationProperty(property)
                ? getSubjectState()
                : subjectState,
              value,
            });
          } catch (_error) {
            // Element might be mid-destroy or otherwise invalid.
          }
        }
      },
      applyTargetState: () => {
        if (!element || element.destroyed) return;

        if (targetState === null) {
          element.destroy();
          return;
        }

        if (!targetState) return;

        for (const [property, value] of Object.entries(targetState)) {
          try {
            applyAnimationProperty({
              object: element,
              property,
              propertyPathMap,
              subjectState: isTranslateAnimationProperty(property)
                ? getSubjectState()
                : subjectState,
              value,
            });
          } catch (_error) {
            // Skip properties that fail to apply.
          }
        }
      },
      isValid: () => Boolean(element) && !element.destroyed,
    };

    registerAnimation(attachAnimationMetadata(context, payload));
  };

  const startCustomAnimation = (payload) => {
    const context = {
      id: payload.id,
      kind: "custom",
      duration: payload.duration ?? 0,
      currentTime: 0,
      playbackSpeed: DEFAULT_PLAYBACK_SPEED,
      deferCompletionUntilNextFrame:
        payload.deferCompletionUntilNextFrame === true,
      pendingCompletion: false,
      stateVersion,
      onComplete: payload.onComplete,
      onCancel: payload.onCancel,
      applyFrame: payload.applyFrame ?? (() => {}),
      applyTargetState: payload.applyTargetState ?? (() => {}),
      isValid: payload.isValid ?? (() => true),
    };

    registerAnimation(attachAnimationMetadata(context, payload));
  };

  const startAnimation = (payload) => {
    if (payload.driver === "custom") {
      startCustomAnimation(payload);
      return;
    }

    startPropertyAnimation(payload);
  };

  const applyCancellation = (context) => {
    try {
      context.applyTargetState?.();
    } catch (_error) {
      // Best-effort cancellation.
    }

    if (context.onCancel) {
      try {
        context.onCancel();
      } catch (_error) {
        // Best-effort cancellation callback.
      }
    }
  };

  const cancelPendingAnimation = (id) => {
    const context = pendingAnimations.get(id);
    if (!context) return;

    applyCancellation(context);
    pendingAnimations.delete(id);
    emit("cancelled", { id });
  };

  const executeCommand = (cmd) => {
    switch (cmd.type) {
      case "START":
        startAnimation(cmd.payload);
        break;
      case "CANCEL":
        cancelAnimation(cmd.id);
        break;
    }
  };

  const processQueue = () => {
    const commands = commandQueue.splice(0);
    for (const command of commands) {
      executeCommand(command);
    }
  };

  const scheduleDeferredQueueProcessing = () => {
    if (sampledTime === null || hasDeferredQueueProcessing) {
      return;
    }

    hasDeferredQueueProcessing = true;
    queueMicrotask(() => {
      hasDeferredQueueProcessing = false;

      if (sampledTime === null) {
        return;
      }

      processQueue();
    });
  };

  const cancelAnimation = (id) => {
    const context = activeAnimations.get(id);
    if (!context) {
      cancelPendingAnimation(id);
      return;
    }

    applyCancellation(context);
    activeAnimations.delete(id);
    emit("cancelled", { id });
  };

  const dispatch = (command) => {
    commandQueue.push(command);
    scheduleDeferredQueueProcessing();
  };

  const cancelAll = () => {
    for (const [id, context] of activeAnimations) {
      applyCancellation(context);
      emit("cancelled", { id });
    }

    for (const [id, context] of pendingAnimations) {
      applyCancellation(context);
      emit("cancelled", { id });
    }

    activeAnimations.clear();
    pendingAnimations.clear();
    stateVersion++;
  };

  const cancelAllExcept = (idsToKeep = new Set()) => {
    const keepIds =
      idsToKeep instanceof Set ? idsToKeep : new Set(idsToKeep ?? []);

    for (const [id, context] of activeAnimations) {
      if (keepIds.has(id)) {
        continue;
      }

      applyCancellation(context);
      activeAnimations.delete(id);
      emit("cancelled", { id });
    }

    for (const [id, context] of pendingAnimations) {
      if (keepIds.has(id)) {
        continue;
      }

      applyCancellation(context);
      pendingAnimations.delete(id);
      emit("cancelled", { id });
    }
  };

  const tick = (deltaMS) => {
    processQueue();

    const toRemove = [];

    for (const [id, context] of activeAnimations) {
      if (context.stateVersion !== stateVersion) {
        toRemove.push(id);
        continue;
      }

      if (!context.isValid()) {
        toRemove.push(id);
        continue;
      }

      if (context.pendingCompletion) {
        fireCompleteEvent(context);
        toRemove.push(id);
        continue;
      }

      const elapsedTime = context.currentTime + deltaMS * context.playbackSpeed;
      context.currentTime = context.loop
        ? wrapAnimationTime(elapsedTime, context.duration)
        : clampAnimationTime(elapsedTime, context.duration);

      if (!context.loop && context.currentTime >= context.duration) {
        context.applyFrame(context.duration);

        if (
          context.deferCompletionUntilNextFrame === true &&
          context.duration > 0
        ) {
          context.pendingCompletion = true;
          continue;
        }

        fireCompleteEvent(context);
        toRemove.push(id);
        continue;
      }

      context.applyFrame(context.currentTime);
    }

    for (const id of toRemove) {
      activeAnimations.delete(id);
    }
  };

  const setTime = (timeMS) => {
    sampledTime = timeMS;
    processQueue();

    const toRemove = [];

    for (const [id, context] of activeAnimations) {
      if (context.stateVersion !== stateVersion) {
        toRemove.push(id);
        continue;
      }

      if (!context.isValid()) {
        toRemove.push(id);
        continue;
      }

      if (applyTimeToContext(context, timeMS)) {
        fireCompleteEvent(context);
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      activeAnimations.delete(id);
    }
  };

  const clearTime = () => {
    sampledTime = null;
  };

  const flush = () => {
    processQueue();
  };

  const on = (event, callback) => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }

    listeners.get(event).add(callback);
    return () => off(event, callback);
  };

  const off = (event, callback) => {
    listeners.get(event)?.delete(callback);
  };

  const registerPending = (payload) => {
    const context = attachAnimationMetadata(
      {
        id: payload.id,
        kind: "pending",
        pending: true,
        applyTargetState: payload.applyTargetState ?? (() => {}),
        onCancel: payload.onCancel,
      },
      payload,
    );

    pendingAnimations.set(context.id, context);
  };

  const activatePending = (id, payload) => {
    const pendingContext = pendingAnimations.get(id);
    if (!pendingContext) {
      return false;
    }

    pendingAnimations.delete(id);
    startAnimation({
      ...payload,
      id,
      animationType: pendingContext.animationType,
      targetId: pendingContext.targetId,
      signature: pendingContext.signature,
      continuity: pendingContext.continuity,
      playbackSpeed: pendingContext.playbackSpeed,
      loop: payload.loop ?? pendingContext.loop,
      onContinuationUpdate:
        payload.onContinuationUpdate ?? pendingContext.onContinuationUpdate,
    });

    return true;
  };

  const removePending = (id) => {
    pendingAnimations.delete(id);
  };

  const getContinuableAnimations = () => {
    const descriptors = new Map();

    for (const [id, context] of pendingAnimations) {
      if (context.continuity === "persistent") {
        descriptors.set(id, toContinuableDescriptor(context));
      }
    }

    for (const [id, context] of activeAnimations) {
      if (context.continuity === "persistent") {
        descriptors.set(id, toContinuableDescriptor(context));
      }
    }

    return descriptors;
  };

  const hasContext = (id) =>
    activeAnimations.has(id) || pendingAnimations.has(id);

  const updateContinuation = (id, payload) => {
    const context = activeAnimations.get(id) ?? pendingAnimations.get(id);

    if (!context?.onContinuationUpdate) {
      return;
    }

    try {
      context.onContinuationUpdate(payload);
    } catch (_error) {
      // Continuation updates are best-effort.
    }
  };

  const getState = () => ({
    stateVersion,
    activeCount: activeAnimations.size,
    pendingCount: pendingAnimations.size,
    animations: Array.from(activeAnimations.entries()).map(([id, ctx]) => ({
      id,
      currentTime: ctx.currentTime,
      duration: ctx.duration,
      playbackSpeed: ctx.playbackSpeed,
      progress: ctx.duration > 0 ? ctx.currentTime / ctx.duration : 0,
    })),
  });

  const isAnimating = (id) => activeAnimations.has(id);

  const destroy = () => {
    cancelAll();
    listeners.clear();
  };

  return {
    dispatch,
    cancelAll,
    cancelAllExcept,
    flush,
    tick,
    setTime,
    clearTime,
    on,
    off,
    registerPending,
    activatePending,
    removePending,
    getContinuableAnimations,
    getState,
    isAnimating,
    hasContext,
    updateContinuation,
    destroy,
  };
};
