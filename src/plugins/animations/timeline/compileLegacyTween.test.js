import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import { compileLegacyTweenAnimation } from "./compileLegacyTween.js";

const compile = (animation) =>
  compileLegacyTweenAnimation(normalizeAnimations([animation])[0], {
    sourcePath: "animations[0]",
  });

describe("legacy tween TimelineProgram compiler", () => {
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
          left: { kind: "constant", value: 20 },
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
