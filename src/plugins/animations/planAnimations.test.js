import { describe, expect, it } from "vitest";
import { getAnimationContinuitySignature } from "./planAnimations.js";

describe("getAnimationContinuitySignature", () => {
  it("includes compositor and transition uProgress tween in transition signatures", () => {
    const base = {
      id: "flip",
      targetId: "scene",
      type: "transition",
      playback: {
        continuity: "persistent",
      },
      compositor: {
        type: "shader",
        uniforms: [{ key: "amount", symbol: "uAmount", type: "f32", value: 1 }],
      },
      tween: {
        uProgress: {
          keyframes: [{ duration: 500, value: 1, easing: "linear" }],
        },
      },
    };

    expect(getAnimationContinuitySignature(base)).not.toBe(
      getAnimationContinuitySignature({
        ...base,
        tween: {
          uProgress: {
            keyframes: [{ duration: 900, value: 1, easing: "linear" }],
          },
        },
      }),
    );

    expect(getAnimationContinuitySignature(base)).not.toBe(
      getAnimationContinuitySignature({
        ...base,
        compositor: {
          ...base.compositor,
          uniforms: [
            { key: "amount", symbol: "uAmount", type: "f32", value: 0.5 },
          ],
        },
      }),
    );
  });

  it("includes playback speed in persistent signatures", () => {
    const base = {
      id: "slide",
      targetId: "portrait",
      type: "update",
      playback: {
        continuity: "persistent",
        speed: 1,
      },
      tween: {
        x: {
          keyframes: [{ duration: 1000, value: 400, easing: "linear" }],
        },
      },
    };

    expect(getAnimationContinuitySignature(base)).not.toBe(
      getAnimationContinuitySignature({
        ...base,
        playback: {
          continuity: "persistent",
          speed: 2,
        },
      }),
    );
  });

  it("includes playback loop in persistent signatures", () => {
    const base = {
      id: "pulse",
      targetId: "portrait",
      type: "update",
      playback: {
        continuity: "persistent",
      },
      tween: {
        scaleX: {
          keyframes: [{ duration: 1000, value: 1.1, easing: "linear" }],
        },
      },
    };

    expect(getAnimationContinuitySignature(base)).not.toBe(
      getAnimationContinuitySignature({
        ...base,
        playback: {
          continuity: "persistent",
          loop: true,
        },
      }),
    );
  });
});
