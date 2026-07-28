export const degreesToRadians = (degrees = 0) => (degrees * Math.PI) / 180;

export const radiansToDegrees = (radians = 0) => (radians * 180) / Math.PI;

const getFiniteScale = (scale) =>
  typeof scale === "number" && Number.isFinite(scale) && scale !== 0
    ? scale
    : 1;

export const getElementTransformPosition = (element) => ({
  x: Math.round((element.x ?? 0) + (element.originX ?? 0)),
  y: Math.round((element.y ?? 0) + (element.originY ?? 0)),
});

export const applyElementTransform = (
  displayObject,
  element,
  { localOriginX, localOriginY } = {},
) => {
  const originX = element.originX ?? 0;
  const originY = element.originY ?? 0;
  const scaleX = getFiniteScale(displayObject.scale?.x);
  const scaleY = getFiniteScale(displayObject.scale?.y);
  const position = getElementTransformPosition(element);
  const pivotX = localOriginX ?? originX;
  const pivotY = localOriginY ?? originY;

  displayObject.pivot?.set?.(pivotX / scaleX, pivotY / scaleY);
  displayObject.x = position.x;
  displayObject.y = position.y;
  displayObject.rotation = degreesToRadians(element.rotation ?? 0);
};

export const getElementTransformTargetState = (element, extra = {}) => {
  const position = getElementTransformPosition(element);
  const targetState = {
    x: position.x,
    y: position.y,
    ...extra,
  };

  if (element.rotation !== undefined) {
    targetState.rotation = element.rotation;
  }

  return targetState;
};
