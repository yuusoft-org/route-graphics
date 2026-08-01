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
    mask: { values: { "transition.mask.progress": 0 } },
    compositor: { values: { "transition.compositor.progress": 0 } },
  };
  return bindTimelineProgram(program, {
    capabilities: new Set(program.requirements),
    transitionTargets: Object.fromEntries(
      Object.entries(targets).map(([key, handle]) => [
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
        mask: {
          kind: "single",
          texture: "mask.png",
          progress: {
            initialValue: 0,
            keyframes: [{ value: 1, duration: 100, easing: "linear" }],
          },
        },
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
});
