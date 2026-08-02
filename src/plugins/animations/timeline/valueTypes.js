import { assertFiniteNumber } from "./validation.js";
import { assertSerializableData } from "./validation.js";

export const isNumericSequence = (value) =>
  Array.isArray(value) || ArrayBuffer.isView(value);

export const cloneTimelineValue = (value) =>
  isNumericSequence(value) ? Array.from(value) : value;

export const assertNumericValue = (value, path = "value") => {
  if (!isNumericSequence(value)) {
    assertFiniteNumber(value, path);
    return;
  }

  if (value.length === 0) {
    throw new Error(`${path} must not be an empty numeric sequence.`);
  }

  Array.from(value).forEach((component, index) =>
    assertFiniteNumber(component, `${path}[${index}]`),
  );
};

const assertMatchingNumericShape = (from, to, path) => {
  const fromSequence = isNumericSequence(from);
  const toSequence = isNumericSequence(to);

  if (fromSequence !== toSequence) {
    throw new Error(`${path} values must have matching numeric shapes.`);
  }

  if (fromSequence && from.length !== to.length) {
    throw new Error(`${path} values must have matching numeric shapes.`);
  }
};

export const addTimelineValues = (left, right, path = "value") => {
  assertNumericValue(left, `${path}.left`);
  assertNumericValue(right, `${path}.right`);
  assertMatchingNumericShape(left, right, path);

  if (!isNumericSequence(left)) return left + right;
  return Array.from(left, (value, index) => value + right[index]);
};

export const interpolateTimelineValues = (from, to, amount, path = "value") => {
  assertNumericValue(from, `${path}.from`);
  assertNumericValue(to, `${path}.to`);
  assertFiniteNumber(amount, `${path}.amount`);
  assertMatchingNumericShape(from, to, path);

  if (amount === 0) return cloneTimelineValue(from);
  if (amount === 1) return cloneTimelineValue(to);

  if (!isNumericSequence(from)) {
    return from + (to - from) * amount;
  }

  return Array.from(
    from,
    (value, index) => value + (to[index] - value) * amount,
  );
};

export const sampleDiscreteValue = (from, to, amount) =>
  amount >= 1 ? to : from;

// Integer channels use symmetric half-away-from-zero rounding. Exact integer
// endpoints remain exact and negative values do not inherit Math.round's
// positive-infinity tie bias.
export const roundTimelineInteger = (value) =>
  value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);

const sequenceLengths = Object.freeze({
  vec2: 2,
  vec3: 3,
  vec4: 4,
  mat3: 9,
  mat4: 16,
  colorSrgb: 4,
  colorLinear: 4,
});

export const validateTimelineValueType = (value, type, path = "value") => {
  if (new Set(["scalar", "angleDegrees"]).has(type)) {
    assertFiniteNumber(value, path);
    return value;
  }
  if (type === "integer") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${path} must be a JSON-safe integer.`);
    }
    return value;
  }
  if (sequenceLengths[type] !== undefined) {
    if (
      (!Array.isArray(value) && !ArrayBuffer.isView(value)) ||
      value.length !== sequenceLengths[type]
    ) {
      throw new Error(
        `${path} must be a ${sequenceLengths[type]}-number ${type}.`,
      );
    }
    Array.from(value).forEach((component, index) =>
      assertFiniteNumber(component, `${path}[${index}]`),
    );
    return value;
  }
  if (type === "boolean" && typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  if (type === "string" && typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  if (type === "discrete") assertSerializableData(value, path);
  return value;
};
