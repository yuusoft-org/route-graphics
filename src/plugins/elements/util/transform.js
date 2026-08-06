export const degreesToRadians = (degrees = 0) => (degrees * Math.PI) / 180;

export const radiansToDegrees = (radians = 0) => (radians * 180) / Math.PI;

const elementPivotValues = new WeakMap();
const appliedElementScaleAxes = new WeakMap();

const getFiniteScale = (scale) =>
  typeof scale === "number" && Number.isFinite(scale) && scale !== 0
    ? scale
    : 1;

const getAuthoredScale = (scale) =>
  typeof scale === "number" && Number.isFinite(scale) ? scale : 1;

const getFiniteScaleMagnitude = (scale) =>
  typeof scale === "number" && Number.isFinite(scale) ? Math.abs(scale) : 1;

const applyElementScale = (
  displayObject,
  element,
  { scaleMode = "sign", preserveScaleMagnitude = false } = {},
) => {
  if (!displayObject.scale) return;

  const previousAxes = appliedElementScaleAxes.get(displayObject) ?? {
    x: false,
    y: false,
  };
  const applyScaleX = element.scaleX !== undefined || previousAxes.x;
  const applyScaleY = element.scaleY !== undefined || previousAxes.y;

  if (!applyScaleX && !applyScaleY) return;

  const authoredScaleX = getAuthoredScale(element.scaleX);
  const authoredScaleY = getAuthoredScale(element.scaleY);
  const targetScaleX =
    scaleMode === "full" ? authoredScaleX : Math.sign(authoredScaleX);
  const targetScaleY =
    scaleMode === "full" ? authoredScaleY : Math.sign(authoredScaleY);
  const currentScaleX = getFiniteScaleMagnitude(displayObject.scale.x);
  const currentScaleY = getFiniteScaleMagnitude(displayObject.scale.y);

  if (applyScaleX) {
    displayObject.scale.x = preserveScaleMagnitude
      ? currentScaleX * targetScaleX
      : targetScaleX;
  }
  if (applyScaleY) {
    displayObject.scale.y = preserveScaleMagnitude
      ? currentScaleY * targetScaleY
      : targetScaleY;
  }

  appliedElementScaleAxes.set(displayObject, {
    x: element.scaleX !== undefined,
    y: element.scaleY !== undefined,
  });
};

export const getElementTransformPosition = (element) => ({
  x: Math.round((element.x ?? 0) + (element.originX ?? 0)),
  y: Math.round((element.y ?? 0) + (element.originY ?? 0)),
});

export const refreshElementPivot = (displayObject) => {
  const pivotValues = elementPivotValues.get(displayObject);

  if (!pivotValues) {
    return;
  }

  displayObject.pivot?.set?.(pivotValues.x, pivotValues.y);
};

export const applyElementPivot = (
  displayObject,
  element,
  { localOriginX, localOriginY, baseScaleX, baseScaleY } = {},
) => {
  const originX = element.originX ?? 0;
  const originY = element.originY ?? 0;
  const pivotX = localOriginX ?? originX;
  const pivotY = localOriginY ?? originY;
  const scaleX = getFiniteScale(baseScaleX ?? displayObject.scale?.x);
  const scaleY = getFiniteScale(baseScaleY ?? displayObject.scale?.y);

  elementPivotValues.set(displayObject, {
    x: pivotX / scaleX,
    y: pivotY / scaleY,
  });
  refreshElementPivot(displayObject);
};

export const applyElementTransform = (
  displayObject,
  element,
  {
    localOriginX,
    localOriginY,
    scaleMode = "sign",
    preserveScaleMagnitude = false,
  } = {},
) => {
  const position = getElementTransformPosition(element);

  applyElementScale(displayObject, element, {
    scaleMode,
    preserveScaleMagnitude,
  });
  applyElementPivot(displayObject, element, {
    localOriginX,
    localOriginY,
  });
  displayObject.x = position.x;
  displayObject.y = position.y;
  displayObject.rotation = degreesToRadians(element.rotation ?? 0);
};

export const getElementTransformTargetState = (element, extra = {}) => {
  const position = getElementTransformPosition(element);
  const targetState = {
    x: position.x,
    y: position.y,
  };

  if (element.scaleX !== undefined) {
    targetState.scaleX = Math.sign(getAuthoredScale(element.scaleX));
  }
  if (element.scaleY !== undefined) {
    targetState.scaleY = Math.sign(getAuthoredScale(element.scaleY));
  }

  if (element.rotation !== undefined) {
    targetState.rotation = element.rotation;
  }

  return { ...targetState, ...extra };
};
