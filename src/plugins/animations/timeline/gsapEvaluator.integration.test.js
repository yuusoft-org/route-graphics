import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import {
  bindTimelineProgram,
  compileLegacyTweenAnimation,
  compilePortableGsapAnimation,
  createGsapTimelineEvaluator,
  evaluateTimelineInstance,
} from "./index.js";

const propertyByChannel = {
  "appearance.alpha": "alpha",
  "transform.rotation.degrees": "rotation",
  "transform.scale.x": "scaleX",
  "transform.x": "x",
  "transform.y": "y",
};

const channelRegistry = {
  resolve: (_target, channel) => {
    const property = propertyByChannel[channel];
    if (!property) return null;
    return {
      property,
      get: (handle) => handle[property],
      apply: (handle, value) => {
        handle[property] = value;
      },
    };
  },
};

const bind = (program, targets) =>
  bindTimelineProgram(program, {
    capabilities: new Set(program.requirements),
    targetRegistry: Object.fromEntries(
      Object.entries(targets).map(([identity, handle]) => [
        identity,
        {
          handle,
          identity,
          subject: {
            x: handle.x,
            y: handle.y,
            width: 100,
            height: 50,
          },
        },
      ]),
    ),
    channelRegistry,
  });

const snapshot = (frame) =>
  Object.fromEntries(
    frame.values.map((entry) => [
      `${entry.targetIdentity}/${entry.channel}`,
      entry.value,
    ]),
  );

const expectSnapshotsClose = (actual, expected, label = "") => {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(expected)) {
    if (typeof expected[key] === "number") {
      expect(actual[key], `${key}${label}`).toBeCloseTo(expected[key], 5);
    } else {
      expect(actual[key], key).toEqual(expected[key]);
    }
  }
};

