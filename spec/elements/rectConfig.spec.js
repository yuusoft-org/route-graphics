import { describe, expect, it } from "vitest";
import { parseRect } from "../../src/plugins/elements/rect/parseRect.js";

const createRect = (overrides = {}) => ({
  id: "panel",
  type: "rect",
  width: 200,
  height: 100,
  fill: "#ffffff",
  ...overrides,
});

describe("rect runtime validation", () => {
  it("accepts the complete renderer-independent rect contract", () => {
    expect(() =>
      parseRect({
        state: createRect({
          x: 10.5,
          y: 20.5,
          anchorX: 0.5,
          anchorY: 0.5,
          originX: 12,
          originY: 18,
          alpha: 0.8,
          scaleX: 1.2,
          scaleY: 0.9,
          rotation: 15,
          fill: {
            type: "linear-gradient",
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
            stops: [
              { offset: 0, color: "#ff0000" },
              { offset: 1, color: "rgba(0, 0, 255, 0.5)" },
            ],
            coordinateSpace: "local",
            resolution: 256,
            spread: "repeat",
          },
          border: { width: 2, color: "white", alpha: 0.5 },
          cornerRadius: {
            topLeft: 4,
            topRight: 8,
            bottomRight: 12,
            bottomLeft: 16,
          },
          blur: {
            x: 1,
            y: 2,
            quality: 3,
            kernelSize: 7,
            repeatEdgePixels: true,
          },
          hover: {
            cursor: "pointer",
            soundSrc: "hover.mp3",
            soundVolume: 40,
            payload: { action: "hover" },
          },
          click: { payload: { action: "click" } },
          rightClick: {
            soundSrc: "context.mp3",
            soundVolume: 25,
          },
          drag: {
            start: {},
            move: { payload: { action: "move" } },
            end: {},
          },
          scrollUp: {},
          scrollDown: { payload: { action: "down" } },
        }),
      }),
    ).not.toThrow();
  });

  it("retains latent border styling when the authored width is zero", () => {
    expect(
      parseRect({
        state: createRect({
          border: { width: 0, color: "#ff0000", alpha: 0.35 },
        }),
      }).border,
    ).toEqual({
      width: 0,
      color: "#ff0000",
      alpha: 0.35,
    });
  });

  it("normalizes an authored border with an omitted width to zero", () => {
    expect(
      parseRect({
        state: createRect({
          border: { color: "#00ff00", alpha: 0.4 },
        }),
      }).border,
    ).toEqual({
      width: 0,
      color: "#00ff00",
      alpha: 0.4,
    });
  });

  it.each([
    ["unknown root property", { mystery: true }, "rect.mystery"],
    ["missing id", { id: undefined }, "rect.id"],
    ["empty id", { id: "" }, "rect.id"],
    ["wrong type", { type: "sprite" }, "rect.type"],
    ["zero width", { width: 0 }, "rect.width"],
    ["infinite width", { width: Infinity }, "rect.width"],
    ["negative height", { height: -1 }, "rect.height"],
    ["infinite position", { x: Infinity }, "rect.x"],
    ["infinite anchor", { anchorX: -Infinity }, "rect.anchorX"],
    ["NaN rotation", { rotation: Number.NaN }, "rect.rotation"],
    ["zero scale", { scaleX: 0 }, "rect.scaleX"],
    ["infinite scale", { scaleY: Infinity }, "rect.scaleY"],
    ["out-of-range alpha", { alpha: 1.1 }, "rect.alpha"],
    ["invalid solid color", { fill: "not-a-real-color()" }, "rect.fill"],
    ["non-object border", { border: [] }, "rect.border"],
    [
      "unknown border property",
      { border: { width: 1, placement: "inside" } },
      "rect.border.placement",
    ],
    ["negative border", { border: { width: -1 } }, "rect.border.width"],
    [
      "invalid border color",
      { border: { color: "not-a-real-color()" } },
      "rect.border.color",
    ],
    ["invalid border alpha", { border: { alpha: -0.1 } }, "rect.border.alpha"],
    ["null corners", { cornerRadius: null }, "rect.cornerRadius"],
    [
      "invalid corner",
      { cornerRadius: { topLeft: -1 } },
      "rect.cornerRadius.topLeft",
    ],
    [
      "unknown corner",
      { cornerRadius: { upperLeft: 5 } },
      "rect.cornerRadius.upperLeft",
    ],
    [
      "unknown hover property",
      { hover: { opacity: 0.5 } },
      "rect.hover.opacity",
    ],
    ["non-object click", { click: true }, "rect.click"],
    [
      "unsupported click cursor",
      { click: { cursor: "pointer" } },
      "rect.click.cursor",
    ],
    ["empty sound source", { hover: { soundSrc: "" } }, "rect.hover.soundSrc"],
    ["empty cursor", { hover: { cursor: "" } }, "rect.hover.cursor"],
    [
      "non-object pointer payload",
      { click: { payload: [] } },
      "rect.click.payload",
    ],
    [
      "invalid sound volume",
      { rightClick: { soundVolume: 101 } },
      "rect.rightClick.soundVolume",
    ],
    ["empty drag", { drag: {} }, "rect.drag"],
    ["unknown drag property", { drag: { cancel: {} } }, "rect.drag.cancel"],
    ["non-object drag phase", { drag: { start: true } }, "rect.drag.start"],
    [
      "invalid drag phase",
      { drag: { move: { payload: [] } } },
      "rect.drag.move.payload",
    ],
    [
      "invalid scroll payload",
      { scrollUp: { payload: [] } },
      "rect.scrollUp.payload",
    ],
    ["non-object blur", { blur: [] }, "rect.blur"],
    [
      "unknown blur property",
      { blur: { x: 1, y: 1, radius: 2 } },
      "rect.blur.radius",
    ],
  ])("rejects %s", (_name, overrides, message) => {
    expect(() => parseRect({ state: createRect(overrides) })).toThrow(message);
  });

  it.each([
    ["null fill", null, "rect.fill must be an object"],
    [
      "unsupported type",
      { type: "mesh" },
      'rect.fill.type must be "solid", "linear-gradient", or "radial-gradient"',
    ],
    ["missing solid color", { type: "solid" }, "rect.fill.color is required"],
    [
      "unknown solid field",
      { type: "solid", color: "red", alpha: 0.5 },
      "rect.fill.alpha",
    ],
    ["missing stops", { type: "linear-gradient" }, "rect.fill.stops"],
    [
      "one stop",
      {
        type: "linear-gradient",
        stops: [{ offset: 0, color: "red" }],
      },
      "at least two stops",
    ],
    [
      "duplicate offsets",
      {
        type: "linear-gradient",
        stops: [
          { offset: 0, color: "red" },
          { offset: 0, color: "blue" },
        ],
      },
      "strictly increasing",
    ],
    [
      "descending offsets",
      {
        type: "radial-gradient",
        stops: [
          { offset: 1, color: "red" },
          { offset: 0, color: "blue" },
        ],
      },
      "strictly increasing",
    ],
    [
      "out-of-range stop",
      {
        type: "linear-gradient",
        stops: [
          { offset: -0.1, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.stops[0].offset",
    ],
    [
      "missing stop color",
      {
        type: "linear-gradient",
        stops: [{ offset: 0 }, { offset: 1, color: "blue" }],
      },
      "rect.fill.stops[0].offset and rect.fill.stops[0].color are required",
    ],
    [
      "unknown stop field",
      {
        type: "linear-gradient",
        stops: [
          { offset: 0, color: "red", midpoint: 0.5 },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.stops[0].midpoint",
    ],
    [
      "invalid stop color",
      {
        type: "linear-gradient",
        stops: [
          { offset: 0, color: "not-a-real-color()" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.stops[0].color",
    ],
    [
      "invalid point",
      {
        type: "linear-gradient",
        start: { x: 0 },
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.start.x and rect.fill.start.y",
    ],
    [
      "unknown point field",
      {
        type: "linear-gradient",
        start: { x: 0, y: 0, z: 0 },
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.start.z",
    ],
    [
      "invalid coordinate space",
      {
        type: "linear-gradient",
        coordinateSpace: "screen",
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      'rect.fill.coordinateSpace must be "local" or "global"',
    ],
    [
      "negative radial radius",
      {
        type: "radial-gradient",
        innerRadius: -1,
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.innerRadius",
    ],
    [
      "zero outer radius",
      {
        type: "radial-gradient",
        outerRadius: 0,
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.outerRadius",
    ],
    [
      "zero radial scale",
      {
        type: "radial-gradient",
        scale: 0,
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.scale",
    ],
    [
      "non-finite radial rotation",
      {
        type: "radial-gradient",
        rotation: Infinity,
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.rotation",
    ],
    [
      "invalid spread",
      {
        type: "linear-gradient",
        spread: "reflect",
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      'rect.fill.spread must be "pad" or "repeat"',
    ],
    [
      "non-positive resolution",
      {
        type: "linear-gradient",
        resolution: 0,
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "rect.fill.resolution",
    ],
    [
      "legacy textureSize",
      {
        type: "linear-gradient",
        textureSize: 128,
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "use rect.fill.resolution",
    ],
    [
      "legacy wrapMode",
      {
        type: "linear-gradient",
        wrapMode: "repeat",
        stops: [
          { offset: 0, color: "red" },
          { offset: 1, color: "blue" },
        ],
      },
      "use rect.fill.spread",
    ],
  ])("rejects a gradient with %s", (_name, fill, message) => {
    expect(() => parseRect({ state: createRect({ fill }) })).toThrow(message);
  });

  it("normalizes uniform and independent corner radii", () => {
    const uniform = parseRect({
      state: createRect({ cornerRadius: 12 }),
    });
    const independent = parseRect({
      state: createRect({
        cornerRadius: { topLeft: 4, bottomRight: 9 },
      }),
    });

    expect(uniform.cornerRadius).toEqual({
      topLeft: 12,
      topRight: 12,
      bottomRight: 12,
      bottomLeft: 12,
    });
    expect(independent.cornerRadius).toEqual({
      topLeft: 4,
      topRight: 0,
      bottomRight: 9,
      bottomLeft: 0,
    });
  });

  it("retains normalized blur instead of silently dropping it", () => {
    expect(
      parseRect({
        state: createRect({ blur: { x: 2, y: 3 } }),
      }).blur,
    ).toEqual({
      x: 2,
      y: 3,
      quality: 4,
      kernelSize: 5,
      repeatEdgePixels: false,
    });
  });
});
