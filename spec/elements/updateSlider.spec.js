import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { addSlider } from "../../src/plugins/elements/slider/addSlider.js";
import { updateSlider } from "../../src/plugins/elements/slider/updateSlider.js";

const createSharedParams = () => ({
  app: {
    audioStage: {
      add: vi.fn(),
    },
  },
  animations: [],
  animationBus: {
    dispatch: vi.fn(),
  },
  completionTracker: {
    getVersion: () => 0,
    track: () => {},
    complete: () => {},
  },
});

const createSharedParamsWithNativeDrag = () => ({
  ...createSharedParams(),
  app: {
    audioStage: {
      add: vi.fn(),
    },
    renderer: {
      events: {
        mapPositionToPoint: (point, x, y) => {
          point.x = x;
          point.y = y;
        },
      },
    },
  },
});

const createSliderElement = (overrides = {}) => ({
  id: "slider-1",
  type: "slider",
  x: 100,
  y: 100,
  width: 200,
  height: 20,
  alpha: 1,
  direction: "horizontal",
  min: 0,
  max: 100,
  step: 1,
  initialValue: 0,
  change: {
    payload: { source: "drag" },
  },
  ...overrides,
});

describe("updateSlider", () => {
  it("applies and resets degree rotation around the configured origin", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const prevElement = createSliderElement({
      originX: 20,
      originY: 8,
      rotation: 90,
    });

    addSlider({
      ...shared,
      parent,
      eventHandler: vi.fn(),
      zIndex: 0,
      element: prevElement,
    });

    const slider = parent.getChildByLabel("slider-1");

    expect(slider.x).toBe(120);
    expect(slider.y).toBe(108);
    expect(slider.pivot.x).toBe(20);
    expect(slider.pivot.y).toBe(8);
    expect(slider.rotation).toBeCloseTo(Math.PI / 2);

    const nextElement = createSliderElement({
      x: 140,
      y: 120,
      originX: 10,
      originY: 5,
      rotation: 0,
    });

    updateSlider({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler: vi.fn(),
      zIndex: 0,
    });

    expect(slider.x).toBe(150);
    expect(slider.y).toBe(125);
    expect(slider.pivot.x).toBe(10);
    expect(slider.pivot.y).toBe(5);
    expect(slider.rotation).toBe(0);
  });

  it("keeps dragging active when renders update the slider value", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParamsWithNativeDrag();
    const prevElement = createSliderElement();

    addSlider({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: prevElement,
    });

    const slider = parent.getChildByLabel("slider-1");

    slider.emit("pointerdown", { global: { x: 280, y: 110 } });

    const nextElement = createSliderElement({
      initialValue: eventHandler.mock.calls[0][1]._event.value,
    });

    updateSlider({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler,
      zIndex: 0,
    });

    const moveEvent =
      typeof PointerEvent === "function"
        ? new PointerEvent("pointermove", {
            clientX: 290,
            clientY: 110,
            bubbles: true,
          })
        : new MouseEvent("mousemove", {
            clientX: 290,
            clientY: 110,
            bubbles: true,
          });
    const upEvent =
      typeof PointerEvent === "function"
        ? new PointerEvent("pointerup", {
            clientX: 290,
            clientY: 110,
            bubbles: true,
          })
        : new MouseEvent("mouseup", {
            clientX: 290,
            clientY: 110,
            bubbles: true,
          });

    document.dispatchEvent(moveEvent);
    window.dispatchEvent(upEvent);

    expect(eventHandler).toHaveBeenCalledTimes(2);
    expect(eventHandler.mock.calls[1][0]).toBe("change");
    expect(eventHandler.mock.calls[1][1]._event.value).toBeGreaterThan(
      eventHandler.mock.calls[0][1]._event.value,
    );
  });

  it("syncs programmatic value updates before the next pointerdown", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();
    const prevElement = createSliderElement();

    addSlider({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: prevElement,
    });

    updateSlider({
      ...shared,
      parent,
      prevElement,
      nextElement: createSliderElement({ initialValue: 100 }),
      eventHandler,
      zIndex: 0,
    });

    const slider = parent.getChildByLabel("slider-1");

    eventHandler.mockClear();
    slider.emit("pointerdown", { global: { x: 300, y: 110 } });

    expect(eventHandler).not.toHaveBeenCalled();
  });
});
