import { gsap } from "gsap";
import { describe, expect, it, vi } from "vitest";
import { SUPPORTED_EASING_NAMES } from "../../../util/animationTimeline.js";
import {
  GSAP_TIMELINE_BACKEND,
  createGsapTimelineEvaluator,
  evaluateTimelineInstance,
  getGsapEase,
  normalizeEasing,
  sampleEasing,
} from "./index.js";

const makeInstance = ({
  easing = "linear",
  from = 0,
  to = 100,
  valueType = "scalar",
  domain = {},
  segment = {},
  duration = 100,
  baseValue = from,
} = {}) => {
  const target = { value: from };
  return {
    target,
    instance: {
      instanceId: "gsap-test-instance",
      programId: "gsap-test-program",
      duration,
      unboundedRoot: false,
      domains: {
        root: {
          parent: null,
          start: 0,
          cycleDuration: 100,
          iterations: 1,
          iterationGap: 0,
          direction: "forward",
          rate: 1,
          ...domain,
        },
      },
      tracks: [
        {
          target: { handle: target, identity: "target" },
          channel: "test.value",
          baseValue,
          binding: {
            get: (handle) => handle.value,
            apply: (handle, value) => {
              handle.value = value;
            },
          },
          segments: [
            {
              id: "segment",
              domain: "root",
              start: 0,
              duration: 100,
              from,
              to,
              easing: normalizeEasing(easing),
              modifiers: [],
              composite: "replace",
              priority: 0,
              fill: "both",
              valueType,
              rootStart: 0,
              rootEnd: 100,
              ...segment,
            },
          ],
        },
      ],
      events: [],
    },
  };
};

const expectValueClose = (actual, expected, precision = 5) => {
  if (Array.isArray(expected)) {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((component, index) =>
      expect(actual[index]).toBeCloseTo(component, precision),
    );
    return;
  }
  if (typeof expected === "number") {
    expect(actual).toBeCloseTo(expected, precision);
    return;
  }
  expect(actual).toEqual(expected);
};

const sampleBoth = (evaluator, instance, time) => ({
  actual: evaluator.evaluate(time).values[0].value,
  expected: evaluateTimelineInstance(instance, time).values[0].value,
});

const easingDirections = ["in", "out", "inOut"];

const nativeEasingDescriptors = [
  { kind: "linear" },
  ...Array.from({ length: 5 }, (_unused, index) =>
    easingDirections.map((direction) => ({
      kind: "power",
      exponent: index + 1,
      direction,
    })),
  ).flat(),
  ...["sine", "expo", "circ", "bounce"].flatMap((kind) =>
    easingDirections.map((direction) => ({ kind, direction })),
  ),
  ...[0, 1.70158, 3.25].flatMap((overshoot) =>
    easingDirections.map((direction) => ({
      kind: "back",
      direction,
      overshoot,
    })),
  ),
  ...[
    [1, 0.3],
    [1.5, 0.5],
    [2.25, 0.8],
  ].flatMap(([amplitude, period]) =>
    easingDirections.map((direction) => ({
      kind: "elastic",
      direction,
      amplitude,
      period,
    })),
  ),
];

const portableFunctionEasings = [
  { kind: "steps", count: 7, position: "start" },
  { kind: "steps", count: 7, position: "end" },
  { kind: "cubicBezier", points: [0.17, 0.67, 0.83, 0.67] },
  { kind: "cubicBezier", points: [0.8, -0.5, 0.2, 1.5] },
  {
    kind: "sampled",
    samples: [
      [0, 0],
      [0.2, 0.6],
      [0.55, 0.25],
      [1, 1],
    ],
  },
];

