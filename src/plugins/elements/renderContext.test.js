import { describe, expect, it, vi } from "vitest";
import {
  clearDeferredMountOperations,
  createRenderContext,
  flushDeferredMountOperations,
  queueDeferredUpdateAnimationStart,
} from "./renderContext.js";

const queuePreparedGsap = (renderContext, { element, rollback }) => {
  queueDeferredUpdateAnimationStart(renderContext, {
    animations: [],
    animationBus: {},
    completionTracker: {},
    element,
    preparedGsap: new Map([["enter", { bindingContext: { rollback } }]]),
  });
};

describe("deferred update animation cleanup", () => {
  it("rolls back prepared GSAP bindings when deferred work is cleared", () => {
    const rollback = vi.fn();
    const renderContext = createRenderContext({ suppressAnimations: true });
    queuePreparedGsap(renderContext, {
      element: { destroyed: false },
      rollback,
    });

    clearDeferredMountOperations(renderContext);

    expect(rollback).toHaveBeenCalledOnce();
    expect(renderContext.deferredMountOperations).toEqual([]);
  });

  it("rolls back prepared GSAP bindings if their element was destroyed", () => {
    const rollback = vi.fn();
    const renderContext = createRenderContext({ suppressAnimations: true });
    queuePreparedGsap(renderContext, {
      element: { destroyed: true },
      rollback,
    });

    flushDeferredMountOperations(renderContext);

    expect(rollback).toHaveBeenCalledOnce();
  });
});
