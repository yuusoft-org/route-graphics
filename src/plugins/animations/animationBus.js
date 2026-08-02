import {
  TRANSITION_PROPERTY_PATH_MAP,
  isSupportedAnimationProperty,
} from "../../types.js";
import {
  applyAnimationProperty,
  createAnimationSubjectState,
  getTimelineInitialValue,
  isTranslateAnimationProperty,
} from "./animationPropertyUtils.js";
import {
  applyTimelineFrame,
  assertDisjointTimelineWriteSets,
  bindTimelineProgram,
  collectTimelineEventCrossings,
  compileLegacyTweenAnimation,
  createGsapTimelineEvaluator,
  createTimelineFrameBuffer,
  getSemanticChannel,
  getPixiTimelineTargetIdentity,
  isPixiTimelineTargetValid,
  mapDomainTime,
} from "./timeline/index.js";

const DEFAULT_PLAYBACK_SPEED = 1;
const DEFAULT_PLAYBACK_LOOP = false;

const hasTranslateProperties = (properties = {}) =>
  Object.keys(properties).some(isTranslateAnimationProperty);

const applyWithGroupFrameHooks = (groups, apply) => {
  const startedGroups = [];
  for (const group of groups) {
    try {
      group.beforeApplyFrame?.();
      startedGroups.push(group);
    } catch {
      // Frame hooks are an internal optimization and must not stop playback.
    }
  }

  try {
    apply();
  } finally {
    for (let index = startedGroups.length - 1; index >= 0; index--) {
      try {
        startedGroups[index].afterApplyFrame?.();
      } catch {
        // Keep other groups consistent even if one hook fails.
      }
    }
  }
};

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

const getTimelineAdapterProperty = (property) => {
  if (property === "translateX") return "x";
  if (property === "translateY") return "y";
  return property;
};

const removeNoopAutoProperties = (group, animationId, preserveNoopAuto) => ({
  ...group,
  properties: Object.fromEntries(
    Object.entries(group.properties).filter(([property, config]) => {
      if (!config.auto || preserveNoopAuto) return true;
      const currentValue = getTimelineInitialValue({
        object: group.element,
        property,
        propertyPathMap: group.propertyPathMap,
        subjectState: group.subjectState,
        defaultValue: 0,
      });
      const targetValue = resolveAutoTargetValue(
        group.targetState,
        property,
        animationId,
      );
      return currentValue !== targetValue;
    }),
  ),
});

