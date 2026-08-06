import { describe, expect, it } from "vitest";
import { parseTextRevealing } from "../../src/plugins/elements/text-revealing/parseTextRevealing.js";

const createState = (overrides = {}) => ({
  id: "scaled-line",
  type: "text-revealing",
  x: 300,
  y: 180,
  width: 100,
  anchorX: 0.5,
  anchorY: 0.5,
  content: [
    {
      text: "Asymmetric line",
      textStyle: {
        fontFamily: "Arial",
        fontSize: 20,
      },
    },
  ],
  revealEffect: "none",
  ...overrides,
});

describe("parseTextRevealing scale", () => {
  it("preserves scaled layout dimensions and signed anchor origins", () => {
    const unscaled = parseTextRevealing({ state: createState() });
    const scaled = parseTextRevealing({
      state: createState({ scaleX: -2, scaleY: 1.5 }),
    });

    expect(scaled.width).toBe(200);
    expect(scaled.height).toBe(Math.round(unscaled.height * 1.5));
    expect(scaled.scaleX).toBe(-2);
    expect(scaled.scaleY).toBe(1.5);
    expect(scaled.originX).toBe(-100);
    expect(scaled.x + scaled.originX).toBe(300);
  });

  it("keeps the authored width only as the local wrapping width", () => {
    const unscaled = parseTextRevealing({ state: createState() });
    const scaled = parseTextRevealing({
      state: createState({ scaleX: 2.25 }),
    });

    expect(scaled.width).toBe(225);
    expect(scaled.scaleX).toBe(2.25);
    expect(scaled.content).toEqual(unscaled.content);
  });
});
