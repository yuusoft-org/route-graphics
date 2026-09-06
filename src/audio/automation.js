import { getEasingFunction } from "../util/animationTimeline.js";
import { normalizeVolume } from "../util/normalizeVolume.js";
import { getAudioContext } from "../audioContext.js";

const AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS = 16;
const AUDIO_AUTOMATION_MAX_SAMPLES = 1024;
export const audioParamAutomation = new WeakMap();

export const toFiniteParamValue = (value, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return fallback;
};

export const getParamValue = (param, fallback = 0) =>
  toFiniteParamValue(param?.value, fallback);

export const getTimelineValueAtTime = (timeline, elapsedMs) => {
  if (timeline.length === 0) return 0;

  const lastKeyframe = timeline[timeline.length - 1];
  if (elapsedMs >= lastKeyframe.time) return lastKeyframe.value;

  for (let index = 1; index < timeline.length; index++) {
    const start = timeline[index - 1];
    const end = timeline[index];
    if (elapsedMs >= end.time || end.time === start.time) continue;

    const progress = Math.max(
      0,
      Math.min(1, (elapsedMs - start.time) / (end.time - start.time)),
    );
    const easedProgress = getEasingFunction(end.easing)(progress);
    return start.value + (end.value - start.value) * easedProgress;
  }

  return lastKeyframe.value;
};

export const getCurrentParamValue = (param, context = getAudioContext()) => {
  const automation = audioParamAutomation.get(param);
  if (!automation) return getParamValue(param);

  const elapsedMs = Math.max(
    0,
    (context.currentTime - automation.startTime) * 1000,
  );
  return automation.normalizeValue(
    getTimelineValueAtTime(automation.timeline, elapsedMs),
  );
};

export const integrateAudioParamValue = (param, startTime, endTime) => {
  const durationSeconds = Math.max(0, endTime - startTime);
  if (durationSeconds === 0) {
    return 0;
  }

  const automation = audioParamAutomation.get(param);
  if (!automation) {
    return durationSeconds * Math.max(0, getParamValue(param, 1));
  }

  const durationMs = durationSeconds * 1000;
  const sampleCount = Math.min(
    AUDIO_AUTOMATION_MAX_SAMPLES,
    Math.max(1, Math.ceil(durationMs / AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS)),
  );
  const sampleDurationSeconds = durationSeconds / sampleCount;
  let integratedSeconds = 0;

  for (let sample = 0; sample < sampleCount; sample++) {
    const sampleTime = startTime + (sample + 0.5) * sampleDurationSeconds;
    const elapsedMs = Math.max(0, (sampleTime - automation.startTime) * 1000);
    const value = automation.normalizeValue(
      getTimelineValueAtTime(automation.timeline, elapsedMs),
    );
    integratedSeconds += Math.max(0, value) * sampleDurationSeconds;
  }

  return integratedSeconds;
};

const setParamAtTime = (param, value, time) => {
  if (typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, time);
  } else {
    param.value = value;
  }
};

export const setParamNow = (param, value, context = getAudioContext()) => {
  if (!param) return;

  const now = context.currentTime;
  const nextValue = toFiniteParamValue(value, getParamValue(param));

  if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }
  setParamAtTime(param, nextValue, now);
  audioParamAutomation.set(param, {
    startTime: now,
    timeline: [{ time: 0, value: nextValue, easing: "linear" }],
    normalizeValue: (automationValue) => automationValue,
  });
};

export const holdParamNow = (param, context = getAudioContext()) => {
  if (!param) return null;

  const now = context.currentTime;
  const currentValue = getCurrentParamValue(param, context);
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(now);
  } else if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }
  setParamAtTime(param, currentValue, now);
  audioParamAutomation.set(param, {
    startTime: now,
    timeline: [{ time: 0, value: currentValue, easing: "linear" }],
    normalizeValue: (value) => value,
  });
  return currentValue;
};

