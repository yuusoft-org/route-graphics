import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import { compileLegacyTweenAnimation } from "./compileLegacyTween.js";
import { bindTimelineProgram } from "./bindProgram.js";
import { evaluateTimelineInstance } from "./evaluateInstance.js";

const compile = (animation) =>
  compileLegacyTweenAnimation(normalizeAnimations([animation])[0], {
    sourcePath: "animations[0]",
  });

describe("legacy tween TimelineProgram compiler", () => {
  it("accumulates consecutive relative keyframes exactly once", () => {
    const program = compile({
      id: "relative-chain",
      targetId: "hero",
      type: "update",
      tween: {
        x: {
          keyframes: [
            { value: 10, relative: true, duration: 100, easing: "linear" },
            { value: 20, relative: true, duration: 100, easing: "linear" },
          ],
        },
      },
    });
    const target = { x: 0 };
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: { hero: { handle: target, identity: "hero" } },
      channelRegistry: {
        "transform.x": {
          get: (handle) => handle.x,
          apply: (handle, value) => {
            handle.x = value;
          },
        },
      },
    });
    const sample = (time) =>
      evaluateTimelineInstance(instance, time).values[0].value;

    expect(sample(100)).toBe(10);
    expect(sample(150)).toBe(20);
    expect(sample(200)).toBe(30);
  });

  it("jumps to delayed absolute starts and resolves relative starts in order", () => {
    const program = compile({
      id: "segment-starts",
      targetId: "hero",
      type: "update",
      tween: {
        x: {
          initialValue: 10,
          keyframes: [
            { value: 100, duration: 100, easing: "linear" },
            {
              startValue: -20,
              value: 50,
              relative: true,
              delay: 50,
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    });
    const target = { x: 0 };
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: { hero: { handle: target, identity: "hero" } },
      channelRegistry: {
        "transform.x": {
          get: (handle) => handle.x,
          apply: (handle, value) => {
            handle.x = value;
          },
        },
      },
    });
    const sample = (time) =>
      evaluateTimelineInstance(instance, time).values[0].value;

    expect(sample(149)).toBe(100);
    expect(sample(150)).toBe(80);
    expect(sample(200)).toBe(105);
    expect(sample(250)).toBe(130);
  });

  it("gives zero-duration endpoints ownership and reapplies starts on repeat/yoyo", () => {
    const zero = compile({
      id: "zero-start",
      targetId: "hero",
      type: "update",
      tween: {
        x: {
          initialValue: 10,
          keyframes: [{ startValue: 0, value: 50, duration: 0 }],
        },
      },
    });
    const repeated = compile({
      id: "repeat-start",
      targetId: "hero",
      type: "update",
      playback: { repeat: 1, yoyo: true },
      tween: {
        x: {
          initialValue: 10,
          keyframes: [
            {
              startValue: 20,
              value: 80,
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    });
    const forwardRepeated = compile({
      id: "forward-repeat-start",
      targetId: "hero",
      type: "update",
      playback: { repeat: 1 },
      tween: {
        x: {
          initialValue: 10,
          keyframes: [
            {
              startValue: 20,
              value: 80,
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    });
    const bind = (program) =>
      bindTimelineProgram(program, {
        capabilities: new Set(program.requirements),
        targetRegistry: { hero: { handle: { x: 0 }, identity: "hero" } },
        channelRegistry: {
          "transform.x": {
            get: (handle) => handle.x,
            apply: (handle, value) => {
              handle.x = value;
            },
          },
        },
      });
    const sample = (instance, time) =>
      evaluateTimelineInstance(instance, time).values[0].value;

    expect(sample(bind(zero), 0)).toBe(50);
    const repeatedInstance = bind(repeated);
    expect(sample(repeatedInstance, 0)).toBe(20);
    expect(sample(repeatedInstance, 50)).toBe(50);
    expect(sample(repeatedInstance, 100)).toBe(80);
    expect(sample(repeatedInstance, 150)).toBe(50);
    expect(sample(repeatedInstance, 200)).toBe(20);
    const forwardRepeatedInstance = bind(forwardRepeated);
    expect(sample(forwardRepeatedInstance, 99)).toBeCloseTo(79.4);
    expect(sample(forwardRepeatedInstance, 100)).toBe(20);
  });

  it("interpolates absolute color start values", () => {
    const program = compile({
      id: "color-start",
      targetId: "hero",
      type: "update",
      tween: {
        border: {
          color: {
            initialValue: "#00ff00",
            keyframes: [
              {
                startValue: "#ff0000",
                value: "#0000ff",
                duration: 100,
                easing: "linear",
              },
            ],
          },
        },
      },
    });
    const target = { color: [0, 1, 0, 1] };
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: { hero: { handle: target, identity: "hero" } },
      channelRegistry: {
        "geometry.rect.border.color": {
          valueType: "colorSrgb",
          get: (handle) => handle.color,
          apply: (handle, value) => {
            handle.color = value;
          },
        },
      },
    });
    const sample = (time) =>
      evaluateTimelineInstance(instance, time).values[0].value;

    expect(sample(0)).toEqual([1, 0, 0, 1]);
    expect(sample(50)).toEqual([0.5, 0, 0.5, 1]);
    expect(sample(100)).toEqual([0, 0, 1, 1]);
  });

  it("accumulates consecutive subject-relative keyframes from the live position", () => {
    const program = compile({
      id: "relative-translate-chain",
      targetId: "hero",
      type: "update",
      tween: {
        translateX: {
          keyframes: [
            { value: 0.25, relative: true, duration: 100, easing: "linear" },
            { value: 0.5, relative: true, duration: 100, easing: "linear" },
          ],
        },
      },
    });
    const target = { x: 40 };
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: {
        hero: {
          handle: target,
          identity: "hero",
          subject: { x: 40, width: 200 },
        },
      },
      channelRegistry: {
        "transform.x": {
          get: (handle) => handle.x,
          apply: (handle, value) => {
            handle.x = value;
          },
        },
      },
    });
    const sample = (time) =>
      evaluateTimelineInstance(instance, time).values[0].value;

    expect(sample(100)).toBe(90);
    expect(sample(150)).toBe(140);
    expect(sample(200)).toBe(190);
  });

  it("compiles parallel property chains and longest-track duration", () => {
    const program = compile({
      id: "move",
      targetId: "hero",
      type: "update",
      tween: {
        x: {
          initialValue: 10,
          keyframes: [
            { value: 20, duration: 100, easing: "easeOutQuad" },
            { value: 5, relative: true, delay: 20, duration: 50 },
          ],
        },
        alpha: {
          keyframes: [{ value: 0, duration: 80 }],
        },
      },
    });

    expect(program.duration).toBe(170);
    expect(program.domains.root.cycleDuration).toBe(170);
    expect(program.clipTemplates).toHaveLength(5);
    expect(program.clipTemplates[2]).toMatchObject({
      channel: "transform.x",
      start: 120,
      duration: 50,
      sampler: {
        to: {
          kind: "add",
          left: { kind: "underlying" },
          right: { kind: "constant", value: 5 },
        },
      },
    });
    expect(program.requirements).toEqual([
      "channel.appearance",
      "channel.transform2d",
      "target.element",
    ]);
  });

  it("canonicalizes subject-relative translation and auto destinations", () => {
    const program = compile({
      id: "translate",
      targetId: "hero",
      type: "update",
      tween: {
        translateX: {
          keyframes: [{ value: 0.5, duration: 100 }],
        },
        y: { auto: { duration: 150, delay: 10 } },
      },
    });

    expect(program.clipTemplates[0].sampler.to).toEqual({
      kind: "add",
      left: { kind: "subjectBase", axis: "x" },
      right: {
        kind: "multiply",
        left: { kind: "subjectDimension", axis: "width" },
        right: { kind: "constant", value: 0 },
      },
    });
    expect(program.clipTemplates[1].sampler.to.right.right).toEqual({
      kind: "constant",
      value: 0.5,
    });
    expect(program.clipTemplates.at(-1)).toMatchObject({
      start: 10,
      duration: 150,
      sampler: { to: { kind: "targetState", property: "y" } },
    });
  });

  it("compiles repeats, yoyo, speed, and infinite loop", () => {
    const repeated = compile({
      id: "repeat",
      targetId: "hero",
      type: "update",
      playback: {
        repeat: 2,
        repeatDelay: 20,
        yoyo: true,
        speed: 2,
      },
      tween: {
        x: { keyframes: [{ value: 10, duration: 100 }] },
      },
    });
    expect(repeated.duration).toBe(170);
    expect(repeated.domains.root).toMatchObject({
      iterations: 3,
      iterationGap: 20,
      direction: "alternate",
      rate: 2,
    });

    const infinite = compile({
      id: "loop",
      targetId: "hero",
      type: "update",
      playback: { loop: true },
      tween: {
        x: { keyframes: [{ value: 10, duration: 100 }] },
      },
    });
    expect(infinite.duration).toBe("infinite");
    expect(infinite.domains.root.iterations).toBeNull();
  });

  it("compiles filters to semantic channels", () => {
    const program = compile({
      id: "glow",
      targetId: "hero",
      type: "update",
      tween: {
        filters: {
          glow: {
            strength: {
              keyframes: [{ value: 2, duration: 100 }],
            },
          },
        },
      },
    });
    expect(program.clipTemplates[0].channel).toBe(
      "filter.glow.parameter.strength",
    );
    expect(program.requirements).toContain("channel.filterParameter");
  });
});
