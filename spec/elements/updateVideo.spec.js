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
    from: textureFrom,
  },
}));

import { updateVideo } from "../../src/plugins/elements/video/updateVideo.js";

const createMockVideo = () => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  muted: true,
  currentTime: 0,
  volume: 0,
  loop: true,
  ended: false,
  duration: 10,
});

describe("updateVideo", () => {
  beforeEach(() => {
    textureFrom.mockReset();
  });

  it("applies and resets degree rotation around the configured origin", () => {
    const currentVideo = createMockVideo();
    const pivot = { set: vi.fn() };
    const videoElement = {
      label: "video-1",
      texture: {
        source: {
          resource: currentVideo,
        },
      },
      pivot,
      scale: { x: 1, y: 1 },
      rotation: Math.PI / 2,
      zIndex: 0,
      x: 20,
      y: 30,
      width: 100,
      height: 80,
      alpha: 1,
    };
    const prevElement = {
      id: "video-1",
      src: "video.mp4",
      loop: true,
      volume: 50,
      x: 10,
      y: 20,
      originX: 10,
      originY: 10,
      rotation: 90,
      width: 100,
      height: 80,
      alpha: 1,
    };
    const nextElement = {
      ...prevElement,
      x: 100,
      y: 120,
      originX: 16,
      originY: 9,
      rotation: 0,
    };

    updateVideo({
      app: {},
      parent: {
        children: [videoElement],
      },
      prevElement,
      nextElement,
      animations: [],
      animationBus: { dispatch: vi.fn() },
      eventHandler: vi.fn(),
      completionTracker: {
        getVersion: () => 0,
        track: vi.fn(),
        complete: vi.fn(),
      },
      zIndex: 3,
    });

    expect(videoElement.x).toBe(116);
    expect(videoElement.y).toBe(129);
    expect(pivot.set).toHaveBeenCalledWith(16, 9);
    expect(videoElement.rotation).toBe(0);
  });

  it("tracks completion when a playing video becomes non-looping without changing src", () => {
    const currentVideo = createMockVideo();
    const existingEndedListener = vi.fn();
    const videoElement = {
      label: "video-1",
      texture: {
        source: {
          resource: currentVideo,
        },
      },
      _videoEndedListener: existingEndedListener,
      _playbackStateVersion: null,
      zIndex: 0,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      alpha: 1,
    };

    const completionTracker = {
      getVersion: () => 7,
      track: vi.fn(),
      complete: vi.fn(),
    };

    updateVideo({
      app: {},
      parent: {
        children: [videoElement],
      },
      prevElement: {
        id: "video-1",
        src: "video.mp4",
        loop: true,
        volume: 50,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        alpha: 1,
      },
      nextElement: {
        id: "video-1",
        src: "video.mp4",
        loop: false,
        volume: 50,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        alpha: 1,
      },
      animations: [],
      animationBus: {
        dispatch: vi.fn(),
      },
      eventHandler: vi.fn(),
      completionTracker,
      zIndex: 3,
    });

    expect(textureFrom).not.toHaveBeenCalled();
    expect(currentVideo.removeEventListener).toHaveBeenCalledWith(
      "ended",
      existingEndedListener,
    );
    expect(completionTracker.track).toHaveBeenCalledWith(7);
    expect(videoElement._playbackStateVersion).toBe(7);
    expect(currentVideo.addEventListener).toHaveBeenCalledWith(
      "ended",
      expect.any(Function),
    );
    expect(currentVideo.loop).toBe(false);
  });

  it("swaps changed video resources before dispatching update animations", () => {
    const order = [];
    const currentVideo = createMockVideo();
    const nextVideo = createMockVideo();
    textureFrom.mockImplementation((src) => {
      order.push(`texture:${src}`);
      return {
        source: {
          resource: nextVideo,
        },
      };
    });

    const videoElement = {
      label: "video-1",
      texture: {
        source: {
          resource: currentVideo,
        },
      },
      zIndex: 0,
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      alpha: 1,
    };
    const animationBus = {
      dispatch: vi.fn(() => {
        order.push("dispatch");
      }),
    };

    updateVideo({
      app: {},
      parent: {
        children: [videoElement],
      },
      prevElement: {
        id: "video-1",
        src: "old-video.mp4",
        loop: true,
        volume: 50,
        x: 10,
        y: 20,
        width: 100,
        height: 100,
        alpha: 1,
      },
      nextElement: {
        id: "video-1",
        src: "new-video.mp4",
        loop: true,
        volume: 50,
        x: 200,
        y: 120,
        width: 160,
        height: 90,
        alpha: 1,
      },
      animations: [
        {
          id: "video-update",
          targetId: "video-1",
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
      eventHandler: vi.fn(),
      completionTracker: {
        getVersion: vi.fn().mockReturnValue(1),
        track: vi.fn(),
        complete: vi.fn(),
      },
      zIndex: 3,
    });

    expect(order).toEqual(["texture:new-video.mp4", "dispatch"]);
    expect(videoElement.texture.source.resource).toBe(nextVideo);
    expect(currentVideo.pause).toHaveBeenCalled();
    expect(nextVideo.play).toHaveBeenCalled();
    expect(videoElement.x).toBe(10);
    expect(videoElement.y).toBe(20);
    expect(videoElement.width).toBe(160);
    expect(videoElement.height).toBe(90);
  });

  it("keeps animated dimensions at their current values before dispatch", () => {
    const order = [];
    const currentVideo = createMockVideo();
    const nextVideo = createMockVideo();
    textureFrom.mockImplementation((src) => {
      order.push(`texture:${src}`);
      return {
        source: {
          resource: nextVideo,
        },
      };
    });

    const videoElement = {
      label: "video-1",
      texture: {
        source: {
          resource: currentVideo,
        },
      },
      zIndex: 0,
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      alpha: 1,
    };
    const animationBus = {
      dispatch: vi.fn((command) => {
        const { element } = command.payload;
        order.push(`dispatch:${element.width}x${element.height}`);
      }),
    };

    updateVideo({
      app: {},
      parent: {
        children: [videoElement],
      },
      prevElement: {
        id: "video-1",
        src: "old-video.mp4",
        loop: true,
        volume: 50,
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        alpha: 1,
      },
      nextElement: {
        id: "video-1",
        src: "new-video.mp4",
        loop: true,
        volume: 50,
        x: 10,
        y: 20,
        width: 160,
        height: 90,
        alpha: 1,
      },
      animations: [
        {
          id: "video-update",
          targetId: "video-1",
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
      eventHandler: vi.fn(),
      completionTracker: {
        getVersion: vi.fn().mockReturnValue(1),
        track: vi.fn(),
        complete: vi.fn(),
      },
      zIndex: 3,
    });

    expect(order).toEqual(["texture:new-video.mp4", "dispatch:100x80"]);
    expect(videoElement.texture.source.resource).toBe(nextVideo);
    expect(videoElement.width).toBe(100);
    expect(videoElement.height).toBe(80);
  });

  it("does not re-track pre-synced non-looping video playback on animation completion", () => {
    const currentVideo = createMockVideo();
    const nextVideo = createMockVideo();
    let animationComplete;
    let endedListener;
    textureFrom.mockReturnValue({
      source: {
        resource: nextVideo,
      },
    });
    nextVideo.addEventListener.mockImplementation((eventName, listener) => {
      if (eventName === "ended") {
        endedListener = listener;
      }
    });

    const videoElement = {
      label: "video-1",
      texture: {
        source: {
          resource: currentVideo,
        },
      },
      zIndex: 0,
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      alpha: 1,
    };
    const animationBus = {
      dispatch: vi.fn((command) => {
        animationComplete = command.payload.onComplete;
      }),
    };
    const completionTracker = {
      getVersion: vi.fn().mockReturnValue(1),
      track: vi.fn(),
      complete: vi.fn(),
    };

    updateVideo({
      app: {},
      parent: {
        children: [videoElement],
      },
      prevElement: {
        id: "video-1",
        src: "old-video.mp4",
        loop: true,
        volume: 50,
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        alpha: 1,
      },
      nextElement: {
        id: "video-1",
        src: "new-video.mp4",
        loop: false,
        volume: 50,
        x: 160,
        y: 90,
        width: 120,
        height: 90,
        alpha: 1,
      },
      animations: [
        {
          id: "video-update",
          targetId: "video-1",
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
      eventHandler: vi.fn(),
      completionTracker,
      zIndex: 3,
    });

    expect(completionTracker.track).toHaveBeenCalledTimes(2);
    expect(nextVideo.addEventListener).toHaveBeenCalledWith(
      "ended",
      expect.any(Function),
    );

    animationComplete();

    expect(nextVideo.removeEventListener).not.toHaveBeenCalled();
    expect(completionTracker.track).toHaveBeenCalledTimes(2);

    endedListener();

    expect(completionTracker.complete).toHaveBeenCalledTimes(2);
  });
});