export const createLegacyTimelineContext = ({
  id,
  targetId,
  propertyGroups,
  playbackSpeed,
  loop,
  repeat,
  repeatDelay,
  yoyo,
}) => {
  const preservesRepeatedDuration =
    loop ||
    repeat === "infinite" ||
    (Number.isSafeInteger(repeat) && repeat > 0);
  const groups = propertyGroups
    .map((group) => {
      let subjectState =
        group.subjectState ??
        group.animationBaseState ??
        (hasTranslateProperties(group.properties)
          ? createAnimationSubjectState(group.element)
          : null);
      return {
        ...group,
        propertyPathMap: group.propertyPathMap ?? TRANSITION_PROPERTY_PATH_MAP,
        subjectState,
        getSubjectState:
          group.getSubjectState ??
          (() => {
            if (!subjectState) {
              subjectState = createAnimationSubjectState(group.element);
            }
            return subjectState;
          }),
      };
    })
    .map((group) =>
      removeNoopAutoProperties(group, id, preservesRepeatedDuration),
    )
    .filter((group) => Object.keys(group.properties).length > 0);
  if (groups.length === 0) return null;

  const mainGroup = groups.find((group) => !group.filterId);
  const filterGroups = groups.filter((group) => group.filterId);
  const animation = {
    id,
    targetId: targetId ?? mainGroup?.element?.label ?? id,
    type: "update",
    ...(mainGroup ? { tween: mainGroup.properties } : {}),
    ...(filterGroups.length > 0
      ? {
          filterTweens: Object.fromEntries(
            filterGroups.map((group) => [group.filterId, group.properties]),
          ),
        }
      : {}),
    playback: {
      ...(playbackSpeed === undefined ? {} : { speed: playbackSpeed }),
      ...(loop ? { loop: true } : {}),
      ...(repeat === undefined ? {} : { repeat }),
      ...(repeatDelay === undefined ? {} : { repeatDelay }),
      ...(yoyo === undefined ? {} : { yoyo }),
    },
  };
  const program = compileLegacyTweenAnimation(animation, {
    sourcePath: `animationBus.${id}`,
  });
  const bindingByChannel = new Map();

  for (const group of groups) {
    for (const [property, config] of Object.entries(group.properties)) {
      const sampleValue =
        config.initialValue ?? config.keyframes?.[0]?.value ?? 0;
      const channelInfo = getSemanticChannel({
        property,
        filterId: group.filterId,
        sampleValue,
      });
      const adapterProperty = getTimelineAdapterProperty(property);
      bindingByChannel.set(channelInfo.channel, {
        property,
        valueType: channelInfo.valueType,
        group,
        get: () =>
          group.filterId
            ? group.element[property]
            : getTimelineInitialValue({
                object: group.element,
                property: adapterProperty,
                propertyPathMap: group.propertyPathMap,
                subjectState: group.subjectState,
                defaultValue: 0,
              }),
        apply: (_target, value) => {
          if (group.filterId) {
            group.element[property] = value;
            return;
          }
          applyAnimationProperty({
            object: group.element,
            property: adapterProperty,
            propertyPathMap: group.propertyPathMap,
            subjectState: group.subjectState,
            value,
          });
        },
      });
    }
  }

  const element = mainGroup?.element ?? groups[0].element;
  const subjectState =
    mainGroup?.subjectState ??
    (mainGroup && hasTranslateProperties(mainGroup.properties)
      ? mainGroup.getSubjectState()
      : { x: 0, y: 0, width: 0, height: 0 });
  const instance = bindTimelineProgram(program, {
    capabilities: new Set(program.requirements),
    targetRegistry: {
      [program.ownerId]: {
        handle: element,
        identity: getPixiTimelineTargetIdentity(element, program.ownerId),
        subject: subjectState,
        targetState: mainGroup?.targetState,
      },
    },
    channelRegistry: {
      resolve: (_target, channel) => bindingByChannel.get(channel),
    },
  });
  return { program, instance, groups };
};

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
    ((time % duration) + duration) % duration;

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

  const fireReverseCompleteEvent = (context) => {
    emit("reverseCompleted", { id: context.id });

    if (context.onReverseComplete) {
      try {
        context.onReverseComplete();
      } catch {
        // Reverse-completion callbacks are best-effort.
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
    context.paused = context.paused ?? false;
    context.playDirection = context.playDirection ?? 1;
    context.controlSpeed = context.controlSpeed ?? 1;
    context.emittedTimelineEvents ??= new Set();
    context.emittedTimelineOccurrences ??= new Set();
    return context;
  };

  const deliverTimelineEvents = (
    context,
    previousTime,
    currentTime,
    { seek = false, replay = false, includeInitial = false } = {},
  ) => {
    if (!context.instance?.events?.length) return;
    const events = collectTimelineEventCrossings(
      context.instance,
      previousTime,
      currentTime,
      {
        seek,
        replay,
        emittedOnce: context.emittedTimelineEvents,
        emittedOccurrences: context.emittedTimelineOccurrences,
        includeInitial,
      },
    );
    for (const event of events) {
      if (event.occurrence === "once") {
        context.emittedTimelineEvents.add(event.onceKey);
      } else {
        context.emittedTimelineOccurrences.add(event.occurrenceKey);
      }
      emit("timelineEvent", {
        id: context.id,
        event: event.name,
        payload: event.payload,
        time: event.resolvedTime,
        direction: event.actualDirection,
        iteration: event.iterationTuple,
      });
    }
  };

  const toContinuableDescriptor = (context) => ({
    id: context.id,
    type: context.animationType ?? null,
    targetId: context.targetId ?? null,
    signature: context.signature ?? null,
    continuity: context.continuity ?? "render",
    pending: context.pending === true,
  });

  const disposeContext = (context) => {
    if (!context || context.disposed === true) return;
    context.disposed = true;
    try {
      context.dispose?.();
    } catch {
      // Cleanup is best-effort and must not retain a dead animation context.
    }
  };

  const registerAnimation = (context) => {
    if (
      context.loop &&
      (!Number.isFinite(context.duration) || context.duration <= 0)
    ) {
      throw new Error(
        `Animation "${context.id}" must have a finite duration greater than 0 when playback loop is enabled.`,
      );
    }

    try {
      context.applyFrame(0);
    } catch (error) {
      disposeContext(context);
      throw error;
    }
    pendingAnimations.delete(context.id);
    activeAnimations.set(context.id, context);

    const completed =
      sampledTime !== null && applyTimeToContext(context, sampledTime);

    emit("started", { id: context.id });
    if (sampledTime === null) {
      deliverTimelineEvents(context, 0, 0, { includeInitial: true });
    }

    if (completed) {
      fireCompleteEvent(context);
      disposeContext(context);
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
      onReverseComplete,
      propertyPathMap = TRANSITION_PROPERTY_PATH_MAP,
      animationBaseState,
    } = payload;
    const normalizedPayload = {
      ...payload,
      playbackSpeed: normalizePlaybackSpeed(payload.playbackSpeed, id),
      loop: normalizePlaybackLoop(payload.loop, id),
    };
    const propertyGroups = (
      payload.propertyGroups ?? [
        {
          element,
          properties,
          targetState,
          propertyPathMap,
          animationBaseState,
        },
      ]
    ).map((group) => {
      let subjectState =
        group.animationBaseState ??
        (hasTranslateProperties(group.properties)
          ? createAnimationSubjectState(group.element)
          : null);

      return {
        ...group,
        propertyPathMap: group.propertyPathMap ?? TRANSITION_PROPERTY_PATH_MAP,
        subjectState,
        getSubjectState: () => {
          if (!subjectState) {
            subjectState = createAnimationSubjectState(group.element);
          }
          return subjectState;
        },
      };
    });

    for (const group of propertyGroups) {
      if (group.validateProperty === false) continue;
      for (const property of Object.keys(group.properties)) {
        if (!isSupportedAnimationProperty(property)) {
          throw new Error(
            `${property} is not a supported property for animation.`,
          );
        }
      }
    }

    let sharedTimeline;
    try {
      sharedTimeline =
        payload.preparedTimeline ??
        createLegacyTimelineContext({
          id,
          targetId: normalizedPayload.targetId,
          propertyGroups,
          playbackSpeed: normalizedPayload.playbackSpeed,
          loop: normalizedPayload.loop,
          repeat: normalizedPayload.repeat,
          repeatDelay: normalizedPayload.repeatDelay,
          yoyo: normalizedPayload.yoyo,
        });
    } catch (error) {
      if (
        normalizedPayload.loop &&
        error instanceof Error &&
        error.message.includes("zero-duration")
      ) {
        throw new Error(
          `Animation "${id}" must have a finite duration greater than 0 when playback loop is enabled.`,
        );
      }
      throw error;
    }

    if (!sharedTimeline) {
      fireCompleteEvent({ id, onComplete });
      return;
    }

    const timelineEvaluator = createGsapTimelineEvaluator(
      sharedTimeline.instance,
    );
    const context = {
      id,
      kind: "timeline",
      element,
      program: sharedTimeline.program,
      instance: sharedTimeline.instance,
      duration: sharedTimeline.instance.duration,
      currentTime: 0,
      playbackSpeed: DEFAULT_PLAYBACK_SPEED,
      deferCompletionUntilNextFrame:
        payload.deferCompletionUntilNextFrame === true,
      pendingCompletion: false,
      stateVersion,
      targetState,
      onComplete,
      onCancel,
      onReverseComplete,
      animationBackend: timelineEvaluator.backend,
      applyFrame: timelineEvaluator.apply,
      dispose: timelineEvaluator.destroy,
      applyTargetState: () => {
        applyWithGroupFrameHooks(propertyGroups, () => {
          for (const group of propertyGroups) {
            if (!group.element || group.element.destroyed) continue;

            if (group.targetState === null) {
              group.element.destroy?.();
              continue;
            }

            if (!group.targetState) continue;

            for (const [property, value] of Object.entries(group.targetState)) {
              try {
                applyAnimationProperty({
                  object: group.element,
                  property,
                  propertyPathMap: group.propertyPathMap,
                  subjectState: isTranslateAnimationProperty(property)
                    ? group.getSubjectState()
                    : group.subjectState,
                  value,
                });
              } catch (_error) {
                // Skip properties that fail to apply.
              }
            }
          }
        });
      },
      isValid: () =>
        propertyGroups.every(
          (group) =>
            Boolean(group.element) &&
            !group.element.destroyed &&
            (group.isValid?.() ?? true),
        ),
      getPublicPlaybackState: () => {
        const rootDomain = sharedTimeline.instance.domains.root;
        const mapped = mapDomainTime(rootDomain, context.currentTime);
        return {
          currentTime: mapped.localTime,
          duration: rootDomain.cycleDuration,
          playbackSpeed: rootDomain.rate,
        };
      },
    };

    registerAnimation(
      attachAnimationMetadata(context, {
        ...normalizedPayload,
        playbackSpeed: DEFAULT_PLAYBACK_SPEED,
        loop: false,
      }),
    );
  };

  const startCustomAnimation = (payload) => {
    const context = {
      id: payload.id,
      kind: "custom",
      program: payload.program,
      instance: payload.instance,
      duration: payload.duration ?? 0,
      currentTime: 0,
      playbackSpeed: DEFAULT_PLAYBACK_SPEED,
      deferCompletionUntilNextFrame:
        payload.deferCompletionUntilNextFrame === true,
      pendingCompletion: false,
      stateVersion,
      onComplete: payload.onComplete,
      onCancel: payload.onCancel,
      onReverseComplete: payload.onReverseComplete,
      animationBackend: payload.animationBackend,
      dispose: payload.dispose,
      applyFrame: payload.applyFrame ?? (() => {}),
      applyTargetState: payload.applyTargetState ?? (() => {}),
      isValid: payload.isValid ?? (() => true),
    };

    registerAnimation(attachAnimationMetadata(context, payload));
  };

  const startTimelineAnimation = (payload) => {
    const instance =
      payload.instance ??
      bindTimelineProgram(payload.program, payload.bindingContext);
    const timelineEvaluator = createGsapTimelineEvaluator(instance);
    const context = {
      id: payload.id,
      kind: "timeline",
      program: payload.program,
      instance,
      duration: instance.duration,
      currentTime: 0,
      playbackSpeed: DEFAULT_PLAYBACK_SPEED,
      deferCompletionUntilNextFrame:
        payload.deferCompletionUntilNextFrame === true,
      pendingCompletion: false,
      stateVersion,
      onComplete: payload.onComplete,
      onCancel: payload.onCancel,
      onReverseComplete: payload.onReverseComplete,
      animationBackend: timelineEvaluator.backend,
      dispose: timelineEvaluator.destroy,
      applyFrame: payload.applyFrame ?? timelineEvaluator.apply,
      applyTargetState: payload.applyTargetState ?? (() => {}),
      isValid:
        payload.isValid ??
        (() =>
          instance.tracks.every((track) =>
            isPixiTimelineTargetValid(track.target),
          )),
    };
    registerAnimation(
      attachAnimationMetadata(context, {
        ...payload,
        playbackSpeed: DEFAULT_PLAYBACK_SPEED,
        loop: false,
      }),
    );
  };

  const startAnimation = (payload) => {
    if (payload.driver === "custom") {
      startCustomAnimation(payload);
      return;
    }

    if (payload.driver === "timeline") {
      startTimelineAnimation(payload);
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

    disposeContext(context);
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
    const activeBefore = new Map(activeAnimations);
    const predictedInstances = new Map(
      [...activeAnimations]
        .filter(([, context]) => context.instance)
        .map(([id, context]) => [id, context.instance]),
    );
    const stagedBindingContexts = new Set();
    try {
      for (const command of commands) {
        if (command.type === "CANCEL") {
          predictedInstances.delete(command.id);
          continue;
        }
        if (command.type !== "START") continue;
        const instance =
          command.payload.instance ??
          command.payload.preparedTimeline?.instance;
        if (!instance) continue;
        predictedInstances.delete(command.payload.id);
        assertDisjointTimelineWriteSets([
          ...predictedInstances.values(),
          instance,
        ]);
        predictedInstances.set(command.payload.id, instance);
        if (command.payload.bindingContext) {
          stagedBindingContexts.add(command.payload.bindingContext);
        }
      }
      for (const bindingContext of stagedBindingContexts) {
        bindingContext.commit?.();
      }
    } catch (error) {
      for (const bindingContext of stagedBindingContexts) {
        bindingContext.rollback?.();
      }
      throw error;
    }
    try {
      for (const command of commands) {
        executeCommand(command);
      }
    } catch (error) {
      for (let index = commands.length - 1; index >= 0; index--) {
        const command = commands[index];
        if (command.type !== "START") continue;
        const instance =
          command.payload.instance ??
          command.payload.preparedTimeline?.instance;
        if (instance) {
          try {
            applyTimelineFrame(createTimelineFrameBuffer(instance));
          } catch {
            // Preserve the activation error; adapters already received their
            // best-effort rollback to captured binding-time values.
          }
        }
        if (activeBefore.has(command.payload.id)) {
          const currentContext = activeAnimations.get(command.payload.id);
          if (currentContext !== activeBefore.get(command.payload.id)) {
            disposeContext(currentContext);
          }
          activeAnimations.set(
            command.payload.id,
            activeBefore.get(command.payload.id),
          );
        } else {
          disposeContext(activeAnimations.get(command.payload.id));
          activeAnimations.delete(command.payload.id);
        }
      }
      for (const bindingContext of stagedBindingContexts) {
        bindingContext.rollback?.();
      }
      throw error;
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

    if (
      typeof deltaMS !== "number" ||
      !Number.isFinite(deltaMS) ||
      deltaMS < 0
    ) {
      throw new Error(
        "Animation tick delta must be a non-negative finite number.",
      );
    }

    const toRemove = [];

    for (const [id, context] of activeAnimations) {
      if (context.stateVersion !== stateVersion) {
        toRemove.push(id);
        continue;
      }

      if (!context.isValid()) {
        applyCancellation(context);
        emit("cancelled", { id, reason: "invalid-target" });
        toRemove.push(id);
        continue;
      }

      if (context.paused) continue;

      if (context.pendingCompletion) {
        fireCompleteEvent(context);
        toRemove.push(id);
        continue;
      }

      const previousTime = context.currentTime;
      const elapsedTime =
        context.currentTime +
        deltaMS *
          context.playbackSpeed *
          context.controlSpeed *
          context.playDirection;
      context.currentTime = context.loop
        ? wrapAnimationTime(elapsedTime, context.duration)
        : clampAnimationTime(elapsedTime, context.duration);

      if (
        !context.loop &&
        context.playDirection > 0 &&
        context.currentTime >= context.duration
      ) {
        try {
          context.applyFrame(context.duration);
          deliverTimelineEvents(context, previousTime, context.duration);
        } catch (error) {
          applyCancellation(context);
          emit("failed", { id, error });
          toRemove.push(id);
          continue;
        }

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

      if (
        !context.loop &&
        context.playDirection < 0 &&
        context.currentTime <= 0
      ) {
        try {
          context.applyFrame(0);
          deliverTimelineEvents(context, previousTime, 0);
        } catch (error) {
          applyCancellation(context);
          emit("failed", { id, error });
          toRemove.push(id);
          continue;
        }
        fireReverseCompleteEvent(context);
        toRemove.push(id);
        continue;
      }

      try {
        context.applyFrame(context.currentTime);
        deliverTimelineEvents(context, previousTime, context.currentTime);
      } catch (error) {
        applyCancellation(context);
        emit("failed", { id, error });
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      disposeContext(activeAnimations.get(id));
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
        applyCancellation(context);
        emit("cancelled", { id, reason: "invalid-target" });
        toRemove.push(id);
        continue;
      }

      try {
        if (applyTimeToContext(context, timeMS)) {
          fireCompleteEvent(context);
          toRemove.push(id);
        }
      } catch (error) {
        applyCancellation(context);
        emit("failed", { id, error });
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      disposeContext(activeAnimations.get(id));
      activeAnimations.delete(id);
    }
  };

  const clearTime = () => {
    sampledTime = null;
  };

  const getActiveContext = (id) => {
    processQueue();
    return activeAnimations.get(id) ?? null;
  };

  const pause = (id) => {
    const context = getActiveContext(id);
    if (!context) return false;
    context.paused = true;
    return true;
  };

  const resume = (id) => {
    const context = getActiveContext(id);
    if (!context) return false;
    context.paused = false;
    return true;
  };

  const reverse = (id, enabled = true) => {
    const context = getActiveContext(id);
    if (!context) return false;
    if (enabled && context.animationType === "transition") {
      throw new Error(
        `Transition animation "${id}" does not support player-controlled reverse playback.`,
      );
    }
    context.playDirection = enabled ? -1 : 1;
    context.paused = false;
    return true;
  };

  const setSpeed = (id, speed) => {
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0) {
      throw new Error(
        "Animation control speed must be a positive finite number.",
      );
    }
    const context = getActiveContext(id);
    if (!context) return false;
    context.controlSpeed = speed;
    return true;
  };

  const seek = (id, timeMS, { emitEvents = false } = {}) => {
    if (typeof timeMS !== "number" || !Number.isFinite(timeMS)) {
      throw new Error("Animation seek time must be finite.");
    }
    const context = getActiveContext(id);
    if (!context) return false;
    const previousTime = context.currentTime;
    const time = context.loop
      ? wrapAnimationTime(timeMS, context.duration)
      : clampAnimationTime(timeMS, context.duration);
    context.applyFrame(time);
    context.currentTime = time;
    if (time < context.duration) {
      context.pendingCompletion = false;
    }
    deliverTimelineEvents(context, previousTime, time, {
      seek: true,
      replay: emitEvents,
    });
    return true;
  };

  const setProgress = (id, progress, options) => {
    if (typeof progress !== "number" || !Number.isFinite(progress)) {
      throw new Error("Animation progress must be finite.");
    }
    const context = getActiveContext(id);
    if (!context || !Number.isFinite(context.duration)) return false;
    return seek(
      id,
      Math.min(Math.max(progress, 0), 1) * context.duration,
      options,
    );
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
      playbackSpeed: payload.playbackSpeed ?? pendingContext.playbackSpeed,
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
    animations: Array.from(activeAnimations.entries()).map(([id, ctx]) => {
      const publicPlayback = ctx.getPublicPlaybackState?.() ?? ctx;
      return {
        id,
        currentTime: publicPlayback.currentTime,
        duration: publicPlayback.duration,
        playbackSpeed: publicPlayback.playbackSpeed,
        progress:
          publicPlayback.duration > 0 &&
          Number.isFinite(publicPlayback.duration)
            ? publicPlayback.currentTime / publicPlayback.duration
            : 0,
        paused: ctx.paused,
        direction: ctx.playDirection < 0 ? "reverse" : "forward",
        controlSpeed: ctx.controlSpeed,
        backend: ctx.animationBackend ?? null,
      };
    }),
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
    pause,
    resume,
    reverse,
    seek,
    setProgress,
    setSpeed,
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