export const buildAudioTimeline = ({
  transition,
  currentValue,
  normalizeTransitionValue,
  denormalizeParamValue,
}) => {
  const initialAuthoredValue =
    transition.initialValue === undefined
      ? denormalizeParamValue(currentValue)
      : transition.initialValue;
  const initialValue = normalizeTransitionValue(initialAuthoredValue);
  let authoredValue = denormalizeParamValue(initialValue);
  let elapsedMs = 0;
  const timeline = [
    {
      time: 0,
      value: initialValue,
      easing: "linear",
    },
  ];

  for (const keyframe of transition.keyframes) {
    const delayMs = Math.max(0, toFiniteParamValue(keyframe.delay, 0));
    if (delayMs > 0) {
      elapsedMs += delayMs;
      timeline.push({
        time: elapsedMs,
        value: timeline[timeline.length - 1].value,
        easing: "linear",
      });
    }

    if (keyframe.startValue !== undefined) {
      const startAuthoredValue = keyframe.relative
        ? authoredValue + keyframe.startValue
        : keyframe.startValue;
      const startValue = normalizeTransitionValue(startAuthoredValue);
      authoredValue = denormalizeParamValue(startValue);
      timeline.push({
        time: elapsedMs,
        value: startValue,
        easing: "linear",
      });
    }

    elapsedMs += Math.max(0, toFiniteParamValue(keyframe.duration, 0));
    const nextAuthoredValue = keyframe.relative
      ? authoredValue + keyframe.value
      : keyframe.value;
    const nextValue = normalizeTransitionValue(nextAuthoredValue);
    authoredValue = denormalizeParamValue(nextValue);
    timeline.push({
      time: elapsedMs,
      value: nextValue,
      easing: keyframe.easing ?? "linear",
    });
  }

  return timeline;
};

const scheduleTimelineSegment = ({
  param,
  start,
  end,
  startTime,
  normalizeValue,
}) => {
  const durationMs = end.time - start.time;
  const endTime = startTime + end.time / 1000;

  if (durationMs <= 0) {
    setParamAtTime(param, end.value, endTime);
    return;
  }

  if (typeof param.linearRampToValueAtTime !== "function") {
    setParamAtTime(param, end.value, endTime);
    return;
  }

  if (end.easing === "linear") {
    param.linearRampToValueAtTime(end.value, endTime);
    return;
  }

  const easing = getEasingFunction(end.easing);
  const sampleCount = Math.min(
    AUDIO_AUTOMATION_MAX_SAMPLES,
    Math.max(1, Math.ceil(durationMs / AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS)),
  );
  for (let sample = 1; sample <= sampleCount; sample++) {
    const progress = sample / sampleCount;
    const value = normalizeValue(
      start.value + (end.value - start.value) * easing(progress),
    );
    const time = startTime + (start.time + durationMs * progress) / 1000;
    param.linearRampToValueAtTime(value, time);
  }
};

const rampParam = ({
  param,
  transition,
  normalizeTransitionValue,
  denormalizeParamValue,
  normalizeParamValue,
  context = getAudioContext(),
}) => {
  if (!param) return 0;

  const now = context.currentTime;
  const currentValue = getCurrentParamValue(param, context);
  const timeline = buildAudioTimeline({
    transition,
    currentValue,
    normalizeTransitionValue,
    denormalizeParamValue,
  });
  const hasExplicitInitialValue = transition.initialValue !== undefined;

  if (
    !hasExplicitInitialValue &&
    typeof param.cancelAndHoldAtTime === "function"
  ) {
    param.cancelAndHoldAtTime(now);
  } else if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }

  setParamAtTime(param, timeline[0].value, now);
  for (let index = 1; index < timeline.length; index++) {
    scheduleTimelineSegment({
      param,
      start: timeline[index - 1],
      end: timeline[index],
      startTime: now,
      normalizeValue: normalizeParamValue,
    });
  }

  audioParamAutomation.set(param, {
    startTime: now,
    timeline,
    normalizeValue: normalizeParamValue,
  });

  return timeline[timeline.length - 1].time;
};

