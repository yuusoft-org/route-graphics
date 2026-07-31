import { Color } from "pixi.js";

export const RECT_CORNER_NAMES = Object.freeze([
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
]);

export const ZERO_CORNER_RADIUS = Object.freeze({
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
});

const RECT_FIELDS = new Set([
  "id",
  "type",
  "width",
  "height",
  "x",
  "y",
  "anchorX",
  "anchorY",
  "originX",
  "originY",
  "alpha",
  "scaleX",
  "scaleY",
  "rotation",
  "fill",
  "border",
  "cornerRadius",
  "blur",
  "filters",
  "hover",
  "click",
  "rightClick",
  "drag",
  "scrollUp",
  "scrollDown",
]);

const FILL_TYPES = new Set(["solid", "linear-gradient", "radial-gradient"]);
const COORDINATE_SPACES = new Set(["local", "global"]);
const GRADIENT_SPREADS = new Set(["pad", "repeat"]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertPlainObject = (value, path) => {
  if (!isPlainObject(value)) {
    throw new Error(`Input Error: ${path} must be an object`);
  }
};

const assertKnownFields = (value, fields, path) => {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) {
      throw new Error(`Input Error: ${path}.${key} is not supported`);
    }
  }
};

const assertFiniteNumber = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Input Error: ${path} must be a finite number`);
  }
};

const assertOptionalFiniteNumber = (value, path) => {
  if (value !== undefined) {
    assertFiniteNumber(value, path);
  }
};

const assertRange = (value, path, minimum, maximum) => {
  assertFiniteNumber(value, path);
  if (value < minimum || value > maximum) {
    throw new Error(
      `Input Error: ${path} must be between ${minimum} and ${maximum}`,
    );
  }
};

const assertNonNegativeNumber = (value, path) => {
  assertFiniteNumber(value, path);
  if (value < 0) {
    throw new Error(`Input Error: ${path} must be greater than or equal to 0`);
  }
};

const assertPositiveNumber = (value, path) => {
  assertFiniteNumber(value, path);
  if (value <= 0) {
    throw new Error(`Input Error: ${path} must be greater than 0`);
  }
};

export const assertRectColor = (value, path) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Input Error: ${path} must be a non-empty color string`);
  }

  // Some embedders replace Pixi with a renderer adapter that does not expose
  // its Color helper. Rendering still owns the final conversion in that case.
  if (typeof Color !== "function") {
    return;
  }

  try {
    new Color(value);
  } catch {
    throw new Error(`Input Error: ${path} is not a valid color`);
  }
};

const validatePoint = (point, path) => {
  assertPlainObject(point, path);
  assertKnownFields(point, new Set(["x", "y"]), path);
  if (point.x === undefined || point.y === undefined) {
    throw new Error(`Input Error: ${path}.x and ${path}.y are required`);
  }
  assertFiniteNumber(point.x, `${path}.x`);
  assertFiniteNumber(point.y, `${path}.y`);
};

const validateStops = (stops, path) => {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error(
      `Input Error: ${path} must be an array with at least two stops`,
    );
  }

  let previousOffset = -Infinity;
  stops.forEach((stop, index) => {
    const stopPath = `${path}[${index}]`;
    assertPlainObject(stop, stopPath);
    assertKnownFields(stop, new Set(["offset", "color"]), stopPath);
    if (stop.offset === undefined || stop.color === undefined) {
      throw new Error(
        `Input Error: ${stopPath}.offset and ${stopPath}.color are required`,
      );
    }
    assertRange(stop.offset, `${stopPath}.offset`, 0, 1);
    assertRectColor(stop.color, `${stopPath}.color`);
    if (stop.offset <= previousOffset) {
      throw new Error(
        `Input Error: ${path} offsets must be strictly increasing`,
      );
    }
    previousOffset = stop.offset;
  });
};

