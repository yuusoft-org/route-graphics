import { describe, expect, it } from "vitest";
import { parseContainerForTesting } from "../support/parseContainer.js";
import { parseRect } from "../../src/plugins/elements/rect/parseRect.js";
import { parseSprite } from "../../src/plugins/elements/sprite/parseSprite.js";
import { parseCommonObject } from "../../src/plugins/elements/util/parseCommonObject.js";

const commonState = (overrides = {}) => ({
  id: "subject",
  type: "sprite",
  x: 200,
  y: 100,
  width: 80,
  height: 50,
  ...overrides,
});

describe("negative scale parsing", () => {
  it("keeps scaled dimensions positive and derives signed anchor origins", () => {
    const result = parseCommonObject(
      commonState({
        anchorX: 0.25,
        anchorY: 0.5,
        scaleX: -1.5,
        scaleY: -2,
      }),
    );

    expect(result).toMatchObject({
      width: 120,
      height: 100,
      x: 230,
      y: 150,
      originX: -30,
      originY: -50,
      scaleX: -1.5,
      scaleY: -2,
    });
  });

  it("retains explicit positive baked scales for animation targets", () => {
    const result = parseCommonObject(commonState({ scaleX: 1.5, scaleY: 2 }));

    expect(result).toMatchObject({
      width: 120,
      height: 100,
      scaleX: 1.5,
      scaleY: 2,
    });
  });

  it("keeps a zero scale instead of treating it as an omitted value", () => {
    const result = parseCommonObject(
      commonState({ anchorX: 0.5, anchorY: 1, scaleX: 0, scaleY: 0 }),
    );

    expect(result).toMatchObject({
      width: 0,
      height: 0,
      x: 200,
      y: 100,
      originX: 0,
      originY: 0,
      scaleX: 0,
      scaleY: 0,
    });
  });

  it("retains explicit transform origins with negative scale", () => {
    const result = parseCommonObject(
      commonState({
        anchorX: 0.5,
        anchorY: 0.5,
        originX: 12,
        originY: 7,
        scaleX: -2,
        scaleY: -3,
      }),
    );

    expect(result).toMatchObject({
      width: 160,
      height: 150,
      x: 280,
      y: 175,
      originX: 12,
      originY: 7,
    });
  });

  it("keeps dimensions local and the full scale live for particles", () => {
    const result = parseCommonObject(
      commonState({
        type: "particles",
        anchorX: 0.25,
        anchorY: 0.5,
        scaleX: -1.5,
        scaleY: 2,
      }),
      { scaleMode: "live" },
    );

    expect(result).toMatchObject({
      width: 80,
      height: 50,
      x: 230,
      y: 50,
      originX: -30,
      originY: 50,
      scaleX: -1.5,
      scaleY: 2,
    });
  });

  it("does not bake a container scale magnitude into its own bounds", () => {
    const result = parseCommonObject(
      commonState({
        type: "container",
        anchorX: 0.5,
        scaleX: -3,
      }),
    );

    expect(result).toMatchObject({
      width: 80,
      x: 240,
      originX: -40,
      scaleX: -3,
    });
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
    ["a string", "-1"],
  ])("rejects %s as scale", (_label, scaleX) => {
    expect(() => parseCommonObject(commonState({ scaleX }))).toThrow(
      "scaleX and scaleY must be finite numbers",
    );
  });

  it("parses a mirrored rect with drawable positive geometry", () => {
    const result = parseRect({
      state: {
        id: "rect",
        type: "rect",
        x: 300,
        y: 180,
        width: 100,
        height: 60,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: -2,
        scaleY: -0.5,
        fill: "red",
      },
    });

    expect(result).toMatchObject({
      width: 200,
      height: 30,
      x: 400,
      y: 195,
      originX: -100,
      originY: -15,
      scaleX: -2,
      scaleY: -0.5,
    });
  });

  it("parses a mirrored sprite without negative width or height", () => {
    const result = parseSprite({
      state: commonState({ scaleX: -1, scaleY: -2, src: "asymmetric" }),
    });

    expect(result).toMatchObject({
      width: 80,
      height: 100,
      scaleX: -1,
      scaleY: -2,
      src: "asymmetric",
    });
  });

  it("bakes a container magnitude into children but keeps its sign on the group", () => {
    const result = parseContainerForTesting({
      state: {
        id: "group",
        type: "container",
        x: 300,
        y: 200,
        width: 200,
        height: 100,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: -2,
        scaleY: 3,
        children: [
          {
            id: "child",
            type: "rect",
            x: 20,
            y: 10,
            width: 30,
            height: 20,
            fill: "red",
          },
        ],
      },
    });

    expect(result).toMatchObject({
      width: 200,
      height: 100,
      x: 400,
      y: 150,
      originX: -100,
      originY: 50,
      scaleX: -2,
      scaleY: 3,
    });
    expect(result.children[0]).toMatchObject({
      width: 60,
      height: 60,
      scaleX: 2,
      scaleY: 3,
    });
  });

  it("composes nested negative signs without losing scale magnitude", () => {
    const result = parseContainerForTesting({
      state: {
        id: "outer",
        type: "container",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        scaleX: -2,
        children: [
          {
            id: "inner",
            type: "container",
            x: 0,
            y: 0,
            width: 100,
            height: 50,
            scaleX: -3,
            children: [
              {
                id: "leaf",
                type: "rect",
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                fill: "blue",
              },
            ],
          },
        ],
      },
    });

    expect(result.scaleX).toBe(-2);
    expect(result.children[0].scaleX).toBe(-6);
    expect(result.children[0].children[0]).toMatchObject({
      width: 60,
      scaleX: 6,
    });
  });
});
