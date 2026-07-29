import {
  TRANSITION_PROPERTY_PATH_MAP,
  WhiteListAnimationProps,
} from "../../types.js";
import {
  applyAnimationProperty,
  createAnimationSubjectState,
  getAnimationProperty,
  isTranslateAnimationProperty,
} from "./animationPropertyUtils.js";

const getLiveTweenProperty = (property) => {
  if (property === "translateX") {
    return "x";
  }

  if (property === "translateY") {
    return "y";
  }

  return property;
};

const captureLiveTweenValues = (
  element,
  animations,
  propertyPathMap = TRANSITION_PROPERTY_PATH_MAP,
) => {
  const values = new Map();

  for (const animation of animations) {
    for (const property of Object.keys(animation.tween)) {
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
    (animation) => animation.playback?.loop === true,
  );
  if (!loopingAnimation || targetState == null || !onComplete) {
    return;
  }

  const liveTweenValues = captureLiveTweenValues(element, animations);
  const restore = () => {
    restoreLiveTweenValues(element, liveTweenValues);
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
};

export const applyInitialUpdateAnimationState = (
  element,
  animations,
  propertyPathMap = TRANSITION_PROPERTY_PATH_MAP,
  animationBaseState,
) => {
  let subjectState = animationBaseState;

  for (const animation of animations) {
    for (const [property, config] of Object.entries(animation.tween)) {
      if (!WhiteListAnimationProps[property]) {
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
    for (const [property, config] of Object.entries(animation.tween)) {
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

  settleLoopingUpdateState({
    animations: animationsToDispatch,
    element,
    targetState,
    onComplete,
  });

  for (const animation of animationsToDispatch) {
    const trackCompletion =
      animation.playback?.continuity !== "persistent" &&
      animation.playback?.loop !== true;
    const stateVersion = trackCompletion
      ? completionTracker.getVersion()
      : null;

    if (trackCompletion) {
      completionTracker.track(stateVersion);
    }

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
            playback: animation.playback ?? null,
          }),
        element,
        properties: animation.tween,
        targetState,
        animationBaseState,
        onComplete: () => {
          if (trackCompletion) {
            completionTracker.complete(stateVersion);
          }

          onComplete?.(animation);
        },
      },
    });
  }
};
