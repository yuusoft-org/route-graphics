import { applyElementPivot, applyElementTransform } from "../util/transform.js";

const animatedSpriteTransformStates = new WeakMap();

const ensureAnimatedSpriteTransformState = (animatedSprite, element) => {
  let state = animatedSpriteTransformStates.get(animatedSprite);

  if (!state) {
    state = {
      element,
      previousFrameChangeHandler: animatedSprite.onFrameChange,
    };
    animatedSpriteTransformStates.set(animatedSprite, state);

    animatedSprite.onFrameChange = (currentFrame) => {
      state.previousFrameChangeHandler?.call(animatedSprite, currentFrame);
      applyElementPivot(animatedSprite, state.element);
    };
  } else {
    state.element = element;
  }

  return state;
};

export const setAnimatedSpriteTransformElement = (animatedSprite, element) => {
  ensureAnimatedSpriteTransformState(animatedSprite, element);
};

export const applyAnimatedSpriteTransform = (animatedSprite, element) => {
  ensureAnimatedSpriteTransformState(animatedSprite, element);
  applyElementTransform(animatedSprite, element, {
    preserveScaleMagnitude: true,
  });
};

export const refreshAnimatedSpritePivot = (animatedSprite) => {
  const state = animatedSpriteTransformStates.get(animatedSprite);

  if (state) {
    applyElementPivot(animatedSprite, state.element);
  }
};
