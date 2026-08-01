import { Container, Rectangle } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/plugins/elements/renderElements.js", () => ({
  renderElements: vi.fn(),
}));

import { renderElements } from "../../src/plugins/elements/renderElements.js";
import { addContainer } from "../../src/plugins/elements/container/addContainer.js";
import { createRenderContext } from "../../src/plugins/elements/renderContext.js";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import { createCompletionTracker } from "../../src/util/completionTracker.js";
import { normalizeAnimations } from "../../src/util/normalizeAnimations.js";

describe("addContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes fresh child mounts through renderElements", () => {
    const parent = new Container();
    const renderContext = createRenderContext();

    addContainer({
      app: { audioStage: { add: vi.fn() } },
      parent,
      element: {
        id: "container-1",
        type: "container",
        x: 0,
        y: 0,
        alpha: 1,
        children: [
          {
            id: "child-1",
            type: "rect",
            x: 0,
            y: 0,
            width: 20,
            height: 20,
          },
        ],
      },
      animations: [
        { id: "child-enter", targetId: "child-1", type: "transition" },
      ],
      eventHandler: vi.fn(),
      animationBus: { dispatch: vi.fn() },
      elementPlugins: [],
      renderContext,
      zIndex: 0,
      completionTracker: {
        getVersion: () => 0,
        track: () => {},
        complete: () => {},
      },
      signal: new AbortController().signal,
    });

    expect(renderElements).toHaveBeenCalledTimes(1);
    expect(renderElements).toHaveBeenCalledWith(
      expect.objectContaining({
        prevComputedTree: [],
        nextComputedTree: [
          expect.objectContaining({
            id: "child-1",
          }),
        ],
        renderContext,
      }),
    );
  });

  it("returns an operation that awaits the fresh child mount", async () => {
    const parent = new Container();
    const renderContext = createRenderContext();
    const childMountOperation = Promise.resolve();
    renderElements.mockReturnValueOnce(childMountOperation);

    const result = addContainer({
      app: { audioStage: { add: vi.fn() } },
      parent,
      element: {
        id: "container-1",
        type: "container",
        x: 0,
        y: 0,
        alpha: 1,
        children: [
          {
            id: "child-1",
            type: "rect",
            x: 0,
            y: 0,
            width: 20,
            height: 20,
          },
        ],
      },
      animations: [],
      eventHandler: vi.fn(),
      animationBus: { dispatch: vi.fn() },
      elementPlugins: [],
      renderContext,
      zIndex: 0,
      completionTracker: {
        getVersion: () => 0,
        track: () => {},
        complete: () => {},
      },
      signal: new AbortController().signal,
    });

    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  it("waits for asynchronous descendants before binding owner timeline aliases", async () => {
    const parent = new Container();
    const renderContext = createRenderContext();
    const animationBus = createAnimationBus();
    const completionTracker = createCompletionTracker();
    completionTracker.reset("async-descendant-state");
    let finishChildMount;

    renderElements.mockImplementationOnce(
      ({ parent: owner }) =>
        new Promise((resolve) => {
          finishChildMount = () => {
            const child = new Container();
            child.label = "async-child";
            owner.addChild(child);
            resolve();
          };
        }),
    );

    const animations = normalizeAnimations([
      {
        id: "animate-async-child",
        targetId: "container-1",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: {
            child: { element: "async-child" },
          },
          steps: [
            {
              kind: "to",
              targets: "child",
              values: { x: 100 },
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    ]);

    const operation = addContainer({
      app: { audioStage: { add: vi.fn() } },
      parent,
      element: {
        id: "container-1",
        type: "container",
        x: 0,
        y: 0,
        alpha: 1,
        children: [{ id: "async-child", type: "async-node" }],
      },
      animations,
      eventHandler: vi.fn(),
      animationBus,
      elementPlugins: [],
      renderContext,
      zIndex: 0,
      completionTracker,
      signal: new AbortController().signal,
    });

    expect(animationBus.getState().activeCount).toBe(0);
    finishChildMount();
    await expect(operation).resolves.toBeUndefined();
    expect(() => animationBus.flush()).not.toThrow();
    expect(animationBus.getState().animations[0]).toMatchObject({
      id: "animate-async-child",
      duration: 100,
    });
    parent.destroy({ children: true });
  });

  it("dispatches update animations when the container is newly added", () => {
    const parent = new Container();
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };

    addContainer({
      app: { audioStage: { add: vi.fn() } },
      parent,
      element: {
        id: "container-1",
        type: "container",
        x: 20,
        y: 30,
        alpha: 1,
        children: [],
      },
      animations: [
        {
          id: "container-enter",
          targetId: "container-1",
          type: "update",
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      ],
      eventHandler: vi.fn(),
      animationBus,
      elementPlugins: [],
      renderContext: createRenderContext(),
      zIndex: 0,
      completionTracker,
      signal: new AbortController().signal,
    });

    const container = parent.getChildByLabel("container-1");

    expect(completionTracker.track).toHaveBeenCalledWith(11);
    expect(animationBus.dispatch).toHaveBeenCalledWith({
      type: "START",
      payload: expect.objectContaining({
        id: "container-enter",
        animationType: "update",
        targetId: "container-1",
        element: container,
        targetState: {
          x: 20,
          y: 30,
          alpha: 1,
        },
      }),
    });
  });

  it("applies degree rotation around the computed anchor origin", () => {
    const parent = new Container();

    addContainer({
      app: { audioStage: { add: vi.fn() } },
      parent,
      element: {
        id: "container-1",
        type: "container",
        x: 200,
        y: 150,
        width: 240,
        height: 120,
        originX: 120,
        originY: 60,
        rotation: 45,
        alpha: 1,
        children: [],
      },
      animations: [],
      eventHandler: vi.fn(),
      animationBus: { dispatch: vi.fn() },
      elementPlugins: [],
      renderContext: createRenderContext(),
      zIndex: 0,
      completionTracker: {
        getVersion: () => 0,
        track: () => {},
        complete: () => {},
      },
      signal: new AbortController().signal,
    });

    const container = parent.getChildByLabel("container-1");

    expect(container.pivot.x).toBe(120);
    expect(container.pivot.y).toBe(60);
    expect(container.x).toBe(320);
    expect(container.y).toBe(210);
    expect(container.rotation).toBeCloseTo(Math.PI / 4);
  });

  it("falls back to direct child add when sibling ids are duplicated", () => {
    const parent = new Container();
    const renderContext = createRenderContext();
    const childPlugin = {
      type: "rect",
      add: vi.fn(),
    };

    addContainer({
      app: { audioStage: { add: vi.fn() } },
      parent,
      element: {
        id: "container-1",
        type: "container",
        x: 0,
        y: 0,
        alpha: 1,
        children: [
          {
            id: "child-1",
            type: "rect",
            x: 0,
            y: 0,
            width: 20,
            height: 20,
          },
          {
            id: "child-1",
            type: "rect",
            x: 25,
            y: 0,
            width: 20,
            height: 20,
          },
        ],
      },
      animations: [
        { id: "child-enter", targetId: "child-1", type: "transition" },
      ],
      eventHandler: vi.fn(),
      animationBus: { dispatch: vi.fn() },
      elementPlugins: [childPlugin],
      renderContext,
      zIndex: 0,
      completionTracker: {
        getVersion: () => 0,
        track: () => {},
        complete: () => {},
      },
      signal: new AbortController().signal,
    });

    expect(renderElements).not.toHaveBeenCalled();
    expect(childPlugin.add).toHaveBeenCalledTimes(2);
    expect(childPlugin.add.mock.calls[0][0].animations).toEqual([]);
    expect(childPlugin.add.mock.calls[1][0].animations).toEqual([]);
  });

  it("assigns a rectangular hit area to non-scroll containers with pointer interactions", () => {
    const parent = new Container();
    const renderContext = createRenderContext();
    const interactionVariants = [
      { hover: { payload: { source: "hover" } } },
      { click: { payload: { source: "click" } } },
      { rightClick: { payload: { source: "rightClick" } } },
    ];

    interactionVariants.forEach((interaction, index) => {
      addContainer({
        app: { audioStage: { add: vi.fn() } },
        parent,
        element: {
          id: `container-${index + 1}`,
          type: "container",
          x: 0,
          y: 0,
          width: 150,
          height: 90,
          alpha: 1,
          children: [],
          ...interaction,
        },
        animations: [],
        eventHandler: vi.fn(),
        animationBus: { dispatch: vi.fn() },
        elementPlugins: [],
        renderContext,
        zIndex: 0,
        completionTracker: {
          getVersion: () => 0,
          track: () => {},
          complete: () => {},
        },
        signal: new AbortController().signal,
      });

      const container = parent.getChildByLabel(`container-${index + 1}`);

      expect(container.eventMode).toBe("static");
      expect(container.hitArea).toBeInstanceOf(Rectangle);
      expect(container.hitArea.width).toBe(150);
      expect(container.hitArea.height).toBe(90);
    });
  });
});
