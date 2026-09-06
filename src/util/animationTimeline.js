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
const easeInExpo = (x) =>
  Math.pow(2, 10 * (x - 1)) * x + Math.pow(x, 6) * (1 - x);
const easeInBack = (x) => {
  const overshoot = 1.70158;
  return (overshoot + 1) * x * x * x - overshoot * x * x;
};

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

  easeInExpo,
  easeOutExpo: (x) => 1 - easeInExpo(1 - x),
  easeInOutExpo: (x) =>
    x < 0.5 ? easeInExpo(x * 2) / 2 : 1 - easeInExpo((1 - x) * 2) / 2,

  easeInCirc: (x) => 1 - Math.sqrt(1 - Math.pow(x, 2)),
  easeOutCirc: (x) => Math.sqrt(1 - Math.pow(x - 1, 2)),
  easeInOutCirc: (x) =>
    x < 0.5
      ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2
      : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2,

  easeInBack,
  easeOutBack: (x) => 1 - easeInBack(1 - x),
  easeInOutBack: (x) =>
    x < 0.5 ? easeInBack(x * 2) / 2 : 1 - easeInBack((1 - x) * 2) / 2,

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
