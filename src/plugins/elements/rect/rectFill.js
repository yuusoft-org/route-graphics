import { FillGradient } from "pixi.js";
import {
  degreesToRadians,
  getElementTransformPosition,
} from "../util/transform.js";

const TRANSPARENT_FILL = { color: 0x000000, alpha: 0 };
const DEFAULT_LINEAR_START = { x: 0, y: 0 };
const DEFAULT_LINEAR_END = { x: 0, y: 1 };
const DEFAULT_RADIAL_CENTER = { x: 0.5, y: 0.5 };

const isTransparentFillValue = (fill) =>
  fill === undefined || fill === null || fill === "" || fill === "transparent";

const sortStops = (stops) =>
  [...stops].sort((left, right) => left.offset - right.offset);

const transformGlobalPointToLocal = (point, element) => {
  if (!point || !element) {
    return point;
  }

  const originX = element.originX ?? 0;
  const originY = element.originY ?? 0;
  const position = getElementTransformPosition(element);
  const rotation = degreesToRadians(element.rotation ?? 0);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point.x - position.x;
  const dy = point.y - position.y;

  return {
    x: originX + dx * cos + dy * sin,
    y: originY - dx * sin + dy * cos,
  };
};

const normalizeGradientPoint = (point, fill, element, defaultPoint) =>
  fill.coordinateSpace === "global"
    ? transformGlobalPointToLocal(point ?? defaultPoint, element)
    : point;

/**
 * @param {import("pixi.js").Graphics & {_rtglFillResource?: FillGradient}} rect
 */
export const destroyRectFillResource = (rect) => {
  rect._rtglFillResource?.destroy();
  delete rect._rtglFillResource;
};

/**
 * @param {import("../../../types.js").RectFill | undefined} fill
 * @param {import("../../../types.js").RectComputedNode} [element]
 * @returns {import("pixi.js").FillInput}
 */
export const normalizeRectFill = (fill, element) => {
  if (isTransparentFillValue(fill)) {
    return TRANSPARENT_FILL;
  }

  if (typeof fill === "string") {
    return fill;
  }

  if (fill.type === "solid") {
    return isTransparentFillValue(fill.color) ? TRANSPARENT_FILL : fill.color;
  }

  if (fill.type === "linear-gradient") {
    return new FillGradient({
      type: "linear",
      start: normalizeGradientPoint(
        fill.start,
        fill,
        element,
        DEFAULT_LINEAR_START,
      ),
      end: normalizeGradientPoint(fill.end, fill, element, DEFAULT_LINEAR_END),
      colorStops: sortStops(fill.stops),
      textureSpace: fill.coordinateSpace,
      textureSize: fill.resolution,
      wrapMode: fill.spread === "repeat" ? "repeat" : "clamp-to-edge",
    });
  }

  if (fill.type === "radial-gradient") {
    return new FillGradient({
      type: "radial",
      center: normalizeGradientPoint(
        fill.innerCenter,
        fill,
        element,
        DEFAULT_RADIAL_CENTER,
      ),
      innerRadius: fill.innerRadius,
      outerCenter: normalizeGradientPoint(fill.outerCenter, fill, element),
      outerRadius: fill.outerRadius,
      colorStops: sortStops(fill.stops),
      textureSpace: fill.coordinateSpace,
      textureSize: fill.resolution,
      wrapMode: fill.spread === "repeat" ? "repeat" : "clamp-to-edge",
      scale: fill.scale,
      rotation: fill.rotation,
    });
  }

  return fill;
};

/**
 * @param {import("pixi.js").Graphics & {_rtglFillResource?: FillGradient}} rect
 * @param {import("../../../types.js").RectFill | undefined} fill
 * @param {import("../../../types.js").RectComputedNode} [element]
 * @returns {import("pixi.js").FillInput}
 */
export const resolveRectFill = (rect, fill, element) => {
  destroyRectFillResource(rect);

  const normalizedFill = normalizeRectFill(fill, element);

  if (normalizedFill instanceof FillGradient) {
    rect._rtglFillResource = normalizedFill;
  }

  return normalizedFill;
};
