import { beforeEach, describe, expect, it, vi } from "vitest";

const { MockBlurFilter, MockSprite, textureFrom } = vi.hoisted(() => {
  class HoistedMockBlurFilter {
    constructor(options = {}) {
      this.strengthX = options.strengthX ?? options.strength ?? 0;
      this.strengthY = options.strengthY ?? options.strength ?? 0;
      this.quality = options.quality ?? 4;
      this.kernelSize = options.kernelSize ?? 5;
      this.destroy = vi.fn();
    }
  }

  class HoistedMockSprite {
    constructor(texture) {
      this.texture = texture;
      this.destroyed = false;
      this.scale = { x: 1, y: 1 };
      this.pivot = {
        set: (x, y) => {
          this.pivot.x = x;
          this.pivot.y = y;
        },
      };
      this._once = new Map();
    }

    get width() {
      return Math.abs(this.scale.x) * this.texture.source.width;
    }

    set width(value) {
      const sign = Math.sign(this.scale.x) || 1;
      this.scale.x = (sign * value) / this.texture.source.width;
    }

    get height() {
      return Math.abs(this.scale.y) * this.texture.source.height;
    }

    set height(value) {
      const sign = Math.sign(this.scale.y) || 1;
      this.scale.y = (sign * value) / this.texture.source.height;
    }

    once(event, callback) {
      this._once.set(event, callback);
    }
  }

  return {
    MockBlurFilter: HoistedMockBlurFilter,
    MockSprite: HoistedMockSprite,
    textureFrom: vi.fn(),
  };
});

vi.mock("pixi.js", () => ({
  BlurFilter: MockBlurFilter,
  Sprite: MockSprite,
  Texture: { from: textureFrom },
}));

import { addVideo } from "../../src/plugins/elements/video/addVideo.js";
import {
  captureManagedVideoSpriteSizes,
  restoreManagedVideoSpriteSizes,
} from "../../src/plugins/elements/video/managedVideoTextureSizing.js";

describe("addVideo", () => {
  beforeEach(() => {
    textureFrom.mockReset();
  });

  it("waits for real texture dimensions before binding auto scale targets", () => {
    const video = {
      videoWidth: 0,
      videoHeight: 0,
      pause: vi.fn(),
      play: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      currentTime: 0,
      volume: 1,
      muted: false,
      loop: true,
    };
    const source = {
      width: 1,
      height: 1,
      resource: video,
      __routeGraphicsVideoTextureRuntime: {
        requestUpdate: vi.fn().mockReturnValue(false),
      },
    };
    textureFrom.mockReturnValue({ source });
    const parent = {
      children: [],
      addChild(child) {
        this.children.push(child);
        child.parent = this;
      },
    };
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: vi.fn().mockReturnValue(3),
      track: vi.fn(),
      complete: vi.fn(),
    };

    addVideo({
      parent,
      element: {
        id: "video-1",
        type: "video",
        src: "video.mp4",
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        scaleX: 1,
        scaleY: 1,
        loop: true,
        alpha: 1,
      },
      animations: [
        {
          id: "video-scale-auto",
          targetId: "video-1",
          type: "update",
          tween: {
            scaleX: { auto: { duration: 300, easing: "linear" } },
            scaleY: { auto: { duration: 300, easing: "linear" } },
          },
        },
      ],
      animationBus,
      completionTracker,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(animationBus.dispatch).not.toHaveBeenCalled();

    const metadataOnlySizes = captureManagedVideoSpriteSizes(source);
    video.videoWidth = 640;
    video.videoHeight = 360;
    restoreManagedVideoSpriteSizes(metadataOnlySizes);

    expect(animationBus.dispatch).not.toHaveBeenCalled();

    const sizes = captureManagedVideoSpriteSizes(source);
    source.width = 640;
    source.height = 360;
    restoreManagedVideoSpriteSizes(sizes);

    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          targetState: expect.objectContaining({
            scaleX: 0.5,
            scaleY: 0.5,
          }),
        }),
      }),
    );
    expect(completionTracker.complete).toHaveBeenCalledWith(3);
  });
});
