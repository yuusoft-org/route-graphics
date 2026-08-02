import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import {
  bindTimelineProgram,
  compileLegacyTransitionAnimation,
  createGsapTimelineEvaluator,
  evaluateTimelineInstance,
} from "./index.js";

const bindVirtualTransition = (program) => {
  const targets = {
    prev: { values: { "transform.x": 10, "appearance.alpha": 1 } },
    next: { values: { "transform.x": 0, "appearance.alpha": 1 } },
    mask: [
      { values: { "transition.mask.progress": 0 } },
      { values: { "transition.mask.progress": 0 } },
    ],
    compositor: { values: { "transition.compositor.progress": 0 } },
  };
  return bindTimelineProgram(program, {
    capabilities: new Set(program.requirements),
    transitionTargets: {
      ...Object.fromEntries(
        Object.entries(targets)
          .filter(([key]) => key !== "mask")
          .map(([key, handle]) => [
            key,
            {
              handle,
              identity: `transition:${key}`,
              subject: {
                x: handle.values["transform.x"] ?? 0,
                y: 0,
                width: 100,
                height: 50,
              },
            },
          ]),
      ),
      mask: targets.mask.map((handle, index) => ({
        handle,
        identity: `transition:mask:${index}`,
        subject: { x: 0, y: 0, width: 100, height: 50 },
      })),
    },
    channelRegistry: {
      resolve: (target, channel) => ({
        get: () => target.handle.values[channel] ?? 0,
        apply: () => {},
      }),
    },
  });
};

describe("legacy transition compiler", () => {
  it("compiles surfaces, mask, and compositor into one program", () => {
    const [animation] = normalizeAnimations([
      {
        id: "handoff",
        targetId: "scene",
        type: "transition",
        prev: {
          tween: {
            translateX: {
              initialValue: 0,
              keyframes: [{ value: -1, duration: 100, easing: "linear" }],
            },
          },
        },
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ value: 1, duration: 100, easing: "linear" }],
            },
          },
        },
        mask: [
          {
            kind: "single",
            texture: "mask.png",
            progress: {
              initialValue: 0,
              keyframes: [{ value: 1, duration: 100, easing: "linear" }],
            },
          },
        ],
        compositor: {
          type: "shader",
          source: {
            webgl: { fragment: "void main(){}" },
            webgpu: {
              source:
                "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(); } @fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(); }",
            },
          },
          tween: {
            progress: {
              initialValue: 0,
              keyframes: [{ value: 1, duration: 100, easing: "linear" }],
            },
          },
        },
      },
    ]);
    const program = compileLegacyTransitionAnimation(animation);
    const instance = bindVirtualTransition(program);
    const evaluator = createGsapTimelineEvaluator(instance);
    const halfway = Object.fromEntries(
      evaluator.evaluate(50).values.map((item) => [item.channel, item.value]),
    );
    expect(instance.duration).toBe(100);
    expect(halfway["transition.mask.progress"]).toBe(0.5);
    expect(halfway["transition.compositor.progress"]).toBe(0.5);
    expect(halfway["transform.x"]).toBe(-40);
    expect(halfway).toEqual(
      Object.fromEntries(
        evaluateTimelineInstance(instance, 50).values.map((item) => [
          item.channel,
          item.value,
        ]),
      ),
    );
    evaluator.destroy();
  });

  it("keeps resource-only transitions as a zero-duration program", () => {
    const program = compileLegacyTransitionAnimation({
      id: "plain",
      targetId: "scene",
      type: "transition",
    });
    expect(program.domains.root.cycleDuration).toBe(0);
  });

  it("compiles each mask into an independently indexed timeline target", () => {
    const [animation] = normalizeAnimations([
      {
        id: "two-masks",
        targetId: "scene",
        type: "transition",
        mask: [
          {
            kind: "single",
            texture: "left.png",
            progress: {
              initialValue: 0,
              keyframes: [{ value: 1, duration: 100, easing: "linear" }],
            },
          },
          {
            kind: "single",
            texture: "right.png",
            delay: 50,
            progress: {
              initialValue: 0,
              keyframes: [{ value: 1, duration: 200, easing: "linear" }],
            },
          },
        ],
      },
    ]);
    const program = compileLegacyTransitionAnimation(animation);
    const instance = bindVirtualTransition(program);
    const evaluator = createGsapTimelineEvaluator(instance);
    const valuesAt = (time) =>
      Object.fromEntries(
        evaluator
          .evaluate(time)
          .values.map(({ targetIdentity, value }) => [targetIdentity, value]),
      );

    expect(instance.duration).toBe(250);
    expect(program.targetQueries).toMatchObject({
      "mask-0": { kind: "transitionMask", index: 0 },
      "mask-1": { kind: "transitionMask", index: 1 },
    });
    expect(valuesAt(25)).toMatchObject({
      "transition:mask:0": 0.25,
      "transition:mask:1": 0,
    });
    expect(valuesAt(150)).toMatchObject({
      "transition:mask:0": 1,
      "transition:mask:1": 0.5,
    });
    evaluator.destroy();
  });

  it("starts mask progress after mask delay and any progress hold", () => {
    const [animation] = normalizeAnimations([
      {
        id: "delayed-mask",
        targetId: "scene",
        type: "transition",
        mask: [
          {
            kind: "single",
            texture: "mask.png",
            delay: 200,
            progress: {
              initialValue: 0,
              keyframes: [
                { value: 1, delay: 50, duration: 100, easing: "linear" },
              ],
            },
          },
        ],
      },
    ]);
    const program = compileLegacyTransitionAnimation(animation);
    const instance = bindVirtualTransition(program);
    const evaluator = createGsapTimelineEvaluator(instance);
    const sample = (time) =>
      evaluator
        .evaluate(time)
        .values.find(({ channel }) => channel === "transition.mask.progress")
        ?.value;

    expect(instance.duration).toBe(350);
    expect(sample(249)).toBe(0);
    expect(sample(300)).toBeCloseTo(0.5);
    expect(animation.mask[0].progress.keyframes[0].delay).toBe(50);
    evaluator.destroy();
  });
});