export const applyDeferredTimeline = ({
  param,
  automation,
  normalizeParamValue,
  context = getAudioContext(),
}) => {
  if (!param || !automation) return 0;

  const now = context.currentTime;
  const elapsedMs = Math.max(0, (now - automation.startTime) * 1000);
  const { timeline } = automation;
  const currentValue = normalizeParamValue(
    getTimelineValueAtTime(timeline, elapsedMs),
  );

  if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }
  setParamAtTime(param, currentValue, now);

  for (let index = 1; index < timeline.length; index++) {
    const start = timeline[index - 1];
    const end = timeline[index];
    if (end.time <= elapsedMs) continue;

    const durationMs = end.time - start.time;
    const endTime = automation.startTime + end.time / 1000;
    if (
      durationMs <= 0 ||
      typeof param.linearRampToValueAtTime !== "function"
    ) {
      setParamAtTime(param, end.value, endTime);
      continue;
    }

    if (end.easing === "linear") {
      param.linearRampToValueAtTime(end.value, endTime);
      continue;
    }

    const easing = getEasingFunction(end.easing);
    const sampleCount = Math.min(
      AUDIO_AUTOMATION_MAX_SAMPLES,
      Math.max(1, Math.ceil(durationMs / AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS)),
    );
    for (let sample = 1; sample <= sampleCount; sample++) {
      const progress = sample / sampleCount;
      const sampleElapsedMs = start.time + durationMs * progress;
      if (sampleElapsedMs <= elapsedMs) continue;
      const value = normalizeParamValue(
        start.value + (end.value - start.value) * easing(progress),
      );
      param.linearRampToValueAtTime(
        value,
        automation.startTime + sampleElapsedMs / 1000,
      );
    }
  }

  audioParamAutomation.set(param, automation);
  return Math.max(0, timeline[timeline.length - 1].time - elapsedMs);
};

export const integrateTimelineRange = (
  timeline,
  startMs,
  endMs,
  normalizeValue,
) => {
  const durationMs = Math.max(0, endMs - startMs);
  if (durationMs === 0) return 0;

  const sampleCount = Math.min(
    AUDIO_AUTOMATION_MAX_SAMPLES,
    Math.max(1, Math.ceil(durationMs / AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS)),
  );
  const sampleDurationMs = durationMs / sampleCount;
  let progressSeconds = 0;
  for (let sample = 0; sample < sampleCount; sample++) {
    const sampleTimeMs = startMs + (sample + 0.5) * sampleDurationMs;
    const rate = normalizeValue(getTimelineValueAtTime(timeline, sampleTimeMs));
    progressSeconds += Math.max(0, rate) * (sampleDurationMs / 1000);
  }
  return progressSeconds;
};

export const getTimeToMediaProgressMs = (
  param,
  requiredProgressSeconds,
  context = getAudioContext(),
) => {
  if (requiredProgressSeconds <= 0) return 0;

  const automation = audioParamAutomation.get(param);
  if (!automation) {
    const rate = Math.max(0, getParamValue(param, 1));
    return rate > 0
      ? (requiredProgressSeconds / rate) * 1000
      : Number.POSITIVE_INFINITY;
  }

  const elapsedMs = Math.max(
    0,
    (context.currentTime - automation.startTime) * 1000,
  );
  const timelineEndMs =
    automation.timeline[automation.timeline.length - 1].time;
  const scheduledEndMs = Math.max(elapsedMs, timelineEndMs);
  const scheduledProgress = integrateTimelineRange(
    automation.timeline,
    elapsedMs,
    scheduledEndMs,
    automation.normalizeValue,
  );

  if (scheduledProgress >= requiredProgressSeconds) {
    let lowMs = elapsedMs;
    let highMs = scheduledEndMs;
    for (let iteration = 0; iteration < 48; iteration++) {
      const midpointMs = (lowMs + highMs) / 2;
      const progress = integrateTimelineRange(
        automation.timeline,
        elapsedMs,
        midpointMs,
        automation.normalizeValue,
      );
      if (progress >= requiredProgressSeconds) {
        highMs = midpointMs;
      } else {
        lowMs = midpointMs;
      }
    }
    return Math.max(0, highMs - elapsedMs);
  }

  const finalRate = Math.max(
    0,
    automation.normalizeValue(
      getTimelineValueAtTime(automation.timeline, timelineEndMs),
    ),
  );
  if (finalRate <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    Math.max(0, timelineEndMs - elapsedMs) +
    ((requiredProgressSeconds - scheduledProgress) / finalRate) * 1000
  );
};

