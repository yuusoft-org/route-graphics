import { describe, expect, it, vi } from "vitest";
import {
  appendRectPath,
  resolveRenderedCornerRadius,
} from "../../src/plugins/elements/rect/rectDrawing.js";

const createGraphicsSpy = () => {
  const graphics = {};
  for (const method of [
    "rect",
    "moveTo",
    "lineTo",
    "quadraticCurveTo",
    "closePath",
  ]) {
    graphics[method] = vi.fn(() => graphics);
  }
  return graphics;
};

describe("rect rounded geometry", () => {
  it("uses the simple rectangle path when every radius is zero", () => {
    const graphics = createGraphicsSpy();

    appendRectPath(graphics, 120, 80, 0);

    expect(graphics.rect).toHaveBeenCalledWith(0, 0, 120, 80);
    expect(graphics.moveTo).not.toHaveBeenCalled();
  });

  it("draws all four corner radii independently", () => {
    const graphics = createGraphicsSpy();

    appendRectPath(graphics, 120, 80, {
      topLeft: 4,
      topRight: 8,
      bottomRight: 12,
      bottomLeft: 16,
    });

    expect(graphics.moveTo).toHaveBeenCalledWith(4, 0);
    expect(graphics.lineTo).toHaveBeenNthCalledWith(1, 112, 0);
    expect(graphics.quadraticCurveTo).toHaveBeenNthCalledWith(
      1,
      120,
      0,
      120,
      8,
    );
    expect(graphics.quadraticCurveTo).toHaveBeenNthCalledWith(
      2,
      120,
      80,
      108,
      80,
    );
    expect(graphics.quadraticCurveTo).toHaveBeenNthCalledWith(3, 0, 80, 0, 64);
    expect(graphics.quadraticCurveTo).toHaveBeenNthCalledWith(4, 0, 0, 4, 0);
    expect(graphics.closePath).toHaveBeenCalledOnce();
  });

  it("reduces oversized adjacent radii proportionally", () => {
    expect(
      resolveRenderedCornerRadius(
        {
          topLeft: 80,
          topRight: 80,
          bottomRight: 20,
          bottomLeft: 20,
        },
        100,
        60,
      ),
    ).toEqual({
      topLeft: 48,
      topRight: 48,
      bottomRight: 12,
      bottomLeft: 12,
    });
  });

  it("clamps animated negative dimensions without producing invalid paths", () => {
    const graphics = createGraphicsSpy();

    appendRectPath(graphics, -20, Number.NaN, 12);

    expect(graphics.rect).toHaveBeenCalledWith(0, 0, 0, 0);
  });
});
