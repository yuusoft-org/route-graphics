import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import {
  bindTimelineProgram,
  collectTimelineEventCrossings,
  compilePortableGsapAnimation,
  createGsapTimelineEvaluator,
  evaluateTimelineInstance,
} from "./index.js";

const bind = (steps, playback) => {
  const [animation] = normalizeAnimations([
    {
      id: "motion",
      targetId: "box",
      type: "update",
      playback,
      gsap: { profile: "portable-v1", steps },
    },
  ]);
  const program = compilePortableGsapAnimation(animation);
  return bindTimelineProgram(program, {
    capabilities: new Set(program.requirements),
    targetRegistry: { box: { identity: "box", handle: { x: 0, y: 0 } } },
    channelRegistry: {
      resolve: (_target, channel) => {
        const property = channel === "transform.x" ? "x" : "y";
        return {
          get: (target) => target[property],
          apply: (target, value) => {
            target[property] = value;
          },
        };
      },
    },
  });
};

const values = (frame) =>
  Object.fromEntries(
    frame.values.map(({ channel, value }) => [channel, value]),
  );

describe("timeline composition regressions", () => {
  it("preserves sibling properties while overwrite:all cancels older actions", () => {
    const instance = bind([
      { kind: "to", values: { x: 20, y: 20 }, duration: 20 },
      {
        kind: "to",
        values: { x: 100, y: 100 },
        duration: 100,
        overwrite: "all",
      },
    ]);
    const evaluator = createGsapTimelineEvaluator(instance);
    try {
      for (const frame of [
        evaluateTimelineInstance(instance, 70),
        evaluator.evaluate(70),
      ]) {
        expect(values(frame)).toEqual({ "transform.x": 60, "transform.y": 60 });
      }
    } finally {
      evaluator.destroy();
    }
  });

  it("replays earlier steps on the return leg, including out-of-order seeks", () => {
    const instance = bind(
      [
        { kind: "to", values: { x: 10 }, duration: 100 },
        { kind: "to", values: { x: 20 }, duration: 100 },
      ],
      { repeat: 1, yoyo: true },
    );
    const evaluator = createGsapTimelineEvaluator(instance);
    try {
      for (const [time, expected] of [
        [350, 5],
        [250, 15],
        [50, 5],
        [400, 0],
        [300, 10],
      ]) {
        expect(
          values(evaluateTimelineInstance(instance, time))["transform.x"],
        ).toBeCloseTo(expected);
        expect(values(evaluator.evaluate(time))["transform.x"]).toBeCloseTo(
          expected,
        );
      }
    } finally {
      evaluator.destroy();
    }
  });

  it("delivers events in an infinite descendant at early and late crossings", () => {
    const instance = bind([
      {
        kind: "sequence",
        repeat: "infinite",
        steps: [
          { kind: "wait", duration: 5 },
          {
            kind: "emit",
            event: "pulse",
            occurrence: "eachIteration",
            direction: "both",
          },
          { kind: "wait", duration: 5 },
        ],
      },
    ]);
    expect(
      collectTimelineEventCrossings(instance, 0, 35).map((e) => e.resolvedTime),
    ).toEqual([5, 15, 25, 35]);
    expect(
      collectTimelineEventCrossings(instance, 35, 0).map((e) => e.resolvedTime),
    ).toEqual([25, 15, 5]);
    expect(
      collectTimelineEventCrossings(instance, 1_000_000, 1_000_006).map(
        (e) => e.resolvedTime,
      ),
    ).toEqual([1_000_005]);
  });

  it("seeks directly to the last permitted repeat-refresh iteration", () => {
    const instance = bind([
      {
        kind: "to",
        values: { x: { by: 1 } },
        duration: 1,
        repeat: 9999,
        repeatRefresh: true,
      },
    ]);
    expect(
      values(evaluateTimelineInstance(instance, 9999.5))["transform.x"],
    ).toBeCloseTo(9999.5);
    expect(
      values(evaluateTimelineInstance(instance, 10000))["transform.x"],
    ).toBe(10000);
    expect(values(evaluateTimelineInstance(instance, 0.5))["transform.x"]).toBe(
      0.5,
    );
  });

  it("checks many disjoint repeated intervals without quadratic pair comparisons", () => {
    expect(() =>
      bind([
        {
          kind: "parallel",
          steps: [
            {
              kind: "to",
              values: { x: 1 },
              duration: 1,
              repeat: 9999,
              repeatDelay: 1,
              overwrite: "error",
            },
            {
              kind: "to",
              values: { x: 2 },
              duration: 1,
              repeat: 9999,
              repeatDelay: 1,
              start: { time: 1 },
              overwrite: "error",
            },
          ],
        },
      ]),
    ).not.toThrow();
  });
});
