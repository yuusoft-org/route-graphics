import { describe, expect, it, vi } from "vitest";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import {
  captureManagedVideoSpriteSizes,
  registerManagedVideoSprite,
  restoreManagedVideoSpriteSizes,
  setManagedVideoSpriteResizeHandler,
} from "../../src/plugins/elements/video/managedVideoTextureSizing.js";
import {
  applyElementPivot,
  applyElementTransform,
} from "../../src/plugins/elements/util/transform.js";

describe("managed video texture sizing", () => {
  it("reapplies the pivot after source metadata changes the sprite scale", () => {
    const source = { width: 1, height: 1 };
    const sprite = {
      destroyed: false,
      texture: { source },
      scale: { x: 1, y: 1 },
      pivot: {
        set(x, y) {
          this.x = x;
          this.y = y;
        },
      },
      once: vi.fn(),
    };

    Object.defineProperties(sprite, {
      width: {
        get() {
          return this.scale.x * this.texture.source.width;
        },
        set(value) {
          this.scale.x = value / this.texture.source.width;
        },
      },
      height: {
        get() {
          return this.scale.y * this.texture.source.height;
        },
        set(value) {
          this.scale.y = value / this.texture.source.height;
        },
      },
    });

    const element = {
      x: 40,
      y: 30,
      width: 320,
      height: 180,
      originX: 80,
      originY: 45,
      rotation: 30,
    };

    sprite.width = element.width;
    sprite.height = element.height;
    applyElementTransform(sprite, element);
    setManagedVideoSpriteResizeHandler(sprite, () => {
      applyElementPivot(sprite, element);
    });
    registerManagedVideoSprite(sprite);

    const spriteSizes = captureManagedVideoSpriteSizes(source);
    source.width = 640;
    source.height = 360;
    restoreManagedVideoSpriteSizes(spriteSizes);

    expect(sprite.width).toBe(320);
    expect(sprite.height).toBe(180);
    expect(sprite.pivot.x * sprite.scale.x).toBeCloseTo(element.originX);
    expect(sprite.pivot.y * sprite.scale.y).toBeCloseTo(element.originY);
    expect(sprite.x).toBe(120);
    expect(sprite.y).toBe(75);
    expect(sprite.rotation).toBeCloseTo(Math.PI / 6);

    const animationBus = createAnimationBus();
    animationBus.dispatch({
      type: "START",
      payload: {
        id: "video-scale",
        element: sprite,
        properties: {
          scaleX: {
            keyframes: [{ duration: 200, value: 1, easing: "linear" }],
          },
          scaleY: {
            keyframes: [{ duration: 200, value: 0.75, easing: "linear" }],
          },
        },
      },
    });
    animationBus.flush();
    animationBus.tick(100);

    expect(sprite.pivot.x * sprite.scale.x).toBeCloseTo(element.originX);
    expect(sprite.pivot.y * sprite.scale.y).toBeCloseTo(element.originY);
  });
});
