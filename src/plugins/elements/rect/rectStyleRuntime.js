import { Color } from "pixi.js";
import { isRectStyleAnimationProperty } from "../../../types.js";
import { normalizeCornerRadius, RECT_CORNER_NAMES } from "./rectConfig.js";

export const RECT_STYLE_STATE_KEY = "_routeGraphicsRectStyle";
export const RECT_ANIMATION_PROPERTY_PREFIX = "rect.";

const DEFAULT_LINEAR_START = { x: 0, y: 0 };
const DEFAULT_LINEAR_END = { x: 0, y: 1 };
const DEFAULT_RADIAL_CENTER = { x: 0.5, y: 0.5 };
const DEFAULT_BORDER = { width: 0, color: "black", alpha: 1 };

const clonePoint = (point) => (point ? { ...point } : point);
const cloneFill = (fill) => {
  if (!fill || typeof fill !== "object" || Array.isArray(fill)) {
    return fill;
  }

  return {
    ...fill,
    ...(fill.start ? { start: clonePoint(fill.start) } : {}),
    ...(fill.end ? { end: clonePoint(fill.end) } : {}),
    ...(fill.innerCenter ? { innerCenter: clonePoint(fill.innerCenter) } : {}),
    ...(fill.outerCenter ? { outerCenter: clonePoint(fill.outerCenter) } : {}),
    ...(fill.stops ? { stops: fill.stops.map((stop) => ({ ...stop })) } : {}),
  };
};

const createStyleState = (element) => ({
  width: element.width,
  height: element.height,
  fill: cloneFill(element.fill),
  border: {
    ...DEFAULT_BORDER,
    ...element.border,
  },
  cornerRadius: normalizeCornerRadius(element.cornerRadius),
});

const colorToArray = (value) => new Color(value).toArray();

const getFillPoint = (fill, key) => {
  if (fill?.type === "linear-gradient") {
    if (key === "start") return fill.start ?? DEFAULT_LINEAR_START;
    if (key === "end") return fill.end ?? DEFAULT_LINEAR_END;
  }

  if (fill?.type === "radial-gradient") {
    if (key === "innerCenter") {
      return fill.innerCenter ?? DEFAULT_RADIAL_CENTER;
    }
    if (key === "outerCenter") {
      return fill.outerCenter ?? fill.innerCenter ?? DEFAULT_RADIAL_CENTER;
    }
  }

  return null;
};

const getFillScalarDefault = (fill, key) => {
  if (fill?.type === "radial-gradient") {
    if (key === "innerRadius") return fill.innerRadius ?? 0;
    if (key === "outerRadius") return fill.outerRadius ?? 0.5;
    if (key === "scale") return fill.scale ?? 1;
    if (key === "rotation") return fill.rotation ?? 0;
  }
  return undefined;
};

const getStyleValue = (state, property) => {
  if (property === "rect.width") return state.width;
  if (property === "rect.height") return state.height;
  if (property === "rect.fill.color") {
    const color =
      typeof state.fill === "string" || Array.isArray(state.fill)
        ? state.fill
        : state.fill?.type === "solid"
          ? state.fill.color
          : undefined;
    return color === undefined ? undefined : colorToArray(color);
  }
  if (property === "rect.border.width") return state.border.width;
  if (property === "rect.border.color") {
    return colorToArray(state.border.color);
  }
  if (property === "rect.border.alpha") return state.border.alpha;

  const cornerMatch = /^rect\.cornerRadius\.(.+)$/.exec(property);
  if (cornerMatch) {
    return state.cornerRadius[cornerMatch[1]];
  }

  const pointMatch =
    /^rect\.fill\.(start|end|innerCenter|outerCenter)\.(x|y)$/.exec(property);
  if (pointMatch) {
    return getFillPoint(state.fill, pointMatch[1])?.[pointMatch[2]];
  }

  const scalarMatch =
    /^rect\.fill\.(innerRadius|outerRadius|scale|rotation)$/.exec(property);
  if (scalarMatch) {
    return getFillScalarDefault(state.fill, scalarMatch[1]);
  }

  const stopMatch = /^rect\.fill\.stops\.(\d+)\.(offset|color)$/.exec(property);
  if (stopMatch) {
    const value = state.fill?.stops?.[Number(stopMatch[1])]?.[stopMatch[2]];
    return stopMatch[2] === "color" && value !== undefined
      ? colorToArray(value)
      : value;
  }

  return undefined;
};

