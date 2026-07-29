import { describe, expect, it, vi } from "vitest";
import {
  buildAnimationContinuityPlan,
  dispatchUpdateAnimations,
  getAnimationContinuitySignature,
  groupAnimationsByTarget,
} from "../../src/plugins/animations/planAnimations.js";
import {
  createRenderContext,
  flushDeferredMountOperations,
} from "../../src/plugins/elements/renderContext.js";

describe("buildAnimationContinuityPlan", () => {
  it("continues a persistent update when the target is unchanged", () => {
    const animation = {
      id: "bg-breathe",
      targetId: "bg",
      type: "update",
      playback: { continuity: "persistent" },
      tween: {
        scaleX: {
          keyframes: [{ duration: 1000, value: 1.2, easing: "linear" }],
        },
      },
    };

    const plan = buildAnimationContinuityPlan({
      prevState: {
        elements: [
          { id: "bg", type: "rect", x: 0, y: 0, width: 10, height: 10 },
        ],
      },
      nextState: {
        elements: [
          { id: "bg", type: "rect", x: 0, y: 0, width: 10, height: 10 },
        ],
        animations: [animation],
      },
      activeAnimations: new Map([
        [
          "bg-breathe",
          {
            id: "bg-breathe",
            type: "update",
            targetId: "bg",
            signature: getAnimationContinuitySignature(animation),
            continuity: "persistent",
          },
        ],
      ]),
    });

    expect(plan.continuedAnimationIds).toEqual(new Set(["bg-breathe"]));
  });

  it("does not continue a persistent update when the target changed", () => {
    const animation = {
      id: "bg-breathe",
      targetId: "bg",
      type: "update",
      playback: { continuity: "persistent" },
      tween: {
        scaleX: {
          keyframes: [{ duration: 1000, value: 1.2, easing: "linear" }],
        },
      },
    };

    const plan = buildAnimationContinuityPlan({
      prevState: {
        elements: [
          { id: "bg", type: "rect", x: 0, y: 0, width: 10, height: 10 },
        ],
      },
      nextState: {
        elements: [
          { id: "bg", type: "rect", x: 5, y: 0, width: 10, height: 10 },
        ],
        animations: [animation],
      },
      activeAnimations: new Map([
        [
          "bg-breathe",
          {
            id: "bg-breathe",
            type: "update",
            targetId: "bg",
            signature: getAnimationContinuitySignature(animation),
            continuity: "persistent",
          },
        ],
      ]),
    });

    expect(plan.continuedAnimationIds).toEqual(new Set());
  });

  it("does not continue an update when playback continuity is explicitly render-scoped", () => {
    const animation = {
      id: "bg-breathe",
      targetId: "bg",
      type: "update",
      playback: { continuity: "render" },
      tween: {
        scaleX: {
          keyframes: [{ duration: 1000, value: 1.2, easing: "linear" }],
        },
      },
    };

    const plan = buildAnimationContinuityPlan({
      prevState: {
        elements: [
          { id: "bg", type: "rect", x: 0, y: 0, width: 10, height: 10 },
        ],
      },
      nextState: {
        elements: [
          { id: "bg", type: "rect", x: 0, y: 0, width: 10, height: 10 },
        ],
        animations: [animation],
      },
      activeAnimations: new Map([
        [
          "bg-breathe",
          {
            id: "bg-breathe",
            type: "update",
            targetId: "bg",
            signature: getAnimationContinuitySignature(animation),
            continuity: "render",
          },
        ],
      ]),
    });

    expect(plan.continuedAnimationIds).toEqual(new Set());
  });

  it("does not continue a persistent update when the target is reparented", () => {
    const animation = {
      id: "bg-breathe",
      targetId: "bg",
      type: "update",
      playback: { continuity: "persistent" },
      tween: {
        scaleX: {
          keyframes: [{ duration: 1000, value: 1.2, easing: "linear" }],
        },
      },
    };

    const bgNode = {
      id: "bg",
      type: "rect",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    };
    const prevState = {
      elements: [
        {
          id: "left",
          type: "container",
          x: 0,
          y: 0,
          alpha: 1,
          children: [bgNode],
        },
        {
          id: "right",
          type: "container",
          x: 20,
          y: 0,
          alpha: 1,
          children: [],
        },
      ],
    };
    const nextState = {
      elements: [
        {
          id: "left",
          type: "container",
          x: 0,
          y: 0,
          alpha: 1,
          children: [],
        },
        {
          id: "right",
          type: "container",
          x: 20,
          y: 0,
          alpha: 1,
          children: [{ ...bgNode }],
        },
      ],
      animations: [animation],
    };

    const plan = buildAnimationContinuityPlan({
      prevState,
      nextState,
      activeAnimations: new Map([
        [
          "bg-breathe",
          {
            id: "bg-breathe",
            type: "update",
            targetId: "bg",
            signature: getAnimationContinuitySignature(animation),
            continuity: "persistent",
          },
        ],
      ]),
    });

    expect(plan.continuedAnimationIds).toEqual(new Set());
  });

  it("continues a persistent transition when the target subtree is unchanged", () => {
    const animation = {
      id: "scene-fade",
      targetId: "scene-root",
      type: "transition",
      playback: { continuity: "persistent" },
      next: {
        tween: {
          alpha: {
            keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
          },
        },
      },
    };

    const sceneNode = {
      id: "scene-root",
      type: "container",
      children: [{ id: "bg", type: "rect", x: 0, y: 0, width: 10, height: 10 }],
    };
    const plan = buildAnimationContinuityPlan({
      prevState: {
        elements: [sceneNode],
      },
      nextState: {
        elements: [sceneNode],
        animations: [animation],
      },
      activeAnimations: new Map([
        [
          "scene-fade",
          {
            id: "scene-fade",
            type: "transition",
            targetId: "scene-root",
            signature: getAnimationContinuitySignature(animation),
            continuity: "persistent",
          },
        ],
      ]),
    });

    expect(plan.continuedAnimationIds).toEqual(new Set(["scene-fade"]));
  });

  it("continues a persistent delete-only transition when the target remains absent", () => {
    const animation = {
      id: "fade-out",
      targetId: "portrait",
      type: "transition",
      playback: { continuity: "persistent" },
      prev: {
        tween: {
          alpha: {
            keyframes: [{ duration: 1000, value: 0, easing: "linear" }],
          },
        },
      },
    };

    const plan = buildAnimationContinuityPlan({
      prevState: {
        elements: [],
      },
      nextState: {
        elements: [],
        animations: [animation],
      },
      activeAnimations: new Map([
        [
          "fade-out",
          {
            id: "fade-out",
            type: "transition",
            targetId: "portrait",
            signature: getAnimationContinuitySignature(animation),
            continuity: "persistent",
          },
        ],
      ]),
    });

    expect(plan.continuedAnimationIds).toEqual(new Set(["fade-out"]));
  });

  it("does not continue a persistent transition when a descendant animation is introduced", () => {
    const transitionAnimation = {
      id: "scene-fade",
      targetId: "scene-root",
      type: "transition",
      playback: { continuity: "persistent" },
      next: {
        tween: {
          alpha: {
            keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
          },
        },
      },
    };
    const descendantAnimation = {
      id: "bg-pulse",
      targetId: "bg",
      type: "update",
      tween: {
        alpha: {
          keyframes: [{ duration: 1000, value: 0.5, easing: "linear" }],
        },
      },
    };

    const sceneNode = {
      id: "scene-root",
      type: "container",
      x: 0,
      y: 0,
      alpha: 1,
      children: [{ id: "bg", type: "rect", x: 0, y: 0, width: 10, height: 10 }],
    };
    const plan = buildAnimationContinuityPlan({
      prevState: {
        elements: [sceneNode],
      },
      nextState: {
        elements: [{ ...sceneNode, children: [...sceneNode.children] }],
        animations: [transitionAnimation, descendantAnimation],
      },
      activeAnimations: new Map([
        [
          "scene-fade",
          {
            id: "scene-fade",
            type: "transition",
            targetId: "scene-root",
            signature: getAnimationContinuitySignature(transitionAnimation),
            continuity: "persistent",
          },
        ],
      ]),
    });

    expect(plan.continuedAnimationIds).toEqual(new Set());
  });
});

