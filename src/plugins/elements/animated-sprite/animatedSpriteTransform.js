import {
  applyElementPivot,
  applyElementTransform,
  refreshElementPivot,
} from "../util/transform.js";

const animatedSpriteTransformStates = new WeakMap();

const refreshAnimatedSpriteGeometryPivot = (animatedSprite, geometry = {}) => {
  const state = animatedSpriteTransformStates.get(animatedSprite);
  const textureWidth = animatedSprite.texture?.orig?.width ?? 0;
  const textureHeight = animatedSprite.texture?.orig?.height ?? 0;

  if (!state || textureWidth <= 0 || textureHeight <= 0) {
    refreshElementPivot(animatedSprite);
    return;
  }

  const width = geometry.width ?? state.element.width;
  const height = geometry.height ?? state.element.height;

  applyElementPivot(animatedSprite, state.element, {
    baseScaleX: width / textureWidth,
    baseScaleY: height / textureHeight,
  });
};

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
      refreshAnimatedSpriteGeometryPivot(animatedSprite);
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

export const refreshAnimatedSpritePivot = (animatedSprite, geometry) =>
  refreshAnimatedSpriteGeometryPivot(animatedSprite, geometry);
