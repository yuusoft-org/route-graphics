import { dispatchUpdateAnimationsNow } from "../animations/updateAnimationDispatch.js";
import { runTextReveal } from "./text-revealing/textRevealingRuntime.js";

export const createRenderContext = ({
  suppressAnimations = false,
  deferredMountOperations = [],
} = {}) => ({
  suppressAnimations,
  deferredMountOperations,
});

const executeDeferredMountOperation = (operation) => {
  switch (operation?.type) {
    case "play-animated-sprite":
      if (!operation.animatedSprite?.destroyed) {
        operation.animatedSprite?.play();
      }
      return;
    case "play-video":
      operation.video?.play();
      return;
    case "start-particles":
      if (operation.app?.debug) {
        const customTickerHandler = (event) => {
          if (operation.emitter.destroyed) {
            window.removeEventListener("snapShotKeyFrame", customTickerHandler);
            return;
          }
          if (event?.detail?.deltaMS) {
            operation.emitter.update(Number(event.detail.deltaMS) / 1000);
            if (typeof operation.app?.render === "function") {
              operation.app.render();
            }
          }
        };
        window.addEventListener("snapShotKeyFrame", customTickerHandler);
        operation.container.customTickerHandler = customTickerHandler;
        return;
      }

      operation.app.ticker.add(operation.tickerCallback);
      return;
    case "autoplay-text-reveal":
      void runTextReveal({
        container: operation.container,
        element: operation.element,
        completionTracker: operation.completionTracker,
        animationBus: operation.animationBus,
        zIndex: operation.zIndex,
        signal: operation.signal,
        app: operation.app,
        playback: "autoplay",
        onLayoutMounted: operation.onLayoutMounted,
      });
      return;
    case "start-update-animations":
      if (!operation.element || operation.element.destroyed) {
        rollbackPreparedUpdateAnimations(operation);
        return;
      }

      dispatchUpdateAnimationsNow({
        animations: operation.animations,
        animationBus: operation.animationBus,
        completionTracker: operation.completionTracker,
        element: operation.element,
        targetState: operation.targetState,
        targetStates: operation.targetStates,
        animationBaseState: operation.animationBaseState,
        preparedGsap: operation.preparedGsap,
      });
      return;
  }
};

const rollbackPreparedUpdateAnimations = (operation) => {
  if (operation?.type !== "start-update-animations") return;
  for (const prepared of operation.preparedGsap?.values?.() ?? []) {
    prepared.bindingContext?.rollback?.();
  }
};

const queueDeferredMountOperation = (renderContext, operation) => {
  if (!operation?.type) {
    return;
  }

  if (!renderContext?.suppressAnimations) {
    executeDeferredMountOperation(operation);
    return;
  }

  renderContext.deferredMountOperations.push(operation);
};

export const clearDeferredMountOperations = (renderContext) => {
  if (!renderContext?.deferredMountOperations) {
    return;
  }

  const operations = renderContext.deferredMountOperations.splice(0);
  for (const operation of operations) {
    rollbackPreparedUpdateAnimations(operation);
  }
};

export const queueDeferredAnimatedSpritePlay = (
  renderContext,
  animatedSprite,
) =>
  queueDeferredMountOperation(renderContext, {
    type: "play-animated-sprite",
    animatedSprite,
  });

export const queueDeferredVideoPlay = (renderContext, video) =>
  queueDeferredMountOperation(renderContext, {
    type: "play-video",
    video,
  });

export const queueDeferredParticlesStart = (
  renderContext,
  { app, emitter, container, tickerCallback },
) =>
  queueDeferredMountOperation(renderContext, {
    type: "start-particles",
    app,
    emitter,
    container,
    tickerCallback,
  });

export const queueDeferredTextRevealAutoplay = (
  renderContext,
  {
    app,
    container,
    element,
    completionTracker,
    animationBus,
    zIndex,
    signal,
    onLayoutMounted,
  },
) =>
  queueDeferredMountOperation(renderContext, {
    type: "autoplay-text-reveal",
    app,
    container,
    element,
    completionTracker,
    animationBus,
    zIndex,
    signal,
    onLayoutMounted,
  });

export const queueDeferredUpdateAnimationStart = (
  renderContext,
  {
    animations,
    animationBus,
    completionTracker,
    element,
    targetState,
    animationBaseState,
    preparedGsap,
  },
) =>
  queueDeferredMountOperation(renderContext, {
    type: "start-update-animations",
    animations,
    animationBus,
    completionTracker,
    element,
    targetState,
    animationBaseState,
    preparedGsap,
  });

export const flushDeferredMountOperations = (
  renderContext,
  shouldFlush = () => true,
) => {
  if (!renderContext?.deferredMountOperations?.length) {
    return;
  }

  const operations = renderContext.deferredMountOperations.splice(0);
  const deferredOperations = [];

  for (const operation of operations) {
    if (shouldFlush(operation)) {
      executeDeferredMountOperation(operation);
    } else {
      deferredOperations.push(operation);
    }
  }

  if (deferredOperations.length > 0) {
    renderContext.deferredMountOperations.push(...deferredOperations);
  }
};