describe("dispatchUpdateAnimations", () => {
  it("returns false when the target has no update animations", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: vi.fn(),
      track: vi.fn(),
      complete: vi.fn(),
    };

    const dispatched = dispatchUpdateAnimations({
      animations: groupAnimationsByTarget([
        {
          id: "scene-transition",
          targetId: "scene-root",
          type: "transition",
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 300, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ]),
      targetId: "child-1",
      animationBus,
      completionTracker,
      element: { x: 100, alpha: 1 },
      targetState: { x: 100, alpha: 1 },
    });

    expect(dispatched).toBe(false);
    expect(animationBus.dispatch).not.toHaveBeenCalled();
    expect(completionTracker.track).not.toHaveBeenCalled();
  });

  it("dispatches immediate update animations and completes tracked callbacks", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: vi.fn().mockReturnValueOnce(7).mockReturnValueOnce(8),
      track: vi.fn(),
      complete: vi.fn(),
    };
    const onComplete = vi.fn();
    const element = {
      x: 100,
      alpha: 1,
    };

    const animations = groupAnimationsByTarget([
      {
        id: "child-update-position",
        targetId: "child-1",
        type: "update",
        tween: {
          x: {
            initialValue: 20,
            keyframes: [{ duration: 300, value: 100, easing: "linear" }],
          },
        },
      },
      {
        id: "child-update-alpha",
        targetId: "child-1",
        type: "update",
        tween: {
          alpha: {
            initialValue: 0,
            keyframes: [{ duration: 300, value: 1, easing: "linear" }],
          },
        },
      },
      {
        id: "other-update",
        targetId: "child-2",
        type: "update",
        tween: {
          alpha: {
            initialValue: 0,
            keyframes: [{ duration: 150, value: 1, easing: "linear" }],
          },
        },
      },
    ]);

    const dispatched = dispatchUpdateAnimations({
      animations,
      targetId: "child-1",
      animationBus,
      completionTracker,
      element,
      targetState: { x: 100, alpha: 1 },
      onComplete,
    });

    expect(dispatched).toBe(true);
    expect(animationBus.dispatch).toHaveBeenCalledTimes(2);
    expect(completionTracker.track).toHaveBeenNthCalledWith(1, 7);
    expect(completionTracker.track).toHaveBeenNthCalledWith(2, 8);

    const firstDispatch = animationBus.dispatch.mock.calls[0][0];
    const secondDispatch = animationBus.dispatch.mock.calls[1][0];

    expect(firstDispatch).toEqual(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "child-update-position",
          element,
          targetState: { x: 100, alpha: 1 },
        }),
      }),
    );
    expect(secondDispatch).toEqual(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "child-update-alpha",
          element,
          targetState: { x: 100, alpha: 1 },
        }),
      }),
    );

    firstDispatch.payload.onComplete();
    secondDispatch.payload.onComplete();

    expect(completionTracker.complete).toHaveBeenNthCalledWith(1, 7);
    expect(completionTracker.complete).toHaveBeenNthCalledWith(2, 8);
    expect(onComplete.mock.calls.map(([animation]) => animation.id)).toEqual([
      "child-update-position",
      "child-update-alpha",
    ]);
  });

  it("dispatches persistent update animations without tracking render completion", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: vi.fn(),
      track: vi.fn(),
      complete: vi.fn(),
    };
    const onComplete = vi.fn();
    const element = {
      alpha: 1,
    };

    const dispatched = dispatchUpdateAnimations({
      animations: groupAnimationsByTarget([
        {
          id: "bg-breathe",
          targetId: "bg",
          type: "update",
          playback: { continuity: "persistent" },
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      ]),
      targetId: "bg",
      animationBus,
      completionTracker,
      element,
      targetState: { alpha: 1 },
      onComplete,
    });

    expect(dispatched).toBe(true);
    expect(completionTracker.getVersion).not.toHaveBeenCalled();
    expect(completionTracker.track).not.toHaveBeenCalled();
    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "bg-breathe",
          continuity: "persistent",
        }),
      }),
    );

    const dispatchedPayload = animationBus.dispatch.mock.calls[0][0].payload;
    dispatchedPayload.onComplete();

    expect(completionTracker.complete).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bg-breathe" }),
    );
  });

  it("dispatches render-scoped loops without tracking render completion", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: vi.fn(),
      track: vi.fn(),
      complete: vi.fn(),
    };
    const element = {
      x: 10,
      y: 20,
    };
    const onComplete = vi.fn(() => {
      element.x = 30;
      element.y = 40;
    });

    const dispatched = dispatchUpdateAnimations({
      animations: groupAnimationsByTarget([
        {
          id: "ambient-drift",
          targetId: "bg",
          type: "update",
          playback: {
            continuity: "render",
            speed: 1.5,
            loop: true,
          },
          tween: {
            x: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 30, easing: "linear" }],
            },
          },
        },
      ]),
      targetId: "bg",
      animationBus,
      completionTracker,
      element,
      targetState: { x: 30, y: 40 },
      onComplete,
    });

    expect(dispatched).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ambient-drift" }),
    );
    expect(element.x).toBe(10);
    expect(element.y).toBe(40);
    expect(completionTracker.getVersion).not.toHaveBeenCalled();
    expect(completionTracker.track).not.toHaveBeenCalled();
    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "ambient-drift",
          continuity: "render",
          playbackSpeed: 1.5,
          loop: true,
        }),
      }),
    );
  });

  it("does not settle looping animations used by deletion paths", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: vi.fn(),
      track: vi.fn(),
      complete: vi.fn(),
    };
    const element = {
      destroyed: false,
    };
    const onComplete = vi.fn(() => {
      element.destroyed = true;
    });

    const dispatched = dispatchUpdateAnimations({
      animations: groupAnimationsByTarget([
        {
          id: "looping-exit",
          targetId: "bg",
          type: "update",
          playback: { loop: true },
          tween: {
            alpha: {
              initialValue: 1,
              keyframes: [{ duration: 300, value: 0, easing: "linear" }],
            },
          },
        },
      ]),
      targetId: "bg",
      animationBus,
      completionTracker,
      element,
      targetState: null,
      onComplete,
    });

    expect(dispatched).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(element.destroyed).toBe(false);
    expect(animationBus.dispatch).toHaveBeenCalledTimes(1);
  });

  it("defers update animations during suppressed mounts and applies initial values", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: () => 7,
      track: vi.fn(),
      complete: vi.fn(),
    };
    const renderContext = createRenderContext({ suppressAnimations: true });
    const element = {
      x: 100,
      alpha: 1,
    };

    const animations = groupAnimationsByTarget([
      {
        id: "child-update",
        targetId: "child-1",
        type: "update",
        tween: {
          x: {
            initialValue: 20,
            keyframes: [{ duration: 300, value: 100, easing: "linear" }],
          },
          alpha: {
            initialValue: 0,
            keyframes: [{ duration: 300, value: 1, easing: "linear" }],
          },
        },
      },
    ]);

    const dispatched = dispatchUpdateAnimations({
      animations,
      targetId: "child-1",
      animationBus,
      completionTracker,
      element,
      targetState: { x: 100, alpha: 1 },
      renderContext,
    });

    expect(dispatched).toBe(true);
    expect(element.x).toBe(20);
    expect(element.alpha).toBe(0);
    expect(animationBus.dispatch).not.toHaveBeenCalled();
    expect(completionTracker.track).not.toHaveBeenCalled();

    flushDeferredMountOperations(renderContext);

    expect(completionTracker.track).toHaveBeenCalledWith(7);
    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "child-update",
          element,
          targetState: { x: 100, alpha: 1 },
        }),
      }),
    );
  });

  it("defers persistent update animations without tracking render completion", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: vi.fn(),
      track: vi.fn(),
      complete: vi.fn(),
    };
    const renderContext = createRenderContext({ suppressAnimations: true });
    const element = {
      alpha: 1,
    };

    const dispatched = dispatchUpdateAnimations({
      animations: groupAnimationsByTarget([
        {
          id: "bg-breathe",
          targetId: "bg",
          type: "update",
          playback: { continuity: "persistent" },
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      ]),
      targetId: "bg",
      animationBus,
      completionTracker,
      element,
      targetState: { alpha: 1 },
      renderContext,
    });

    expect(dispatched).toBe(true);
    expect(element.alpha).toBe(0);
    expect(animationBus.dispatch).not.toHaveBeenCalled();
    expect(completionTracker.track).not.toHaveBeenCalled();

    flushDeferredMountOperations(renderContext);

    expect(completionTracker.getVersion).not.toHaveBeenCalled();
    expect(completionTracker.track).not.toHaveBeenCalled();
    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "bg-breathe",
          continuity: "persistent",
        }),
      }),
    );
  });

  it("treats already-running persistent update animations as dispatched without restarting them", () => {
    const animationBus = {
      dispatch: vi.fn(),
      hasContext: vi.fn().mockReturnValue(true),
    };
    const completionTracker = {
      getVersion: vi.fn(),
      track: vi.fn(),
      complete: vi.fn(),
    };

    const dispatched = dispatchUpdateAnimations({
      animations: groupAnimationsByTarget([
        {
          id: "bg-breathe",
          targetId: "bg",
          type: "update",
          playback: { continuity: "persistent" },
          tween: {
            scaleX: {
              keyframes: [{ duration: 300, value: 1.2, easing: "linear" }],
            },
          },
        },
      ]),
      targetId: "bg",
      animationBus,
      completionTracker,
      element: { scale: { x: 1, y: 1 } },
      targetState: { scaleX: 1.2 },
    });

    expect(dispatched).toBe(true);
    expect(animationBus.dispatch).not.toHaveBeenCalled();
    expect(completionTracker.track).not.toHaveBeenCalled();
  });

  it("throws when deferred update animations receive an onComplete hook", () => {
    const animations = groupAnimationsByTarget([
      {
        id: "child-update",
        targetId: "child-1",
        type: "update",
        tween: {
          alpha: {
            initialValue: 0,
            keyframes: [{ duration: 300, value: 1, easing: "linear" }],
          },
        },
      },
    ]);

    expect(() =>
      dispatchUpdateAnimations({
        animations,
        targetId: "child-1",
        animationBus: { dispatch: vi.fn() },
        completionTracker: {
          getVersion: () => 7,
          track: vi.fn(),
          complete: vi.fn(),
        },
        element: { alpha: 1 },
        targetState: { alpha: 1 },
        onComplete: vi.fn(),
        renderContext: createRenderContext({ suppressAnimations: true }),
      }),
    ).toThrow("Deferred update animations do not support onComplete hooks.");
  });

  it("throws before tracking when auto tween targetState is missing a property", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: vi.fn(),
      track: vi.fn(),
      complete: vi.fn(),
    };

    const animations = groupAnimationsByTarget([
      {
        id: "child-auto-update",
        targetId: "child-1",
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

    expect(() =>
      dispatchUpdateAnimations({
        animations,
        targetId: "child-1",
        animationBus,
        completionTracker,
        element: { x: 20 },
        targetState: { alpha: 1 },
      }),
    ).toThrow(
      'Animation "child-auto-update" cannot auto-resolve property "x" from targetState.',
    );

    expect(completionTracker.track).not.toHaveBeenCalled();
    expect(animationBus.dispatch).not.toHaveBeenCalled();
  });

  it("defers auto update animations without mutating the initial live value", () => {
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };
    const renderContext = createRenderContext({ suppressAnimations: true });
    const element = {
      x: 100,
      alpha: 1,
      scale: { x: 1, y: 1 },
    };

    const animations = groupAnimationsByTarget([
      {
        id: "child-auto-update",
        targetId: "child-1",
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

    const dispatched = dispatchUpdateAnimations({
      animations,
      targetId: "child-1",
      animationBus,
      completionTracker,
      element,
      targetState: { x: 240 },
      renderContext,
    });

    expect(dispatched).toBe(true);
    expect(element.x).toBe(100);
    expect(animationBus.dispatch).not.toHaveBeenCalled();
    expect(completionTracker.track).not.toHaveBeenCalled();

    flushDeferredMountOperations(renderContext);

    expect(completionTracker.track).toHaveBeenCalledWith(11);
    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "child-auto-update",
          element,
          targetState: { x: 240 },
        }),
      }),
    );
  });
});
