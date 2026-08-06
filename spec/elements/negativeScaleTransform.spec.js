import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { parseSprite } from "../../src/plugins/elements/sprite/parseSprite.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
  refreshElementPivot,
} from "../../src/plugins/elements/util/transform.js";
import { hitTestElementBounds } from "../../src/util/hitTestElementBounds.js";

const createDisplay = (scale = { x: 1, y: 1 }) => ({
  x: 0,
  y: 0,
  rotation: 0,
  scale: { ...scale },
  pivot: {
    set(x, y) {
      this.x = x;
      this.y = y;
    },
  },
});

describe("negative scale transforms", () => {
  it("applies only the sign when magnitude is baked into geometry", () => {
    const display = createDisplay();

    applyElementTransform(display, {
      x: 250,
      y: 140,
      originX: -50,
      originY: -20,
      scaleX: -2,
      scaleY: -0.5,
    });

    expect(display.scale).toEqual({ x: -1, y: -1 });
    expect(display).toMatchObject({ x: 200, y: 120 });
    expect(display.pivot).toMatchObject({ x: 50, y: 20 });
  });

  it("applies full signed scale for unbaked particle geometry", () => {
    const display = createDisplay();

    applyElementTransform(
      display,
      { originX: -30, originY: 20, scaleX: -1.5, scaleY: 2 },
      { scaleMode: "full" },
    );

    expect(display.scale).toEqual({ x: -1.5, y: 2 });
    expect(display.pivot).toMatchObject({ x: 20, y: 10 });
  });

  it("exposes baked scale signs to update animation target state", () => {
    expect(
      getElementTransformTargetState({
        x: 10,
        y: 20,
        originX: -5,
        originY: 4,
        scaleX: -2,
        scaleY: 0,
      }),
    ).toMatchObject({ x: 5, y: 24, scaleX: -1, scaleY: 0 });
  });

  it("allows full live particle scale to override the generic sign target", () => {
    expect(
      getElementTransformTargetState(
        { scaleX: -2, scaleY: 3 },
        { scaleX: -2, scaleY: 3 },
      ),
    ).toMatchObject({ scaleX: -2, scaleY: 3 });
  });

  it("preserves texture sizing magnitude while replacing its sign", () => {
    const display = createDisplay({ x: 3, y: -4 });

    applyElementTransform(
      display,
      { scaleX: -2, scaleY: 0.5 },
      { preserveScaleMagnitude: true },
    );

    expect(display.scale).toEqual({ x: -3, y: 4 });
  });

  it("does not overwrite unrelated existing Pixi scale", () => {
    const display = createDisplay({ x: 0.5, y: 0.25 });

    applyElementTransform(display, { originX: 10, originY: 5 });

    expect(display.scale).toEqual({ x: 0.5, y: 0.25 });
    expect(display.pivot).toMatchObject({ x: 20, y: 20 });
  });

  it("restores the positive sign when a previously mirrored axis is omitted", () => {
    const display = createDisplay({ x: 5, y: 7 });

    applyElementTransform(
      display,
      { scaleX: -1, scaleY: -1 },
      { preserveScaleMagnitude: true },
    );
    applyElementTransform(display, {}, { preserveScaleMagnitude: true });

    expect(display.scale).toEqual({ x: 5, y: 7 });
  });

  it("collapses zero scale on either axis", () => {
    const display = createDisplay({ x: 8, y: 6 });

    applyElementTransform(
      display,
      { originX: 12, originY: 9, scaleX: 0, scaleY: 0 },
      { preserveScaleMagnitude: true },
    );

    expect(display.scale).toEqual({ x: 0, y: 0 });
    expect(display.pivot).toMatchObject({ x: 12, y: 9 });
  });

  it("keeps the pixel origin stable when a mirrored scale changes", () => {
    const display = createDisplay();
    applyElementTransform(display, {
      originX: -20,
      originY: 10,
      scaleX: -1,
      scaleY: 1,
    });

    display.scale.x = -2.5;
    display.scale.y = 0.5;
    refreshElementPivot(display);

    expect(display.pivot.x * display.scale.x).toBeCloseTo(-20);
    expect(display.pivot.y * display.scale.y).toBeCloseTo(10);
  });

  it("mirrors an asymmetric sprite around its center anchor", () => {
    const element = parseSprite({
      state: {
        id: "sprite",
        type: "sprite",
        x: 200,
        y: 100,
        width: 100,
        height: 40,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: -1,
        src: "",
      },
    });
    const sprite = new Sprite(Texture.WHITE);
    sprite.width = element.width;
    sprite.height = element.height;
    applyElementTransform(sprite, element, { preserveScaleMagnitude: true });

    const leftLocal = sprite.toGlobal({ x: 0, y: 0 });
    const rightLocal = sprite.toGlobal({ x: 1, y: 0 });

    expect(leftLocal.x).toBeCloseTo(250);
    expect(rightLocal.x).toBeCloseTo(150);
    expect(sprite.x).toBe(200);
    expect(sprite.pivot.x * sprite.scale.x).toBeCloseTo(-50);
  });

  it("hit-tests the reflected world-space bounds", () => {
    const element = parseSprite({
      state: {
        id: "sprite",
        type: "sprite",
        x: 200,
        y: 100,
        width: 100,
        height: 40,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: -1,
        src: "",
      },
    });
    const stage = new Container();
    const sprite = new Sprite(Texture.WHITE);
    sprite.label = element.id;
    sprite.width = element.width;
    sprite.height = element.height;
    applyElementTransform(sprite, element, { preserveScaleMagnitude: true });
    stage.addChild(sprite);

    expect(
      hitTestElementBounds({ stage, elements: [element], x: 175, y: 100 }),
    ).toHaveLength(1);
    expect(
      hitTestElementBounds({ stage, elements: [element], x: 260, y: 100 }),
    ).toHaveLength(0);
  });
});
