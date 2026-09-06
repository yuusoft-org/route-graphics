import { mapDomainTime } from "./domains.js";
import { sampleEasing } from "./easing.js";
import { applyModifiers } from "./modifiers.js";
import {
  addTimelineValues,
  cloneTimelineValue,
  interpolateTimelineValues,
  isNumericSequence,
  roundTimelineInteger,
  sampleDiscreteValue,
} from "./valueTypes.js";
import { assertFiniteNumber } from "./validation.js";

const mapDomain = (instance, domainId, rootTime, cache) => {
  if (cache.has(domainId)) return cache.get(domainId);
  const domain = instance.domains[domainId];
  if (domain.parent === null && instance.unboundedRoot) {
    const state = {
      active: rootTime >= domain.start,
      completed: false,
      iteration: 0,
      direction: "forward",
      inGap: false,
      localTime: Math.max(0, rootTime - domain.start) * domain.rate,
    };
    cache.set(domainId, state);
    return state;
  }
  const parentState =
    domain.parent === null
      ? { active: true, localTime: rootTime }
      : mapDomain(instance, domain.parent, rootTime, cache);
  const state = parentState.active
    ? mapDomainTime(domain, parentState.localTime)
    : {
        active: false,
        completed: false,
        iteration: 0,
        direction: "forward",
        inGap: false,
        localTime: 0,
      };
  cache.set(domainId, state);
  return state;
};

const sampleReferenceSegment = (segment, progress) => {
  const eased = sampleEasing(segment.easing, progress);
  const value = new Set(["boolean", "string", "discrete"]).has(
    segment.valueType,
  )
    ? sampleDiscreteValue(segment.from, segment.to, eased)
    : interpolateTimelineValues(segment.from, segment.to, eased);
  return segment.valueType === "integer" ? roundTimelineInteger(value) : value;
};

const getSegmentContribution = (
  segment,
  localTime,
  sampleSegment,
  sourceSegment,
) => {
  const end = segment.start + segment.duration;
  let value;
  if (localTime < segment.start) {
    value = new Set(["backwards", "both"]).has(segment.fill)
      ? cloneTimelineValue(segment.from)
      : null;
  } else if (segment.duration === 0 || localTime >= end) {
    value = new Set(["forwards", "both"]).has(segment.fill)
      ? cloneTimelineValue(segment.to)
      : null;
  } else {
    const progress = (localTime - segment.start) / segment.duration;
    value = sampleSegment(segment, progress, sourceSegment);
  }
  return value !== null && segment.modifiers.length > 0
    ? applyModifiers(value, segment.modifiers)
    : value;
};

const multiplyValues = (left, right) => {
  if (!isNumericSequence(left) && !isNumericSequence(right)) {
    return left * right;
  }
  if (
    !isNumericSequence(left) ||
    !isNumericSequence(right) ||
    left.length !== right.length
  ) {
    throw new Error("Multiply composition requires matching numeric shapes.");
  }
  return Array.from(left, (value, index) => value * right[index]);
};

