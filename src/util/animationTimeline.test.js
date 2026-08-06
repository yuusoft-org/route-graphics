import { describe, expect, it } from "vitest";
import { buildTimeline, getValueAtTime } from "./animationTimeline.js";

describe("animationTimeline numeric arrays", () => {
  it("interpolates vector and matrix-shaped values component by component", () => {
    const timeline = buildTimeline([
      { value: [0, 2, 4], duration: 0 },
      { value: [2, 4, 8], duration: 100, easing: "linear" },
    ]);

    expect(getValueAtTime(timeline, 50)).toEqual([1, 3, 6]);
  });

  it("supports relative numeric array keyframes", () => {
    const timeline = buildTimeline([
      { value: [1, 2], duration: 0 },
      {
        value: [2, -1],
        duration: 100,
        easing: "linear",
        relative: true,
      },
    ]);

    expect(getValueAtTime(timeline, 100)).toEqual([3, 1]);
  });

  it("holds vector values before applying a delayed relative keyframe", () => {
    const timeline = buildTimeline([
      { value: [1, 2] },
      {
        value: [2, -1],
        delay: 50,
        duration: 100,
        easing: "linear",
        relative: true,
      },
    ]);

    expect(getValueAtTime(timeline, 25)).toEqual([1, 2]);
    expect(getValueAtTime(timeline, 100)).toEqual([2, 1.5]);
    expect(getValueAtTime(timeline, 150)).toEqual([3, 1]);
  });

  it("holds the preceding endpoint until a delayed absolute start value", () => {
    const timeline = buildTimeline([
      { value: 10 },
      { value: 100, duration: 100, easing: "linear" },
      {
        startValue: 0,
        value: 50,
        delay: 50,
        duration: 100,
        easing: "linear",
      },
    ]);

    expect(getValueAtTime(timeline, 149)).toBe(100);
    expect(getValueAtTime(timeline, 150)).toBe(0);
    expect(getValueAtTime(timeline, 200)).toBe(25);
    expect(getValueAtTime(timeline, 250)).toBe(50);
  });

  it("resolves relative vector starts before relative endpoints", () => {
    const timeline = buildTimeline([
      { value: [10, 20] },
      {
        startValue: [-2, 5],
        value: [4, -1],
        duration: 100,
        easing: "linear",
        relative: true,
      },
    ]);

    expect(getValueAtTime(timeline, 0)).toEqual([8, 25]);
    expect(getValueAtTime(timeline, 50)).toEqual([10, 24.5]);
    expect(getValueAtTime(timeline, 100)).toEqual([12, 24]);
  });

  it("uses the terminal value for a zero-duration explicit-start segment", () => {
    const timeline = buildTimeline([
      { value: 10 },
      { startValue: 0, value: 50, duration: 0 },
    ]);

    expect(getValueAtTime(timeline, 0)).toBe(50);
  });
});
