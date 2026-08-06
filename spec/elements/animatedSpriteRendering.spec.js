import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  textureFrom,
  dispatchLiveAnimations,
  getLiveAnimations,
  MockAnimatedSprite,
  MockBlurFilter,
  MockSpritesheet,
} = vi.hoisted(() => {
  class HoistedMockAnimatedSprite {
    constructor(textures) {
      this.textures = textures;
      this.label = "";
      this.zIndex = 0;
      this.animationSpeed = 0;
      this.loop = true;
      this.x = 0;
      this.y = 0;
      this.pivot = {
        x: 0,
        y: 0,
        set: (x, y) => {
          this.pivot.x = x;
          this.pivot.y = y;
        },
      };
      this.scale = { x: 1, y: 1 };
      this.rotation = 0;
      this.width = 0;
      this.height = 0;
      this.alpha = 1;
      this.destroyed = false;
      this.currentFrame = 0;
      this.gotoAndStop = vi.fn((frameIndex) => {
        this.currentFrame = frameIndex;
      });
      this.play = vi.fn();
      this.stop = vi.fn();
    }
  }

  class HoistedMockSpritesheet {
    constructor(_texture, metadata) {
      this.metadata = metadata;
      this.textures = {};
    }

    async parse() {
      const frameNames = Object.keys(this.metadata.frames);
      this.textures = Object.fromEntries(
        frameNames.map((frameName) => [frameName, { frameName }]),
      );
    }
  }

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
    textureFrom: vi.fn(),
    dispatchLiveAnimations: vi.fn(() => false),
    getLiveAnimations: vi.fn(() => []),
    MockAnimatedSprite: HoistedMockAnimatedSprite,
    MockBlurFilter: HoistedMockBlurFilter,
    MockSpritesheet: HoistedMockSpritesheet,
  };
});

vi.mock("pixi.js", () => ({
  AnimatedSprite: MockAnimatedSprite,
  BlurFilter: MockBlurFilter,
  Spritesheet: MockSpritesheet,
  Texture: {
    from: textureFrom,
  },
}));

vi.mock("../../src/plugins/animations/planAnimations.js", () => ({
  dispatchLiveAnimations,
  getLiveAnimations,
}));

import { addAnimatedSprite } from "../../src/plugins/elements/animated-sprite/addAnimatedSprite.js";
import { updateAnimatedSprite } from "../../src/plugins/elements/animated-sprite/updateAnimatedSprite.js";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import { applyElementTransform } from "../../src/plugins/elements/util/transform.js";
import {
  cleanupDebugMode,
  setupDebugMode,
} from "../../src/plugins/elements/animated-sprite/util/debugUtils.js";

function createAnimatedSpriteElement(overrides = {}) {
  return {
    id: "animated-sprite-1",
    x: 200,
    y: 150,
    width: 100,
    height: 100,
    src: "fighter-spritesheet",
    atlas: {
      frames: {
        "frame-0.png": { x: 0, y: 0, width: 32, height: 32 },
        "frame-1.png": { x: 32, y: 0, width: 32, height: 32 },
        "frame-2.png": { x: 64, y: 0, width: 32, height: 32 },
      },
      width: 96,
      height: 32,
    },
    clips: {
      idle: ["frame-0.png", "frame-1.png", "frame-2.png"],
    },
    playback: {
      clip: "idle",
      fps: 30,
      loop: true,
      autoplay: true,
    },
    alpha: 1,
    ...overrides,
  };
}

