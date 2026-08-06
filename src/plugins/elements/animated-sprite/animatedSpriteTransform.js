import {
  applyElementTransform,
  refreshElementPivot,
} from "../util/transform.js";

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
      refreshElementPivot(animatedSprite);
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
  applyElementTransform(animatedSprite, element);
};

export const refreshAnimatedSpritePivot = (animatedSprite) => {
  refreshElementPivot(animatedSprite);
};