export const getAudioParamValueAfterDelayMs = (
  param,
  delayMs,
  context = getAudioContext(),
) => {
  const automation = audioParamAutomation.get(param);
  if (!automation) {
    return getParamValue(param, 1);
  }

  const elapsedMs = Math.max(
    0,
    (context.currentTime - automation.startTime) * 1000 + delayMs,
  );
  return automation.normalizeValue(
    getTimelineValueAtTime(automation.timeline, elapsedMs),
  );
};

export const getAudioParamProgressAfterDelayMs = (
  param,
  delayMs,
  context = getAudioContext(),
) =>
  integrateAudioParamValue(
    param,
    context.currentTime,
    context.currentTime + Math.max(0, delayMs) / 1000,
  );

export const getAudioParamAutomationRemainingMs = (
  param,
  context = getAudioContext(),
) => {
  const automation = audioParamAutomation.get(param);
  if (!automation) return 0;

  const elapsedMs = Math.max(
    0,
    (context.currentTime - automation.startTime) * 1000,
  );
  const timelineEndMs =
    automation.timeline[automation.timeline.length - 1].time;
  return Math.max(0, timelineEndMs - elapsedMs);
};

export const hasContinuingPlaybackProgress = (param) => {
  const automation = audioParamAutomation.get(param);
  if (!automation) {
    return getParamValue(param, 1) > 0;
  }

  const timelineEndMs =
    automation.timeline[automation.timeline.length - 1].time;
  const finalRate = automation.normalizeValue(
    getTimelineValueAtTime(automation.timeline, timelineEndMs),
  );
  return finalRate > 0;
};

const applyAudioParam = ({
  param,
  targetValue,
  transition,
  normalizeTargetValue = (value) => value,
  normalizeTransitionValue = normalizeTargetValue,
  denormalizeParamValue = (value) => value,
}) => {
  if (!param) return 0;

  const normalizedTargetValue = normalizeTargetValue(targetValue);

  if (!transition) {
    setParamNow(param, normalizedTargetValue);
    return 0;
  }

  return rampParam({
    param,
    transition,
    normalizeTransitionValue,
    denormalizeParamValue,
    normalizeParamValue: normalizeTargetValue,
  });
};

export const applyVolume = ({ gainNode, targetValue, transition }) =>
  applyAudioParam({
    param: gainNode?.gain,
    targetValue,
    transition,
    normalizeTargetValue: (value) =>
      Math.max(0, Math.min(1, toFiniteParamValue(value, 1))),
    normalizeTransitionValue: (value) => normalizeVolume(value, 100),
    denormalizeParamValue: (value) => value * 100,
  });

export const applyPan = ({ pannerNode, targetValue, transition }) =>
  applyAudioParam({
    param: pannerNode?.pan,
    targetValue,
    transition,
    normalizeTargetValue: (value) =>
      Math.max(-1, Math.min(1, toFiniteParamValue(value, 0))),
  });

export const normalizePlaybackRateValue = (value) =>
  Math.max(0, toFiniteParamValue(value, 1));

export const applyPlaybackRate = ({ source, targetValue, transition }) =>
  applyAudioParam({
    param: source?.playbackRate,
    targetValue,
    transition,
    normalizeTargetValue: normalizePlaybackRateValue,
  });

export const captureActiveAudioParamAutomation = (
  param,
  { hold = false, context = getAudioContext() } = {},
) => {
  const automation = audioParamAutomation.get(param);
  if (!automation) return null;

  const elapsedMs = Math.max(
    0,
    (context.currentTime - automation.startTime) * 1000,
  );
  const timelineEndMs =
    automation.timeline[automation.timeline.length - 1].time;
  if (elapsedMs >= timelineEndMs) return null;

  if (hold) {
    holdParamNow(param, context);
  }
  return { automation, elapsedMs };
};

export const resumeAudioParamAutomation = (
  param,
  snapshot,
  context = getAudioContext(),
) => {
  if (!param || !snapshot) return null;

  const automation = {
    ...snapshot.automation,
    startTime: context.currentTime - snapshot.elapsedMs / 1000,
  };
  applyDeferredTimeline({
    param,
    automation,
    normalizeParamValue: automation.normalizeValue,
    context,
  });
  return automation;
};