const validateGradientSampling = (fill, path) => {
  if (fill.textureSize !== undefined) {
    throw new Error(
      `Input Error: ${path}.textureSize is no longer supported; use ${path}.resolution`,
    );
  }
  if (fill.wrapMode !== undefined) {
    throw new Error(
      `Input Error: ${path}.wrapMode is no longer supported; use ${path}.spread with "pad" or "repeat"`,
    );
  }
  if (fill.coordinateSpace !== undefined) {
    if (!COORDINATE_SPACES.has(fill.coordinateSpace)) {
      throw new Error(
        `Input Error: ${path}.coordinateSpace must be "local" or "global"`,
      );
    }
  }
  if (fill.resolution !== undefined) {
    assertPositiveNumber(fill.resolution, `${path}.resolution`);
  }
  if (fill.spread !== undefined && !GRADIENT_SPREADS.has(fill.spread)) {
    throw new Error(`Input Error: ${path}.spread must be "pad" or "repeat"`);
  }
};

export const validateRectFill = (fill, path = "fill") => {
  if (typeof fill === "string") {
    assertRectColor(fill, path);
    return;
  }

  assertPlainObject(fill, path);
  if (!FILL_TYPES.has(fill.type)) {
    throw new Error(
      `Input Error: ${path}.type must be "solid", "linear-gradient", or "radial-gradient"`,
    );
  }

  if (fill.type === "solid") {
    assertKnownFields(fill, new Set(["type", "color"]), path);
    if (fill.color === undefined) {
      throw new Error(`Input Error: ${path}.color is required`);
    }
    assertRectColor(fill.color, `${path}.color`);
    return;
  }

  if (fill.type === "linear-gradient") {
    assertKnownFields(
      fill,
      new Set([
        "type",
        "start",
        "end",
        "stops",
        "coordinateSpace",
        "resolution",
        "spread",
        "textureSize",
        "wrapMode",
      ]),
      path,
    );
    if (fill.start !== undefined) validatePoint(fill.start, `${path}.start`);
    if (fill.end !== undefined) validatePoint(fill.end, `${path}.end`);
    validateStops(fill.stops, `${path}.stops`);
    validateGradientSampling(fill, path);
    return;
  }

  assertKnownFields(
    fill,
    new Set([
      "type",
      "innerCenter",
      "innerRadius",
      "outerCenter",
      "outerRadius",
      "stops",
      "coordinateSpace",
      "resolution",
      "spread",
      "scale",
      "rotation",
      "textureSize",
      "wrapMode",
    ]),
    path,
  );
  if (fill.innerCenter !== undefined) {
    validatePoint(fill.innerCenter, `${path}.innerCenter`);
  }
  if (fill.outerCenter !== undefined) {
    validatePoint(fill.outerCenter, `${path}.outerCenter`);
  }
  if (fill.innerRadius !== undefined) {
    assertNonNegativeNumber(fill.innerRadius, `${path}.innerRadius`);
  }
  if (fill.outerRadius !== undefined) {
    assertPositiveNumber(fill.outerRadius, `${path}.outerRadius`);
  }
  if (fill.scale !== undefined) {
    assertPositiveNumber(fill.scale, `${path}.scale`);
  }
  assertOptionalFiniteNumber(fill.rotation, `${path}.rotation`);
  validateStops(fill.stops, `${path}.stops`);
  validateGradientSampling(fill, path);
};

export const normalizeCornerRadius = (value) => {
  if (value === undefined) {
    return { ...ZERO_CORNER_RADIUS };
  }

  if (typeof value === "number") {
    return Object.fromEntries(
      RECT_CORNER_NAMES.map((corner) => [corner, value]),
    );
  }

  return Object.fromEntries(
    RECT_CORNER_NAMES.map((corner) => [corner, value[corner] ?? 0]),
  );
};

const validateCornerRadius = (value, path) => {
  if (typeof value === "number") {
    assertNonNegativeNumber(value, path);
    return;
  }

  assertPlainObject(value, path);
  assertKnownFields(value, new Set(RECT_CORNER_NAMES), path);
  for (const corner of RECT_CORNER_NAMES) {
    if (value[corner] !== undefined) {
      assertNonNegativeNumber(value[corner], `${path}.${corner}`);
    }
  }
};

const validatePayload = (payload, path) => {
  if (payload !== undefined) {
    assertPlainObject(payload, path);
  }
};

const validateSoundFields = (event, path, { cursor = false } = {}) => {
  if (event.soundSrc !== undefined) {
    if (typeof event.soundSrc !== "string" || event.soundSrc.length === 0) {
      throw new Error(
        `Input Error: ${path}.soundSrc must be a non-empty string`,
      );
    }
  }
  if (event.soundVolume !== undefined) {
    assertRange(event.soundVolume, `${path}.soundVolume`, 0, 100);
  }
  if (cursor && event.cursor !== undefined) {
    if (typeof event.cursor !== "string" || event.cursor.length === 0) {
      throw new Error(`Input Error: ${path}.cursor must be a non-empty string`);
    }
  }
  validatePayload(event.payload, `${path}.payload`);
};

