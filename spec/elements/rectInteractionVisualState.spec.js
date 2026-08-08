import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import { addRect } from "../../src/plugins/elements/rect/addRect.js";
import { deleteRect } from "../../src/plugins/elements/rect/deleteRect.js";
import {
  getRectBaseAlpha,
  getRectEffectiveAppearance,
} from "../../src/plugins/elements/rect/rectAppearanceRuntime.js";
import { parseRect } from "../../src/plugins/elements/rect/parseRect.js";
import { getRectStyleAnimationValue } from "../../src/plugins/elements/rect/rectStyleRuntime.js";
import { updateRect } from "../../src/plugins/elements/rect/updateRect.js";
import {
  setTreeInheritedHover,
  setTreeInheritedPress,
  setTreeInheritedRightPress,
} from "../../src/plugins/elements/util/hoverInheritance.js";
import { normalizeAnimations } from "../../src/util/normalizeAnimations.js";

const app = { audioStage: { add: vi.fn() } };
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
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      fill: "#111111",
      alpha: 0.8,
      ...overrides,
    },
  });

const mountRect = ({ element = createRect(), eventHandler = vi.fn() } = {}) => {
  const parent = new Container();
  const animationBus = createAnimationBus();
  addRect({
    app,
    parent,
    element,
    animations: [],
    animationBus,
    completionTracker,
    eventHandler,
    zIndex: 0,
  });
  animationBus.flush();
  return {
    parent,
    rect: parent.getChildByLabel(element.id),
    animationBus,
    eventHandler,
  };
};

