import {
  assertFiniteNumber,
  assertKnownFields,
  assertPlainObject,
} from "./validation.js";

const directions = new Set(["in", "out", "inOut"]);

const applyDirection = (progress, direction, easeIn) => {
  if (direction === "in") return easeIn(progress);
  if (direction === "out") return 1 - easeIn(1 - progress);
  return progress < 0.5
    ? easeIn(progress * 2) / 2
    : 1 - easeIn((1 - progress) * 2) / 2;
};

const bounceOut = (x) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) {
    const shifted = x - 1.5 / d1;
    return n1 * shifted * shifted + 0.75;
  }
  if (x < 2.5 / d1) {
    const shifted = x - 2.25 / d1;
    return n1 * shifted * shifted + 0.9375;
  }
  const shifted = x - 2.625 / d1;
  return n1 * shifted * shifted + 0.984375;
};

const namedDescriptors = {
  linear: { kind: "linear" },
  none: { kind: "linear" },
  easeInQuad: { kind: "power", exponent: 2, direction: "in" },
  easeOutQuad: { kind: "power", exponent: 2, direction: "out" },
  easeInOutQuad: { kind: "power", exponent: 2, direction: "inOut" },
  easeInCubic: { kind: "power", exponent: 3, direction: "in" },
  easeOutCubic: { kind: "power", exponent: 3, direction: "out" },
  easeInOutCubic: { kind: "power", exponent: 3, direction: "inOut" },
  easeInQuart: { kind: "power", exponent: 4, direction: "in" },
  easeOutQuart: { kind: "power", exponent: 4, direction: "out" },
  easeInOutQuart: { kind: "power", exponent: 4, direction: "inOut" },
  easeInQuint: { kind: "power", exponent: 5, direction: "in" },
  easeOutQuint: { kind: "power", exponent: 5, direction: "out" },
  easeInOutQuint: { kind: "power", exponent: 5, direction: "inOut" },
  easeInSine: { kind: "sine", direction: "in" },
  easeOutSine: { kind: "sine", direction: "out" },
  easeInOutSine: { kind: "sine", direction: "inOut" },
  easeInExpo: { kind: "expo", direction: "in" },
  easeOutExpo: { kind: "expo", direction: "out" },
  easeInOutExpo: { kind: "expo", direction: "inOut" },
  easeInCirc: { kind: "circ", direction: "in" },
  easeOutCirc: { kind: "circ", direction: "out" },
  easeInOutCirc: { kind: "circ", direction: "inOut" },
  easeInBack: { kind: "back", direction: "in", overshoot: 1.70158 },
  easeOutBack: { kind: "back", direction: "out", overshoot: 1.70158 },
  easeInOutBack: { kind: "back", direction: "inOut", overshoot: 1.70158 },
  easeInBounce: { kind: "bounce", direction: "in" },
  easeOutBounce: { kind: "bounce", direction: "out" },
  easeInOutBounce: { kind: "bounce", direction: "inOut" },
  easeInElastic: { kind: "elastic", direction: "in" },
  easeOutElastic: { kind: "elastic", direction: "out" },
  easeInOutElastic: { kind: "elastic", direction: "inOut" },
};

for (let power = 1; power <= 4; power++) {
  const exponent = power + 1;
  namedDescriptors[`power${power}.in`] = {
    kind: "power",
    exponent,
    direction: "in",
  };
  namedDescriptors[`power${power}.out`] = {
    kind: "power",
    exponent,
    direction: "out",
  };
  namedDescriptors[`power${power}.inOut`] = {
    kind: "power",
    exponent,
    direction: "inOut",
  };
}
Object.freeze(namedDescriptors);

