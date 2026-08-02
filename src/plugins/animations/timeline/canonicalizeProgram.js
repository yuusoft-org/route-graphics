import { assertSerializableData, isPlainObject } from "./validation.js";

const hasLoneSurrogate = (value) => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const normalizeCanonicalValue = (value, path) => {
  if (typeof value === "string") {
    if (hasLoneSurrogate(value)) {
      throw new Error(`${path} contains a lone Unicode surrogate.`);
    }
    return value;
  }

  if (typeof value === "number") {
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeCanonicalValue(item, `${path}[${index}]`),
    );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          normalizeCanonicalValue(value[key], `${path}.${key}`),
        ]),
    );
  }

  return value;
};

export const canonicalizeData = (value) => {
  assertSerializableData(value);
  return JSON.stringify(normalizeCanonicalValue(value, "value"));
};

export const getProgramSemanticData = (program) => {
  if (!isPlainObject(program)) {
    throw new Error("program must be an object.");
  }

  const { debug: _debug, ...semantic } = program;
  return semantic;
};

export const canonicalizeProgram = (program) =>
  canonicalizeData(getProgramSemanticData(program));
