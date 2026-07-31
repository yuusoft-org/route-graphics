const bounceOut = (x) => {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (x < 1 / d1) {
    return n1 * x * x;
  }

  if (x < 2 / d1) {
    return n1 * (x -= 1.5 / d1) * x + 0.75;
  }

  if (x < 2.5 / d1) {
    return n1 * (x -= 2.25 / d1) * x + 0.9375;
  }

  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

const linear = (x) => x;
const easeInQuad = (x) => x * x;
const easeOutQuad = (x) => 1 - (1 - x) * (1 - x);
const easeInOutQuad = (x) =>
  x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

const easings = Object.freeze({
  linear,
  easeInQuad: easeInQuad,
  easeOutQuad: easeOutQuad,
  easeInOutQuad: easeInOutQuad,

  easeInCubic: (x) => x * x * x,
  easeOutCubic: (x) => 1 - Math.pow(1 - x, 3),
  easeInOutCubic: (x) =>
    x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,

  easeInQuart: (x) => x * x * x * x,
  easeOutQuart: (x) => 1 - Math.pow(1 - x, 4),
  easeInOutQuart: (x) =>
    x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2,

  easeInQuint: (x) => x * x * x * x * x,
  easeOutQuint: (x) => 1 - Math.pow(1 - x, 5),
  easeInOutQuint: (x) =>
    x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2,

  easeInSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  easeOutSine: (x) => Math.sin((x * Math.PI) / 2),
  easeInOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,

  easeInExpo: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  easeOutExpo: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  easeInOutExpo: (x) => {
    if (x === 0) return 0;
    if (x === 1) return 1;
    return x < 0.5
      ? Math.pow(2, 20 * x - 10) / 2
      : (2 - Math.pow(2, -20 * x + 10)) / 2;
  },

  easeInCirc: (x) => 1 - Math.sqrt(1 - Math.pow(x, 2)),
  easeOutCirc: (x) => Math.sqrt(1 - Math.pow(x - 1, 2)),
  easeInOutCirc: (x) =>
    x < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2,

  easeInBack: (x) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * x * x * x - c1 * x * x;
  },
  easeOutBack: (x) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  easeInOutBack: (x) => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    return x < 0.5
      ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2
      : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2;
  },

  easeInBounce: (x) => 1 - bounceOut(1 - x),
  easeOutBounce: bounceOut,
  easeInOutBounce: (x) =>
    x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2,

  easeInElastic: (x) => {
    const c4 = (2 * Math.PI) / 3;
    if (x === 0) return 0;
    if (x === 1) return 1;
    return -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * c4);
  },
  easeOutElastic: (x) => {
    const c4 = (2 * Math.PI) / 3;
    if (x === 0) return 0;
    if (x === 1) return 1;
    return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1;
  },
  easeInOutElastic: (x) => {
    const c5 = (2 * Math.PI) / 4.5;
    if (x === 0) return 0;
    if (x === 1) return 1;
    return x < 0.5
      ? -(Math.pow(2, 20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1;
  },
});

export const SUPPORTED_EASING_NAMES = Object.freeze(Object.keys(easings));

export const getEasingFunction = (name = "linear") => {
  const easing = easings[name];

  if (!easing) {
    throw new Error(`Unsupported easing: ${name}`);
  }

  return easing;
};

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
    ({ value, delay = 0, duration, easing = "linear", relative }, index) => {
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
  if (currentTime <= timeline[0].time) return timeline[0].value;
  if (currentTime >= timeline[timeline.length - 1].time) {
    return timeline[timeline.length - 1].value;
  }

  for (let i = 0; i < timeline.length - 1; i++) {
    const { time: startTime, value: startValue } = timeline[i];
    const { time: endTime, value: endValue, easing } = timeline[i + 1];

    if (currentTime >= startTime && currentTime <= endTime) {
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