const requireFillObject = (state, property) => {
  if (
    !state.fill ||
    typeof state.fill !== "object" ||
    Array.isArray(state.fill)
  ) {
    throw new Error(
      `Animation property "${property}" is incompatible with the current rect fill`,
    );
  }
  return state.fill;
};

const setStyleValue = (state, property, value) => {
  if (property === "rect.width") {
    state.width = value;
    return;
  }
  if (property === "rect.height") {
    state.height = value;
    return;
  }
  if (property === "rect.fill.color") {
    if (
      typeof state.fill === "string" ||
      Array.isArray(state.fill) ||
      state.fill === undefined
    ) {
      state.fill = value;
      return;
    }
    if (state.fill?.type === "solid") {
      state.fill.color = value;
      return;
    }
    throw new Error(
      `Animation property "${property}" requires a solid rect fill`,
    );
  }
  if (property === "rect.border.width") {
    state.border.width = value;
    return;
  }
  if (property === "rect.border.color") {
    state.border.color = value;
    return;
  }
  if (property === "rect.border.alpha") {
    state.border.alpha = value;
    return;
  }

  const cornerMatch = /^rect\.cornerRadius\.(.+)$/.exec(property);
  if (cornerMatch) {
    state.cornerRadius[cornerMatch[1]] = value;
    return;
  }

  const pointMatch =
    /^rect\.fill\.(start|end|innerCenter|outerCenter)\.(x|y)$/.exec(property);
  if (pointMatch) {
    const fill = requireFillObject(state, property);
    const [key, axis] = pointMatch.slice(1);
    fill[key] = { ...getFillPoint(fill, key), [axis]: value };
    return;
  }

  const scalarMatch =
    /^rect\.fill\.(innerRadius|outerRadius|scale|rotation)$/.exec(property);
  if (scalarMatch) {
    requireFillObject(state, property)[scalarMatch[1]] = value;
    return;
  }

  const stopMatch = /^rect\.fill\.stops\.(\d+)\.(offset|color)$/.exec(property);
  if (stopMatch) {
    const fill = requireFillObject(state, property);
    const index = Number(stopMatch[1]);
    if (!fill.stops?.[index]) {
      throw new Error(
        `Animation property "${property}" targets a missing gradient stop`,
      );
    }
    fill.stops[index][stopMatch[2]] = value;
    return;
  }

  throw new Error(`Unknown rect animation property "${property}"`);
};

export const isRectAnimationProperty = isRectStyleAnimationProperty;

export const installRectStyleRuntime = (
  displayObject,
  element,
  onChange = () => {},
) => {
  let runtime = displayObject[RECT_STYLE_STATE_KEY];

  if (!runtime) {
    const target = {
      state: createStyleState(element),
      element,
      onChange,
      batchDepth: 0,
      pendingChanges: new Set(),
      beginBatch() {
        this.batchDepth += 1;
      },
      endBatch() {
        if (this.batchDepth === 0) return;
        this.batchDepth -= 1;
        if (this.batchDepth > 0 || this.pendingChanges.size === 0) return;

        const changes = new Set(this.pendingChanges);
        this.pendingChanges.clear();
        this.onChange(changes, runtime);
      },
      sync(nextElement) {
        this.state = createStyleState(nextElement);
        this.element = nextElement;
        this.pendingChanges.clear();
      },
    };
    runtime = new Proxy(target, {
      get(current, property, receiver) {
        if (isRectAnimationProperty(property)) {
          return getStyleValue(current.state, property);
        }
        return Reflect.get(current, property, receiver);
      },
      set(current, property, value, receiver) {
        if (isRectAnimationProperty(property)) {
          setStyleValue(current.state, property, value);
          if (current.batchDepth > 0) {
            current.pendingChanges.add(property);
          } else {
            current.onChange(property, receiver);
          }
          return true;
        }
        return Reflect.set(current, property, value, receiver);
      },
    });
    displayObject[RECT_STYLE_STATE_KEY] = runtime;
  } else {
    runtime.onChange = onChange;
  }

  return runtime;
};

export const syncRectStyleRuntime = (displayObject, element) => {
  const runtime = displayObject[RECT_STYLE_STATE_KEY];
  if (!runtime) {
    return installRectStyleRuntime(displayObject, element);
  }
  runtime.sync(element);
  return runtime;
};