describe("spritesheet animation rendering", () => {
  beforeEach(() => {
    textureFrom.mockReset();
    textureFrom.mockReturnValue({ alias: "fighter-spritesheet" });
    dispatchLiveAnimations.mockReset();
    dispatchLiveAnimations.mockReturnValue(false);
    getLiveAnimations.mockReset();
    getLiveAnimations.mockReturnValue([]);
  });

  afterEach(() => {
    window.document.body.innerHTML = "";
  });

  it("applies degree rotation around the configured origin", async () => {
    const parent = {
      destroyed: false,
      addChild: vi.fn(),
    };

    await addAnimatedSprite({
      app: {
        debug: false,
        render: vi.fn(),
      },
      parent,
      element: createAnimatedSpriteElement({
        x: 120,
        y: 90,
        originX: 18,
        originY: 12,
        rotation: 135,
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {},
      renderContext: {},
      zIndex: 3,
      signal: undefined,
    });

    const sprite = parent.addChild.mock.calls[0][0];

    expect(sprite.x).toBe(138);
    expect(sprite.y).toBe(102);
    expect(sprite.pivot.x).toBe(18);
    expect(sprite.pivot.y).toBe(12);
    expect(sprite.rotation).toBeCloseTo((3 * Math.PI) / 4);
  });

  it("keeps the pivot stable across frame changes and scale tweens", async () => {
    const parent = {
      destroyed: false,
      addChild: vi.fn(),
    };

    await addAnimatedSprite({
      app: {
        debug: false,
        render: vi.fn(),
      },
      parent,
      element: createAnimatedSpriteElement({
        originX: 20,
        originY: 30,
        rotation: 45,
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {},
      renderContext: {},
      zIndex: 3,
      signal: undefined,
    });

    const sprite = parent.addChild.mock.calls[0][0];
    sprite.texture = { orig: { width: 100, height: 100 } };
    sprite.x = 333;
    sprite.y = 222;
    sprite.rotation = 1.25;
    sprite.scale.x = 0.5;
    sprite.scale.y = 0.25;

    sprite.onFrameChange(1);

    expect(sprite.pivot.x).toBeCloseTo(20);
    expect(sprite.pivot.y).toBeCloseTo(30);
    expect(sprite.x).toBe(333);
    expect(sprite.y).toBe(222);
    expect(sprite.rotation).toBe(1.25);

    const animationBus = createAnimationBus();
    animationBus.dispatch({
      type: "START",
      payload: {
        id: "animated-sprite-scale",
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

    expect(sprite.pivot.x).toBeCloseTo(20);
    expect(sprite.pivot.y).toBeCloseTo(30);

    const pivotBeforeFrameChange = {
      x: sprite.pivot.x,
      y: sprite.pivot.y,
    };
    sprite.onFrameChange(2);

    expect(sprite.pivot.x).toBeCloseTo(pivotBeforeFrameChange.x);
    expect(sprite.pivot.y).toBeCloseTo(pivotBeforeFrameChange.y);
  });

  it("recomputes the geometry pivot without folding in the live scale", async () => {
    const parent = {
      destroyed: false,
      addChild: vi.fn(),
    };

    await addAnimatedSprite({
      app: {
        debug: false,
        render: vi.fn(),
      },
      parent,
      element: createAnimatedSpriteElement({
        width: 100,
        height: 100,
        originX: 20,
        originY: 30,
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {},
      renderContext: {},
      zIndex: 3,
      signal: undefined,
    });

    const sprite = parent.addChild.mock.calls[0][0];
    sprite.texture = { orig: { width: 200, height: 50 } };
    sprite.scale.x = 0.75;
    sprite.scale.y = 1;

    sprite.onFrameChange(1);

    expect(sprite.pivot.x).toBeCloseTo(40);
    expect(sprite.pivot.y).toBeCloseTo(15);
    expect(sprite.scale.x).toBeCloseTo(0.75);
    expect(sprite.scale.y).toBeCloseTo(1);
  });

  it("keeps the previous origin during a live update tween", async () => {
    const liveAnimations = [
      {
        id: "animated-sprite-update",
        targetId: "animated-sprite-1",
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
    ];
    dispatchLiveAnimations.mockReturnValue(true);
    getLiveAnimations.mockReturnValue(liveAnimations);

    const app = {
      debug: false,
      render: vi.fn(),
    };
    const animatedSpriteElement = new MockAnimatedSprite([
      { frameName: "old" },
    ]);
    animatedSpriteElement.label = "animated-sprite-1";
    const prevElement = createAnimatedSpriteElement({
      x: 20,
      y: 30,
      width: 64,
      height: 48,
      originX: 10,
      originY: 5,
    });
    const nextElement = createAnimatedSpriteElement({
      x: 200,
      y: 160,
      width: 64,
      height: 48,
      originX: 30,
      originY: 12,
    });
    animatedSpriteElement.x = prevElement.x + prevElement.originX;
    animatedSpriteElement.y = prevElement.y + prevElement.originY;
    applyElementTransform(animatedSpriteElement, prevElement);

    await updateAnimatedSprite({
      app,
      parent: {
        children: [animatedSpriteElement],
      },
      prevElement,
      nextElement,
      animations: liveAnimations,
      animationBus: {},
      completionTracker: {},
      zIndex: 4,
      signal: undefined,
    });

    animatedSpriteElement.scale.x = 0.5;
    animatedSpriteElement.scale.y = 0.25;
    animatedSpriteElement.onFrameChange(1);

    expect(animatedSpriteElement.pivot.x).toBeCloseTo(10);
    expect(animatedSpriteElement.pivot.y).toBeCloseTo(5);
    expect(animatedSpriteElement.x).toBe(30);
    expect(animatedSpriteElement.y).toBe(35);

    await dispatchLiveAnimations.mock.calls[0][0].onComplete();

    expect(
      animatedSpriteElement.pivot.x * animatedSpriteElement.scale.x,
    ).toBeCloseTo(30);
    expect(
      animatedSpriteElement.pivot.y * animatedSpriteElement.scale.y,
    ).toBeCloseTo(12);
    expect(animatedSpriteElement.x).toBe(230);
    expect(animatedSpriteElement.y).toBe(172);
  });

  it("renders after asynchronously adding a spritesheet animation in debug/manual flows", async () => {
    const app = {
      debug: true,
      render: vi.fn(),
    };
    const getShaderTime = vi.fn(() => 4.25);
    const parent = {
      destroyed: false,
      addChild: vi.fn(),
    };

    await addAnimatedSprite({
      app,
      parent,
      element: createAnimatedSpriteElement(),
      renderContext: {},
      zIndex: 3,
      signal: undefined,
      shaderTime: 1,
      getShaderTime,
    });

    expect(parent.addChild).toHaveBeenCalledTimes(1);
    expect(app.render).toHaveBeenCalledTimes(1);
    expect(getShaderTime).toHaveBeenCalledTimes(1);
    expect(getShaderTime.mock.invocationCallOrder[0]).toBeLessThan(
      app.render.mock.invocationCallOrder[0],
    );
  });

  it("dispatches update animations after asynchronously adding a spritesheet animation", async () => {
    const app = {
      debug: true,
      render: vi.fn(),
    };
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: () => 2,
      track: vi.fn(),
      complete: vi.fn(),
    };
    const parent = {
      destroyed: false,
      addChild: vi.fn(),
    };
    const renderContext = {};

    await addAnimatedSprite({
      app,
      parent,
      element: createAnimatedSpriteElement({
        originX: 10,
        originY: 5,
        rotation: 45,
      }),
      animations: [
        {
          id: "animated-sprite-enter",
          targetId: "animated-sprite-1",
          type: "update",
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      ],
      animationBus,
      completionTracker,
      renderContext,
      zIndex: 3,
      signal: undefined,
    });

    const addedSprite = parent.addChild.mock.calls[0][0];

    expect(dispatchLiveAnimations).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: "animated-sprite-1",
        animationBus,
        completionTracker,
        element: addedSprite,
        targetState: expect.objectContaining({
          x: 210,
          y: 155,
          rotation: 45,
          width: 100,
          height: 100,
          alpha: 1,
        }),
        renderContext,
      }),
    );
  });

  it("renders after replacing spritesheet animation frame textures asynchronously", async () => {
    const app = {
      debug: false,
      render: vi.fn(),
    };
    const animatedSpriteElement = new MockAnimatedSprite([
      { frameName: "old" },
    ]);
    animatedSpriteElement.label = "animated-sprite-1";
    const parent = {
      children: [animatedSpriteElement],
    };
    const prevElement = createAnimatedSpriteElement();
    const nextElement = createAnimatedSpriteElement({
      playback: {
        frames: ["frame-2.png", "frame-1.png", "frame-0.png"],
        fps: 45,
        loop: false,
        autoplay: true,
      },
    });

    await updateAnimatedSprite({
      app,
      parent,
      prevElement,
      nextElement,
      animations: [],
      animationBus: {},
      completionTracker: {},
      zIndex: 4,
      signal: undefined,
    });

    expect(animatedSpriteElement.textures).toEqual([
      { frameName: "frame-2.png" },
      { frameName: "frame-1.png" },
      { frameName: "frame-0.png" },
    ]);
    expect(app.render).toHaveBeenCalledTimes(1);
  });

  it("reloads textures when atlas or src changes even if playback does not", async () => {
    const app = {
      debug: false,
      render: vi.fn(),
    };
    const animatedSpriteElement = new MockAnimatedSprite([
      { frameName: "old" },
    ]);
    animatedSpriteElement.label = "animated-sprite-1";
    const parent = {
      children: [animatedSpriteElement],
    };
    const prevElement = createAnimatedSpriteElement();
    const nextElement = createAnimatedSpriteElement({
      src: "fighter-spritesheet-v2",
      atlas: {
        frames: {
          "frame-0.png": { x: 0, y: 0, width: 48, height: 48 },
          "frame-1.png": { x: 48, y: 0, width: 48, height: 48 },
          "frame-2.png": { x: 96, y: 0, width: 48, height: 48 },
        },
        width: 144,
        height: 48,
      },
    });

    await updateAnimatedSprite({
      app,
      parent,
      prevElement,
      nextElement,
      animations: [],
      animationBus: {},
      completionTracker: {},
      zIndex: 4,
      signal: undefined,
    });

    expect(textureFrom).toHaveBeenCalledWith("fighter-spritesheet-v2");
    expect(animatedSpriteElement.textures).toEqual([
      { frameName: "frame-0.png" },
      { frameName: "frame-1.png" },
      { frameName: "frame-2.png" },
    ]);
  });

  it("recomputes the pivot after a replacement atlas changes frame geometry", async () => {
    const app = {
      debug: false,
      render: vi.fn(),
    };
    const animatedSpriteElement = new MockAnimatedSprite([
      { frameName: "old" },
    ]);
    animatedSpriteElement.label = "animated-sprite-1";
    let assignedTextures = animatedSpriteElement.textures;
    Object.defineProperty(animatedSpriteElement, "textures", {
      configurable: true,
      get: () => assignedTextures,
      set: (textures) => {
        assignedTextures = textures;
        animatedSpriteElement.texture = {
          orig: { width: 200, height: 50 },
        };
        animatedSpriteElement.scale.x = animatedSpriteElement.width / 200;
        animatedSpriteElement.scale.y = animatedSpriteElement.height / 50;
      },
    });
    const parent = {
      children: [animatedSpriteElement],
    };
    const prevElement = createAnimatedSpriteElement({
      width: 100,
      height: 100,
      originX: 20,
      originY: 30,
    });
    const nextElement = createAnimatedSpriteElement({
      width: 100,
      height: 100,
      originX: 20,
      originY: 30,
      src: "fighter-spritesheet-v2",
      atlas: {
        frames: {
          "frame-0.png": { x: 0, y: 0, width: 200, height: 50 },
          "frame-1.png": { x: 200, y: 0, width: 200, height: 50 },
          "frame-2.png": { x: 400, y: 0, width: 200, height: 50 },
        },
        width: 600,
        height: 50,
      },
    });

    await updateAnimatedSprite({
      app,
      parent,
      prevElement,
      nextElement,
      animations: [],
      animationBus: {},
      completionTracker: {},
      zIndex: 4,
      signal: undefined,
    });

    expect(animatedSpriteElement.pivot.x).toBeCloseTo(40);
    expect(animatedSpriteElement.pivot.y).toBeCloseTo(15);
    expect(
      animatedSpriteElement.pivot.x * animatedSpriteElement.scale.x,
    ).toBeCloseTo(20);
    expect(
      animatedSpriteElement.pivot.y * animatedSpriteElement.scale.y,
    ).toBeCloseTo(30);
  });

  it("reloads changed spritesheet resources before dispatching update animations", async () => {
    const order = [];
    textureFrom.mockImplementation((src) => {
      order.push(`texture:${src}`);
      return { alias: src };
    });
    dispatchLiveAnimations.mockImplementation(() => {
      order.push("dispatch");
      return true;
    });
    getLiveAnimations.mockReturnValue([
      {
        id: "animated-sprite-update",
        targetId: "animated-sprite-1",
        type: "update",
      },
    ]);

    const app = {
      debug: false,
      render: vi.fn(() => {
        order.push(
          `render:${animatedSpriteElement.width}x${animatedSpriteElement.height}`,
        );
      }),
    };
    const animatedSpriteElement = new MockAnimatedSprite([
      { frameName: "old" },
    ]);
    animatedSpriteElement.label = "animated-sprite-1";
    animatedSpriteElement.x = 20;
    animatedSpriteElement.y = 30;
    animatedSpriteElement.width = 64;
    animatedSpriteElement.height = 64;
    const parent = {
      children: [animatedSpriteElement],
    };
    const prevElement = createAnimatedSpriteElement({
      x: 20,
      y: 30,
      width: 64,
      height: 64,
    });
    const nextElement = createAnimatedSpriteElement({
      src: "fighter-spritesheet-v2",
      x: 240,
      y: 160,
      width: 128,
      height: 128,
    });

    await updateAnimatedSprite({
      app,
      parent,
      prevElement,
      nextElement,
      animations: [
        {
          id: "animated-sprite-update",
          targetId: "animated-sprite-1",
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
      animationBus: {},
      completionTracker: {
        getVersion: vi.fn().mockReturnValue(1),
        track: vi.fn(() => {
          order.push("track");
        }),
        complete: vi.fn(() => {
          order.push("complete");
        }),
      },
      zIndex: 4,
      signal: undefined,
    });

    expect(order).toEqual([
      "track",
      "texture:fighter-spritesheet-v2",
      "render:128x128",
      "dispatch",
      "complete",
    ]);
    expect(animatedSpriteElement.textures).toEqual([
      { frameName: "frame-0.png" },
      { frameName: "frame-1.png" },
      { frameName: "frame-2.png" },
    ]);
    expect(animatedSpriteElement.x).toBe(20);
    expect(animatedSpriteElement.y).toBe(30);
    expect(animatedSpriteElement.width).toBe(128);
    expect(animatedSpriteElement.height).toBe(128);
  });

  it("keeps animated dimensions at their current values before dispatch", async () => {
    const order = [];
    textureFrom.mockImplementation((src) => {
      order.push(`texture:${src}`);
      return { alias: src };
    });
    dispatchLiveAnimations.mockImplementation(({ element }) => {
      order.push(`dispatch:${element.width}x${element.height}`);
      return true;
    });
    getLiveAnimations.mockReturnValue([
      {
        id: "animated-sprite-update",
        targetId: "animated-sprite-1",
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
    ]);

    const app = {
      debug: false,
      render: vi.fn(),
    };
    const animatedSpriteElement = new MockAnimatedSprite([
      { frameName: "old" },
    ]);
    animatedSpriteElement.label = "animated-sprite-1";
    animatedSpriteElement.x = 20;
    animatedSpriteElement.y = 30;
    animatedSpriteElement.width = 64;
    animatedSpriteElement.height = 48;
    const parent = {
      children: [animatedSpriteElement],
    };
    const prevElement = createAnimatedSpriteElement({
      x: 20,
      y: 30,
      width: 64,
      height: 48,
    });
    const nextElement = createAnimatedSpriteElement({
      src: "fighter-spritesheet-v2",
      x: 20,
      y: 30,
      width: 128,
      height: 96,
    });

    await updateAnimatedSprite({
      app,
      parent,
      prevElement,
      nextElement,
      animations: [
        {
          id: "animated-sprite-update",
          targetId: "animated-sprite-1",
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
      animationBus: {},
      completionTracker: {
        getVersion: vi.fn().mockReturnValue(1),
        track: vi.fn(),
        complete: vi.fn(),
      },
      zIndex: 4,
      signal: undefined,
    });

    expect(order).toEqual(["texture:fighter-spritesheet-v2", "dispatch:64x48"]);
    expect(animatedSpriteElement.textures).toEqual([
      { frameName: "frame-0.png" },
      { frameName: "frame-1.png" },
      { frameName: "frame-2.png" },
    ]);
    expect(animatedSpriteElement.width).toBe(64);
    expect(animatedSpriteElement.height).toBe(48);
  });

  it("does not reload frame textures before dispatch for playback-only updates", async () => {
    const order = [];
    dispatchLiveAnimations.mockImplementation(() => {
      order.push("dispatch");
      return true;
    });
    getLiveAnimations.mockReturnValue([
      {
        id: "animated-sprite-update",
        targetId: "animated-sprite-1",
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
    ]);

    const app = {
      debug: false,
      render: vi.fn(),
    };
    const animatedSpriteElement = new MockAnimatedSprite([
      { frameName: "old" },
    ]);
    animatedSpriteElement.label = "animated-sprite-1";
    const parent = {
      children: [animatedSpriteElement],
    };
    const prevElement = createAnimatedSpriteElement();
    const nextElement = createAnimatedSpriteElement({
      playback: {
        clip: "idle",
        fps: 12,
        loop: true,
        autoplay: true,
      },
    });

    await updateAnimatedSprite({
      app,
      parent,
      prevElement,
      nextElement,
      animations: [
        {
          id: "animated-sprite-update",
          targetId: "animated-sprite-1",
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
      animationBus: {},
      completionTracker: {
        getVersion: vi.fn().mockReturnValue(1),
        track: vi.fn(),
        complete: vi.fn(),
      },
      zIndex: 4,
      signal: undefined,
    });

    expect(order).toEqual(["dispatch"]);
    expect(textureFrom).not.toHaveBeenCalled();
    expect(animatedSpriteElement.animationSpeed).toBe(0);
  });

  it("re-renders when a debug snapshot frame event changes the current frame", () => {
    const animatedSprite = new MockAnimatedSprite([
      { frameName: "frame-0.png" },
    ]);
    const render = vi.fn();

    setupDebugMode(animatedSprite, "animated-sprite-1", true, render);

    window.dispatchEvent(
      new CustomEvent("snapShotAnimatedSpriteFrame", {
        detail: {
          elementId: "animated-sprite-1",
          frameIndex: "2",
        },
      }),
    );

    expect(animatedSprite.gotoAndStop).toHaveBeenCalledWith(2);
    expect(render).toHaveBeenCalledTimes(1);

    cleanupDebugMode(animatedSprite);
  });
});
