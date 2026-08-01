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
import { validateShaderFilterAnimationTarget } from "../elements/util/shaderFilterEffect.js";
import {
  getRectStyleAnimationBatchHooks,
  validateRectStyleAnimationTarget,
} from "../elements/rect/rectStyleRuntime.js";
import {
  canonicalizeProgram,
  assertDisjointTimelineWriteSets,
  bindTimelineProgram,
  compilePortableGsapAnimation,
  createPixiTimelineBindingContext,
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

  for (const animation of animations) {
    for (const property of Object.keys(animation.tween ?? {})) {
      const liveProperty = getLiveTweenProperty(property);
      if (values.has(liveProperty)) {
        continue;
      }

      const value = getAnimationProperty(
        element,
        liveProperty,
        propertyPathMap,
      );
      if (value !== undefined) {
        values.set(liveProperty, value);
      }
    }
  }

  return values;
};

const restoreLiveTweenValues = (
  element,
  values,
  propertyPathMap = TRANSITION_PROPERTY_PATH_MAP,
) => {
  if (!element || element.destroyed) {
    return;
  }

  for (const [property, value] of values) {
    applyAnimationProperty({
      object: element,
      property,
      propertyPathMap,
      value,
    });
  }
};

const settleLoopingUpdateState = ({
  animations,
  element,
  targetState,
  onComplete,
}) => {
  const loopingAnimation = animations.find(
    (animation) =>
      animation.playback?.loop === true ||
      animation.playback?.repeat === "infinite",
  );
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
) => {
  let subjectState = animationBaseState;

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
  }
};

export const dispatchUpdateAnimationsNow = ({
  animations,
  animationBus,
  completionTracker,
  element,
  targetState,
  onComplete,
  animationBaseState,
}) => {
  const animationsToDispatch = animations.filter(
    (animation) =>
      typeof animationBus?.hasContext !== "function" ||
      !animationBus.hasContext(animation.id),
  );

  for (const animation of animationsToDispatch) {
    if (animation.gsap) {
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
  });
  const dispatchElement = settlement.element;
  const dispatchAnimationBaseState =
    settlement.didSettle && animationsUseTranslate(animationsToDispatch)
      ? createAnimationSubjectState(dispatchElement)
      : animationBaseState;

  const preparedGsap = new Map();
  const preparedLegacy = new Map();
  const stagedBindingContexts = [];
  try {
    for (const animation of animationsToDispatch) {
      if (animation.gsap) {
        const program = compilePortableGsapAnimation(animation);
        const bindingContext = createPixiTimelineBindingContext({
          program,
          ownerElement: dispatchElement,
          ownerTargetState: targetState,
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
          ...getRectStyleAnimationBatchHooks(dispatchElement),
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
    const isInfinite =
      animation.playback?.loop === true ||
      animation.playback?.repeat === "infinite";
    const trackCompletion =
      animation.playback?.continuity !== "persistent" && !isInfinite;
    const stateVersion = trackCompletion
      ? completionTracker.getVersion()
      : null;

    if (trackCompletion) {
      completionTracker.track(stateVersion);
    }

    const complete = () => {
      if (trackCompletion) {
        completionTracker.complete(stateVersion);
      }

      if (!settlement.didSettle) {
        onComplete?.(animation);
      }
    };

    if (animation.gsap) {
      const { program, bindingContext, instance } = preparedGsap.get(
        animation.id,
      );
      const frameHooks = getRectStyleAnimationBatchHooks(dispatchElement);
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
      },
    });
  }
};