const shuffled = (values) => {
  let state = 0x243f6a88;
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

describe("compiled frontend to GSAP evaluator integration", () => {
  it("matches the pure timeline plan across a complex portable GSAP schedule", () => {
    const [animation] = normalizeAnimations([
      {
        id: "orchestrated-entrance",
        targetId: "hero",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: { cards: { elements: ["card-a", "card-b", "card-c"] } },
          defaults: { duration: 100, easing: "easeInOutSine" },
          steps: [
            { kind: "set", values: { x: -20, alpha: 0 } },
            {
              kind: "parallel",
              id: "motion",
              repeat: 1,
              repeatDelay: 15,
              yoyo: true,
              speed: 1.25,
              steps: [
                {
                  kind: "fromTo",
                  from: { x: -50 },
                  to: { x: 120 },
                  duration: 140,
                  easing: {
                    kind: "back",
                    direction: "out",
                    overshoot: 2.4,
                  },
                },
                {
                  kind: "keyframes",
                  frames: [
                    {
                      values: { y: 50 },
                      duration: 60,
                      easing: "easeOutQuad",
                    },
                    {
                      values: { y: 10 },
                      delay: 10,
                      duration: 70,
                      easing: {
                        kind: "cubicBezier",
                        points: [0.2, 0.8, 0.3, 1],
                      },
                    },
                  ],
                },
                {
                  kind: "to",
                  values: { alpha: 1 },
                  duration: 90,
                  easing: {
                    kind: "steps",
                    count: 6,
                    position: "end",
                  },
                },
                {
                  kind: "to",
                  targets: "cards",
                  values: {
                    x: {
                      expr: {
                        kind: "multiply",
                        left: { kind: "targetIndex" },
                        right: { kind: "constant", value: 30 },
                      },
                    },
                    y: { by: 35 },
                  },
                  duration: 100,
                  stagger: { each: 17, from: "center" },
                  modifiers: {
                    y: [
                      { kind: "snap", increment: 2.5 },
                      { kind: "clamp", min: -100, max: 100 },
                    ],
                  },
                },
              ],
            },
            { kind: "mark", name: "settle" },
            {
              kind: "to",
              values: { x: { by: 40 }, rotation: 45 },
              duration: 80,
              overlap: 25,
              easing: {
                kind: "sampled",
                samples: [
                  [0, 0],
                  [0.35, 0.8],
                  [0.7, 0.55],
                  [1, 1],
                ],
              },
              modifiers: {
                rotation: [{ kind: "round", precision: 2 }],
              },
            },
            {
              kind: "from",
              values: { scaleX: 0.5 },
              duration: 40,
              start: { anchor: "settle", offset: 30 },
              easing: "easeOutElastic",
            },
            { kind: "emit", event: "ready" },
          ],
        },
      },
    ]);
    const program = compilePortableGsapAnimation(animation);
    const targets = {
      hero: { x: 10, y: 20, alpha: 0.6, rotation: 5, scaleX: 1 },
      "card-a": { x: -10, y: 0, alpha: 1, rotation: 0, scaleX: 1 },
      "card-b": { x: 5, y: 10, alpha: 1, rotation: 0, scaleX: 1 },
      "card-c": { x: 20, y: 20, alpha: 1, rotation: 0, scaleX: 1 },
    };
    const instance = bind(program, targets);
    const evaluator = createGsapTimelineEvaluator(instance);
    const boundaries = new Set([0, instance.duration]);
    for (const track of instance.tracks) {
      for (const segment of track.segments) {
        for (const boundary of [
          segment.rootStart,
          segment.rootEnd,
          segment.trimRootAt,
        ]) {
          if (Number.isFinite(boundary)) {
            boundaries.add(Math.max(0, boundary - 1));
            boundaries.add(boundary);
            boundaries.add(Math.min(instance.duration, boundary + 1));
          }
        }
      }
    }
    for (let time = 0; time <= instance.duration; time += 3) {
      boundaries.add(time);
    }

    for (const time of shuffled([...boundaries])) {
      expectSnapshotsClose(
        snapshot(evaluator.evaluate(time)),
        snapshot(evaluateTimelineInstance(instance, time)),
        ` at ${time}ms`,
      );
    }
    evaluator.destroy();
  });

  it("rebuilds GSAP samplers deterministically for repeatRefresh values", () => {
    const [animation] = normalizeAnimations([
      {
        id: "refresh-relative-value",
        targetId: "hero",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { x: { by: 10 } },
              duration: 100,
              repeat: 2,
              repeatRefresh: true,
            },
          ],
        },
      },
    ]);
    const program = compilePortableGsapAnimation(animation);
    const instance = bind(program, {
      hero: { x: 0, y: 0, alpha: 1, rotation: 0, scaleX: 1 },
    });
    const evaluator = createGsapTimelineEvaluator(instance);
    const expectedByTime = new Map([
      [0, 0],
      [50, 5],
      [100, 10],
      [150, 15],
      [200, 20],
      [250, 25],
      [300, 30],
    ]);

    for (const time of [250, 50, 150, 300, 0, 200, 100, 250]) {
      expect(evaluator.evaluate(time).values[0].value).toBeCloseTo(
        expectedByTime.get(time),
        8,
      );
    }
    evaluator.destroy();
  });

  it("executes the compact tween frontend through the same GSAP backend", () => {
    const [animation] = normalizeAnimations([
      {
        id: "compact-tween",
        targetId: "hero",
        type: "update",
        playback: { repeat: 1, repeatDelay: 25, yoyo: true, speed: 1.5 },
        tween: {
          x: {
            initialValue: -20,
            keyframes: [
              { value: 80, duration: 90, easing: "easeOutBack" },
              { value: 20, delay: 15, duration: 60, easing: "easeInOutSine" },
            ],
          },
          alpha: {
            initialValue: 0,
            keyframes: [{ value: 1, duration: 120, easing: "easeOutExpo" }],
          },
        },
      },
    ]);
    const program = compileLegacyTweenAnimation(animation);
    const instance = bind(program, {
      hero: { x: 10, y: 0, alpha: 0.4, rotation: 0, scaleX: 1 },
    });
    const evaluator = createGsapTimelineEvaluator(instance);
    const times = shuffled([
      0,
      instance.duration,
      ...Array.from(
        { length: 101 },
        (_unused, index) => (instance.duration * index) / 100,
      ),
    ]);

    for (const time of times) {
      expectSnapshotsClose(
        snapshot(evaluator.evaluate(time)),
        snapshot(evaluateTimelineInstance(instance, time)),
      );
    }
    evaluator.destroy();
  });
});
