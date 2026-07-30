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
});