export const getRectStyleAnimationValue = (displayObject, property) =>
  getStyleValue(displayObject?.[RECT_STYLE_STATE_KEY]?.state, property);

export const setRectStyleAnimationValue = (displayObject, property, value) => {
  const runtime = displayObject?.[RECT_STYLE_STATE_KEY];
  if (!runtime) {
    throw new Error("Rect style animation target is not installed");
  }
  runtime[property] = value;
};

export const getRectStyleAnimationBatchHooks = (displayObject) => {
  const runtime = displayObject?.[RECT_STYLE_STATE_KEY];
  if (!runtime) return {};

  return {
    beforeApplyFrame: () => runtime.beginBatch(),
    afterApplyFrame: () => runtime.endBatch(),
  };
};

export const validateRectStyleAnimationTarget = (displayObject, animation) => {
  const properties = Object.keys(animation?.tween ?? {}).filter(
    isRectAnimationProperty,
  );
  if (properties.length === 0) return;

  const runtime = displayObject?.[RECT_STYLE_STATE_KEY];
  if (!runtime) {
    throw new Error(
      `Animation "${animation.id}" can only target rect style properties on a mounted rect.`,
    );
  }

  for (const property of properties) {
    if (getStyleValue(runtime.state, property) === undefined) {
      throw new Error(
        `Animation "${animation.id}" property "${property.slice(RECT_ANIMATION_PROPERTY_PREFIX.length)}" is incompatible with the current rect fill.`,
      );
    }
  }
};

const addFillTargetState = (targetState, fill) => {
  if (typeof fill === "string" || fill?.type === "solid") {
    const color = typeof fill === "string" ? fill : fill?.color;
    if (color !== undefined) {
      targetState["rect.fill.color"] = colorToArray(color);
    }
    return;
  }

  if (fill?.type === "linear-gradient") {
    const start = fill.start ?? DEFAULT_LINEAR_START;
    const end = fill.end ?? DEFAULT_LINEAR_END;
    targetState["rect.fill.start.x"] = start.x;
    targetState["rect.fill.start.y"] = start.y;
    targetState["rect.fill.end.x"] = end.x;
    targetState["rect.fill.end.y"] = end.y;
  }

  if (fill?.type === "radial-gradient") {
    const innerCenter = fill.innerCenter ?? DEFAULT_RADIAL_CENTER;
    const outerCenter = fill.outerCenter ?? innerCenter;
    targetState["rect.fill.innerCenter.x"] = innerCenter.x;
    targetState["rect.fill.innerCenter.y"] = innerCenter.y;
    targetState["rect.fill.outerCenter.x"] = outerCenter.x;
    targetState["rect.fill.outerCenter.y"] = outerCenter.y;
    targetState["rect.fill.innerRadius"] = fill.innerRadius ?? 0;
    targetState["rect.fill.outerRadius"] = fill.outerRadius ?? 0.5;
    targetState["rect.fill.scale"] = fill.scale ?? 1;
    targetState["rect.fill.rotation"] = fill.rotation ?? 0;
  }

  fill?.stops?.forEach((stop, index) => {
    targetState[`rect.fill.stops.${index}.offset`] = stop.offset;
    targetState[`rect.fill.stops.${index}.color`] = colorToArray(stop.color);
  });
};

const removeBakedScale = (dimension, scale) =>
  typeof scale === "number" && scale !== 0 ? dimension / scale : dimension;

export const getRectStyleTargetState = (
  element,
  { liveScaleX = false, liveScaleY = false } = {},
) => {
  const targetState = {
    "rect.width": liveScaleX
      ? removeBakedScale(element.width, element.scaleX)
      : element.width,
    "rect.height": liveScaleY
      ? removeBakedScale(element.height, element.scaleY)
      : element.height,
    "rect.border.width": element.border?.width ?? 0,
    "rect.border.color": colorToArray(element.border?.color ?? "black"),
    "rect.border.alpha": element.border?.alpha ?? 1,
  };
  const cornerRadius = normalizeCornerRadius(element.cornerRadius);

  for (const corner of RECT_CORNER_NAMES) {
    targetState[`rect.cornerRadius.${corner}`] = cornerRadius[corner];
  }
  addFillTargetState(targetState, element.fill);
  return targetState;
};