describe("rect interaction visual states", () => {
  it("cascades partial hover, click, and right-click appearance by field", () => {
    const element = createRect({
      hover: { fill: "#222222", alpha: 0.9 },
      click: { alpha: 0 },
      rightClick: { fill: "#333333" },
    });
    const { rect } = mountRect({ element });

    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#111111",
      alpha: 0.8,
    });

    rect.emit("pointerover");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#222222",
      alpha: 0.9,
    });
    expect(rect.alpha).toBe(0.9);

    rect.emit("pointerdown");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#222222",
      alpha: 0,
    });

    rect.emit("rightdown");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#333333",
      alpha: 0,
    });

    rect.emit("rightup");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#222222",
      alpha: 0,
    });

    rect.emit("pointerup");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#222222",
      alpha: 0.9,
    });

    rect.emit("pointerout");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#111111",
      alpha: 0.8,
    });
  });

  it("fully replaces and restores structured and transparent fills", () => {
    const element = createRect({
      hover: {
        fill: {
          type: "linear-gradient",
          stops: [
            { offset: 0, color: "#ff0000" },
            { offset: 1, color: "#0000ff" },
          ],
        },
      },
      click: { fill: "transparent", alpha: 0 },
    });
    const { rect } = mountRect({ element });

    rect.emit("pointerover");
    expect(getRectEffectiveAppearance(rect).fill).toEqual(element.hover.fill);
    expect(rect._rtglFillResource).toBeDefined();

    rect.emit("pointerdown");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "transparent",
      alpha: 0,
    });
    expect(rect._rtglFillResource).toBeUndefined();

    rect.emit("pointerup");
    expect(getRectEffectiveAppearance(rect).fill).toEqual(element.hover.fill);
    expect(rect._rtglFillResource).toBeDefined();

    rect.emit("pointerout");
    expect(getRectEffectiveAppearance(rect).fill).toBe("#111111");
    expect(rect._rtglFillResource).toBeUndefined();
  });

  it("clears pressed appearance outside without emitting a click", () => {
    const eventHandler = vi.fn();
    const { rect } = mountRect({
      element: createRect({
        click: { fill: "#222222", payload: { action: "click" } },
        rightClick: { fill: "#333333", payload: { action: "context" } },
      }),
      eventHandler,
    });

    rect.emit("pointerdown", { button: 2 });
    expect(getRectEffectiveAppearance(rect).fill).toBe("#111111");

    rect.emit("pointerdown");
    expect(getRectEffectiveAppearance(rect).fill).toBe("#222222");
    rect.emit("pointerupoutside");
    expect(getRectEffectiveAppearance(rect).fill).toBe("#111111");

    rect.emit("rightdown");
    expect(getRectEffectiveAppearance(rect).fill).toBe("#333333");
    rect.emit("rightupoutside");
    expect(getRectEffectiveAppearance(rect).fill).toBe("#111111");
    expect(eventHandler).not.toHaveBeenCalled();
  });

  it("preserves active direct state and applies updated configs immediately", () => {
    const prevElement = createRect({
      hover: { fill: "#222222", alpha: 0.9 },
    });
    const nextElement = createRect({
      fill: "#444444",
      alpha: 0.6,
      hover: { fill: "#555555", alpha: 0.7 },
    });
    const { parent, rect, animationBus } = mountRect({ element: prevElement });

    rect.emit("pointerover");
    updateRect({
      app,
      parent,
      prevElement,
      nextElement,
      animations: [],
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });

    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#555555",
      alpha: 0.7,
    });
    rect.emit("pointerout");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#444444",
      alpha: 0.6,
    });

    const removedElement = createRect({ fill: "#666666", alpha: 0.4 });
    rect.emit("pointerover");
    updateRect({
      app,
      parent,
      prevElement: nextElement,
      nextElement: removedElement,
      animations: [],
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      zIndex: 0,
    });
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#666666",
      alpha: 0.4,
    });
  });

  it.each([
    {
      name: "replaces",
      nextOverrides: { hover: { fill: "#555555", alpha: 0.7 } },
      expected: { fill: "#555555", alpha: 0.7 },
    },
    {
      name: "removes",
      nextOverrides: {},
      expected: { fill: "#111111", alpha: 0.8 },
    },
  ])(
    "$name active interaction appearance before an unrelated tween completes",
    ({ nextOverrides, expected }) => {
      const prevElement = createRect({
        hover: { fill: "#222222", alpha: 0.9 },
      });
      const nextElement = createRect({ x: 100, ...nextOverrides });
      const { parent, rect, animationBus } = mountRect({
        element: prevElement,
      });
      const animations = normalizeAnimations([
        {
          id: "move-panel",
          targetId: "panel",
          type: "update",
          tween: {
            x: { auto: { duration: 1000, easing: "linear" } },
          },
        },
      ]);

      rect.emit("pointerover");
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

      expect(getRectEffectiveAppearance(rect)).toEqual(expected);
      expect(rect.x).toBe(prevElement.x);
    },
  );

  it("supports inherited hover, press, and right-press state", () => {
    const root = new Container();
    const { rect } = mountRect({
      element: createRect({
        hover: { fill: "#222222" },
        click: { alpha: 0.5 },
        rightClick: { fill: "#333333" },
      }),
    });
    root.addChild(rect);

    setTreeInheritedHover({ root, isHovered: true });
    expect(getRectEffectiveAppearance(rect).fill).toBe("#222222");
    setTreeInheritedPress({ root, isPressed: true });
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#222222",
      alpha: 0.5,
    });
    setTreeInheritedRightPress({ root, isPressed: true });
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#333333",
      alpha: 0.5,
    });

    setTreeInheritedRightPress({ root, isPressed: false });
    setTreeInheritedPress({ root, isPressed: false });
    setTreeInheritedHover({ root, isHovered: false });
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#111111",
      alpha: 0.8,
    });
  });

  it("retains inherited state until every nested source releases it", () => {
    const outer = new Container();
    const inner = new Container();
    const { rect } = mountRect({
      element: createRect({ hover: { fill: "#222222" } }),
    });
    outer.addChild(inner);
    inner.addChild(rect);

    setTreeInheritedHover({ root: outer, isHovered: true });
    setTreeInheritedHover({ root: inner, isHovered: true });
    setTreeInheritedHover({ root: outer, isHovered: false });
    expect(getRectEffectiveAppearance(rect).fill).toBe("#222222");

    setTreeInheritedHover({ root: inner, isHovered: false });
    expect(getRectEffectiveAppearance(rect).fill).toBe("#111111");
  });

  it("cleans up appearance and interaction state when deleted", () => {
    const element = createRect({ hover: { fill: "#222222", alpha: 0.4 } });
    const { parent, rect, animationBus } = mountRect({ element });
    rect.emit("pointerover");

    deleteRect({
      parent,
      element,
      animations: [],
      animationBus,
      completionTracker,
    });

    expect(rect.destroyed).toBe(true);
    expect(getRectEffectiveAppearance(rect)).toBeNull();
  });

  it("keeps legacy alpha and fill tweens advancing under hover overrides", () => {
    const prevElement = createRect({
      alpha: 1,
      fill: "#ff0000",
      hover: { alpha: 0.9, fill: "#00ff00" },
    });
    const nextElement = createRect({
      alpha: 0.2,
      fill: "#0000ff",
      hover: { alpha: 0.9, fill: "#00ff00" },
    });
    const { parent, rect, animationBus } = mountRect({ element: prevElement });
    const animations = normalizeAnimations([
      {
        id: "animate-under-hover",
        targetId: "panel",
        type: "update",
        tween: {
          alpha: { auto: { duration: 1000, easing: "linear" } },
          fill: { color: { auto: { duration: 1000, easing: "linear" } } },
        },
      },
    ]);

    rect.emit("pointerover");
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

    expect(getRectBaseAlpha(rect)).toBeCloseTo(0.6);
    expect(getRectStyleAnimationValue(rect, "rect.fill.color")).toEqual([
      0.5, 0, 0.5, 1,
    ]);
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#00ff00",
      alpha: 0.9,
    });

    rect.emit("pointerout");
    expect(rect.alpha).toBeCloseTo(0.6);
    expect(getRectEffectiveAppearance(rect).fill).toEqual([0.5, 0, 0.5, 1]);

    rect.emit("pointerover");
    animationBus.tick(500);
    expect(getRectBaseAlpha(rect)).toBeCloseTo(0.2);
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#00ff00",
      alpha: 0.9,
    });
    rect.emit("pointerout");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#0000ff",
      alpha: 0.2,
    });
  });

  it("does not redraw geometry after an update alpha initial value is applied", () => {
    const prevElement = createRect({ alpha: 1 });
    const nextElement = createRect({ alpha: 1, x: 100 });
    const { parent, rect, animationBus } = mountRect({ element: prevElement });
    const animations = normalizeAnimations([
      {
        id: "initial-alpha-without-redraw",
        targetId: "panel",
        type: "update",
        tween: {
          alpha: {
            initialValue: 0.3,
            keyframes: [
              { duration: 1000, value: 0.7, easing: "linear" },
              { duration: 1000, value: 1, easing: "linear" },
            ],
          },
        },
      },
    ]);
    const clearSpy = vi.spyOn(rect, "clear");

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

    expect(getRectBaseAlpha(rect)).toBe(0.3);
    expect(rect.alpha).toBe(0.3);
    expect(clearSpy).not.toHaveBeenCalled();

    animationBus.tick(800);
    expect(getRectBaseAlpha(rect)).toBeCloseTo(0.62);
    expect(rect.alpha).toBeCloseTo(0.62);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("settles animated base values on cancellation without exposing them early", () => {
    const prevElement = createRect({
      alpha: 1,
      fill: "#ff0000",
      hover: { alpha: 0.9, fill: "#00ff00" },
    });
    const nextElement = createRect({
      alpha: 0.2,
      fill: "#0000ff",
      hover: { alpha: 0.9, fill: "#00ff00" },
    });
    const { parent, rect, animationBus } = mountRect({ element: prevElement });
    const animations = normalizeAnimations([
      {
        id: "cancel-under-hover",
        targetId: "panel",
        type: "update",
        tween: {
          alpha: { auto: { duration: 1000, easing: "linear" } },
          fill: { color: { auto: { duration: 1000, easing: "linear" } } },
        },
      },
    ]);

    rect.emit("pointerover");
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

    expect(getRectBaseAlpha(rect)).toBe(0.2);
    expect(getRectStyleAnimationValue(rect, "rect.fill.color")).toEqual([
      0, 0, 1, 1,
    ]);
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: "#00ff00",
      alpha: 0.9,
    });
    rect.emit("pointerout");
    expect(getRectEffectiveAppearance(rect)).toEqual({
      fill: [0, 0, 1, 1],
      alpha: 0.2,
    });
  });

  it("keeps looping base animations isolated under interaction appearance", () => {
    const prevElement = createRect({ alpha: 1, hover: { alpha: 0.95 } });
    const nextElement = createRect({ alpha: 0.2, hover: { alpha: 0.95 } });
    const { parent, rect, animationBus } = mountRect({ element: prevElement });
    const animations = normalizeAnimations([
      {
        id: "loop-under-hover",
        targetId: "panel",
        type: "update",
        playback: { loop: true },
        tween: {
          alpha: {
            initialValue: 1,
            keyframes: [{ duration: 1000, value: 0.2, easing: "linear" }],
          },
        },
      },
    ]);

    rect.emit("pointerover");
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
    expect(getRectBaseAlpha(rect)).toBeCloseTo(0.8);
    expect(rect.alpha).toBe(0.95);

    animationBus.tick(1000);
    expect(getRectBaseAlpha(rect)).toBeCloseTo(0.8);
    expect(rect.alpha).toBe(0.95);

    animationBus.cancelAllExcept(new Set());
    rect.emit("pointerout");
    expect(rect.alpha).toBe(0.2);
  });

  it("routes portable timeline alpha through the animated base channel", () => {
    const prevElement = createRect({ alpha: 1, hover: { alpha: 0.95 } });
    const nextElement = createRect({ alpha: 0.4, hover: { alpha: 0.95 } });
    const { parent, rect, animationBus } = mountRect({ element: prevElement });
    const animations = normalizeAnimations([
      {
        id: "portable-alpha-under-hover",
        targetId: "panel",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { alpha: 0.4 },
              duration: 1000,
              easing: "linear",
            },
          ],
        },
      },
    ]);

    rect.emit("pointerover");
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
    expect(animationBus.seek("portable-alpha-under-hover", 500)).toBe(true);

    expect(rect.alpha).toBe(0.95);
    expect(getRectBaseAlpha(rect)).toBeCloseTo(0.7);
    rect.emit("pointerout");
    expect(rect.alpha).toBeCloseTo(0.7);
  });
});
