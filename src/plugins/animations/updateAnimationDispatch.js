import {
  TRANSITION_PROPERTY_PATH_MAP,
  isSupportedAnimationProperty,
} from "../../types.js";
import {
  applyAnimationProperty,
  createAnimationSubjectState,
  getAnimationProperty,
  isTranslateAnimationProperty,
} from "./animationPropertyUtils.js";
import {
  getShaderFilterAnimationTarget,
  validateShaderFilterAnimationTarget,
} from "../elements/util/shaderFilterEffect.js";
import { validateRectStyleAnimationTarget } from "../elements/rect/rectStyleRuntime.js";
import {
  canonicalizeProgram,
  assertDisjointTimelineWriteSets,
  applyTimelineFrame,
  bindTimelineProgram,
  cloneTimelineValue,
  compilePortableGsapAnimation,
  createPixiTimelineBindingContext,
  evaluateTimelineInstance,
  getLegacyPropertyForChannel,
  getPixiTimelineAnimationBatchHooks,
} from "./timeline/index.js";
import { createLegacyTimelineContext } from "./animationBus.js";

const getLiveTweenProperty = (property) => {
  if (property === "translateX") {
    return "x";
  }

  if (property === "translateY") {
    return "y";
  }

  return property;
};

const animationsUseTranslate = (animations) =>
  animations.some((animation) =>
    Object.keys(animation.tween ?? {}).some(isTranslateAnimationProperty),
  );

const queryIncludesOwner = (
  targetQueries,
  alias,
  ownerId,
  seen = new Set(),
) => {
  if (seen.has(alias)) return false;
  seen.add(alias);
  const query = targetQueries[alias];
  if (!query) return false;
  if (query.kind === "element") return query.elementId === ownerId;
  if (query.kind === "elements") return query.elementIds.includes(ownerId);
  if (query.kind === "union") {
    return query.aliases.some((child) =>
      queryIncludesOwner(targetQueries, child, ownerId, seen),
    );
  }
  return false;
};

const getGsapOwnerChannels = (animation) => {
  if (!animation.gsap) return [];
  const program = compilePortableGsapAnimation(animation);
  const channels = new Set();
  for (const clip of program.clipTemplates) {
    if (
      !queryIncludesOwner(program.targetQueries, clip.targets, program.ownerId)
    ) {
      continue;
    }
    channels.add(clip.channel);
  }
  return [...channels];
};

const parseFilterChannel = (channel) => {
  const match = /^filter\.([^.]+)\.parameter\.(.+)$/.exec(channel);
  return match ? { filterId: match[1], parameter: match[2] } : null;
};

const createCurrentElementResolver = (element) => {
  const parent = element?.parent;
  const label = element?.label;

  return () => {
    if (!element?.destroyed || !parent || label == null) {
      return element;
    }

    const labeledChild = parent.getChildByLabel?.(label);
    const replacement =
      labeledChild && labeledChild !== element && !labeledChild.destroyed
        ? labeledChild
        : parent.children?.find(
            (child) =>
              child !== element && !child.destroyed && child.label === label,
          );

    return replacement && !replacement.destroyed ? replacement : element;
  };
};

const captureLiveTweenValues = (
  element,
  animations,
  propertyPathMap = TRANSITION_PROPERTY_PATH_MAP,
) => {
  const values = new Map();

  const captureProperty = (property) => {
    const liveProperty = getLiveTweenProperty(property);
    const key = `property:${liveProperty}`;
    if (values.has(key)) return;
    const value = getAnimationProperty(element, liveProperty, propertyPathMap);
    if (value !== undefined) {
      values.set(key, {
        kind: "property",
        property: liveProperty,
        value: cloneTimelineValue(value),
      });
    }
  };

  const captureFilter = (filterId, parameter, animationId) => {
    const key = `filter:${filterId}:${parameter}`;
    if (values.has(key)) return;
    const target = getShaderFilterAnimationTarget(
      element,
      filterId,
      animationId,
    );
    values.set(key, {
      kind: "filter",
      filterId,
      parameter,
      animationId,
      value: cloneTimelineValue(target[parameter]),
    });
  };

  for (const animation of animations) {
    for (const property of Object.keys(animation.tween ?? {})) {
      captureProperty(property);
    }
    for (const [filterId, tween] of Object.entries(
      animation.filterTweens ?? {},
    )) {
      for (const parameter of Object.keys(tween)) {
        captureFilter(filterId, parameter, animation.id);
      }
    }

    for (const channel of getGsapOwnerChannels(animation)) {
      const property = getLegacyPropertyForChannel(channel);
      if (property) {
        captureProperty(property);
        continue;
      }
      const filter = parseFilterChannel(channel);
      if (filter) {
        captureFilter(filter.filterId, filter.parameter, animation.id);
      }
    }
  }

  return [...values.values()];
};

