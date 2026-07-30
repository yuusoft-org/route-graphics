import {
  applyInitialUpdateAnimationState,
  dispatchUpdateAnimationsNow,
} from "./updateAnimationDispatch.js";
import { queueDeferredUpdateAnimationStart } from "../elements/renderContext.js";
import {
  createAnimationSubjectState,
  isTranslateAnimationProperty,
} from "./animationPropertyUtils.js";
import { isDeepEqual } from "../../util/isDeepEqual.js";
import { collectAllElementIds } from "../../util/collectElementIds.js";

export const groupAnimationsByTarget = (animations = []) => {
  if (animations instanceof Map) {
    return animations;
  }

  const byTarget = new Map();

  for (const animation of animations) {
    if (!byTarget.has(animation.targetId)) {
      byTarget.set(animation.targetId, []);
    }

    byTarget.get(animation.targetId).push(animation);
  }

  return byTarget;
};

export const getTargetAnimations = (animationsOrMap, targetId) => {
  if (!animationsOrMap) {
    return [];
  }

  if (animationsOrMap instanceof Map) {
    return animationsOrMap.get(targetId) ?? [];
  }

  return animationsOrMap.filter((animation) => animation.targetId === targetId);
};

export const getUpdateAnimations = (animationsOrMap, targetId) =>
  getTargetAnimations(animationsOrMap, targetId).filter(
    (animation) => animation.type === "update",
  );

export const getTransitionAnimation = (animationsOrMap, targetId) =>
  getTargetAnimations(animationsOrMap, targetId).find(
    (animation) => animation.type === "transition",
  ) ?? null;

const animationsUseTranslate = (animations = []) =>
  animations.some((animation) =>
    Object.keys(animation.tween ?? {}).some(isTranslateAnimationProperty),
  );

const findElementMatchById = (elements = [], targetId, ancestorIds = []) => {
  for (const element of elements) {
    if (element?.id === targetId) {
      return {
        element,
        ancestorIds,
      };
    }

    if (Array.isArray(element?.children)) {
      const childMatch = findElementMatchById(element.children, targetId, [
        ...ancestorIds,
        element.id,
      ]);
      if (childMatch) {
        return childMatch;
      }
    }
  }

  return null;
};

const hasSameOwnershipPath = (prevMatch, nextMatch) =>
  isDeepEqual(prevMatch?.ancestorIds ?? null, nextMatch?.ancestorIds ?? null);

const hasSubtreeAnimationConflict = ({
  subtreeRoot,
  nextAnimations,
  continuingAnimationId,
}) => {
  if (!subtreeRoot) {
    return false;
  }

  const subtreeIds = collectAllElementIds(subtreeRoot);

  for (const candidate of nextAnimations ?? []) {
    if (!candidate || candidate.id === continuingAnimationId) {
      continue;
    }

    if (subtreeIds.has(candidate.targetId)) {
      return true;
    }
  }

  return false;
};

export const getAnimationContinuitySignature = (animation = {}) => {
  if (animation.type === "update") {
    return JSON.stringify({
      type: animation.type,
      tween: animation.tween,
      filterTweens: animation.filterTweens ?? null,
      playback: animation.playback ?? null,
    });
  }

  return JSON.stringify({
    type: animation.type,
    prev: animation.prev ?? null,
    next: animation.next ?? null,
    mask: animation.mask ?? null,
    compositor: animation.compositor ?? null,
    playback: animation.playback ?? null,
  });
};

const canContinuePersistentUpdate = ({ prevState, nextState, animation }) => {
  const prevTarget = findElementMatchById(
    prevState?.elements,
    animation.targetId,
  );
  const nextTarget = findElementMatchById(
    nextState?.elements,
    animation.targetId,
  );

  return (
    prevTarget !== null &&
    nextTarget !== null &&
    hasSameOwnershipPath(prevTarget, nextTarget) &&
    isDeepEqual(prevTarget.element, nextTarget.element)
  );
};

