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

const findInSubtree = (root, label) => {
  if (!root) return null;
  if (root.label === label) return root;
  for (const child of root.children ?? []) {
    const match = findInSubtree(child, label);
    if (match) return match;
  }
  return null;
};

const getQueryElementIds = (program, alias, resolving = new Set()) => {
  if (resolving.has(alias)) return new Set();
  const query = program.targetQueries[alias];
  if (!query) return new Set();
  if (query.kind === "element") return new Set([query.elementId]);
  if (query.kind === "elements") return new Set(query.elementIds);
  if (query.kind !== "union") return new Set();

  const nextResolving = new Set(resolving).add(alias);
  const elementIds = new Set();
  for (const childAlias of query.aliases) {
    for (const elementId of getQueryElementIds(
      program,
      childAlias,
      nextResolving,
    )) {
      elementIds.add(elementId);
    }
  }
  return elementIds;
};

const getGsapElementChannels = (program) => {
  const entries = new Map();
  for (const clip of program.clipTemplates) {
    for (const elementId of getQueryElementIds(program, clip.targets)) {
      entries.set(`${elementId}\u0000${clip.channel}`, {
        elementId,
        channel: clip.channel,
      });
    }
  }
  return [...entries.values()];
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
  compiledGsapPrograms = new Map(),
) => {
  const values = new Map();

  const captureProperty = (target, elementId, property) => {
    const liveProperty = getLiveTweenProperty(property);
    const key = `property:${elementId ?? "@owner"}:${liveProperty}`;
    if (values.has(key)) return;
    const value = getAnimationProperty(target, liveProperty, propertyPathMap);
    if (value !== undefined) {
      values.set(key, {
        kind: "property",
        elementId,
        property: liveProperty,
        value: cloneTimelineValue(value),
      });
    }
  };

  const captureFilter = (
    target,
    elementId,
    filterId,
    parameter,
    animationId,
  ) => {
    const key = `filter:${elementId ?? "@owner"}:${filterId}:${parameter}`;
    if (values.has(key)) return;
    const filterTarget = getShaderFilterAnimationTarget(
      target,
      filterId,
      animationId,
    );
    values.set(key, {
      kind: "filter",
      elementId,
      filterId,
      parameter,
      animationId,
      value: cloneTimelineValue(filterTarget[parameter]),
    });
  };

  for (const animation of animations) {
    for (const property of Object.keys(animation.tween ?? {})) {
      captureProperty(element, null, property);
    }
    for (const [filterId, tween] of Object.entries(
      animation.filterTweens ?? {},
    )) {
      for (const parameter of Object.keys(tween)) {
        captureFilter(element, null, filterId, parameter, animation.id);
      }
    }

    const program = compiledGsapPrograms.get(animation.id);
    if (!program) continue;
    for (const { elementId, channel } of getGsapElementChannels(program)) {
      const target = findInSubtree(element, elementId);
      if (!target) continue;
      const property = getLegacyPropertyForChannel(channel);
      if (property) {
        captureProperty(target, elementId, property);
        continue;
      }
      const filter = parseFilterChannel(channel);
      if (filter) {
        captureFilter(
          target,
          elementId,
          filter.filterId,
          filter.parameter,
          animation.id,
        );
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

  const frameValues = [];
  const groups = new WeakMap();
  const getGroup = (target) => {
    if (!groups.has(target)) {
      groups.set(target, getPixiTimelineAnimationBatchHooks(target));
    }
    return groups.get(target);
  };
  for (const entry of values) {
    const target = entry.elementId
      ? findInSubtree(element, entry.elementId)
      : element;
    if (!target || target.destroyed) continue;
    const group = getGroup(target);
    if (entry.kind === "filter") {
      const filterTarget = getShaderFilterAnimationTarget(
        target,
        entry.filterId,
        entry.animationId,
      );
      frameValues.push({
        target,
        value: cloneTimelineValue(entry.value),
        binding: {
          group,
          get: () => filterTarget[entry.parameter],
          apply: (_target, value) => {
            filterTarget[entry.parameter] = value;
          },
        },
      });
      continue;
    }
    frameValues.push({
      target,
      value: cloneTimelineValue(entry.value),
      binding: {
        group,
        get: () =>
          getAnimationProperty(target, entry.property, propertyPathMap),
        apply: (_target, value) =>
          applyAnimationProperty({
            object: target,
            property: entry.property,
            propertyPathMap,
            value,
          }),
      },
    });
  }
  if (frameValues.length > 0) applyTimelineFrame({ values: frameValues });
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
  compiledGsapPrograms,
  isInfiniteAnimation = (animation) =>
    animation.playback?.loop === true ||
    animation.playback?.repeat === "infinite",
}) => {
  const loopingAnimation = animations.find(isInfiniteAnimation);
  if (!loopingAnimation || targetState == null || !onComplete) {
    return { didSettle: false, element };
  }

  const resolveCurrentElement = createCurrentElementResolver(element);
  const liveTweenValues = captureLiveTweenValues(
    element,
    animations,
    TRANSITION_PROPERTY_PATH_MAP,
    compiledGsapPrograms,
  );
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
    compiledGsapPrograms,
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

  const unsettled = new Set(
    animationsToDispatch.map((animation) => animation.id),
  );
  const dispatchVersion = completionTracker.getVersion();
  for (const animation of animationsToDispatch) {
    const preparedTimeline = animation.gsap
      ? preparedGsap.get(animation.id)?.instance
      : preparedLegacy.get(animation.id)?.timeline?.instance;
    const isInfinite =
      animation.playback?.loop === true ||
      preparedTimeline?.duration === Infinity;
    const isPersistent = animation.playback?.continuity === "persistent";
    const trackCompletion = !isPersistent && !isInfinite;
    const stateVersion = trackCompletion ? dispatchVersion : null;

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
      unsettled.delete(animation.id);
      try {
        if (
          !settlement.didSettle &&
          unsettled.size === 0 &&
          // The bus retains compatible persistent players across render versions
          // and cancels them when ownership changes. They still need to settle.
          (isPersistent || completionTracker.getVersion() === dispatchVersion)
        ) {
          const operation = onComplete?.(animation);
          if (operation && typeof operation.then === "function") {
            void operation.then(releaseCompletion, (error) => {
              completionTracker.fail?.(dispatchVersion, error);
              releaseCompletion();
            });
            return;
          }
        }
      } catch (error) {
        completionTracker.fail?.(dispatchVersion, error);
      }
      releaseCompletion();
    };
    const cancel = () => {
      unsettled.delete(animation.id);
      releaseCompletion();
    };
    const fail = (error) => {
      if (trackCompletion) {
        completionTracker.fail?.(dispatchVersion, error);
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
          onCancel: cancel,
          onFailure: fail,
          onReverseComplete: cancel,
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
        onCancel: cancel,
        onFailure: fail,
        onReverseComplete: cancel,
      },
    });
  }
};
