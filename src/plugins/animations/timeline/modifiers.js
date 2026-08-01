import {
  assertFiniteNumber,
  assertKnownFields,
  assertPlainObject,
} from "./validation.js";

const roundTieAwayFromZero = (value) =>
  value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);

export const normalizeModifier = (modifier, path = "modifier") => {
  assertPlainObject(modifier, path);
  switch (modifier.kind) {
    case "snap": {
      assertKnownFields(
        modifier,
        new Set(["kind", "increment", "values"]),
        path,
      );
      if (
        (modifier.increment === undefined) ===
        (modifier.values === undefined)
      ) {
        throw new Error(
          `${path} snap requires exactly one of increment or values.`,
        );
      }
      if (modifier.increment !== undefined) {
        assertFiniteNumber(modifier.increment, `${path}.increment`);
        if (modifier.increment <= 0) {
          throw new Error(`${path}.increment must be positive.`);
        }
      } else if (
        !Array.isArray(modifier.values) ||
        modifier.values.length === 0
      ) {
        throw new Error(`${path}.values must be a non-empty array.`);
      } else {
        modifier.values.forEach((value, index) =>
          assertFiniteNumber(value, `${path}.values[${index}]`),
        );
      }
      break;
    }
    case "round":
      assertKnownFields(modifier, new Set(["kind", "precision"]), path);
      if (
        !Number.isInteger(modifier.precision) ||
        modifier.precision < 0 ||
        modifier.precision > 15
      ) {
        throw new Error(
          `${path}.precision must be an integer from 0 through 15.`,
        );
      }
      break;
    case "clamp":
    case "wrap":
    case "wrapYoyo":
      assertKnownFields(modifier, new Set(["kind", "min", "max"]), path);
      assertFiniteNumber(modifier.min, `${path}.min`);
      assertFiniteNumber(modifier.max, `${path}.max`);
      if (
        (modifier.kind === "clamp" && modifier.min > modifier.max) ||
        (modifier.kind !== "clamp" && modifier.min >= modifier.max)
      ) {
        throw new Error(`${path}.min and max define an invalid interval.`);
      }
      break;
    default:
      throw new Error(`${path}.kind "${modifier.kind}" is not supported.`);
  }
  return Object.freeze({
    ...modifier,
    ...(modifier.values ? { values: Object.freeze([...modifier.values]) } : {}),
  });
};

const euclideanModulo = (value, modulus) =>
  ((value % modulus) + modulus) % modulus;

export const applyModifier = (input, rawModifier) => {
  assertFiniteNumber(input, "modifier input");
  const modifier = normalizeModifier(rawModifier);
  let result;
  switch (modifier.kind) {
    case "snap":
      if (modifier.increment !== undefined) {
        result =
          roundTieAwayFromZero(input / modifier.increment) * modifier.increment;
      } else {
        result = modifier.values.reduce((best, candidate) =>
          Math.abs(candidate - input) < Math.abs(best - input)
            ? candidate
            : best,
        );
      }
      break;
    case "round": {
      const factor = 10 ** modifier.precision;
      result = roundTieAwayFromZero(input * factor) / factor;
      break;
    }
    case "clamp":
      result = Math.min(Math.max(input, modifier.min), modifier.max);
      break;
    case "wrap": {
      const width = modifier.max - modifier.min;
      result = modifier.min + euclideanModulo(input - modifier.min, width);
      break;
    }
    case "wrapYoyo": {
      const width = modifier.max - modifier.min;
      const position = euclideanModulo(input - modifier.min, width * 2);
      result =
        modifier.min + (position <= width ? position : width * 2 - position);
      break;
    }
  }
  assertFiniteNumber(result, "modifier result");
  return result;
};

export const applyModifiers = (value, modifiers = []) =>
  modifiers.reduce(
    (current, modifier) => applyModifier(current, modifier),
    value,
  );
