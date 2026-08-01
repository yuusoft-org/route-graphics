import { MAX_SAFE_TIME_MS } from "./constants.js";

export const isPlainObject = (value) =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

export const assertPlainObject = (value, path) => {
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be an object.`);
  }
};

export const assertKnownFields = (value, allowedFields, path) => {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new Error(`${path}.${field} is not supported.`);
    }
  }
};

export const assertNonEmptyString = (value, path) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
};

export const assertFiniteNumber = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
};

export const assertSafeTime = (value, path) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_TIME_MS) {
    throw new Error(
      `${path} must be a non-negative JSON-safe integer millisecond value.`,
    );
  }
};

export const assertSignedSafeTime = (value, path) => {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${path} must be a JSON-safe integer millisecond value.`);
  }
};

export const checkedTimeAdd = (left, right, path = "time") => {
  assertSignedSafeTime(left, `${path}.left`);
  assertSignedSafeTime(right, `${path}.right`);
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${path} exceeds JSON-safe integer time range.`);
  }
  return Object.is(result, -0) ? 0 : result;
};

export const checkedTimeMultiply = (left, right, path = "time") => {
  assertSignedSafeTime(left, `${path}.left`);
  assertSignedSafeTime(right, `${path}.right`);
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${path} exceeds JSON-safe integer time range.`);
  }
  return Object.is(result, -0) ? 0 : result;
};

export const assertSerializableData = (
  value,
  path = "value",
  seen = new Set(),
) => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    assertFiniteNumber(value, path);
    return;
  }

  if (
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new Error(`${path} must contain only JSON-serializable data.`);
  }

  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new Error(`${path} must contain only plain JSON values.`);
  }

  if (seen.has(value)) {
    throw new Error(`${path} must not contain cyclic references.`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSerializableData(item, `${path}[${index}]`, seen),
    );
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertSerializableData(item, `${path}.${key}`, seen);
    }
  }

  seen.delete(value);
};
