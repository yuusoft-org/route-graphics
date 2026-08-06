import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import { queueDeferredTextRevealAutoplay } from "../renderContext.js";
import {
  runTextReveal,
  shouldRenderTextRevealImmediately,
} from "./textRevealingRuntime.js";
import { normalizeSoftWipeConfig } from "./softWipeConfig.js";
import { setElementRenderState } from "../elementRenderState.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";
import { prepareShaderFilterAnimationTargets } from "../util/shaderFilterEffect.js";

const getRevealIdentity = (element = {}) =>
  JSON.stringify({
    content: element.content ?? null,
    revealEffect: element.revealEffect ?? "typewriter",
    softWipe:
      (element.revealEffect ?? "typewriter") === "softWipe"
        ? normalizeSoftWipeConfig(element.softWipe)
        : null,
    speed: element.speed ?? 50,
    initialRevealedCharacters: element.initialRevealedCharacters ?? 0,
    width: element.width ?? null,
    indicator: element.indicator ?? null,
    revealSound: element.revealSound ?? null,
    x: element.x ?? null,
    y: element.y ?? null,
    alpha: element.alpha ?? 1,
  });

const shouldRestartReveal = (prevElement, nextElement) =>
  getRevealIdentity(prevElement) !== getRevealIdentity(nextElement);

/**
 * Simple render function for text-revealing elements
 * @param {import("../elementPlugin").UpdateElementOptions} params
 */
export const updateTextRevealing = async ({
  app,
  parent,
  prevElement,
  nextElement: element,
  animations,
  animationBus,
  renderContext,
  completionTracker,
  zIndex,
  signal,
  deferRenderStateCommit,
  commitRenderState,
}) => {
  if (signal?.aborted) return;

  const textRevealingElement = parent.children.find(
    (child) => child.label === prevElement.id,
  );
  if (!textRevealingElement) return;

  prepareShaderFilterAnimationTargets({
    displayObject: textRevealingElement,
    element,
    animations,
    targetId: prevElement.id,
  });

  let didCommitMountedLayout = false;
  const commitMountedLayout = () => {
    if (!signal?.aborted && !textRevealingElement.destroyed) {
      setElementRenderState(textRevealingElement, element);
      commitRenderState?.(textRevealingElement);
      didCommitMountedLayout = true;
    }
  };

  const updateElement = async () => {
    applyElementTransform(textRevealingElement, element, {
      scaleMode: "full",
    });
    if (element.alpha !== undefined) {
      textRevealingElement.alpha = element.alpha;
    }

    if (!shouldRestartReveal(prevElement, element)) {
      if (
        renderContext?.suppressAnimations !== true &&
        !shouldRenderTextRevealImmediately(element)
      ) {
        await runTextReveal({
          container: textRevealingElement,
          element,
          completionTracker,
          animationBus,
          zIndex,
          signal,
          app,
          playback: "resume",
          onLayoutMounted: commitMountedLayout,
        });
        if (!didCommitMountedLayout) {
          commitMountedLayout();
        }
      } else {
        commitMountedLayout();
      }

      return;
    }

    if (
      renderContext?.suppressAnimations === true &&
      !shouldRenderTextRevealImmediately(element)
    ) {
      await runTextReveal({
        container: textRevealingElement,
        element,
        completionTracker,
        animationBus,
        zIndex,
        signal,
        app,
        playback: "paused-initial",
        onLayoutMounted: commitMountedLayout,
      });

      queueDeferredTextRevealAutoplay(renderContext, {
        container: textRevealingElement,
        element,
        completionTracker,
        animationBus,
        zIndex,
        signal,
        app,
        onLayoutMounted: commitMountedLayout,
      });
      return;
    }

    await runTextReveal({
      container: textRevealingElement,
      element,
      completionTracker,
      animationBus,
      zIndex,
      signal,
      app,
      playback: "autoplay",
      onLayoutMounted: commitMountedLayout,
    });
  };

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: prevElement.id,
    animationBus,
    completionTracker,
    element: textRevealingElement,
    targetState: getElementTransformTargetState(element, {
      alpha: element.alpha ?? textRevealingElement.alpha,
      ...(element.scaleX !== undefined && { scaleX: element.scaleX }),
      ...(element.scaleY !== undefined && { scaleY: element.scaleY }),
    }),
    onComplete: () => {
      void updateElement();
    },
  });

  if (!dispatched) {
    await updateElement();
  } else {
    deferRenderStateCommit?.();
  }
};