const restoreLiveTweenValues = (
  element,
  values,
  propertyPathMap = TRANSITION_PROPERTY_PATH_MAP,
) => {
  if (!element || element.destroyed) {
    return;
  }

  const frameHooks = getPixiTimelineAnimationBatchHooks(element);
  frameHooks.beforeApplyFrame?.();
  try {
    for (const entry of values) {
      if (entry.kind === "filter") {
        const target = getShaderFilterAnimationTarget(
          element,
          entry.filterId,
          entry.animationId,
        );
        target[entry.parameter] = cloneTimelineValue(entry.value);
        continue;
      }
      applyAnimationProperty({
        object: element,
        property: entry.property,
        propertyPathMap,
        value: cloneTimelineValue(entry.value),
      });
    }
  } finally {
    frameHooks.afterApplyFrame?.();
  }
};

const applyBoundTimelineTargetStates = (instance) => {
  const values = [];
  for (const track of instance.tracks) {
    const state = track.target.targetState;
    if (state == null) continue;
    const value = track.binding.getTargetStateValue
      ? track.binding.getTargetStateValue(state)
      : Object.prototype.hasOwnProperty.call(state, track.binding.property)
        ? state[track.binding.property]
        : undefined;
    if (value === undefined) continue;
    values.push({
      target: track.target.handle,
      targetIdentity: track.target.identity,
      channel: track.channel,
      value: cloneTimelineValue(value),
      binding: track.binding,
    });
  }
  if (values.length > 0) {
    applyTimelineFrame({ values });
  }
};

const settleLoopingUpdateState = ({
  animations,
  element,
  targetState,
  onComplete,
  isInfiniteAnimation = (animation) =>
    animation.playback?.loop === true ||
    animation.playback?.repeat === "infinite",
}) => {
  const loopingAnimation = animations.find(isInfiniteAnimation);
  if (!loopingAnimation || targetState == null || !onComplete) {
    return { didSettle: false, element };
  }

  const resolveCurrentElement = createCurrentElementResolver(element);
  const liveTweenValues = captureLiveTweenValues(element, animations);
  let currentElement = element;
  const restore = () => {
    currentElement = resolveCurrentElement();
    restoreLiveTweenValues(currentElement, liveTweenValues);
  };

  let settlement;
  try {
    settlement = onComplete(loopingAnimation);
  } finally {
    restore();
  }

  if (settlement && typeof settlement.then === "function") {
    settlement.then(restore, restore);
  }

  return { didSettle: true, element: currentElement };
};

export const applyInitialUpdateAnimationState = (
  element,
  animations,
  propertyPathMap = TRANSITION_PROPERTY_PATH_MAP,
  animationBaseState,
  targetState,
  targetStates,
) => {
  let subjectState = animationBaseState;
  const preparedGsap = new Map();

  for (const animation of animations) {
    validateRectStyleAnimationTarget(element, animation);
    for (const [property, config] of Object.entries(animation.tween ?? {})) {
      if (!isSupportedAnimationProperty(property)) {
        throw new Error(
          `${property} is not a supported property for animation.`,
        );
      }

      if (config.initialValue === undefined) {
        continue;
      }

      if (!subjectState && isTranslateAnimationProperty(property)) {
        subjectState = createAnimationSubjectState(element);
      }

      applyAnimationProperty({
        object: element,
        property,
        propertyPathMap,
        subjectState,
        value: config.initialValue,
      });
    }

    for (const [filterId, tween] of Object.entries(
      animation.filterTweens ?? {},
    )) {
      const filterTarget = validateShaderFilterAnimationTarget(
        element,
        filterId,
        animation.id,
        tween,
      );

      for (const [property, config] of Object.entries(tween)) {
        if (config.initialValue !== undefined) {
          filterTarget[property] = config.initialValue;
        }
      }
    }

    if (animation.gsap) {
      const program = compilePortableGsapAnimation(animation);
      const bindingContext = createPixiTimelineBindingContext({
        program,
        ownerElement: element,
        ownerTargetState: targetState,
        targetStates,
        animationId: animation.id,
      });
      try {
        const instance = bindTimelineProgram(program, bindingContext);
        preparedGsap.set(animation.id, {
          program,
          bindingContext,
          instance,
        });
      } catch (error) {
        bindingContext.rollback?.();
        throw error;
      }
    }
  }

  const stagedInstances = [...preparedGsap.values()];
  try {
    assertDisjointTimelineWriteSets(
      stagedInstances.map(({ instance }) => instance),
    );
    for (const { bindingContext, instance } of stagedInstances) {
      bindingContext.commit?.();
      applyTimelineFrame(evaluateTimelineInstance(instance, 0));
    }
  } catch (error) {
    for (const { bindingContext } of stagedInstances) {
      bindingContext.rollback?.();
    }
    throw error;
  }

  return preparedGsap;
};