const canContinuePersistentTransition = ({
  prevState,
  nextState,
  animation,
}) => {
  const prevTarget = findElementMatchById(
    prevState?.elements,
    animation.targetId,
  );
  const nextTarget = findElementMatchById(
    nextState?.elements,
    animation.targetId,
  );

  if (prevTarget === null && nextTarget === null) {
    return true;
  }

  if (
    prevTarget === null ||
    nextTarget === null ||
    !hasSameOwnershipPath(prevTarget, nextTarget) ||
    !isDeepEqual(prevTarget.element, nextTarget.element)
  ) {
    return false;
  }

  return !hasSubtreeAnimationConflict({
    subtreeRoot: nextTarget.element,
    nextAnimations: nextState?.animations,
    continuingAnimationId: animation.id,
  });
};

export const buildAnimationContinuityPlan = ({
  prevState,
  nextState,
  activeAnimations,
}) => {
  const continuedAnimationIds = new Set();
  const activeById =
    activeAnimations instanceof Map
      ? activeAnimations
      : new Map(activeAnimations?.map((entry) => [entry.id, entry]) ?? []);

  for (const animation of nextState?.animations ?? []) {
    if (animation?.playback?.continuity !== "persistent") {
      continue;
    }

    const activeAnimation = activeById.get(animation.id);
    if (!activeAnimation) {
      continue;
    }

    if (
      activeAnimation.type !== animation.type ||
      activeAnimation.targetId !== animation.targetId ||
      activeAnimation.signature !== getAnimationContinuitySignature(animation)
    ) {
      continue;
    }

    if (animation.type === "update") {
      if (
        canContinuePersistentUpdate({
          prevState,
          nextState,
          animation,
        })
      ) {
        continuedAnimationIds.add(animation.id);
      }
      continue;
    }

    if (
      canContinuePersistentTransition({
        prevState,
        nextState,
        animation,
      })
    ) {
      continuedAnimationIds.add(animation.id);
    }
  }

  return {
    continuedAnimationIds,
  };
};

export const dispatchUpdateAnimations = ({
  animations,
  targetId,
  animationBus,
  completionTracker,
  element,
  targetState,
  onComplete,
  renderContext,
}) => {
  const relevantAnimations = getUpdateAnimations(animations, targetId);
  const continuedAnimations = relevantAnimations.filter((animation) =>
    typeof animationBus?.hasContext === "function"
      ? animationBus.hasContext(animation.id)
      : false,
  );
  const animationsToStart = relevantAnimations.filter(
    (animation) => !continuedAnimations.includes(animation),
  );

  if (relevantAnimations.length === 0) {
    return false;
  }

  if (animationsToStart.length === 0) {
    return true;
  }

  if (renderContext?.suppressAnimations) {
    if (onComplete) {
      throw new Error(
        "Deferred update animations do not support onComplete hooks.",
      );
    }

    const animationBaseState = animationsUseTranslate(animationsToStart)
      ? createAnimationSubjectState(element)
      : undefined;

    applyInitialUpdateAnimationState(
      element,
      animationsToStart,
      undefined,
      animationBaseState,
    );

    queueDeferredUpdateAnimationStart(renderContext, {
      animations: animationsToStart,
      animationBus,
      completionTracker,
      element,
      targetState,
      animationBaseState,
    });

    return true;
  }

  dispatchUpdateAnimationsNow({
    animations: animationsToStart,
    animationBus,
    completionTracker,
    element,
    targetState,
    onComplete,
    animationBaseState: animationsUseTranslate(animationsToStart)
      ? createAnimationSubjectState(element)
      : undefined,
  });

  return true;
};

export const getLiveAnimations = getUpdateAnimations;
export const getReplaceAnimation = getTransitionAnimation;
export const dispatchLiveAnimations = dispatchUpdateAnimations;
