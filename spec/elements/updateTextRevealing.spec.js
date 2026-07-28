import { Container } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runTextReveal: vi.fn(({ onLayoutMounted }) => {
    onLayoutMounted?.();
    return Promise.resolve();
  }),
}));

vi.mock(
  "../../src/plugins/elements/text-revealing/textRevealingRuntime.js",
  () => ({
    runTextReveal: mocks.runTextReveal,
    shouldRenderTextRevealImmediately: (element) =>
      element?.revealEffect === "none" || (element?.speed ?? 50) >= 100,
  }),
);

import {
  createRenderContext,
  flushDeferredMountOperations,
} from "../../src/plugins/elements/renderContext.js";
import { updateTextRevealing } from "../../src/plugins/elements/text-revealing/updateTextRevealing.js";
import {
  getElementRenderState,
  setElementRenderState,
} from "../../src/plugins/elements/elementRenderState.js";

const createCompletionTracker = () => ({
  getVersion: () => 0,
  track: vi.fn(),
  complete: vi.fn(),
});

const createElement = (overrides = {}) => ({
  id: "line-1",
  type: "text-revealing",
  x: 0,
  y: 0,
  alpha: 1,
  width: 300,
  speed: 50,
  revealEffect: "typewriter",
  content: [
    {
      text: "Original text content",
    },
  ],
  ...overrides,
});

