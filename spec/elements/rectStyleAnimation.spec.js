import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import { addRect } from "../../src/plugins/elements/rect/addRect.js";
import { updateRect } from "../../src/plugins/elements/rect/updateRect.js";
import { parseRect } from "../../src/plugins/elements/rect/parseRect.js";
import { getRectStyleAnimationValue } from "../../src/plugins/elements/rect/rectStyleRuntime.js";
import { normalizeAnimations } from "../../src/util/normalizeAnimations.js";

const app = {
  audioStage: { add: vi.fn() },
};

const completionTracker = {
  getVersion: () => 1,
  track: vi.fn(),
  complete: vi.fn(),
};

const createRect = (overrides = {}) =>
  parseRect({
    state: {
      id: "panel",
      type: "rect",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      fill: "#ff0000",
      border: { width: 2, color: "#ffffff", alpha: 1 },
      cornerRadius: 4,
      ...overrides,
    },
  });

const mountRect = (parent, element, animationBus, animations = []) => {
  addRect({
    app,
    parent,
    element,
    animations,
    animationBus,
    completionTracker,
    eventHandler: vi.fn(),
    zIndex: 0,
  });
  animationBus.flush();
  return parent.getChildByLabel(element.id);
};

describe("rect style animation", () => {
  it("animates dimensions, solid colors, border, and independent corners", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect();
    const nextElement = createRect({
      width: 300,
      height: 180,
      fill: "#0000ff",
      border: { width: 10, color: "#00ff00", alpha: 0.5 },
      cornerRadius: {
        topLeft: 20,
        topRight: 30,
        bottomRight: 40,
        bottomLeft: 50,
      },
    });
    const rect = mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "reshape",
        targetId: "panel",
        type: "update",
        tween: {
          width: { auto: { duration: 1000 } },
          height: { auto: { duration: 1000 } },
          fill: {
            color: { auto: { duration: 1000 } },
          },
          border: {
            width: { auto: { duration: 1000 } },
            color: { auto: { duration: 1000 } },
            alpha: { auto: { duration: 1000 } },
          },
          cornerRadius: {
            topLeft: { auto: { duration: 1000 } },
            topRight: { auto: { duration: 1000 } },
            bottomRight: { auto: { duration: 1000 } },
            bottomLeft: { auto: { duration: 1000 } },
          },
        },
      },
    ]);

    updateRect({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });
    const clearSpy = vi.spyOn(rect, "clear");
    animationBus.flush();
    animationBus.tick(500);

    expect(clearSpy).toHaveBeenCalledTimes(2);

    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(250);
    expect(getRectStyleAnimationValue(rect, "rect.height")).toBe(140);
    expect(getRectStyleAnimationValue(rect, "rect.fill.color")).toEqual([
      0.5, 0, 0.5, 1,
    ]);
    expect(getRectStyleAnimationValue(rect, "rect.border.width")).toBe(6);
    expect(getRectStyleAnimationValue(rect, "rect.border.color")).toEqual([
      0.5, 1, 0.5, 1,
    ]);
    expect(getRectStyleAnimationValue(rect, "rect.border.alpha")).toBe(0.75);
    expect(getRectStyleAnimationValue(rect, "rect.cornerRadius.topLeft")).toBe(
      12,
    );
    expect(
      getRectStyleAnimationValue(rect, "rect.cornerRadius.bottomLeft"),
    ).toBe(27);

    animationBus.tick(500);

    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(300);
    expect(getRectStyleAnimationValue(rect, "rect.fill.color")).toEqual([
      0, 0, 1, 1,
    ]);
    expect(
      getRectStyleAnimationValue(rect, "rect.cornerRadius.bottomLeft"),
    ).toBe(50);
  });

  it("composes dimension and scale tweens without applying baked scale twice", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect({
      width: 100,
      height: 80,
      scaleX: 2,
      scaleY: 0.5,
    });
    const nextElement = createRect({
      width: 200,
      height: 120,
      scaleX: 3,
      scaleY: 1.5,
    });
    const rect = mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "resize-and-scale",
        targetId: "panel",
        type: "update",
        tween: {
          width: { auto: { duration: 1000 } },
          height: { auto: { duration: 1000 } },
          scaleX: { auto: { duration: 1000 } },
          scaleY: { auto: { duration: 1000 } },
        },
      },
    ]);

    updateRect({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });

    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(100);
    expect(getRectStyleAnimationValue(rect, "rect.height")).toBe(80);
    expect(rect.scale.x).toBe(2);
    expect(rect.scale.y).toBe(0.5);

    animationBus.flush();
    animationBus.tick(500);

    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(150);
    expect(getRectStyleAnimationValue(rect, "rect.height")).toBe(100);
    expect(rect.scale.x).toBe(2.5);
    expect(rect.scale.y).toBe(1);
    expect(getRectStyleAnimationValue(rect, "rect.width") * rect.scale.x).toBe(
      375,
    );
    expect(getRectStyleAnimationValue(rect, "rect.height") * rect.scale.y).toBe(
      100,
    );

    animationBus.tick(500);

    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(600);
    expect(getRectStyleAnimationValue(rect, "rect.height")).toBe(180);
    expect(rect.scale.x).toBe(1);
    expect(rect.scale.y).toBe(1);
  });

  it("settles scale-only tweens to unbaked geometry when cancelled", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect({
      width: 100,
      height: 80,
      scaleX: 2,
      scaleY: 0.5,
    });
    const nextElement = createRect({
      width: 100,
      height: 80,
      scaleX: 3,
      scaleY: 1.5,
    });
    const rect = mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "scale-only",
        targetId: "panel",
        type: "update",
        tween: {
          scaleX: { auto: { duration: 1000 } },
          scaleY: { auto: { duration: 1000 } },
        },
      },
    ]);

    updateRect({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });
    animationBus.flush();
    animationBus.tick(250);
    animationBus.cancelAllExcept(new Set());

    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(100);
    expect(getRectStyleAnimationValue(rect, "rect.height")).toBe(80);
    expect(rect.scale.x).toBe(3);
    expect(rect.scale.y).toBe(1.5);
    expect(getRectStyleAnimationValue(rect, "rect.width") * rect.scale.x).toBe(
      nextElement.width,
    );
    expect(getRectStyleAnimationValue(rect, "rect.height") * rect.scale.y).toBe(
      nextElement.height,
    );

    updateRect({
      app,
      parent,
      prevElement: nextElement,
      nextElement,
      animations: [],
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });

    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(
      nextElement.width,
    );
    expect(getRectStyleAnimationValue(rect, "rect.height")).toBe(
      nextElement.height,
    );
    expect(rect.scale.x).toBe(1);
    expect(rect.scale.y).toBe(1);
  });

  it("reveals an authored zero-width border without losing its styling", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect({
      border: { width: 0, color: "#ff0000", alpha: 0.35 },
    });
    const nextElement = createRect({
      border: { width: 8, color: "#ff0000", alpha: 0.35 },
    });
    const rect = mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "reveal-border",
        targetId: "panel",
        type: "update",
        tween: {
          border: {
            width: {
              initialValue: 0,
              keyframes: [{ duration: 1000, value: 8 }],
            },
          },
        },
      },
    ]);

    updateRect({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });
    animationBus.flush();
    animationBus.tick(500);

    expect(getRectStyleAnimationValue(rect, "rect.border.width")).toBe(4);
    expect(getRectStyleAnimationValue(rect, "rect.border.color")).toEqual([
      1, 0, 0, 1,
    ]);
    expect(getRectStyleAnimationValue(rect, "rect.border.alpha")).toBe(0.35);
  });

  it("animates gradient geometry, offsets, and colors", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect({
      fill: {
        type: "linear-gradient",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    });
    const nextElement = createRect({
      fill: {
        type: "linear-gradient",
        start: { x: 0.25, y: 0.5 },
        end: { x: 0.75, y: 1 },
        stops: [
          { offset: 0.2, color: "#00ff00" },
          { offset: 0.8, color: "#ffffff" },
        ],
      },
    });
    const rect = mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "gradient-shift",
        targetId: "panel",
        type: "update",
        tween: {
          fill: {
            start: {
              x: { auto: { duration: 1000 } },
              y: { auto: { duration: 1000 } },
            },
            end: {
              x: { auto: { duration: 1000 } },
              y: { auto: { duration: 1000 } },
            },
            stops: [
              {
                index: 0,
                offset: { auto: { duration: 1000 } },
                color: { auto: { duration: 1000 } },
              },
              {
                index: 1,
                offset: { auto: { duration: 1000 } },
                color: { auto: { duration: 1000 } },
              },
            ],
          },
        },
      },
    ]);

    updateRect({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });
    animationBus.flush();
    animationBus.tick(500);

    expect(getRectStyleAnimationValue(rect, "rect.fill.start.x")).toBe(0.125);
    expect(getRectStyleAnimationValue(rect, "rect.fill.start.y")).toBe(0.25);
    expect(getRectStyleAnimationValue(rect, "rect.fill.end.x")).toBe(0.875);
    expect(getRectStyleAnimationValue(rect, "rect.fill.end.y")).toBe(0.5);
    expect(
      getRectStyleAnimationValue(rect, "rect.fill.stops.0.offset"),
    ).toBeCloseTo(0.1);
    expect(
      getRectStyleAnimationValue(rect, "rect.fill.stops.1.offset"),
    ).toBeCloseTo(0.9);
    expect(getRectStyleAnimationValue(rect, "rect.fill.stops.0.color")).toEqual(
      [0.5, 0.5, 0, 1],
    );
    expect(getRectStyleAnimationValue(rect, "rect.fill.stops.1.color")).toEqual(
      [0.5, 0.5, 1, 1],
    );
  });

  it("animates radial-gradient centers, radii, scale, and rotation", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect({
      fill: {
        type: "radial-gradient",
        innerCenter: { x: 0.2, y: 0.3 },
        innerRadius: 0.1,
        outerCenter: { x: 0.4, y: 0.5 },
        outerRadius: 0.6,
        scale: 1,
        rotation: 0,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    const nextElement = createRect({
      fill: {
        type: "radial-gradient",
        innerCenter: { x: 0.4, y: 0.5 },
        innerRadius: 0.3,
        outerCenter: { x: 0.8, y: 0.9 },
        outerRadius: 1,
        scale: 2,
        rotation: Math.PI,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    const rect = mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "radial-shift",
        targetId: "panel",
        type: "update",
        tween: {
          fill: {
            innerCenter: {
              x: { auto: { duration: 1000 } },
              y: { auto: { duration: 1000 } },
            },
            innerRadius: { auto: { duration: 1000 } },
            outerCenter: {
              x: { auto: { duration: 1000 } },
              y: { auto: { duration: 1000 } },
            },
            outerRadius: { auto: { duration: 1000 } },
            scale: { auto: { duration: 1000 } },
            rotation: { auto: { duration: 1000 } },
          },
        },
      },
    ]);

    updateRect({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });
    animationBus.flush();
    animationBus.tick(500);

    expect(
      getRectStyleAnimationValue(rect, "rect.fill.innerCenter.x"),
    ).toBeCloseTo(0.3);
    expect(
      getRectStyleAnimationValue(rect, "rect.fill.innerCenter.y"),
    ).toBeCloseTo(0.4);
    expect(
      getRectStyleAnimationValue(rect, "rect.fill.innerRadius"),
    ).toBeCloseTo(0.2);
    expect(
      getRectStyleAnimationValue(rect, "rect.fill.outerCenter.x"),
    ).toBeCloseTo(0.6);
    expect(
      getRectStyleAnimationValue(rect, "rect.fill.outerCenter.y"),
    ).toBeCloseTo(0.7);
    expect(
      getRectStyleAnimationValue(rect, "rect.fill.outerRadius"),
    ).toBeCloseTo(0.8);
    expect(getRectStyleAnimationValue(rect, "rect.fill.scale")).toBeCloseTo(
      1.5,
    );
    expect(getRectStyleAnimationValue(rect, "rect.fill.rotation")).toBeCloseTo(
      Math.PI / 2,
    );
  });

  it("settles every rect style channel in one redraw when interrupted", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect();
    const nextElement = createRect({
      width: 300,
      fill: "#0000ff",
      border: { width: 8, color: "#00ff00", alpha: 0.5 },
      cornerRadius: 24,
    });
    const rect = mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "interruptible-style",
        targetId: "panel",
        type: "update",
        tween: {
          width: { auto: { duration: 1000 } },
          fill: { color: { auto: { duration: 1000 } } },
          border: {
            width: { auto: { duration: 1000 } },
            color: { auto: { duration: 1000 } },
            alpha: { auto: { duration: 1000 } },
          },
          cornerRadius: { auto: { duration: 1000 } },
        },
      },
    ]);

    updateRect({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });
    animationBus.flush();
    animationBus.tick(250);

    const clearSpy = vi.spyOn(rect, "clear");
    animationBus.cancelAllExcept(new Set());

    expect(clearSpy).toHaveBeenCalledOnce();
    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(300);
    expect(getRectStyleAnimationValue(rect, "rect.fill.color")).toEqual([
      0, 0, 1, 1,
    ]);
    expect(getRectStyleAnimationValue(rect, "rect.border.width")).toBe(8);
    expect(getRectStyleAnimationValue(rect, "rect.border.color")).toEqual([
      0, 1, 0, 1,
    ]);
    expect(getRectStyleAnimationValue(rect, "rect.border.alpha")).toBe(0.5);
    expect(
      getRectStyleAnimationValue(rect, "rect.cornerRadius.bottomLeft"),
    ).toBe(24);
  });

  it("applies explicit rect style initial values on mount", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const element = createRect({
      width: 300,
      fill: "#0000ff",
      cornerRadius: 40,
    });
    const animations = normalizeAnimations([
      {
        id: "enter-style",
        targetId: "panel",
        type: "update",
        tween: {
          width: {
            initialValue: 120,
            keyframes: [{ duration: 1000, value: 300 }],
          },
          fill: {
            color: {
              initialValue: "#ff0000",
              keyframes: [{ duration: 1000, value: "#0000ff" }],
            },
          },
          cornerRadius: {
            initialValue: 0,
            keyframes: [{ duration: 1000, value: 40 }],
          },
        },
      },
    ]);

    const rect = mountRect(parent, element, animationBus, animations);

    expect(getRectStyleAnimationValue(rect, "rect.width")).toBe(120);
    expect(getRectStyleAnimationValue(rect, "rect.fill.color")).toEqual([
      1, 0, 0, 1,
    ]);
    expect(getRectStyleAnimationValue(rect, "rect.cornerRadius.topRight")).toBe(
      0,
    );
  });

  it("fails before playback when the current fill shape is incompatible", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect({ fill: "#ff0000" });
    const nextElement = createRect({
      fill: {
        type: "linear-gradient",
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "incompatible-fill",
        targetId: "panel",
        type: "update",
        tween: {
          fill: {
            start: {
              x: { auto: { duration: 100 } },
            },
          },
        },
      },
    ]);

    expect(() =>
      updateRect({
        app,
        parent,
        prevElement,
        nextElement,
        animations,
        animationBus,
        completionTracker,
        eventHandler: vi.fn(),
        zIndex: 0,
      }),
    ).toThrow(
      'Animation "incompatible-fill" property "fill.start.x" is incompatible with the current rect fill.',
    );
  });

  it("fails before playback when a gradient stop target is missing", () => {
    const parent = new Container();
    const animationBus = createAnimationBus();
    const prevElement = createRect({
      fill: {
        type: "linear-gradient",
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    const nextElement = createRect({
      fill: {
        type: "linear-gradient",
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 0.5, color: "#00ff00" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    });
    mountRect(parent, prevElement, animationBus);
    const animations = normalizeAnimations([
      {
        id: "missing-stop",
        targetId: "panel",
        type: "update",
        tween: {
          fill: {
            stops: [
              {
                index: 2,
                color: { auto: { duration: 100 } },
              },
            ],
          },
        },
      },
    ]);

    expect(() =>
      updateRect({
        app,
        parent,
        prevElement,
        nextElement,
        animations,
        animationBus,
        completionTracker,
        eventHandler: vi.fn(),
        zIndex: 0,
      }),
    ).toThrow(
      'Animation "missing-stop" property "fill.stops.2.color" is incompatible with the current rect fill.',
    );
  });
});