export const sampleBoundTrack = (
  instance,
  track,
  rootTime,
  {
    maximumPriority = Infinity,
    domainCache = new Map(),
    sampleSegment = sampleReferenceSegment,
    baseValue = track.baseValue,
    ignoreTrimsAtOrAfterPriority = Infinity,
  } = {},
) => {
  let result = cloneTimelineValue(baseValue);
  for (const segment of track.segments) {
    if (segment.priority > maximumPriority) continue;
    const domainState = mapDomain(
      instance,
      segment.domain,
      rootTime,
      domainCache,
    );
    if (!domainState.active) continue;
    const ignoreTrim =
      segment.trimmedByPriority !== undefined &&
      segment.trimmedByPriority >= ignoreTrimsAtOrAfterPriority;
    if (!ignoreTrim && segment.trimDomain !== undefined) {
      const trimState = mapDomain(
        instance,
        segment.trimDomain,
        rootTime,
        domainCache,
      );
      // Overwrite is a boundary in authored timeline coordinates. Reversing
      // traversal must restore contributions on the earlier side of it.
      const reachedTrim = trimState.localTime >= segment.trimAt;
      if (trimState.active && reachedTrim) continue;
    } else if (
      !ignoreTrim &&
      segment.trimRootAt !== undefined &&
      rootTime >= segment.trimRootAt
    ) {
      continue;
    }
    const valueDomainState = segment.refreshDomain
      ? mapDomain(instance, segment.refreshDomain, rootTime, domainCache)
      : domainState;
    const resolvedSegment = segment.resolveValues
      ? { ...segment, ...segment.resolveValues(valueDomainState) }
      : segment;
    const contribution = getSegmentContribution(
      resolvedSegment,
      domainState.localTime,
      sampleSegment,
      segment,
    );
    if (contribution === null) continue;
    if (resolvedSegment.composite === "replace") result = contribution;
    else if (resolvedSegment.composite === "add") {
      result = addTimelineValues(result, contribution, "composition");
    } else result = multiplyValues(result, contribution);
  }
  return cloneTimelineValue(result);
};

export const createTimelineFrameBuffer = (instance) => ({
  instanceId: instance.instanceId,
  programId: instance.programId,
  time: 0,
  values: instance.tracks.map((track) => ({
    target: track.target.handle,
    targetIdentity: track.target.identity,
    channel: track.channel,
    value: cloneTimelineValue(track.baseValue),
    binding: track.binding,
  })),
});

export const evaluateTimelineInstanceIntoWithSampler = (
  instance,
  rootTime,
  frame,
  sampleSegment,
) => {
  assertFiniteNumber(rootTime, "rootTime");
  if (
    frame?.instanceId !== instance.instanceId ||
    frame.values?.length !== instance.tracks.length
  ) {
    throw new Error("Timeline frame buffer does not belong to this instance.");
  }
  const time = Math.max(rootTime, 0);
  const domainCache = new Map();
  frame.time = time;
  for (let index = 0; index < instance.tracks.length; index++) {
    frame.values[index].value = sampleBoundTrack(
      instance,
      instance.tracks[index],
      time,
      { domainCache, sampleSegment },
    );
  }
  return frame;
};

export const evaluateTimelineInstanceInto = (instance, rootTime, frame) =>
  evaluateTimelineInstanceIntoWithSampler(instance, rootTime, frame);

export const evaluateTimelineInstance = (instance, rootTime) =>
  evaluateTimelineInstanceInto(
    instance,
    rootTime,
    createTimelineFrameBuffer(instance),
  );

export const applyTimelineFrame = (frame) => {
  const previousValues = frame.values.map((item) =>
    cloneTimelineValue(item.binding.get(item.target, item)),
  );
  const groups = [];
  const groupSet = new Set();
  for (const item of frame.values) {
    const group = item.binding.group ?? item.binding;
    if (!groupSet.has(group)) {
      groupSet.add(group);
      groups.push(group);
    }
  }
  const opened = [];
  const appliedIndexes = [];
  let primaryError;
  try {
    for (const group of groups) {
      group.beforeApplyFrame?.();
      opened.push(group);
    }
    for (let index = 0; index < frame.values.length; index++) {
      const item = frame.values[index];
      item.binding.apply(item.target, item.value, item);
      appliedIndexes.push(index);
    }
  } catch (error) {
    primaryError = error;
    for (let index = appliedIndexes.length - 1; index >= 0; index--) {
      const itemIndex = appliedIndexes[index];
      const item = frame.values[itemIndex];
      try {
        item.binding.apply(item.target, previousValues[itemIndex], item);
      } catch {
        // Preserve the original adapter failure. A backend may report the
        // rollback failure separately, but must still close every batch hook.
      }
    }
  }

  let closeError;
  for (let index = opened.length - 1; index >= 0; index--) {
    try {
      opened[index].afterApplyFrame?.();
    } catch (error) {
      closeError ??= error;
    }
  }
  if (primaryError) throw primaryError;
  if (closeError) throw closeError;
};