const validatePointerEvent = (event, path, { cursor = false } = {}) => {
  assertPlainObject(event, path);
  assertKnownFields(
    event,
    new Set([
      "soundSrc",
      "soundVolume",
      "payload",
      ...(cursor ? ["cursor"] : []),
    ]),
    path,
  );
  validateSoundFields(event, path, { cursor });
};

const validatePayloadEvent = (event, path) => {
  assertPlainObject(event, path);
  assertKnownFields(event, new Set(["payload"]), path);
  validatePayload(event.payload, `${path}.payload`);
};

const validateDrag = (drag, path) => {
  assertPlainObject(drag, path);
  assertKnownFields(drag, new Set(["start", "move", "end"]), path);
  if (!drag.start && !drag.move && !drag.end) {
    throw new Error(`Input Error: ${path} must define start, move, or end`);
  }
  for (const phase of ["start", "move", "end"]) {
    if (drag[phase] !== undefined) {
      validatePayloadEvent(drag[phase], `${path}.${phase}`);
    }
  }
};

const validateBorder = (border, path) => {
  assertPlainObject(border, path);
  assertKnownFields(border, new Set(["width", "color", "alpha"]), path);
  if (border.width !== undefined) {
    assertNonNegativeNumber(border.width, `${path}.width`);
  }
  if (border.color !== undefined) {
    assertRectColor(border.color, `${path}.color`);
  }
  if (border.alpha !== undefined) {
    assertRange(border.alpha, `${path}.alpha`, 0, 1);
  }
};

const validateBlurShape = (blur, path) => {
  assertPlainObject(blur, path);
  assertKnownFields(
    blur,
    new Set(["x", "y", "quality", "kernelSize", "repeatEdgePixels"]),
    path,
  );
};

export const validateRectState = (state, path = "rect") => {
  assertPlainObject(state, path);
  assertKnownFields(state, RECT_FIELDS, path);

  if (typeof state.id !== "string" || state.id.length === 0) {
    throw new Error(`Input Error: ${path}.id must be a non-empty string`);
  }
  if (state.type !== "rect") {
    throw new Error(`Input Error: ${path}.type must be "rect"`);
  }

  assertPositiveNumber(state.width, `${path}.width`);
  assertPositiveNumber(state.height, `${path}.height`);
  for (const key of [
    "x",
    "y",
    "anchorX",
    "anchorY",
    "originX",
    "originY",
    "rotation",
  ]) {
    assertOptionalFiniteNumber(state[key], `${path}.${key}`);
  }
  for (const key of ["scaleX", "scaleY"]) {
    if (state[key] !== undefined) {
      assertPositiveNumber(state[key], `${path}.${key}`);
    }
  }
  if (state.alpha !== undefined) {
    assertRange(state.alpha, `${path}.alpha`, 0, 1);
  }
  if (state.fill !== undefined) {
    validateRectFill(state.fill, `${path}.fill`);
  }
  if (state.border !== undefined) {
    validateBorder(state.border, `${path}.border`);
  }
  if (state.cornerRadius !== undefined) {
    validateCornerRadius(state.cornerRadius, `${path}.cornerRadius`);
  }
  if (state.blur !== undefined) {
    validateBlurShape(state.blur, `${path}.blur`);
  }
  if (state.hover !== undefined) {
    validatePointerEvent(state.hover, `${path}.hover`, { cursor: true });
  }
  if (state.click !== undefined) {
    validatePointerEvent(state.click, `${path}.click`);
  }
  if (state.rightClick !== undefined) {
    validatePointerEvent(state.rightClick, `${path}.rightClick`);
  }
  if (state.drag !== undefined) {
    validateDrag(state.drag, `${path}.drag`);
  }
  if (state.scrollUp !== undefined) {
    validatePayloadEvent(state.scrollUp, `${path}.scrollUp`);
  }
  if (state.scrollDown !== undefined) {
    validatePayloadEvent(state.scrollDown, `${path}.scrollDown`);
  }
};
