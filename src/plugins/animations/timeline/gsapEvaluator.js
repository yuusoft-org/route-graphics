import { gsap } from "gsap";
import { normalizeEasing, sampleEasing } from "./easing.js";
import {
  applyTimelineFrame,
  createTimelineFrameBuffer,
  evaluateTimelineInstanceIntoWithSampler,
} from "./evaluateInstance.js";
import {
  cloneTimelineValue,
  isNumericSequence,
  roundTimelineInteger,
  sampleDiscreteValue,
} from "./valueTypes.js";

const GSAP_MILLISECONDS_PER_SECOND = 1000;
// GSAP rounds plain-object property writes to six decimal places. Driving a
// normalized, scaled ratio keeps that implementation detail from changing
// TimelineProgram modifier decisions near rounding boundaries.
const GSAP_PROGRESS_SCALE = 1_000_000;
const discreteValueTypes = new Set(["boolean", "string", "discrete"]);
const nativeEaseCache = new Map();

const getDirectionSuffix = (direction) =>
  direction === "inOut" ? "inOut" : direction;

const getGsapEaseName = (descriptor) => {
  const suffix = getDirectionSuffix(descriptor.direction);
  switch (descriptor.kind) {
    case "linear":
      return "none";
    case "power":
      return descriptor.exponent === 1
        ? "none"
        : `power${descriptor.exponent - 1}.${suffix}`;
    case "sine":
    case "expo":
    case "circ":
    case "bounce":
      return `${descriptor.kind}.${suffix}`;
    case "back":
      return `back.${suffix}(${descriptor.overshoot})`;
    case "elastic":
      return `elastic.${suffix}(${descriptor.amplitude},${descriptor.period})`;
    default:
      return null;
  }
};

/** Convert a portable easing descriptor into an ease consumed by GSAP. */
export const getGsapEase = (input) => {
  const descriptor = normalizeEasing(input);
  const cacheKey = JSON.stringify(descriptor);
  if (nativeEaseCache.has(cacheKey)) return nativeEaseCache.get(cacheKey);

  const easeName = getGsapEaseName(descriptor);
  const ease = easeName
    ? gsap.parseEase(easeName)
    : (progress) => sampleEasing(descriptor, progress);
  if (typeof ease !== "function") {
    throw new Error(`GSAP could not resolve easing "${easeName}".`);
  }
  nativeEaseCache.set(cacheKey, ease);
  return ease;
};

const timelineValuesEqual = (left, right) => {
  if (!isNumericSequence(left) || !isNumericSequence(right)) {
    return Object.is(left, right);
  }
  return (
    left.length === right.length &&
    Array.from(left).every((value, index) => Object.is(value, right[index]))
  );
};

const createNumericSampler = (segment, ownedTweens) => {
  const sequence = isNumericSequence(segment.from);
  const from = sequence ? Array.from(segment.from) : [segment.from];
  const to = sequence ? Array.from(segment.to) : [segment.to];
  const proxy = { progress: 0 };
  const fromVars = { progress: 0 };
  const toVars = {
    duration: segment.duration / GSAP_MILLISECONDS_PER_SECOND,
    ease: getGsapEase(segment.easing),
    immediateRender: true,
    lazy: false,
    overwrite: false,
    paused: true,
    progress: GSAP_PROGRESS_SCALE,
  };

  const tween = gsap.fromTo(proxy, fromVars, toVars);
  // The Route Graphics clock scrubs these tweens explicitly. Detaching them
  // prevents GSAP's global ticker from advancing renderer-owned state.
  gsap.globalTimeline.remove(tween);
  ownedTweens.add(tween);

  return {
    from: cloneTimelineValue(segment.from),
    to: cloneTimelineValue(segment.to),
    tween,
    sample: (progress) => {
      tween.time(
        (progress * segment.duration) / GSAP_MILLISECONDS_PER_SECOND,
        true,
      );
      const eased = proxy.progress / GSAP_PROGRESS_SCALE;
      if (!sequence) return from[0] + (to[0] - from[0]) * eased;
      return from.map(
        (component, index) => component + (to[index] - component) * eased,
      );
    },
  };
};

/**
 * Creates the PixiJS/JavaScript TimelineProgram evaluator. TimelineProgram
 * retains renderer-neutral scheduling while real GSAP tweens perform easing
 * and normalized progress interpolation against plain proxy objects.
 */
export const createGsapTimelineEvaluator = (instance) => {
  const frame = createTimelineFrameBuffer(instance);
  const samplerBySegment = new WeakMap();
  const ownedTweens = new Set();
  let destroyed = false;

  const sampleSegment = (segment, progress, sourceSegment) => {
    if (discreteValueTypes.has(segment.valueType)) {
      const eased = getGsapEase(segment.easing)(progress);
      return sampleDiscreteValue(segment.from, segment.to, eased);
    }

    let sampler = samplerBySegment.get(sourceSegment);
    if (
      !sampler ||
      !timelineValuesEqual(sampler.from, segment.from) ||
      !timelineValuesEqual(sampler.to, segment.to)
    ) {
      if (sampler) {
        sampler.tween.kill();
        ownedTweens.delete(sampler.tween);
      }
      sampler = createNumericSampler(segment, ownedTweens);
      samplerBySegment.set(sourceSegment, sampler);
    }

    const value = sampler.sample(progress);
    return segment.valueType === "integer"
      ? roundTimelineInteger(value)
      : value;
  };

  const assertLive = () => {
    if (destroyed) {
      throw new Error("Cannot evaluate a destroyed GSAP timeline evaluator.");
    }
  };

  const evaluate = (timeMS) => {
    assertLive();
    return evaluateTimelineInstanceIntoWithSampler(
      instance,
      timeMS,
      frame,
      sampleSegment,
    );
  };

  return {
    backend: "gsap",
    backendVersion: gsap.version,
    timeUnit: "ms",
    instance,
    frame,
    evaluate,
    apply: (timeMS) => applyTimelineFrame(evaluate(timeMS)),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const tween of ownedTweens) tween.kill();
      ownedTweens.clear();
    },
  };
};

export const GSAP_TIMELINE_BACKEND = Object.freeze({
  name: "gsap",
  version: gsap.version,
  timeUnit: "ms",
});
