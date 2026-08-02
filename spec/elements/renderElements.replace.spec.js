import { Container } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderContext } from "../../src/plugins/elements/renderContext.js";

const mocks = vi.hoisted(() => ({
  runReplaceAnimation: vi.fn(),
}));

vi.mock("../../src/plugins/animations/replace/runReplaceAnimation.js", () => ({
  runReplaceAnimation: mocks.runReplaceAnimation,
}));

import { renderElements } from "../../src/plugins/elements/renderElements.js";

describe("renderElements transition handling", () => {
  beforeEach(() => {
    mocks.runReplaceAnimation.mockReset();
  });

  it("routes add-only transition animations through the transition runner", () => {
    const parent = {
      children: [],
      sortableChildren: false,
    };

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
          id: "rect1",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#000000",
        },
      ],
      animations: [
        {
          id: "rect-enter",
          targetId: "rect1",
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

    expect(plugin.add).not.toHaveBeenCalled();
    expect(mocks.runReplaceAnimation).toHaveBeenCalledTimes(1);
    expect(mocks.runReplaceAnimation).toHaveBeenCalledWith(
      expect.objectContaining({
        prevElement: null,
        nextElement: expect.objectContaining({
          id: "rect1",
          type: "rect",
        }),
        zIndex: 0,
        animation: expect.objectContaining({
          id: "rect-enter",
          type: "transition",
        }),
        plugin,
      }),
    );
  });

  it("routes delete-only transition animations through the transition runner", () => {
    const parent = {
      children: [{ label: "rect1", zIndex: 7 }],
      sortableChildren: false,
    };

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
          id: "rect1",
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
          id: "rect-exit",
          targetId: "rect1",
          type: "transition",
          prev: {
            tween: {
              alpha: {
                initialValue: 1,
                keyframes: [{ duration: 300, value: 0, easing: "linear" }],
              },
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

    expect(plugin.delete).not.toHaveBeenCalled();
    expect(mocks.runReplaceAnimation).toHaveBeenCalledTimes(1);
    expect(mocks.runReplaceAnimation).toHaveBeenCalledWith(
      expect.objectContaining({
        prevElement: expect.objectContaining({
          id: "rect1",
          type: "rect",
        }),
        nextElement: null,
        zIndex: 7,
        animation: expect.objectContaining({
          id: "rect-exit",
          type: "transition",
        }),
        plugin,
      }),
    );
  });

  it("routes same-id transition animations through the transition runner", () => {
    const parent = {
      children: [],
      sortableChildren: false,
    };

    const plugin = {
      type: "rect",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: () => 3,
      track: vi.fn(),
      complete: vi.fn(),
    };

    renderElements({
      app: { renderer: { width: 1280, height: 720 } },
      parent,
      prevComputedTree: [
        {
          id: "rect1",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#ffffff",
        },
      ],
      nextComputedTree: [
        {
          id: "rect1",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#000000",
        },
      ],
      animations: [
        {
          id: "rect-transition",
          targetId: "rect1",
          type: "transition",
          mask: [
            {
              kind: "single",
              texture: "mask-diagonal",
              progress: {
                initialValue: 0,
                keyframes: [{ duration: 500, value: 1, easing: "linear" }],
              },
            },
          ],
        },
      ],
      animationBus,
      completionTracker,
      eventHandler: vi.fn(),
      elementPlugins: [plugin],
      signal: new AbortController().signal,
    });

    expect(plugin.update).not.toHaveBeenCalled();
    expect(mocks.runReplaceAnimation).toHaveBeenCalledTimes(1);
    expect(mocks.runReplaceAnimation).toHaveBeenCalledWith(
      expect.objectContaining({
        animation: expect.objectContaining({
          id: "rect-transition",
          type: "transition",
        }),
        animations: expect.any(Map),
        completionTracker,
        plugin,
      }),
    );
  });

  it("routes same-id type changes through both transition plugins", () => {
    const parent = {
      children: [],
      sortableChildren: false,
    };
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

    renderElements({
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
      animations: [
        {
          id: "background-transition",
          targetId: "preview-background",
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
      ],
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

    expect(previousPlugin.delete).not.toHaveBeenCalled();
    expect(nextPlugin.add).not.toHaveBeenCalled();
    expect(nextPlugin.update).not.toHaveBeenCalled();
    expect(mocks.runReplaceAnimation).toHaveBeenCalledTimes(1);
    expect(mocks.runReplaceAnimation).toHaveBeenCalledWith(
      expect.objectContaining({
        prevElement: expect.objectContaining({ type: "sprite" }),
        nextElement: expect.objectContaining({ type: "rect" }),
        plugin: nextPlugin,
        prevPlugin: previousPlugin,
        nextPlugin,
      }),
    );
  });

  it("suppresses descendant transitions when render context owns the subtree", () => {
    const parent = {
      children: [],
      sortableChildren: false,
    };

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
          id: "rect1",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#000000",
        },
      ],
      animations: [
        {
          id: "rect-transition",
          targetId: "rect1",
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
      ],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [plugin],
      renderContext: createRenderContext({ suppressAnimations: true }),
      signal: new AbortController().signal,
    });

    expect(plugin.add).toHaveBeenCalledTimes(1);
    expect(plugin.add).toHaveBeenCalledWith(
      expect.objectContaining({
        animations: expect.any(Map),
      }),
    );
    expect(mocks.runReplaceAnimation).not.toHaveBeenCalled();
  });

  it("uses the live element type after an async transition is superseded", () => {
    const parent = new Container();
    const previousPlugin = {
      type: "sprite",
      add: vi.fn(({ parent: targetParent, element }) => {
        const child = new Container();
        child.label = element.id;
        targetParent.addChild(child);
      }),
      update: vi.fn(),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.getChildByLabel(element.id);
        if (!child) return;
        targetParent.removeChild(child);
        child.destroy();
      }),
    };
    const nextPlugin = {
      type: "spritesheet-animation",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(() => {
        throw new Error("wrong lifecycle plugin");
      }),
    };
    const commonParams = {
      app: { renderer: { width: 1280, height: 720 } },
      parent,
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 3,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [previousPlugin, nextPlugin],
    };

    renderElements({
      ...commonParams,
      prevComputedTree: [],
      nextComputedTree: [{ id: "character", type: "sprite" }],
      animations: [],
      signal: new AbortController().signal,
    });

    const transitionController = new AbortController();
    renderElements({
      ...commonParams,
      prevComputedTree: [{ id: "character", type: "sprite" }],
      nextComputedTree: [{ id: "character", type: "spritesheet-animation" }],
      animations: [
        {
          id: "character-transition",
          targetId: "character",
          type: "transition",
        },
      ],
      signal: transitionController.signal,
    });

    transitionController.abort();

    expect(() =>
      renderElements({
        ...commonParams,
        prevComputedTree: [{ id: "character", type: "spritesheet-animation" }],
        nextComputedTree: [],
        animations: [],
        signal: new AbortController().signal,
      }),
    ).not.toThrow();
    expect(previousPlugin.delete).toHaveBeenCalledTimes(1);
    expect(nextPlugin.delete).not.toHaveBeenCalled();
  });
});