export const dispatchUpdateAnimationsNow = ({
  animations,
  animationBus,
  completionTracker,
  element,
  targetState,
  targetStates,
  onComplete,
  animationBaseState,
  preparedGsap: stagedGsap = new Map(),
}) => {
  const animationsToDispatch = animations.filter(
    (animation) =>
      typeof animationBus?.hasContext !== "function" ||
      !animationBus.hasContext(animation.id),
  );
  const preparedGsap = new Map(stagedGsap);
  const compiledGsapPrograms = new Map(
    [...preparedGsap].map(([animationId, prepared]) => [
      animationId,
      prepared.program,
    ]),
  );
  const dispatchIds = new Set(
    animationsToDispatch.map((animation) => animation.id),
  );
  for (const [animationId, prepared] of preparedGsap) {
    if (!dispatchIds.has(animationId)) {
      prepared.bindingContext.rollback?.();
      preparedGsap.delete(animationId);
    }
  }

  for (const animation of animationsToDispatch) {
    if (animation.gsap) {
      if (!compiledGsapPrograms.has(animation.id)) {
        compiledGsapPrograms.set(
          animation.id,
          compilePortableGsapAnimation(animation),
        );
      }
      continue;
    }
    validateRectStyleAnimationTarget(element, animation);
    for (const [property, config] of Object.entries(animation.tween ?? {})) {
      if (
        config.auto &&
        (!targetState ||
          !Object.prototype.hasOwnProperty.call(targetState, property))
      ) {
        throw new Error(
          `Animation "${animation.id}" cannot auto-resolve property "${property}" from targetState.`,
        );
      }
    }
  }

  const settlement = settleLoopingUpdateState({
    animations: animationsToDispatch,
    element,
    targetState,
    onComplete,
    isInfiniteAnimation: (animation) =>
      animation.playback?.loop === true ||
      animation.playback?.repeat === "infinite" ||
      compiledGsapPrograms.get(animation.id)?.duration === "infinite",
  });
  const dispatchElement = settlement.element;
  const dispatchAnimationBaseState =
    settlement.didSettle && animationsUseTranslate(animationsToDispatch)
      ? createAnimationSubjectState(dispatchElement)
      : animationBaseState;

  const preparedLegacy = new Map();
  const stagedBindingContexts = [];
  try {
    for (const animation of animationsToDispatch) {
      if (animation.gsap) {
        if (preparedGsap.has(animation.id)) {
          stagedBindingContexts.push(
            preparedGsap.get(animation.id).bindingContext,
          );
          continue;
        }
        const program = compiledGsapPrograms.get(animation.id);
        const bindingContext = createPixiTimelineBindingContext({
          program,
          ownerElement: dispatchElement,
          ownerTargetState: targetState,
          targetStates,
          animationId: animation.id,
        });
        stagedBindingContexts.push(bindingContext);
        const instance = bindTimelineProgram(program, bindingContext);
        preparedGsap.set(animation.id, { program, bindingContext, instance });
        continue;
      }

      const propertyGroups = [
        {
          element: dispatchElement,
          properties: animation.tween ?? {},
          targetState,
          animationBaseState: dispatchAnimationBaseState,
          ...getPixiTimelineAnimationBatchHooks(dispatchElement),
        },
      ];
      for (const [filterId, tween] of Object.entries(
        animation.filterTweens ?? {},
      )) {
        propertyGroups.push({
          filterId,
          element: validateShaderFilterAnimationTarget(
            dispatchElement,
            filterId,
            animation.id,
            tween,
          ),
          properties: tween,
          propertyPathMap: {},
          validateProperty: false,
        });
      }
      const timeline = createLegacyTimelineContext({
        id: animation.id,
        targetId: animation.targetId,
        propertyGroups,
        playbackSpeed: animation.playback?.speed,
        loop: animation.playback?.loop === true,
        repeat: animation.playback?.repeat,
        repeatDelay: animation.playback?.repeatDelay,
        yoyo: animation.playback?.yoyo,
      });
      preparedLegacy.set(animation.id, { propertyGroups, timeline });
    }
    assertDisjointTimelineWriteSets([
      ...[...preparedGsap.values()].map(({ instance }) => instance),
      ...[...preparedLegacy.values()]
        .map(({ timeline }) => timeline?.instance)
        .filter(Boolean),
    ]);
  } catch (error) {
    for (const bindingContext of stagedBindingContexts) {
      bindingContext.rollback?.();
    }
    throw error;
  }

  for (const animation of animationsToDispatch) {
    const preparedTimeline = animation.gsap
      ? preparedGsap.get(animation.id)?.instance
      : preparedLegacy.get(animation.id)?.timeline?.instance;
    const isInfinite =
      animation.playback?.loop === true ||
      preparedTimeline?.duration === Infinity;
    const trackCompletion =
      animation.playback?.continuity !== "persistent" && !isInfinite;
    const stateVersion = trackCompletion
      ? completionTracker.getVersion()
      : null;

    if (trackCompletion) {
      completionTracker.track(stateVersion);
    }

    let completionReleased = false;
    const releaseCompletion = () => {
      if (completionReleased) return;
      completionReleased = true;
      if (trackCompletion) {
        completionTracker.complete(stateVersion);
      }
    };

    const complete = () => {
      releaseCompletion();
      if (!settlement.didSettle) {
        onComplete?.(animation);
      }
    };

    if (animation.gsap) {
      const { program, bindingContext, instance } = preparedGsap.get(
        animation.id,
      );
      const frameHooks = getPixiTimelineAnimationBatchHooks(dispatchElement);
      animationBus.dispatch({
        type: "START",
        payload: {
          driver: "timeline",
          id: animation.id,
          animationType: animation.type,
          targetId: animation.targetId,
          continuity: animation.playback?.continuity ?? "render",
          signature: animation.signature ?? canonicalizeProgram(program),
          program,
          bindingContext,
          instance,
          applyTargetState: () => {
            applyBoundTimelineTargetStates(instance);
            if (!dispatchElement || dispatchElement.destroyed || !targetState) {
              return;
            }
            frameHooks.beforeApplyFrame?.();
            try {
              for (const [property, value] of Object.entries(targetState)) {
                try {
                  applyAnimationProperty({
                    object: dispatchElement,
                    property,
                    propertyPathMap: TRANSITION_PROPERTY_PATH_MAP,
                    subjectState: createAnimationSubjectState(dispatchElement),
                    value,
                  });
                } catch {
                  // Renderer reconciliation owns unsupported settlement fields.
                }
              }
            } finally {
              frameHooks.afterApplyFrame?.();
            }
          },
          onComplete: complete,
          onCancel: releaseCompletion,
        },
      });
      continue;
    }

    const { propertyGroups, timeline } = preparedLegacy.get(animation.id);

    animationBus.dispatch({
      type: "START",
      payload: {
        id: animation.id,
        animationType: animation.type,
        targetId: animation.targetId,
        continuity: animation.playback?.continuity ?? "render",
        playbackSpeed: animation.playback?.speed,
        loop: animation.playback?.loop === true,
        signature:
          animation.signature ??
          JSON.stringify({
            type: animation.type,
            tween: animation.tween,
            filterTweens: animation.filterTweens ?? null,
            playback: animation.playback ?? null,
          }),
        element: dispatchElement,
        properties: animation.tween ?? {},
        propertyGroups,
        preparedTimeline: timeline,
        targetState,
        animationBaseState: dispatchAnimationBaseState,
        repeat: animation.playback?.repeat,
        repeatDelay: animation.playback?.repeatDelay,
        yoyo: animation.playback?.yoyo,
        onComplete: complete,
        onCancel: releaseCompletion,
      },
    });
  }
};
