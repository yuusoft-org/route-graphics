import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockBlurFilter, textureFrom } = vi.hoisted(() => {
  class HoistedMockBlurFilter {
    constructor(options = {}) {
      this.strengthX = options.strengthX ?? options.strength ?? 0;
      this.strengthY = options.strengthY ?? options.strength ?? 0;
      this.quality = options.quality ?? 4;
      this.kernelSize = options.kernelSize ?? 5;
      this.repeatEdgePixels = false;
      this.destroy = vi.fn();
    }
  }

  return {
    MockBlurFilter: HoistedMockBlurFilter,
    textureFrom: vi.fn(),
  };
});

vi.mock("pixi.js", () => ({
  BlurFilter: MockBlurFilter,
  Texture: {
    EMPTY: { src: "" },
    from: textureFrom,
  },
}));

import { updateSprite } from "../../src/plugins/elements/sprite/updateSprite.js";

describe("updateSprite", () => {
  beforeEach(() => {
    textureFrom.mockReset();
  });

  it("swaps changed textures before dispatching update animations", () => {
    const order = [];
    const nextTexture = { src: "next-sprite" };
    textureFrom.mockImplementation((src) => {
      order.push(`texture:${src}`);
      return nextTexture;
    });

    const spriteElement = {
      label: "sprite-1",
      texture: { src: "prev-sprite" },
      x: 10,
      y: 20,
      width: 80,
      height: 80,
      alpha: 1,
      zIndex: 0,
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    };
    const animationBus = {
      dispatch: vi.fn(() => {
        order.push("dispatch");
      }),
    };

    updateSprite({
      app: {
        audioStage: { add: vi.fn() },
      },
      parent: {
        children: [spriteElement],
      },
      prevElement: {
        id: "sprite-1",
        type: "sprite",
        src: "prev-sprite",
        x: 10,
        y: 20,
        width: 80,
        height: 80,
        alpha: 1,
      },
      nextElement: {
        id: "sprite-1",
        type: "sprite",
        src: "next-sprite",
        x: 200,
        y: 120,
        width: 100,
        height: 100,
        alpha: 1,
      },
      animations: [
        {
          id: "sprite-update",
          targetId: "sprite-1",
          type: "update",
          tween: {
            x: {
              auto: {
                duration: 300,
                easing: "linear",
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: vi.fn().mockReturnValue(1),
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      zIndex: 4,
    });

    expect(order).toEqual(["texture:next-sprite", "dispatch"]);
    expect(spriteElement.texture).toBe(nextTexture);
    expect(spriteElement.x).toBe(10);
    expect(spriteElement.y).toBe(20);
    expect(spriteElement.width).toBe(100);
    expect(spriteElement.height).toBe(100);
  });

  it("keeps animated dimensions at their current values before dispatch", () => {
    const order = [];
    const nextTexture = { src: "next-sprite" };
    textureFrom.mockImplementation((src) => {
      order.push(`texture:${src}`);
      return nextTexture;
    });

    const spriteElement = {
      label: "sprite-1",
      texture: { src: "prev-sprite" },
      x: 10,
      y: 20,
      width: 80,
      height: 60,
      alpha: 1,
      zIndex: 0,
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    };
    const animationBus = {
      dispatch: vi.fn((command) => {
        const { element } = command.payload;
        order.push(`dispatch:${element.width}x${element.height}`);
      }),
    };

    updateSprite({
      app: {
        audioStage: { add: vi.fn() },
      },
      parent: {
        children: [spriteElement],
      },
      prevElement: {
        id: "sprite-1",
        type: "sprite",
        src: "prev-sprite",
        x: 10,
        y: 20,
        width: 80,
        height: 60,
        alpha: 1,
      },
      nextElement: {
        id: "sprite-1",
        type: "sprite",
        src: "next-sprite",
        x: 10,
        y: 20,
        width: 120,
        height: 90,
        alpha: 1,
      },
      animations: [
        {
          id: "sprite-update",
          targetId: "sprite-1",
          type: "update",
          tween: {
            width: {
              auto: {
                duration: 300,
                easing: "linear",
              },
            },
            height: {
              auto: {
                duration: 300,
                easing: "linear",
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: vi.fn().mockReturnValue(1),
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      zIndex: 4,
    });

    expect(order).toEqual(["texture:next-sprite", "dispatch:80x60"]);
    expect(spriteElement.texture).toBe(nextTexture);
    expect(spriteElement.width).toBe(80);
    expect(spriteElement.height).toBe(60);
  });

  it("dispatches auto rotation tweens with degree target values", () => {
    const spriteElement = {
      label: "sprite-1",
      texture: { src: "sprite" },
      x: 10,
      y: 20,
      width: 80,
      height: 60,
      alpha: 1,
      rotation: 0,
      zIndex: 0,
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    };
    const animationBus = { dispatch: vi.fn() };

    updateSprite({
      app: {
        audioStage: { add: vi.fn() },
      },
      parent: {
        children: [spriteElement],
      },
      prevElement: {
        id: "sprite-1",
        type: "sprite",
        src: "sprite",
        x: 10,
        y: 20,
        width: 80,
        height: 60,
        alpha: 1,
        rotation: 0,
      },
      nextElement: {
        id: "sprite-1",
        type: "sprite",
        src: "sprite",
        x: 10,
        y: 20,
        width: 80,
        height: 60,
        alpha: 1,
        rotation: 180,
      },
      animations: [
        {
          id: "sprite-rotation-auto",
          targetId: "sprite-1",
          type: "update",
          tween: {
            rotation: {
              auto: {
                duration: 300,
                easing: "linear",
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: vi.fn().mockReturnValue(1),
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      zIndex: 4,
    });

    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "sprite-rotation-auto",
          targetState: expect.objectContaining({
            rotation: 180,
          }),
        }),
      }),
    );
  });

  it("dispatches auto scale tweens to the signed post-sizing display scale", () => {
    const spriteElement = {
      label: "sprite-1",
      texture: { orig: { width: 50, height: 25 } },
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      scale: { x: -2, y: 2 },
      alpha: 1,
      zIndex: 0,
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    };
    const animationBus = { dispatch: vi.fn() };
    const prevElement = {
      id: "sprite-1",
      type: "sprite",
      src: "sprite",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      scaleX: -1,
      alpha: 1,
    };
    const nextElement = {
      ...prevElement,
      width: 200,
      height: 100,
    };

    updateSprite({
      app: { audioStage: { add: vi.fn() } },
      parent: { children: [spriteElement] },
      prevElement,
      nextElement,
      animations: [
        {
          id: "sprite-scale-auto",
          targetId: "sprite-1",
          type: "update",
          tween: {
            scaleX: { auto: { duration: 300 } },
            scaleY: { auto: { duration: 300 } },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      zIndex: 4,
    });

    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          targetState: expect.objectContaining({
            scaleX: -4,
            scaleY: 4,
          }),
        }),
      }),
    );
  });

  it("uses explicit origin independently from anchor when applying rotation", () => {
    const spriteElement = {
      label: "sprite-1",
      texture: { src: "sprite" },
      x: 10,
      y: 20,
      width: 80,
      height: 60,
      alpha: 1,
      rotation: 0,
      pivot: {
        x: 0,
        y: 0,
        set(x, y) {
          this.x = x;
          this.y = y;
        },
      },
      scale: {
        x: 1,
        y: 1,
      },
      zIndex: 0,
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    };

    updateSprite({
      app: {
        audioStage: { add: vi.fn() },
      },
      parent: {
        children: [spriteElement],
      },
      prevElement: {
        id: "sprite-1",
        type: "sprite",
        src: "sprite",
        x: 240,
        y: 160,
        width: 120,
        height: 80,
        originX: 0,
        originY: 80,
        alpha: 1,
        rotation: 0,
      },
      nextElement: {
        id: "sprite-1",
        type: "sprite",
        src: "sprite",
        x: 260,
        y: 200,
        width: 120,
        height: 80,
        originX: 0,
        originY: 80,
        alpha: 1,
        rotation: 45,
      },
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 0,
        track: () => {},
        complete: () => {},
      },
      eventHandler: vi.fn(),
      zIndex: 4,
    });

    expect(spriteElement.pivot.x).toBe(0);
    expect(spriteElement.pivot.y).toBe(80);
    expect(spriteElement.x).toBe(260);
    expect(spriteElement.y).toBe(280);
    expect(spriteElement.rotation).toBeCloseTo(Math.PI / 4);
  });

  it("applies hover sound volume after rebinding interactions", () => {
    const listeners = new Map();
    const audioStage = { add: vi.fn() };
    const spriteElement = {
      label: "sprite-1",
      texture: { src: "sprite" },
      x: 0,
      y: 0,
      width: 80,
      height: 60,
      alpha: 1,
      rotation: 0,
      pivot: {
        set: vi.fn(),
      },
      scale: {
        x: 1,
        y: 1,
      },
      zIndex: 0,
      removeAllListeners: vi.fn(),
      on: vi.fn((name, listener) => {
        listeners.set(name, listener);
      }),
    };
    const prevElement = {
      id: "sprite-1",
      type: "sprite",
      src: "sprite",
      x: 0,
      y: 0,
      width: 80,
      height: 60,
      alpha: 1,
    };

    updateSprite({
      app: { audioStage },
      parent: {
        children: [spriteElement],
      },
      prevElement,
      nextElement: {
        ...prevElement,
        hover: {
          soundSrc: "hover.mp3",
          soundVolume: 35,
        },
      },
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 0,
        track: () => {},
        complete: () => {},
      },
      eventHandler: vi.fn(),
      zIndex: 0,
    });

    listeners.get("pointerover")();

    expect(audioStage.add).toHaveBeenCalledWith({
      id: expect.stringMatching(/^hover-/),
      url: "hover.mp3",
      loop: false,
      volume: 0.35,
    });
  });
});