describe("GSAP TimelineProgram evaluator", () => {
  it("uses the installed GSAP runtime behind an ms-based detached evaluator", () => {
    const { instance, target } = makeInstance({ easing: "easeOutQuad" });
    const globalChildrenBefore = gsap.globalTimeline.getChildren().length;
    const evaluator = createGsapTimelineEvaluator(instance);

    expect(GSAP_TIMELINE_BACKEND).toEqual({
      name: "gsap",
      version: gsap.version,
      timeUnit: "ms",
    });
    expect(evaluator).toMatchObject({
      backend: "gsap",
      backendVersion: gsap.version,
      timeUnit: "ms",
    });

    expect(evaluator.evaluate(50).values[0].value).toBeCloseTo(75, 12);
    expect(target.value).toBe(0);
    evaluator.apply(50);
    expect(target.value).toBeCloseTo(75, 12);
    expect(gsap.globalTimeline.getChildren().length).toBe(globalChildrenBefore);

    evaluator.destroy();
    expect(() => evaluator.evaluate(50)).toThrow(/destroyed/);
  });

  it("matches native GSAP eases in the portable reference evaluator", () => {
    for (const name of SUPPORTED_EASING_NAMES) {
      const descriptor = normalizeEasing(name);
      const gsapEase = getGsapEase(descriptor);
      for (let index = 0; index <= 100; index++) {
        const progress = index / 100;
        expect(sampleEasing(descriptor, progress)).toBeCloseTo(
          gsapEase(progress),
          12,
        );
      }
    }
  });

  it("matches parameterized native GSAP eases over dense samples", () => {
    for (const descriptor of nativeEasingDescriptors) {
      const normalized = normalizeEasing(descriptor);
      const gsapEase = getGsapEase(normalized);
      let maximumError = 0;
      for (let index = 0; index <= 1000; index++) {
        const progress = index / 1000;
        maximumError = Math.max(
          maximumError,
          Math.abs(sampleEasing(normalized, progress) - gsapEase(progress)),
        );
      }
      expect(maximumError, JSON.stringify(descriptor)).toBeLessThan(1e-11);
    }
  });

  it("runs portable function eases through real GSAP tweens", () => {
    for (const easing of portableFunctionEasings) {
      const { instance } = makeInstance({ easing });
      const evaluator = createGsapTimelineEvaluator(instance);
      for (let time = 0; time <= 100; time += 0.25) {
        const { actual, expected } = sampleBoth(evaluator, instance, time);
        expectValueClose(actual, expected);
      }
      evaluator.destroy();
    }
  });

  it("preserves GSAP overshoot and typed numeric sequence interpolation", () => {
    const scalar = makeInstance({ easing: "easeOutBack" }).instance;
    const scalarEvaluator = createGsapTimelineEvaluator(scalar);
    const gsapValue = scalarEvaluator.evaluate(50).values[0].value;
    const referenceValue = evaluateTimelineInstance(scalar, 50).values[0].value;
    expect(gsapValue).toBeGreaterThan(100);
    expect(gsapValue).toBeCloseTo(referenceValue, 12);
    scalarEvaluator.destroy();

    const sequence = makeInstance({
      from: [0, 10],
      to: [100, 30],
      valueType: "vec2",
    }).instance;
    const sequenceEvaluator = createGsapTimelineEvaluator(sequence);
    expect(sequenceEvaluator.evaluate(25).values[0].value).toEqual([25, 15]);
    expect(sequenceEvaluator.evaluate(75).values[0].value).toEqual([75, 25]);
    sequenceEvaluator.destroy();
  });

  it("keeps repeated yoyo sampling deterministic across out-of-order seeks", () => {
    const { instance } = makeInstance({
      easing: "easeInOutSine",
      domain: {
        iterations: 2,
        iterationGap: 20,
        direction: "alternate",
      },
    });
    instance.duration = 220;
    const evaluator = createGsapTimelineEvaluator(instance);

    expect(evaluator.evaluate(145).values[0].value).toBeCloseTo(
      evaluateTimelineInstance(instance, 145).values[0].value,
      6,
    );
    expect(evaluator.evaluate(25).values[0].value).toBeCloseTo(
      evaluateTimelineInstance(instance, 25).values[0].value,
      6,
    );
    expect(evaluator.evaluate(220).values[0].value).toBe(0);
    evaluator.destroy();
  });

  it.each([
    ["scalar", -125.5, 902.25],
    ["angleDegrees", -720, 1080],
    ["integer", -11, 14],
    ["vec2", new Float32Array([-2, 4]), new Float32Array([8, -16])],
    ["vec3", [0, 10, 20], [30, -20, 50]],
    ["vec4", [0, 1, 2, 3], [4, 5, 6, 7]],
    [
      "mat3",
      Array.from({ length: 9 }, (_value, index) => index),
      Array.from({ length: 9 }, (_value, index) => 20 - index),
    ],
    [
      "mat4",
      Array.from({ length: 16 }, (_value, index) => index - 8),
      Array.from({ length: 16 }, (_value, index) => index * 2),
    ],
    ["colorSrgb", [0, 0.2, 0.5, 1], [1, 0.8, 0.1, 0]],
    ["colorLinear", [0.01, 0.04, 0.16, 1], [0.8, 0.6, 0.4, 0.2]],
    ["boolean", false, true],
    ["string", "hidden", "visible"],
    ["discrete", { state: "before" }, { state: "after" }],
  ])("matches reference sampling for %s values", (valueType, from, to) => {
    const { instance } = makeInstance({
      easing: "easeInOutBack",
      from,
      to,
      valueType,
    });
    const evaluator = createGsapTimelineEvaluator(instance);
    for (const time of [100, 0, 49.9, 50, 50.1, 1, 99, 25, 75, 12.345]) {
      const { actual, expected } = sampleBoth(evaluator, instance, time);
      expectValueClose(actual, expected);
    }
    evaluator.destroy();
  });

  it("implements every fill mode at exact and adjacent boundaries", () => {
    const expectations = {
      none: [-10, -10, 0, 50, -10, -10],
      forwards: [-10, -10, 0, 50, 100, 100],
      backwards: [0, 0, 0, 50, -10, -10],
      both: [0, 0, 0, 50, 100, 100],
    };
    const times = [0, 19.999, 20, 40, 60, 100];

    for (const [fill, expectedValues] of Object.entries(expectations)) {
      const { instance } = makeInstance({
        baseValue: -10,
        segment: {
          start: 20,
          duration: 40,
          fill,
          rootStart: 20,
          rootEnd: 60,
        },
      });
      const evaluator = createGsapTimelineEvaluator(instance);
      times.forEach((time, index) => {
        expect(evaluator.evaluate(time).values[0].value).toBeCloseTo(
          expectedValues[index],
          8,
        );
      });
      evaluator.destroy();
    }
  });

  it("matches shared composition, priority, modifiers, and root trimming", () => {
    const { instance } = makeInstance();
    instance.tracks[0].baseValue = 5;
    instance.tracks[0].segments = [
      {
        ...instance.tracks[0].segments[0],
        id: "replace",
        from: 0,
        to: 103,
        modifiers: [{ kind: "round", precision: 1 }],
      },
      {
        ...instance.tracks[0].segments[0],
        id: "add",
        start: 20,
        duration: 60,
        from: 0,
        to: 27,
        composite: "add",
        priority: 1,
        modifiers: [{ kind: "snap", increment: 2.5 }],
      },
      {
        ...instance.tracks[0].segments[0],
        id: "multiply",
        start: 40,
        duration: 40,
        from: 1,
        to: 1.75,
        composite: "multiply",
        priority: 2,
        trimRootAt: 90,
      },
    ];
    const evaluator = createGsapTimelineEvaluator(instance);
    for (const time of [100, 0, 89.999, 20, 90, 40, 80, 33.3, 75, 5]) {
      const { actual, expected } = sampleBoth(evaluator, instance, time);
      expectValueClose(actual, expected);
    }
    evaluator.destroy();
  });

  it("does not amplify GSAP proxy-write rounding across a modifier boundary", () => {
    const { instance } = makeInstance({
      from: 0,
      to: 2.4699992,
      segment: {
        modifiers: [{ kind: "round", precision: 2 }],
      },
    });
    const evaluator = createGsapTimelineEvaluator(instance);

    expect(evaluateTimelineInstance(instance, 50).values[0].value).toBe(1.23);
    expect(evaluator.evaluate(50).values[0].value).toBe(1.23);
    evaluator.destroy();
  });

  it("matches nested rates, gaps, repeats, reverse, and alternate domains", () => {
    const { instance } = makeInstance({ duration: 380 });
    instance.domains = {
      root: {
        parent: null,
        start: 0,
        cycleDuration: 180,
        iterations: 2,
        iterationGap: 20,
        direction: "alternate",
        rate: 1,
      },
      child: {
        parent: "root",
        start: 20,
        cycleDuration: 100,
        iterations: 2,
        iterationGap: 10,
        direction: "reverse",
        rate: 2,
      },
    };
    instance.tracks[0].segments[0].domain = "child";
    const evaluator = createGsapTimelineEvaluator(instance);
    const seeks = [
      380, 0, 19, 20, 35, 70, 75, 125, 179, 180, 199, 200, 255, 310, 379,
    ];
    for (const time of seeks) {
      const { actual, expected } = sampleBoth(evaluator, instance, time);
      expectValueClose(actual, expected);
    }
    evaluator.destroy();
  });

  it("stays reference-equivalent across a deterministic randomized sweep", () => {
    let state = 0x9e3779b9;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const easings = [...nativeEasingDescriptors, ...portableFunctionEasings];
    const globalChildrenBefore = gsap.globalTimeline.getChildren().length;

    for (let caseIndex = 0; caseIndex < 40; caseIndex++) {
      const { instance } = makeInstance({
        from: -100 + random() * 200,
        to: -100 + random() * 200,
        easing: easings[Math.floor(random() * easings.length)],
        duration: 340,
        domain: {
          cycleDuration: 100,
          iterations: 3,
          iterationGap: Math.floor(random() * 21),
          direction: random() < 0.5 ? "forward" : "alternate",
          rate: 0.75 + random() * 1.5,
        },
      });
      const evaluator = createGsapTimelineEvaluator(instance);
      const seeks = Array.from({ length: 30 }, () => random() * 340);
      seeks.push(0, 100, 340);
      seeks.reverse();
      for (const time of seeks) {
        const { actual, expected } = sampleBoth(evaluator, instance, time);
        expectValueClose(actual, expected);
      }
      evaluator.destroy();
      evaluator.destroy();
    }

    expect(gsap.globalTimeline.getChildren().length).toBe(globalChildrenBefore);
  });

  it("rolls back partial renderer writes and closes frame hooks", () => {
    const first = { value: 1 };
    const second = { value: 2 };
    const beforeApplyFrame = vi.fn();
    const afterApplyFrame = vi.fn();
    const group = { beforeApplyFrame, afterApplyFrame };
    const { instance } = makeInstance();
    instance.tracks = [
      {
        ...instance.tracks[0],
        target: { handle: first, identity: "first" },
        binding: {
          group,
          get: (handle) => handle.value,
          apply: (handle, value) => {
            handle.value = value;
          },
        },
      },
      {
        ...instance.tracks[0],
        target: { handle: second, identity: "second" },
        binding: {
          group,
          get: (handle) => handle.value,
          apply: () => {
            throw new Error("renderer write failed");
          },
        },
      },
    ];
    const evaluator = createGsapTimelineEvaluator(instance);

    expect(() => evaluator.apply(50)).toThrow("renderer write failed");
    expect(first.value).toBe(1);
    expect(second.value).toBe(2);
    expect(beforeApplyFrame).toHaveBeenCalledTimes(1);
    expect(afterApplyFrame).toHaveBeenCalledTimes(1);
    evaluator.destroy();
  });
});
