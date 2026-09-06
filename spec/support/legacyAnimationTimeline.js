import { getEasingFunction } from "../../src/util/animationTimeline.js";

const isNumericSequence = (value) =>
  Array.isArray(value) || ArrayBuffer.isView(value);

const addTweenValues = (left, right) => {
  if (!isNumericSequence(left) && !isNumericSequence(right)) {
    return left + right;
  }

  if (
    !isNumericSequence(left) ||
    !isNumericSequence(right) ||
    left.length !== right.length
  ) {
    throw new Error("Relative tween values must have matching numeric shapes.");
  }

  return Array.from(left, (value, index) => value + right[index]);
};

const interpolateTweenValues = (start, end, amount) => {
  if (!isNumericSequence(start) && !isNumericSequence(end)) {
    return start + (end - start) * amount;
  }

  if (
    !isNumericSequence(start) ||
    !isNumericSequence(end) ||
    start.length !== end.length
  ) {
    throw new Error("Tween keyframe values must have matching numeric shapes.");
  }

  return Array.from(
    start,
    (value, index) => value + (end[index] - value) * amount,
  );
};

export const buildTimeline = (keyframesInput) => {
  const timeline = [];
  let accumulatedTime = 0;
  let latestValue;

  keyframesInput.forEach(
    (
      { value, startValue, delay = 0, duration, easing = "linear", relative },
      index,
    ) => {
      if (index === 0) {
        latestValue = value;
        timeline.push({ time: accumulatedTime, value, easing: "linear" });
        return;
      }

      if (duration === undefined) {
        return;
      }

      if (delay > 0) {
        accumulatedTime += delay;
        timeline.push({
          time: accumulatedTime,
          value: latestValue,
          easing: "linear",
        });
      }

      if (startValue !== undefined) {
        latestValue = relative
          ? addTweenValues(latestValue, startValue)
          : startValue;
        timeline.push({
          time: accumulatedTime,
          value: latestValue,
          easing: "linear",
        });
      }

      accumulatedTime += duration;
      latestValue = relative ? addTweenValues(latestValue, value) : value;
      timeline.push({ time: accumulatedTime, value: latestValue, easing });
    },
  );

  return timeline;
};

export const calculateMaxDuration = (timelines) => {
  let max = 0;

  for (const { timeline } of timelines) {
    const lastKeyframe = timeline[timeline.length - 1];
    if (lastKeyframe && lastKeyframe.time > max) {
      max = lastKeyframe.time;
    }
  }

  return max;
};

export const getValueAtTime = (timeline, currentTime) => {
  if (timeline.length === 0) return 0;
  if (currentTime < timeline[0].time) return timeline[0].value;
  if (currentTime >= timeline[timeline.length - 1].time) {
    return timeline[timeline.length - 1].value;
  }

  for (let i = 0; i < timeline.length - 1; i++) {
    const { time: startTime, value: startValue } = timeline[i];
    const { time: endTime, value: endValue, easing } = timeline[i + 1];

    if (currentTime >= startTime && currentTime < endTime) {
      const t = (currentTime - startTime) / (endTime - startTime);
      return interpolateTweenValues(
        startValue,
        endValue,
        getEasingFunction(easing)(t),
      );
    }
  }

  return timeline[timeline.length - 1].value;
};
