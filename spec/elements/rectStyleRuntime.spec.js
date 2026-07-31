import { describe, expect, it, vi } from "vitest";
import {
  getRectStyleAnimationBatchHooks,
  getRectStyleAnimationValue,
  getRectStyleTargetState,
  isRectAnimationProperty,
  installRectStyleRuntime,
  setRectStyleAnimationValue,
  syncRectStyleRuntime,
  validateRectStyleAnimationTarget,
} from "../../src/plugins/elements/rect/rectStyleRuntime.js";
import {
  getAnimationProperty,
  setAnimationProperty,
} from "../../src/plugins/animations/animationPropertyUtils.js";
import { TRANSITION_PROPERTY_PATH_MAP } from "../../src/types.js";

const createElement = (overrides = {}) => ({
  id: "panel",
  type: "rect",
  width: 200,
  height: 100,
  fill: "#ff0000",
  border: { width: 2, color: "#ffffff", alpha: 0.8 },
  cornerRadius: {
    topLeft: 4,
    topRight: 8,
    bottomRight: 12,
    bottomLeft: 16,
  },
  ...overrides,
});

describe("rect style animation runtime", () => {
  it("recognizes only supported private rect property paths", () => {
    expect(isRectAnimationProperty("rect.width")).toBe(true);
    expect(isRectAnimationProperty("rect.fill.stops.12.color")).toBe(true);
    expect(isRectAnimationProperty("rect.cornerRadius.bottomLeft")).toBe(true);
    expect(isRectAnimationProperty("rect.fill.stops.-1.color")).toBe(false);
    expect(isRectAnimationProperty("rect.fill.textureSize")).toBe(false);
    expect(isRectAnimationProperty("rect.unknown")).toBe(false);
  });

  it("routes flattened animation properties through the private style proxy", () => {
    const displayObject = {};
    const onChange = vi.fn();
    const runtime = installRectStyleRuntime(
      displayObject,
      createElement(),
      onChange,
    );

    expect(
      getAnimationProperty(
        displayObject,
        "rect.width",
        TRANSITION_PROPERTY_PATH_MAP,
      ),
    ).toBe(200);

    setAnimationProperty(
      displayObject,
      "rect.cornerRadius.topRight",
      TRANSITION_PROPERTY_PATH_MAP,
      24,
    );
    setAnimationProperty(
      displayObject,
      "rect.fill.color",
      TRANSITION_PROPERTY_PATH_MAP,
      [0, 0, 1, 1],
    );

    expect(runtime.state.cornerRadius.topRight).toBe(24);
    expect(runtime.state.fill).toEqual([0, 0, 1, 1]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("batches multiple animated style writes into one redraw notification", () => {
    const displayObject = {};
    const onChange = vi.fn();
    const runtime = installRectStyleRuntime(
      displayObject,
      createElement(),
      onChange,
    );
    const hooks = getRectStyleAnimationBatchHooks(displayObject);

    hooks.beforeApplyFrame();
    runtime["rect.width"] = 240;
    runtime["rect.height"] = 140;
    runtime["rect.cornerRadius.topLeft"] = 20;

    expect(onChange).not.toHaveBeenCalled();
    hooks.afterApplyFrame();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(
      new Set(["rect.width", "rect.height", "rect.cornerRadius.topLeft"]),
    );
  });

  it("keeps nested animation batches pending until the outer frame ends", () => {
    const displayObject = {};
    const onChange = vi.fn();
    const runtime = installRectStyleRuntime(
      displayObject,
      createElement(),
      onChange,
    );

    runtime.beginBatch();
    runtime.beginBatch();
    runtime["rect.width"] = 240;
    runtime.endBatch();

    expect(onChange).not.toHaveBeenCalled();

    runtime["rect.height"] = 140;
    runtime.endBatch();

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toEqual(
      new Set(["rect.width", "rect.height"]),
    );
  });

  it("synchronizes a reused rect runtime and discards pending old changes", () => {
    const displayObject = {};
    const onChange = vi.fn();
    const runtime = installRectStyleRuntime(
      displayObject,
      createElement(),
      onChange,
    );

    runtime.beginBatch();
    runtime["rect.width"] = 240;
    syncRectStyleRuntime(
      displayObject,
      createElement({
        width: 320,
        fill: "#0000ff",
        cornerRadius: 24,
      }),
    );
    runtime.endBatch();

    expect(onChange).not.toHaveBeenCalled();
    expect(getRectStyleAnimationValue(displayObject, "rect.width")).toBe(320);
    expect(
      getRectStyleAnimationValue(
        displayObject,
        "rect.cornerRadius.bottomRight",
      ),
    ).toBe(24);
    expect(
      getRectStyleAnimationValue(displayObject, "rect.fill.color"),
    ).toEqual([0, 0, 1, 1]);
  });

  it("rejects incompatible writes and missing rect animation targets", () => {
    const solidDisplayObject = {};
    installRectStyleRuntime(solidDisplayObject, createElement());

    expect(() =>
      setRectStyleAnimationValue(solidDisplayObject, "rect.fill.start.x", 0.25),
    ).toThrow(
      'Animation property "rect.fill.start.x" is incompatible with the current rect fill',
    );
    expect(() => setRectStyleAnimationValue({}, "rect.width", 240)).toThrow(
      "Rect style animation target is not installed",
    );
    expect(() =>
      validateRectStyleAnimationTarget(
        {},
        {
          id: "not-a-rect",
          tween: {
            "rect.width": { auto: { duration: 100 } },
          },
        },
      ),
    ).toThrow(
      'Animation "not-a-rect" can only target rect style properties on a mounted rect.',
    );
  });

  it("rejects writes to gradient stops that do not exist", () => {
    const displayObject = {};
    installRectStyleRuntime(
      displayObject,
      createElement({
        fill: {
          type: "linear-gradient",
          stops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
        },
      }),
    );

    expect(() =>
      setRectStyleAnimationValue(
        displayObject,
        "rect.fill.stops.2.color",
        [1, 0, 0, 1],
      ),
    ).toThrow(
      'Animation property "rect.fill.stops.2.color" targets a missing gradient stop',
    );
  });

  it("exposes complete auto targets for solid rect styles", () => {
    expect(getRectStyleTargetState(createElement())).toMatchObject({
      "rect.width": 200,
      "rect.height": 100,
      "rect.fill.color": [1, 0, 0, 1],
      "rect.border.width": 2,
      "rect.border.color": [1, 1, 1, 1],
      "rect.border.alpha": 0.8,
      "rect.cornerRadius.topLeft": 4,
      "rect.cornerRadius.topRight": 8,
      "rect.cornerRadius.bottomRight": 12,
      "rect.cornerRadius.bottomLeft": 16,
    });
  });

  it("exposes gradient geometry and indexed stop targets", () => {
    const targets = getRectStyleTargetState(
      createElement({
        fill: {
          type: "radial-gradient",
          innerCenter: { x: 0.2, y: 0.3 },
          innerRadius: 0.1,
          outerCenter: { x: 0.7, y: 0.8 },
          outerRadius: 0.9,
          scale: 1.4,
          rotation: 0.2,
          stops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
        },
      }),
    );

    expect(targets).toMatchObject({
      "rect.fill.innerCenter.x": 0.2,
      "rect.fill.innerCenter.y": 0.3,
      "rect.fill.outerCenter.x": 0.7,
      "rect.fill.outerCenter.y": 0.8,
      "rect.fill.innerRadius": 0.1,
      "rect.fill.outerRadius": 0.9,
      "rect.fill.scale": 1.4,
      "rect.fill.rotation": 0.2,
      "rect.fill.stops.0.offset": 0,
      "rect.fill.stops.0.color": [0, 0, 0, 1],
      "rect.fill.stops.1.offset": 1,
      "rect.fill.stops.1.color": [1, 1, 1, 1],
    });
  });

  it("uses authored defaults for omitted border and radial-gradient fields", () => {
    expect(
      getRectStyleTargetState(
        createElement({
          border: undefined,
          fill: {
            type: "radial-gradient",
            stops: [
              { offset: 0, color: "#000000" },
              { offset: 1, color: "#ffffff" },
            ],
          },
          cornerRadius: undefined,
        }),
      ),
    ).toMatchObject({
      "rect.border.width": 0,
      "rect.border.color": [0, 0, 0, 1],
      "rect.border.alpha": 1,
      "rect.cornerRadius.topLeft": 0,
      "rect.cornerRadius.topRight": 0,
      "rect.cornerRadius.bottomRight": 0,
      "rect.cornerRadius.bottomLeft": 0,
      "rect.fill.innerCenter.x": 0.5,
      "rect.fill.innerCenter.y": 0.5,
      "rect.fill.outerCenter.x": 0.5,
      "rect.fill.outerCenter.y": 0.5,
      "rect.fill.innerRadius": 0,
      "rect.fill.outerRadius": 0.5,
      "rect.fill.scale": 1,
      "rect.fill.rotation": 0,
    });
  });
});