describe("updateTextRevealing", () => {
  beforeEach(() => {
    mocks.runTextReveal.mockClear();
    mocks.runTextReveal.mockImplementation(({ onLayoutMounted }) => {
      onLayoutMounted?.();
      return Promise.resolve();
    });
  });

  it("restarts reveal when position or alpha changes", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);

    await updateTextRevealing({
      parent,
      prevElement: createElement(),
      nextElement: createElement({
        x: 25,
        y: 40,
        alpha: 0.5,
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext: createRenderContext(),
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "autoplay",
        element: expect.objectContaining({
          x: 25,
          y: 40,
          alpha: 0.5,
          revealEffect: "typewriter",
        }),
      }),
    );
    expect(child.x).toBe(25);
    expect(child.y).toBe(40);
    expect(child.alpha).toBe(0.5);
  });

  it("restarts reveal when content changes, using paused-initial then autoplay", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);
    const renderContext = createRenderContext({ suppressAnimations: true });

    await updateTextRevealing({
      parent,
      prevElement: createElement(),
      nextElement: createElement({
        content: [
          {
            text: "Updated content should restart reveal progress",
          },
        ],
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext,
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "paused-initial",
      }),
    );

    flushDeferredMountOperations(renderContext);

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(2);
    expect(mocks.runTextReveal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        playback: "autoplay",
      }),
    );
  });

  it("restarts reveal immediately with autoplay when animations are not suppressed", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);

    await updateTextRevealing({
      parent,
      prevElement: createElement(),
      nextElement: createElement({
        content: [
          {
            text: "Updated content should restart immediately in normal runtime",
          },
        ],
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext: createRenderContext(),
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "autoplay",
      }),
    );
  });

  it("commits the new layout before typewriter playback completes", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);
    const previous = createElement({ width: 100 });
    const next = createElement({
      width: 400,
      content: [{ text: "A much wider replacement line" }],
    });
    let resolveReveal;
    mocks.runTextReveal.mockImplementationOnce(({ onLayoutMounted }) => {
      onLayoutMounted?.();
      return new Promise((resolve) => {
        resolveReveal = resolve;
      });
    });
    setElementRenderState(child, previous);

    const updateOperation = updateTextRevealing({
      parent,
      prevElement: previous,
      nextElement: next,
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext: createRenderContext(),
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    await Promise.resolve();

    expect(getElementRenderState(child)).toBe(next);

    resolveReveal();
    await updateOperation;
  });

  it("restarts reveal when only the initial revealed character offset changes", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);

    await updateTextRevealing({
      parent,
      prevElement: createElement({
        initialRevealedCharacters: 0,
      }),
      nextElement: createElement({
        initialRevealedCharacters: 12,
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext: createRenderContext(),
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "autoplay",
        element: expect.objectContaining({
          initialRevealedCharacters: 12,
        }),
      }),
    );
  });

  it("preserves initial revealed character offset through deferred autoplay", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);
    const renderContext = createRenderContext({ suppressAnimations: true });

    await updateTextRevealing({
      parent,
      prevElement: createElement(),
      nextElement: createElement({
        content: [
          {
            text: "Original text content with appended continuation",
          },
        ],
        initialRevealedCharacters: "Original text content".length,
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext,
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "paused-initial",
        element: expect.objectContaining({
          initialRevealedCharacters: "Original text content".length,
        }),
      }),
    );

    flushDeferredMountOperations(renderContext);

    expect(mocks.runTextReveal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        playback: "autoplay",
        element: expect.objectContaining({
          initialRevealedCharacters: "Original text content".length,
        }),
      }),
    );
  });

  it("restarts reveal when softWipe parameters change", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);

    await updateTextRevealing({
      parent,
      prevElement: createElement({
        revealEffect: "softWipe",
        softWipe: {
          easing: "linear",
        },
      }),
      nextElement: createElement({
        revealEffect: "softWipe",
        softWipe: {
          easing: "easeOutCubic",
        },
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext: createRenderContext(),
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "autoplay",
        element: expect.objectContaining({
          revealEffect: "softWipe",
          softWipe: expect.objectContaining({
            easing: "easeOutCubic",
          }),
        }),
      }),
    );
  });

  it("restarts softWipe reveal when only revealSound changes", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);

    await updateTextRevealing({
      parent,
      prevElement: createElement({
        revealEffect: "softWipe",
        revealSound: {
          src: "old-blip",
          volume: 100,
          loop: true,
        },
      }),
      nextElement: createElement({
        revealEffect: "softWipe",
        revealSound: {
          src: "new-blip",
          volume: 70,
          loop: true,
        },
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext: createRenderContext(),
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "autoplay",
        element: expect.objectContaining({
          revealEffect: "softWipe",
          revealSound: {
            src: "new-blip",
            volume: 70,
            loop: true,
          },
        }),
      }),
    );
  });

  it("renders immediately at max speed without queueing deferred reveal work", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);
    const renderContext = createRenderContext({ suppressAnimations: true });

    await updateTextRevealing({
      parent,
      prevElement: createElement(),
      nextElement: createElement({
        speed: 100,
      }),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext,
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "autoplay",
      }),
    );

    flushDeferredMountOperations(renderContext);

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
  });

  it("commits transform-only animated updates for immediate reveals", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);
    const previous = createElement({
      revealEffect: "none",
      rotation: 0,
    });
    const next = createElement({
      revealEffect: "none",
      rotation: 90,
    });
    const animationBus = { dispatch: vi.fn() };
    const deferRenderStateCommit = vi.fn();
    const commitRenderState = vi.fn();
    setElementRenderState(child, previous);

    await updateTextRevealing({
      parent,
      prevElement: previous,
      nextElement: next,
      animations: [
        {
          id: "line-rotation",
          targetId: "line-1",
          type: "update",
          tween: {
            rotation: {
              auto: {
                duration: 300,
                easing: "linear",
              },
            },
          },
        },
      ],
      animationBus,
      renderContext: createRenderContext(),
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
      deferRenderStateCommit,
      commitRenderState,
    });

    expect(deferRenderStateCommit).toHaveBeenCalledTimes(1);
    expect(commitRenderState).not.toHaveBeenCalled();
    expect(mocks.runTextReveal).not.toHaveBeenCalled();

    animationBus.dispatch.mock.calls[0][0].payload.onComplete();

    expect(child.rotation).toBeCloseTo(Math.PI / 2);
    expect(getElementRenderState(child)).toBe(next);
    expect(commitRenderState).toHaveBeenCalledWith(child);
    expect(mocks.runTextReveal).not.toHaveBeenCalled();
  });

  it("resumes an unchanged in-flight reveal instead of leaving it frozen", async () => {
    const parent = new Container();
    const child = new Container();
    child.label = "line-1";
    parent.addChild(child);

    await updateTextRevealing({
      parent,
      prevElement: createElement(),
      nextElement: createElement(),
      animations: [],
      animationBus: { dispatch: vi.fn() },
      renderContext: createRenderContext(),
      completionTracker: createCompletionTracker(),
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(mocks.runTextReveal).toHaveBeenCalledTimes(1);
    expect(mocks.runTextReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        playback: "resume",
      }),
    );
  });
});
