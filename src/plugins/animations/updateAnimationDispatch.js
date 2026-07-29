import {
  TRANSITION_PROPERTY_PATH_MAP,
  WhiteListAnimationProps,
} from "../../types.js";
import {
  applyAnimationProperty,
  createAnimationSubjectState,
  isTranslateAnimationProperty,
} from "./animationPropertyUtils.js";

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
  for (const animation of animations) {
    if (
      typeof animationBus?.hasContext === "function" &&
      animationBus.hasContext(animation.id)
    ) {
      continue;
    }

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
