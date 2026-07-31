import { describe, expect, it } from "vitest";
import {
  SUPPORTED_EASING_NAMES,
  buildTimeline,
  calculateMaxDuration,
  getEasingFunction,
  getValueAtTime,
} from "../../src/util/animationTimeline.js";

describe("animationTimeline easings", () => {
  it("resolves all supported easing names", () => {
    for (const easingName of SUPPORTED_EASING_NAMES) {
      expect(getEasingFunction(easingName)).toEqual(expect.any(Function));
    }
  });

  it("supports the quad easing family", () => {
    const sample = 0.37;

    expect(getEasingFunction("easeInQuad")(sample)).toBeCloseTo(
      sample * sample,
    );
    expect(getEasingFunction("easeOutQuad")(sample)).toBeCloseTo(
      1 - (1 - sample) * (1 - sample),
    );
    expect(getEasingFunction("easeInOutQuad")(sample)).toBeCloseTo(
      sample < 0.5 ? 2 * sample * sample : 1 - Math.pow(-2 * sample + 2, 2) / 2,
    );
  });

  it("supports representative advanced easing families", () => {
    expect(getEasingFunction("easeInCubic")(0.5)).toBeCloseTo(0.125);
    expect(getEasingFunction("easeOutSine")(0.5)).toBeCloseTo(
      Math.sin(Math.PI / 4),
    );
    expect(getEasingFunction("easeOutBounce")(0.5)).toBeGreaterThan(0.7);
    expect(getEasingFunction("easeInOutElastic")(0)).toBe(0);
    expect(getEasingFunction("easeInOutElastic")(1)).toBe(1);
  });

  it("applies the easing from the keyframe being reached", () => {
    const timeline = buildTimeline([
      { value: 0 },
      { duration: 1000, value: 100, easing: "easeInQuad" },
    ]);

    expect(getValueAtTime(timeline, 500)).toBeCloseTo(25);
  });

  it("does not shift later keyframe easings onto following segments", () => {
    const timeline = buildTimeline([
      { value: 0 },
      { duration: 1000, value: 100, easing: "easeInQuad" },
      { duration: 1000, value: 200, easing: "easeOutQuad" },
    ]);

    expect(getValueAtTime(timeline, 500)).toBeCloseTo(25);
    expect(getValueAtTime(timeline, 1500)).toBeCloseTo(175);
  });

  it("holds the previous value during first and subsequent keyframe delays", () => {
    const timeline = buildTimeline([
      { value: 0 },
      {
        delay: 200,
        duration: 400,
        value: 100,
        easing: "linear",
      },
      {
        delay: 300,
        duration: 100,
        value: 200,
        easing: "linear",
      },
    ]);

    expect(timeline).toEqual([
      { time: 0, value: 0, easing: "linear" },
      { time: 200, value: 0, easing: "linear" },
      { time: 600, value: 100, easing: "linear" },
      { time: 900, value: 100, easing: "linear" },
      { time: 1000, value: 200, easing: "linear" },
    ]);
    expect(getValueAtTime(timeline, 100)).toBe(0);
    expect(getValueAtTime(timeline, 400)).toBeCloseTo(50);
    expect(getValueAtTime(timeline, 750)).toBe(100);
    expect(getValueAtTime(timeline, 950)).toBeCloseTo(150);
    expect(calculateMaxDuration([{ timeline }])).toBe(1000);
  });

  it("does not add a hold point for an omitted or zero delay", () => {
    const timeline = buildTimeline([
      { value: 0 },
      { delay: 0, duration: 100, value: 1 },
      { duration: 100, value: 2 },
    ]);

    expect(timeline.map(({ time, value }) => ({ time, value }))).toEqual([
      { time: 0, value: 0 },
      { time: 100, value: 1 },
      { time: 200, value: 2 },
    ]);
  });

  it("starts easing only after the delay boundary", () => {
    const timeline = buildTimeline([
      { value: 10 },
      {
        delay: 200,
        duration: 400,
        value: 110,
        easing: "easeInQuad",
      },
    ]);

    expect(getValueAtTime(timeline, 199.999)).toBe(10);
    expect(getValueAtTime(timeline, 200)).toBe(10);
    expect(getValueAtTime(timeline, 300)).toBeCloseTo(16.25);
    expect(getValueAtTime(timeline, 600)).toBe(110);
  });

  it("resolves a delayed zero-duration step at its boundary", () => {
    const timeline = buildTimeline([
      { value: 0 },
      { delay: 250, duration: 0, value: 1 },
      { duration: 250, value: 2, easing: "linear" },
    ]);

    expect(calculateMaxDuration([{ timeline }])).toBe(500);
    expect(getValueAtTime(timeline, 249.999)).toBe(0);
    expect(getValueAtTime(timeline, 250)).toBe(1);
    expect(getValueAtTime(timeline, 375)).toBeCloseTo(1.5);
  });

  it("resolves consecutive zero-duration steps to the last value at a timestamp", () => {
    const timeline = buildTimeline([
      { value: 0 },
      { delay: 250, duration: 0, value: 1 },
      { duration: 0, value: 2 },
      { duration: 250, value: 3, easing: "linear" },
    ]);

    expect(getValueAtTime(timeline, 249.999)).toBe(0);
    expect(getValueAtTime(timeline, 250)).toBe(2);
    expect(getValueAtTime(timeline, 375)).toBeCloseTo(2.5);
  });

  it("resolves zero-duration steps at the initial timestamp", () => {
    const timeline = buildTimeline([
      { value: 0 },
      { duration: 0, value: 1 },
      { duration: 100, value: 2, easing: "linear" },
    ]);

    expect(getValueAtTime(timeline, 0)).toBe(1);
    expect(getValueAtTime(timeline, 50)).toBeCloseTo(1.5);
  });
});
