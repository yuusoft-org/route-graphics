import {
  degreesToRadians,
  radiansToDegrees,
  refreshElementPivot,
} from "../elements/util/transform.js";
import { RECT_APPEARANCE_STATE_KEY } from "../elements/rect/rectAppearanceRuntime.js";

export const isTranslateAnimationProperty = (property) =>
  property === "translateX" || property === "translateY";

const getMappedPath = (object, propertyPathMap, path) => {
  if (typeof path !== "string") {
    return path;
  }

  if (path === "alpha" && object?.[RECT_APPEARANCE_STATE_KEY]) {
    return [RECT_APPEARANCE_STATE_KEY, "baseAlpha"];
  }

  if (path.startsWith("rect.")) {
    return ["_routeGraphicsRectStyle", path];
  }

  return propertyPathMap[path] ?? path;
};

export const getAnimationProperty = (
  object,
  path,
  propertyPathMap,
  defaultValue,
) => {
  const mappedPath = getMappedPath(object, propertyPathMap, path);

  if (typeof mappedPath === "string") {
    const result = object[mappedPath];
    if (result === undefined) return defaultValue;
    return path === "rotation" ? radiansToDegrees(result) : result;
  }

  let result = object;
  for (const key of mappedPath) {
    if (result == null) {
      return defaultValue;
    }
    result = result[key];
  }

  if (result === undefined) return defaultValue;
  return path === "rotation" ? radiansToDegrees(result) : result;
};

export const setAnimationProperty = (object, path, propertyPathMap, value) => {
  const mappedPath = getMappedPath(object, propertyPathMap, path);
  const nextValue = path === "rotation" ? degreesToRadians(value) : value;

  if (typeof mappedPath === "string") {
    object[mappedPath] = nextValue;
    return object;
  }

  let current = object;
  for (let index = 0; index < mappedPath.length - 1; index++) {
    const key = mappedPath[index];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }

  current[mappedPath[mappedPath.length - 1]] = nextValue;
  return object;
};

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const getBoundsRectangle = (displayObject) => {
  const bounds = displayObject?.getLocalBounds?.();
  return bounds?.rectangle ?? bounds ?? null;
};

const getSubjectDimension = (displayObject, axis) => {
  const directValue =
    axis === "x" ? displayObject?.width : displayObject?.height;
  if (isFiniteNumber(directValue) && directValue > 0) {
    return directValue;
  }

  const rectangle = getBoundsRectangle(displayObject);
  const boundsValue = axis === "x" ? rectangle?.width : rectangle?.height;
  const scaleValue =
    axis === "x" ? displayObject?.scale?.x : displayObject?.scale?.y;

  if (isFiniteNumber(boundsValue) && boundsValue > 0) {
    return Math.abs(boundsValue * (scaleValue ?? 1));
  }

  return 0;
};

export const createAnimationSubjectState = (displayObject) => ({
  x: displayObject?.x ?? 0,
  y: displayObject?.y ?? 0,
  width: getSubjectDimension(displayObject, "x"),
  height: getSubjectDimension(displayObject, "y"),
});

export const getTimelineInitialValue = ({
  object,
  property,
  propertyPathMap,
  subjectState,
  defaultValue = 0,
}) => {
  if (property === "translateX" || property === "translateY") {
    return defaultValue;
  }

  return getAnimationProperty(object, property, propertyPathMap, defaultValue);
};

export const applyAnimationProperty = ({
  object,
  property,
  propertyPathMap,
  subjectState,
  value,
}) => {
  if (property === "translateX") {
    object.x = subjectState.x + value * subjectState.width;
    return object;
  }

  if (property === "translateY") {
    object.y = subjectState.y + value * subjectState.height;
    return object;
  }

  const result = setAnimationProperty(object, property, propertyPathMap, value);

  if (property === "scaleX" || property === "scaleY") {
    refreshElementPivot(object);
  }

  return result;
};
