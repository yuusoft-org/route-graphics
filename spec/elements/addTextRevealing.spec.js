import { Container } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runTextReveal: vi.fn(() => Promise.resolve()),
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
import { addTextRevealing } from "../../src/plugins/elements/text-revealing/addTextRevealing.js";

describe("addTextRevealing", () => {
  beforeEach(() => {
    mocks.runTextReveal.mockClear();
  });

  it("applies degree rotation around the configured origin", async () => {
    const parent = new Container();

    await addTextRevealing({
      parent,
      element: {
        id: "rotated-line",
        type: "text-revealing",
        x: 80,
        y: 50,
        originX: 16,
        originY: 10,
        rotation: 60,
        alpha: 1,
        speed: 100,
        revealEffect: "typewriter",
        content: [],
      },
      animationBus: { dispatch: vi.fn() },
      completionTracker: {
        getVersion: () => 0,
        track: vi.fn(),
        complete: vi.fn(),
      },
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const text = parent.getChildByLabel("rotated-line");

    expect(text.x).toBe(96);
    expect(text.y).toBe(60);
    expect(text.pivot.x).toBe(16);
    expect(text.pivot.y).toBe(10);
    expect(text.rotation).toBeCloseTo(Math.PI / 3);
  });

  it("pauses reveal work during suppressed mounts and starts it after finalize", async () => {
    const parent = new Container();
    const renderContext = createRenderContext({ suppressAnimations: true });

    await addTextRevealing({
      parent,
      element: {
        id: "line-1",
        type: "text-revealing",
        x: 0,
        y: 0,
        alpha: 1,
        revealEffect: "typewriter",
        content: [],
      },
      animationBus: { dispatch: vi.fn() },
      renderContext,
      completionTracker: {
        getVersion: () => 0,
        track: vi.fn(),
        complete: vi.fn(),
      },
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

  it("renders immediately at max speed without queueing deferred reveal work", async () => {
    const parent = new Container();
    const renderContext = createRenderContext({ suppressAnimations: true });

    await addTextRevealing({
      parent,
      element: {
        id: "line-1",
        type: "text-revealing",
        x: 0,
        y: 0,
        alpha: 1,
        speed: 100,
        revealEffect: "typewriter",
        content: [],
      },
      animationBus: { dispatch: vi.fn() },
      renderContext,
      completionTracker: {
        getVersion: () => 0,
        track: vi.fn(),
        complete: vi.fn(),
      },
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
});