export const normalizeEasing = (input = "linear", path = "easing") => {
  if (typeof input === "string") {
    const descriptor = namedDescriptors[input];
    if (!descriptor) throw new Error(`${path} is not a supported easing.`);
    return normalizeEasing({ ...descriptor }, path);
  }

  assertPlainObject(input, path);
  if (typeof input.kind !== "string") {
    throw new Error(`${path}.kind must be a non-empty string.`);
  }

  const descriptor = { ...input };
  switch (descriptor.kind) {
    case "linear":
      assertKnownFields(descriptor, new Set(["kind"]), path);
      break;
    case "power":
      assertKnownFields(
        descriptor,
        new Set(["kind", "direction", "exponent"]),
        path,
      );
      if (
        !Number.isInteger(descriptor.exponent) ||
        descriptor.exponent < 1 ||
        descriptor.exponent > 5
      ) {
        throw new Error(
          `${path}.exponent must be an integer from 1 through 5.`,
        );
      }
      break;
    case "sine":
    case "expo":
    case "circ":
    case "bounce":
      assertKnownFields(descriptor, new Set(["kind", "direction"]), path);
      break;
    case "back":
      assertKnownFields(
        descriptor,
        new Set(["kind", "direction", "overshoot"]),
        path,
      );
      descriptor.overshoot ??= 1.70158;
      assertFiniteNumber(descriptor.overshoot, `${path}.overshoot`);
      if (descriptor.overshoot < 0) {
        throw new Error(`${path}.overshoot must be non-negative.`);
      }
      break;
    case "elastic":
      assertKnownFields(
        descriptor,
        new Set(["kind", "direction", "amplitude", "period"]),
        path,
      );
      descriptor.amplitude ??= 1;
      descriptor.period ??= descriptor.direction === "inOut" ? 0.45 : 0.3;
      assertFiniteNumber(descriptor.amplitude, `${path}.amplitude`);
      assertFiniteNumber(descriptor.period, `${path}.period`);
      if (descriptor.amplitude < 1 || descriptor.period <= 0) {
        throw new Error(
          `${path} elastic amplitude must be at least 1 and period must be positive.`,
        );
      }
      break;
    case "steps":
      assertKnownFields(
        descriptor,
        new Set(["kind", "count", "position"]),
        path,
      );
      if (!Number.isInteger(descriptor.count) || descriptor.count <= 0) {
        throw new Error(`${path}.count must be a positive integer.`);
      }
      descriptor.position ??= "end";
      if (!new Set(["start", "end"]).has(descriptor.position)) {
        throw new Error(`${path}.position must be start or end.`);
      }
      break;
    case "cubicBezier":
      assertKnownFields(descriptor, new Set(["kind", "points"]), path);
      if (!Array.isArray(descriptor.points) || descriptor.points.length !== 4) {
        throw new Error(`${path}.points must contain four finite numbers.`);
      }
      descriptor.points.forEach((value, index) =>
        assertFiniteNumber(value, `${path}.points[${index}]`),
      );
      if (
        descriptor.points[0] < 0 ||
        descriptor.points[0] > 1 ||
        descriptor.points[2] < 0 ||
        descriptor.points[2] > 1
      ) {
        throw new Error(`${path} cubic-bezier x points must be within [0, 1].`);
      }
      break;
    case "sampled":
      assertKnownFields(descriptor, new Set(["kind", "samples"]), path);
      if (!Array.isArray(descriptor.samples) || descriptor.samples.length < 2) {
        throw new Error(`${path}.samples must contain at least two points.`);
      }
      descriptor.samples = descriptor.samples.map((sample, index) => {
        if (!Array.isArray(sample) || sample.length !== 2) {
          throw new Error(`${path}.samples[${index}] must be [time, value].`);
        }
        sample.forEach((value, component) =>
          assertFiniteNumber(value, `${path}.samples[${index}][${component}]`),
        );
        if (index > 0 && sample[0] <= descriptor.samples[index - 1][0]) {
          throw new Error(`${path}.samples times must be strictly increasing.`);
        }
        return [...sample];
      });
      if (
        descriptor.samples[0][0] !== 0 ||
        descriptor.samples.at(-1)[0] !== 1
      ) {
        throw new Error(`${path}.samples must begin at 0 and end at 1.`);
      }
      break;
    default:
      throw new Error(`${path}.kind "${descriptor.kind}" is not supported.`);
  }

  if (
    descriptor.kind !== "linear" &&
    !new Set(["steps", "cubicBezier", "sampled"]).has(descriptor.kind) &&
    !directions.has(descriptor.direction)
  ) {
    throw new Error(`${path}.direction must be in, out, or inOut.`);
  }

  return descriptor;
};

const cubicCoordinate = (time, first, second) => {
  const inverse = 1 - time;
  return (
    3 * inverse * inverse * time * first +
    3 * inverse * time * time * second +
    time * time * time
  );
};

const sampleCubicBezier = (progress, [x1, y1, x2, y2]) => {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 24; iteration++) {
    const candidate = (low + high) / 2;
    if (cubicCoordinate(candidate, x1, x2) < progress) low = candidate;
    else high = candidate;
  }
  return cubicCoordinate((low + high) / 2, y1, y2);
};

const samplePoints = (progress, samples) => {
  for (let index = 1; index < samples.length; index++) {
    const [rightTime, rightValue] = samples[index];
    if (progress <= rightTime) {
      const [leftTime, leftValue] = samples[index - 1];
      const amount = (progress - leftTime) / (rightTime - leftTime);
      return leftValue + (rightValue - leftValue) * amount;
    }
  }
  return samples.at(-1)[1];
};

export const sampleEasing = (input, progress) => {
  const descriptor = normalizeEasing(input);
  const clamped = Math.min(Math.max(progress, 0), 1);
  if (clamped === 0) return 0;
  if (clamped === 1) return 1;

  switch (descriptor.kind) {
    case "linear":
      return clamped;
    case "power":
      return applyDirection(
        clamped,
        descriptor.direction,
        (value) => value ** descriptor.exponent,
      );
    case "sine":
      return applyDirection(
        clamped,
        descriptor.direction,
        (value) => 1 - Math.cos((value * Math.PI) / 2),
      );
    case "expo":
      return applyDirection(
        clamped,
        descriptor.direction,
        (value) => 2 ** (10 * (value - 1)) * value + value ** 6 * (1 - value),
      );
    case "circ":
      return applyDirection(
        clamped,
        descriptor.direction,
        (value) => 1 - Math.sqrt(1 - value * value),
      );
    case "back": {
      return applyDirection(
        clamped,
        descriptor.direction,
        (value) =>
          (descriptor.overshoot + 1) * value ** 3 -
          descriptor.overshoot * value ** 2,
      );
    }
    case "bounce":
      return applyDirection(
        clamped,
        descriptor.direction,
        (value) => 1 - bounceOut(1 - value),
      );
    case "elastic": {
      const amplitude = descriptor.amplitude;
      const period = descriptor.period;
      const shift = (period / (2 * Math.PI)) * Math.asin(1 / amplitude);
      const easeOut = (value) =>
        value === 1
          ? 1
          : amplitude *
              2 ** (-10 * value) *
              Math.sin(((value - shift) * 2 * Math.PI) / period) +
            1;
      return applyDirection(
        clamped,
        descriptor.direction,
        (value) => 1 - easeOut(1 - value),
      );
    }
    case "steps":
      return descriptor.position === "start"
        ? Math.ceil(clamped * descriptor.count) / descriptor.count
        : Math.floor(clamped * descriptor.count) / descriptor.count;
    case "cubicBezier":
      return sampleCubicBezier(clamped, descriptor.points);
    case "sampled":
      return samplePoints(clamped, descriptor.samples);
    default:
      throw new Error(`Unsupported easing kind: ${descriptor.kind}`);
  }
};
