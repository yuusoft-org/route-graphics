import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

import { renderElements } from "../../src/plugins/elements/renderElements.js";
import { createRenderContext } from "../../src/plugins/elements/renderContext.js";
import { addRect } from "../../src/plugins/elements/rect/addRect.js";
import { parseRect } from "../../src/plugins/elements/rect/parseRect.js";
import {
  getElementRenderState,
  setElementRenderState,
} from "../../src/plugins/elements/elementRenderState.js";
import {
  getShaderFilterAnimationTarget,
  syncShaderFilters,
} from "../../src/plugins/elements/util/shaderFilterEffect.js";
import { hitTestElementBounds } from "../../src/util/hitTestElementBounds.js";
import {
  createAnimatedShaderFilterFixture,
  createFilterAnimationFixture,
} from "../util/shaderFilterFixtures.js";

describe("renderElements add-time update animations", () => {
  const createSharedOptions = (parent, elementPlugins) => ({
    app: { renderer: { width: 1280, height: 720 } },
    parent,
    animations: [],
    animationBus: { dispatch: vi.fn() },
    completionTracker: {
      getVersion: () => 3,
      track: vi.fn(),
      complete: vi.fn(),
    },
    eventHandler: vi.fn(),
    elementPlugins,
    signal: new AbortController().signal,
  });

  it("passes update animations to newly added non-container elements", () => {
    const parent = new Container();
    const plugin = {
      type: "rect",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    renderElements({
      app: { renderer: { width: 1280, height: 720 } },
      parent,
      prevComputedTree: [],
      nextComputedTree: [
        {
          id: "rect-1",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#ffffff",
        },
      ],
      animations: [
        {
          id: "rect-enter-update",
          targetId: "rect-1",
          type: "update",
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      ],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [plugin],
      signal: new AbortController().signal,
    });

    expect(plugin.add).toHaveBeenCalledTimes(1);

    const { animations } = plugin.add.mock.calls[0][0];

    expect(animations.get("rect-1")).toEqual([
      expect.objectContaining({
        id: "rect-enter-update",
        targetId: "rect-1",
        type: "update",
      }),
    ]);
  });

  it("returns a promise that waits for async add operations", async () => {
    const parent = new Container();
    let resolveAdd;
    const addOperation = new Promise((resolve) => {
      resolveAdd = resolve;
    });
    const plugin = {
      type: "async-test",
      add: vi.fn(() => addOperation),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const result = renderElements({
      app: { renderer: { width: 1280, height: 720 } },
      parent,
      prevComputedTree: [],
      nextComputedTree: [
        {
          id: "async-1",
          type: "async-test",
        },
      ],
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [plugin],
      signal: new AbortController().signal,
    });

    let settled = false;
    result.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(settled).toBe(false);

    resolveAdd();
    await result;

    expect(settled).toBe(true);
  });

  it("seeds a late asynchronous shader mount from the live clock", async () => {
    const parent = new Container();
    let releaseMount;
    const mountGate = new Promise((resolve) => {
      releaseMount = resolve;
    });
    const timedFilters = createAnimatedShaderFilterFixture().map((effect) => ({
      ...effect,
      time: true,
      passes: effect.passes.map((pass) => ({ ...pass, time: true })),
    }));
    const element = {
      id: "async-shader",
      type: "async-shader",
      width: 32,
      height: 32,
      filters: timedFilters,
    };
    const plugin = {
      type: "async-shader",
      add: vi.fn(async ({ parent: targetParent }) => {
        await mountGate;
        const child = new Container({ label: element.id });
        syncShaderFilters(child, timedFilters, { width: 32, height: 32 });
        targetParent.addChild(child);
      }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    let shaderTime = 1;

    const result = renderElements({
      app: { renderer: { width: 1280, height: 720 } },
      parent,
      prevComputedTree: [],
      nextComputedTree: [element],
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [plugin],
      shaderTime,
      getShaderTime: () => shaderTime,
      signal: new AbortController().signal,
    });

    shaderTime = 6.25;
    releaseMount();
    await result;

    const child = parent.getChildByLabel(element.id);
    expect(
      child.filters[0].resources.shaderUniforms.uniforms.uTime,
    ).toBeCloseTo(6.25);

    child.destroy();
  });

  it("preserves deferred shader initial values through post-mount synchronization", () => {
    const parent = new Container();
    const element = parseRect({
      state: {
        id: "deferred-filter",
        type: "rect",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        fill: "#ffffff",
      },
    });
    element.filters = createAnimatedShaderFilterFixture();
    const animations = createFilterAnimationFixture(element.id).get(element.id);
    const renderContext = createRenderContext({
      suppressAnimations: true,
    });

    renderElements({
      app: {
        audioStage: { add: vi.fn() },
        renderer: { width: 1280, height: 720 },
      },
      parent,
      prevComputedTree: [],
      nextComputedTree: [element],
      animations,
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [
        {
          type: "rect",
          add: addRect,
          update: vi.fn(),
          delete: vi.fn(),
        },
      ],
      renderContext,
      signal: new AbortController().signal,
    });

    const displayObject = parent.getChildByLabel(element.id);
    expect(
      getShaderFilterAnimationTarget(displayObject, "grade").amount,
    ).toBeCloseTo(0.4);
    expect(renderContext.deferredMountOperations).toHaveLength(1);

    displayObject.destroy();
  });

  it("refreshes semantic bounds after a custom plugin update", () => {
    const parent = new Container();
    const plugin = {
      type: "custom-node",
      add: ({ parent: targetParent, element }) => {
        const displayObject = new Container({ label: element.id });
        targetParent.addChild(displayObject);
      },
      update: vi.fn(({ parent: targetParent, nextElement }) => {
        targetParent.getChildByLabel(nextElement.id).visualWidth =
          nextElement.width;
      }),
      delete: vi.fn(),
    };
    const previous = {
      id: "custom-1",
      type: "custom-node",
      width: 20,
      height: 20,
    };
    const next = { ...previous, width: 100 };
    const shared = createSharedOptions(parent, [plugin]);

    renderElements({
      ...shared,
      prevComputedTree: [],
      nextComputedTree: [previous],
    });
    renderElements({
      ...shared,
      prevComputedTree: [previous],
      nextComputedTree: [next],
    });

    const displayObject = parent.getChildByLabel("custom-1");
    const [hit] = hitTestElementBounds({ stage: parent, x: 80, y: 10 });

    expect(plugin.update).toHaveBeenCalledTimes(1);
    expect(displayObject.visualWidth).toBe(100);
    expect(getElementRenderState(displayObject)).toBe(next);
    expect(hit.path[0].bounds).toMatchObject({ width: 100, height: 20 });
  });

  it("lets a custom plugin defer its semantic snapshot commit", () => {
    const parent = new Container();
    const displayObject = new Container({ label: "custom-1" });
    const previous = {
      id: "custom-1",
      type: "custom-node",
      width: 20,
      height: 20,
    };
    const next = { ...previous, width: 100 };
    let commitUpdate;
    const plugin = {
      type: "custom-node",
      add: vi.fn(),
      update: vi.fn(({ commitRenderState, deferRenderStateCommit }) => {
        deferRenderStateCommit();
        commitUpdate = () => commitRenderState(displayObject);
      }),
      delete: vi.fn(),
    };
    parent.addChild(displayObject);
    setElementRenderState(displayObject, previous);

    renderElements({
      ...createSharedOptions(parent, [plugin]),
      prevComputedTree: [previous],
      nextComputedTree: [next],
    });

    expect(getElementRenderState(displayObject)).toBe(previous);

    commitUpdate();

    expect(getElementRenderState(displayObject)).toBe(next);
  });

  it("passes update animations to deleted elements so plugins can animate before removal", () => {
    const parent = new Container();
    const child = new Container();
    child.label = "rect-1";
    parent.addChild(child);

    const plugin = {
      type: "rect",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    renderElements({
      app: { renderer: { width: 1280, height: 720 } },
      parent,
      prevComputedTree: [
        {
          id: "rect-1",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#ffffff",
        },
      ],
      nextComputedTree: [],
      animations: [
        {
          id: "rect-exit-update",
          targetId: "rect-1",
          type: "update",
          tween: {
            alpha: {
              keyframes: [{ duration: 300, value: 0, easing: "linear" }],
            },
          },
        },
      ],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [plugin],
      signal: new AbortController().signal,
    });

    expect(plugin.delete).toHaveBeenCalledTimes(1);

    const { animations } = plugin.delete.mock.calls[0][0];

    expect(animations.get("rect-1")).toEqual([
      expect.objectContaining({
        id: "rect-exit-update",
        targetId: "rect-1",
        type: "update",
      }),
    ]);
  });

  it("replaces a same-id element through its previous and next type plugins", () => {
    const parent = new Container();
    const previousPlugin = {
      type: "sprite",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const nextPlugin = {
      type: "rect",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const result = renderElements({
      app: { renderer: { width: 1280, height: 720 } },
      parent,
      prevComputedTree: [
        {
          id: "preview-background",
          type: "sprite",
          src: "background.png",
        },
      ],
      nextComputedTree: [
        {
          id: "preview-background",
          type: "rect",
          width: 1280,
          height: 720,
          fill: "#000000",
        },
      ],
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [previousPlugin, nextPlugin],
      signal: new AbortController().signal,
    });

    expect(result).toBeUndefined();
    expect(previousPlugin.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        element: expect.objectContaining({ type: "sprite" }),
        animations: [],
      }),
    );
    expect(nextPlugin.add).toHaveBeenCalledWith(
      expect.objectContaining({
        element: expect.objectContaining({ type: "rect" }),
        zIndex: 0,
      }),
    );
    expect(previousPlugin.update).not.toHaveBeenCalled();
    expect(nextPlugin.update).not.toHaveBeenCalled();
    expect(previousPlugin.delete.mock.invocationCallOrder[0]).toBeLessThan(
      nextPlugin.add.mock.invocationCallOrder[0],
    );
  });

  it("waits for async previous-type cleanup before adding a replacement", async () => {
    const parent = new Container();
    let resolveDelete;
    const deleteOperation = new Promise((resolve) => {
      resolveDelete = resolve;
    });
    const previousPlugin = {
      type: "sprite",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(() => deleteOperation),
    };
    const nextPlugin = {
      type: "rect",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const result = renderElements({
      app: { renderer: { width: 1280, height: 720 } },
      parent,
      prevComputedTree: [{ id: "preview-background", type: "sprite" }],
      nextComputedTree: [{ id: "preview-background", type: "rect" }],
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [previousPlugin, nextPlugin],
      signal: new AbortController().signal,
    });

    expect(nextPlugin.add).not.toHaveBeenCalled();

    resolveDelete();
    await result;

    expect(nextPlugin.add).toHaveBeenCalledTimes(1);
  });
});
