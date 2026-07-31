import { describe, expect, it, vi } from "vitest";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import { applyElementTransform } from "../../src/plugins/elements/util/transform.js";

describe("animationBus auto tween shorthand", () => {
  it("holds auto tween values for the configured delay before interpolation", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 20,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "delayed-auto-x",
        element,
        properties: {
          x: {
            auto: {
              delay: 200,
              duration: 400,
              easing: "linear",
            },
          },
        },
        targetState: { x: 120 },
        onComplete,
      },
    });

    animationBus.flush();
    expect(animationBus.getState().animations[0].duration).toBe(600);

    animationBus.tick(200);
    expect(element.x).toBe(20);
    expect(onComplete).not.toHaveBeenCalled();

    animationBus.tick(200);
    expect(element.x).toBeCloseTo(70);

    animationBus.tick(200);
    expect(element.x).toBeCloseTo(120);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("applies playback speed to both auto delay and interpolation", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 20,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "fast-delayed-auto-x",
        playbackSpeed: 2,
        element,
        properties: {
          x: {
            auto: {
              delay: 200,
              duration: 400,
              easing: "linear",
            },
          },
        },
        targetState: { x: 120 },
        onComplete,
      },
    });

    animationBus.flush();
    animationBus.tick(99);
    expect(element.x).toBe(20);

    animationBus.tick(101);
    expect(element.x).toBeCloseTo(70);
    expect(onComplete).not.toHaveBeenCalled();

    animationBus.tick(100);
    expect(element.x).toBe(120);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("holds a manual timeline between two keyframe segments", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 0,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "delayed-manual-x",
        element,
        properties: {
          x: {
            initialValue: 0,
            keyframes: [
              { duration: 100, value: 100, easing: "linear" },
              {
                delay: 200,
                duration: 100,
                value: 200,
                easing: "linear",
              },
            ],
          },
        },
        onComplete,
      },
    });

    animationBus.flush();
    expect(animationBus.getState().animations[0].duration).toBe(400);

    animationBus.tick(100);
    expect(element.x).toBe(100);

    animationBus.tick(199);
    expect(element.x).toBe(100);
    expect(onComplete).not.toHaveBeenCalled();

    animationBus.tick(51);
    expect(element.x).toBeCloseTo(150);

    animationBus.tick(50);
    expect(element.x).toBe(200);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("animates to the targetState value for auto tween properties", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 20,
      alpha: 0.4,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "auto-x",
        element,
        properties: {
          x: {
            auto: {
              duration: 400,
              easing: "linear",
            },
          },
        },
        targetState: { x: 120 },
        onComplete,
      },
    });

    animationBus.flush();

    expect(element.x).toBe(20);

    animationBus.tick(200);
    expect(element.x).toBeCloseTo(70);

    animationBus.tick(200);
    expect(element.x).toBeCloseTo(120);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("completes immediately when auto tween target already matches current state", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 20,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "auto-noop",
        element,
        properties: {
          x: {
            auto: {
              duration: 300,
            },
          },
        },
        targetState: { x: 20 },
        onComplete,
      },
    });

    animationBus.flush();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(animationBus.getState().activeCount).toBe(0);
  });

  it("keeps a no-op auto loop active without completing", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const onBusComplete = vi.fn();
    const element = {
      x: 20,
      scale: { x: 1, y: 1 },
    };
    animationBus.on("completed", onBusComplete);

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "auto-noop-loop",
        loop: true,
        element,
        properties: {
          x: {
            auto: {
              duration: 300,
              easing: "linear",
            },
          },
        },
        targetState: { x: 20 },
        onComplete,
      },
    });

    animationBus.flush();
    animationBus.tick(600);

    expect(element.x).toBe(20);
    expect(animationBus.getState()).toMatchObject({
      activeCount: 1,
      animations: [
        expect.objectContaining({
          id: "auto-noop-loop",
          duration: 300,
          currentTime: 0,
        }),
      ],
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(onBusComplete).not.toHaveBeenCalled();
  });

  it("throws when auto tween cannot resolve a targetState value", () => {
    const animationBus = createAnimationBus();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "auto-missing-target",
        element: {
          x: 20,
          scale: { x: 1, y: 1 },
        },
        properties: {
          x: {
            auto: {
              duration: 300,
            },
          },
        },
        targetState: {},
      },
    });

    expect(() => animationBus.flush()).toThrow(
      'Animation "auto-missing-target" cannot auto-resolve property "x" from targetState.',
    );
  });

  it("supports mixed auto and manual tween properties in one animation", () => {
    const animationBus = createAnimationBus();
    const element = {
      x: 20,
      alpha: 1,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "auto-and-manual",
        element,
        properties: {
          x: {
            auto: {
              duration: 400,
              easing: "linear",
            },
          },
          alpha: {
            keyframes: [{ duration: 400, value: 0.25, easing: "linear" }],
          },
        },
        targetState: { x: 120, alpha: 0.25 },
      },
    });

    animationBus.flush();
    animationBus.tick(200);

    expect(element.x).toBeCloseTo(70);
    expect(element.alpha).toBeCloseTo(0.625);
  });

  it("scales ticked elapsed time by playback speed", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 0,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "fast-x",
        playbackSpeed: 2,
        element,
        properties: {
          x: {
            keyframes: [{ duration: 1000, value: 100, easing: "linear" }],
          },
        },
        onComplete,
      },
    });

    animationBus.flush();
    animationBus.tick(250);

    expect(element.x).toBeCloseTo(50);
    expect(onComplete).not.toHaveBeenCalled();

    animationBus.tick(250);

    expect(element.x).toBeCloseTo(100);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("scales manually sampled time by playback speed", () => {
    const animationBus = createAnimationBus();
    const element = {
      x: 0,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "manual-fast-x",
        playbackSpeed: 2,
        element,
        properties: {
          x: {
            keyframes: [{ duration: 1000, value: 100, easing: "linear" }],
          },
        },
      },
    });

    animationBus.setTime(250);

    expect(element.x).toBeCloseTo(50);
    expect(animationBus.getState().animations[0]).toMatchObject({
      id: "manual-fast-x",
      currentTime: 500,
      playbackSpeed: 2,
      progress: 0.5,
    });
  });

  it("rejects invalid playback speeds", () => {
    const animationBus = createAnimationBus();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "bad-speed",
        playbackSpeed: 0,
        element: {
          x: 0,
          scale: { x: 1, y: 1 },
        },
        properties: {
          x: {
            keyframes: [{ duration: 1000, value: 100, easing: "linear" }],
          },
        },
      },
    });

    expect(() => animationBus.flush()).toThrow(
      'Animation "bad-speed" playback speed must be a finite number greater than 0.',
    );
  });

  it("loops ticked playback without completing and composes with speed", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const onBusComplete = vi.fn();
    const element = {
      x: 0,
      scale: { x: 1, y: 1 },
    };
    animationBus.on("completed", onBusComplete);

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "looping-fast-x",
        playbackSpeed: 2,
        loop: true,
        element,
        properties: {
          x: {
            initialValue: 0,
            keyframes: [{ duration: 1000, value: 100, easing: "linear" }],
          },
        },
        onComplete,
      },
    });

    animationBus.flush();
    animationBus.tick(250);
    expect(element.x).toBeCloseTo(50);

    animationBus.tick(250);
    expect(element.x).toBeCloseTo(0);

    animationBus.tick(125);
    expect(element.x).toBeCloseTo(25);
    expect(animationBus.getState()).toMatchObject({
      activeCount: 1,
      animations: [
        {
          id: "looping-fast-x",
          currentTime: 250,
          duration: 1000,
          playbackSpeed: 2,
          progress: 0.25,
        },
      ],
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(onBusComplete).not.toHaveBeenCalled();
  });

  it("loops manually sampled playback deterministically across large jumps", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 0,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "sampled-loop",
        playbackSpeed: 2,
        loop: true,
        element,
        properties: {
          x: {
            initialValue: 0,
            keyframes: [{ duration: 1000, value: 100, easing: "linear" }],
          },
        },
        onComplete,
      },
    });

    animationBus.setTime(1625);

    expect(element.x).toBeCloseTo(25);
    expect(animationBus.getState()).toMatchObject({
      activeCount: 1,
      animations: [
        expect.objectContaining({
          id: "sampled-loop",
          currentTime: 250,
          progress: 0.25,
        }),
      ],
    });
    expect(onComplete).not.toHaveBeenCalled();

    animationBus.setTime(2000);
    expect(element.x).toBeCloseTo(0);
    expect(animationBus.getState().activeCount).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("repeats delayed holds on every loop", () => {
    const animationBus = createAnimationBus();
    const element = {
      x: 0,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "looping-delayed-x",
        loop: true,
        element,
        properties: {
          x: {
            initialValue: 0,
            keyframes: [
              { delay: 100, duration: 100, value: 100, easing: "linear" },
            ],
          },
        },
      },
    });

    animationBus.setTime(50);
    expect(element.x).toBe(0);

    animationBus.setTime(150);
    expect(element.x).toBeCloseTo(50);

    animationBus.setTime(250);
    expect(element.x).toBe(0);
    expect(animationBus.getState().animations[0]).toMatchObject({
      duration: 200,
      currentTime: 50,
      progress: 0.25,
    });
  });

  it("rejects looping animations without a positive finite duration", () => {
    const animationBus = createAnimationBus();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "zero-duration-loop",
        loop: true,
        element: {
          x: 0,
          scale: { x: 1, y: 1 },
        },
        properties: {
          x: {
            initialValue: 0,
            keyframes: [{ duration: 0, value: 100, easing: "linear" }],
          },
        },
      },
    });

    expect(() => animationBus.flush()).toThrow(
      'Animation "zero-duration-loop" must have a finite duration greater than 0 when playback loop is enabled.',
    );
  });

  it("rejects non-boolean looping metadata at the animation bus boundary", () => {
    const animationBus = createAnimationBus();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "invalid-loop",
        loop: "forever",
        element: {
          x: 0,
          scale: { x: 1, y: 1 },
        },
        properties: {
          x: {
            keyframes: [{ duration: 100, value: 100, easing: "linear" }],
          },
        },
      },
    });

    expect(() => animationBus.flush()).toThrow(
      'Animation "invalid-loop" playback loop must be a boolean.',
    );
  });

  it("cancels a loop without emitting completion", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const onBusComplete = vi.fn();
    const element = {
      x: 0,
      scale: { x: 1, y: 1 },
    };
    animationBus.on("completed", onBusComplete);

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "cancelled-loop",
        loop: true,
        element,
        properties: {
          x: {
            initialValue: 0,
            keyframes: [{ duration: 1000, value: 100, easing: "linear" }],
          },
        },
        targetState: { x: 100 },
        onComplete,
        onCancel,
      },
    });

    animationBus.flush();
    animationBus.tick(500);
    expect(element.x).toBeCloseTo(50);

    animationBus.dispatch({ type: "CANCEL", id: "cancelled-loop" });
    animationBus.flush();

    expect(element.x).toBeCloseTo(100);
    expect(animationBus.getState().activeCount).toBe(0);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onBusComplete).not.toHaveBeenCalled();
  });

  it("settles the target state when cancelled during a delay", () => {
    const animationBus = createAnimationBus();
    const onCancel = vi.fn();
    const element = {
      x: 10,
      alpha: 0.25,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "cancelled-delayed-update",
        element,
        properties: {
          x: {
            keyframes: [
              { delay: 500, duration: 500, value: 110, easing: "linear" },
            ],
          },
        },
        targetState: { x: 110, alpha: 0.8 },
        onCancel,
      },
    });

    animationBus.flush();
    animationBus.tick(250);
    expect(element.x).toBe(10);

    animationBus.dispatch({ type: "CANCEL", id: "cancelled-delayed-update" });
    animationBus.flush();

    expect(element).toMatchObject({ x: 110, alpha: 0.8 });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("applies property path mapping for auto scale tweens", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 20,
      alpha: 1,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "auto-scale",
        element,
        properties: {
          scaleX: {
            auto: {
              duration: 200,
              easing: "linear",
            },
          },
          scaleY: {
            auto: {
              duration: 200,
              easing: "linear",
            },
          },
        },
        targetState: { scaleX: 1.5, scaleY: 0.5 },
        onComplete,
      },
    });

    animationBus.flush();
    animationBus.tick(100);

    expect(element.scale.x).toBeCloseTo(1.25);
    expect(element.scale.y).toBeCloseTo(0.75);

    animationBus.tick(100);

    expect(element.scale.x).toBeCloseTo(1.5);
    expect(element.scale.y).toBeCloseTo(0.5);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps a pixel transform origin stable throughout scale tweens", () => {
    const animationBus = createAnimationBus();
    const element = {
      x: 0,
      y: 0,
      scale: { x: 0.5, y: 0.25 },
      pivot: {
        set(x, y) {
          this.x = x;
          this.y = y;
        },
      },
    };

    applyElementTransform(element, {
      x: 40,
      y: 30,
      originX: 20,
      originY: 10,
      rotation: 45,
    });

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "scale-around-origin",
        element,
        properties: {
          scaleX: {
            keyframes: [{ duration: 200, value: 1.5, easing: "linear" }],
          },
          scaleY: {
            keyframes: [{ duration: 200, value: 0.75, easing: "linear" }],
          },
        },
      },
    });

    animationBus.flush();
    animationBus.tick(100);

    expect(element.scale.x).toBeCloseTo(1);
    expect(element.scale.y).toBeCloseTo(0.5);
    expect(element.pivot.x * element.scale.x).toBeCloseTo(20);
    expect(element.pivot.y * element.scale.y).toBeCloseTo(10);

    animationBus.tick(100);

    expect(element.pivot.x * element.scale.x).toBeCloseTo(20);
    expect(element.pivot.y * element.scale.y).toBeCloseTo(10);
  });

  it("applies property path mapping for blur tweens", () => {
    const animationBus = createAnimationBus();
    const element = {
      _routeGraphicsBlur: {
        x: 0,
        y: 2,
      },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "manual-blur",
        element,
        properties: {
          blurX: {
            keyframes: [{ duration: 200, value: 10, easing: "linear" }],
          },
          blurY: {
            auto: {
              duration: 200,
              easing: "linear",
            },
          },
        },
        targetState: { blurX: 10, blurY: 6 },
      },
    });

    animationBus.flush();
    animationBus.tick(100);

    expect(element._routeGraphicsBlur.x).toBeCloseTo(5);
    expect(element._routeGraphicsBlur.y).toBeCloseTo(4);
  });

  it("uses degree values for rotation tweens while applying Pixi radians", () => {
    const animationBus = createAnimationBus();
    const element = {
      rotation: Math.PI / 2,
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "auto-rotation",
        element,
        properties: {
          rotation: {
            auto: {
              duration: 200,
              easing: "linear",
            },
          },
        },
        targetState: { rotation: 180 },
      },
    });

    animationBus.flush();
    expect(element.rotation).toBeCloseTo(Math.PI / 2);

    animationBus.tick(100);
    expect(element.rotation).toBeCloseTo((3 * Math.PI) / 4);

    animationBus.tick(100);
    expect(element.rotation).toBeCloseTo(Math.PI);
  });

  it("applies translate tweens relative to the subject dimensions", () => {
    const animationBus = createAnimationBus();
    const element = {
      x: 10,
      y: 20,
      width: 120,
      height: 80,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "manual-translate",
        element,
        properties: {
          translateX: {
            initialValue: 0,
            keyframes: [{ duration: 200, value: 1, easing: "linear" }],
          },
          translateY: {
            initialValue: -0.5,
            keyframes: [{ duration: 200, value: 0.5, easing: "linear" }],
          },
        },
      },
    });

    animationBus.flush();

    expect(element.x).toBeCloseTo(10);
    expect(element.y).toBeCloseTo(-20);

    animationBus.tick(100);

    expect(element.x).toBeCloseTo(70);
    expect(element.y).toBeCloseTo(20);

    animationBus.tick(100);

    expect(element.x).toBeCloseTo(130);
    expect(element.y).toBeCloseTo(60);
  });

  it("samples property animations at an exact time without completing them", () => {
    const animationBus = createAnimationBus();
    const onComplete = vi.fn();
    const element = {
      x: 10,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "manual-time",
        element,
        properties: {
          x: {
            keyframes: [{ duration: 400, value: 110, easing: "linear" }],
          },
        },
        onComplete,
      },
    });

    animationBus.flush();
    animationBus.setTime(250);

    expect(element.x).toBeCloseTo(72.5);
    expect(onComplete).not.toHaveBeenCalled();
    expect(animationBus.getState().animations).toEqual([
      expect.objectContaining({
        id: "manual-time",
        currentTime: 250,
        duration: 400,
      }),
    ]);
  });

  it("samples custom animations without running completion or target-state hooks", () => {
    const animationBus = createAnimationBus();
    const applyFrame = vi.fn();
    const applyTargetState = vi.fn();
    const onComplete = vi.fn();
    const onCancel = vi.fn();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "custom-manual-time",
        driver: "custom",
        duration: 500,
        applyFrame,
        applyTargetState,
        onComplete,
        onCancel,
      },
    });

    animationBus.flush();
    applyFrame.mockClear();

    animationBus.setTime(300);

    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(applyFrame).toHaveBeenCalledWith(300);
    expect(applyTargetState).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("completes custom animations when sampled time reaches the end", () => {
    const animationBus = createAnimationBus();
    const applyFrame = vi.fn();
    const applyTargetState = vi.fn();
    const onComplete = vi.fn();
    const onCancel = vi.fn();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "custom-manual-time-complete",
        driver: "custom",
        duration: 500,
        applyFrame,
        applyTargetState,
        onComplete,
        onCancel,
      },
    });

    animationBus.flush();
    applyFrame.mockClear();

    animationBus.setTime(500);

    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(applyFrame).toHaveBeenCalledWith(500);
    expect(applyTargetState).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(animationBus.getState().activeCount).toBe(0);
  });

  it("completes custom animations immediately by default during playback", () => {
    const animationBus = createAnimationBus();
    const applyFrame = vi.fn();
    const onComplete = vi.fn();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "custom-playback-complete",
        driver: "custom",
        duration: 100,
        applyFrame,
        onComplete,
      },
    });

    animationBus.flush();
    applyFrame.mockClear();

    animationBus.tick(120);

    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(applyFrame).toHaveBeenCalledWith(100);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(animationBus.getState().activeCount).toBe(0);
  });

  it("keeps deferred custom animations active for one final playback frame", () => {
    const animationBus = createAnimationBus();
    const applyFrame = vi.fn();
    const onComplete = vi.fn();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "custom-transition-final-frame",
        driver: "custom",
        duration: 100,
        deferCompletionUntilNextFrame: true,
        applyFrame,
        onComplete,
      },
    });

    animationBus.flush();
    applyFrame.mockClear();

    animationBus.tick(120);

    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(applyFrame).toHaveBeenCalledWith(100);
    expect(onComplete).not.toHaveBeenCalled();
    expect(animationBus.getState()).toEqual(
      expect.objectContaining({
        activeCount: 1,
        animations: [
          expect.objectContaining({
            id: "custom-transition-final-frame",
            currentTime: 100,
            duration: 100,
            progress: 1,
          }),
        ],
      }),
    );

    animationBus.tick(16);

    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(animationBus.getState().activeCount).toBe(0);
  });

  it("does not defer custom animation completion in sampled-time mode", () => {
    const animationBus = createAnimationBus();
    const applyFrame = vi.fn();
    const onComplete = vi.fn();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "custom-sampled-final-frame",
        driver: "custom",
        duration: 100,
        deferCompletionUntilNextFrame: true,
        applyFrame,
        onComplete,
      },
    });

    animationBus.flush();
    applyFrame.mockClear();

    animationBus.setTime(100);

    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(applyFrame).toHaveBeenCalledWith(100);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(animationBus.getState().activeCount).toBe(0);
  });

  it("keeps explicitly preserved persistent animations active across selective cancellation", () => {
    const animationBus = createAnimationBus();
    const onCancel = vi.fn();
    const element = {
      x: 10,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "persistent-update",
        animationType: "update",
        targetId: "bg",
        continuity: "persistent",
        signature: '{"type":"update"}',
        element,
        properties: {
          x: {
            keyframes: [{ duration: 1000, value: 110, easing: "linear" }],
          },
        },
        onCancel,
      },
    });

    animationBus.flush();
    animationBus.tick(300);
    expect(element.x).toBeCloseTo(40);

    animationBus.cancelAllExcept(new Set(["persistent-update"]));
    animationBus.tick(100);

    expect(element.x).toBeCloseTo(50);
    expect(onCancel).not.toHaveBeenCalled();
    expect(animationBus.isAnimating("persistent-update")).toBe(true);
  });

  it("preserves progress while a persistent animation is inside its delay", () => {
    const animationBus = createAnimationBus();
    const element = {
      x: 10,
      scale: { x: 1, y: 1 },
    };

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "persistent-delayed-update",
        animationType: "update",
        targetId: "bg",
        continuity: "persistent",
        signature: '{"type":"update","delay":500}',
        element,
        properties: {
          x: {
            keyframes: [
              { delay: 500, duration: 500, value: 110, easing: "linear" },
            ],
          },
        },
      },
    });

    animationBus.flush();
    animationBus.tick(300);
    animationBus.cancelAllExcept(new Set(["persistent-delayed-update"]));
    animationBus.tick(250);

    expect(element.x).toBeCloseTo(20);
    expect(animationBus.getState().animations[0]).toMatchObject({
      currentTime: 550,
      duration: 1000,
      progress: 0.55,
    });
  });

  it("exposes pending persistent contexts for continuity planning and cancels unkept ones", () => {
    const animationBus = createAnimationBus();
    const onCancel = vi.fn();

    animationBus.registerPending({
      id: "pending-transition",
      animationType: "transition",
      targetId: "scene-root",
      continuity: "persistent",
      signature: '{"type":"transition"}',
      onCancel,
    });

    expect(animationBus.hasContext("pending-transition")).toBe(true);
    expect(animationBus.getContinuableAnimations()).toEqual(
      new Map([
        [
          "pending-transition",
          {
            id: "pending-transition",
            type: "transition",
            targetId: "scene-root",
            signature: '{"type":"transition"}',
            continuity: "persistent",
            pending: true,
          },
        ],
      ]),
    );

    animationBus.cancelAllExcept(new Set());

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(animationBus.hasContext("pending-transition")).toBe(false);
  });

  it("updates continuation metadata for active and pending contexts", () => {
    const animationBus = createAnimationBus();
    const activeUpdate = vi.fn();
    const pendingUpdate = vi.fn();

    animationBus.dispatch({
      type: "START",
      payload: {
        id: "active-transition",
        driver: "custom",
        animationType: "transition",
        targetId: "scene-root",
        continuity: "persistent",
        signature: '{"type":"transition"}',
        duration: 500,
        onContinuationUpdate: activeUpdate,
      },
    });
    animationBus.flush();

    animationBus.registerPending({
      id: "pending-transition",
      animationType: "transition",
      targetId: "scene-root",
      continuity: "persistent",
      signature: '{"type":"transition"}',
      onContinuationUpdate: pendingUpdate,
    });

    animationBus.updateContinuation("active-transition", { zIndex: 7 });
    animationBus.updateContinuation("pending-transition", { zIndex: 3 });

    expect(activeUpdate).toHaveBeenCalledWith({ zIndex: 7 });
    expect(pendingUpdate).toHaveBeenCalledWith({ zIndex: 3 });
  });
});
