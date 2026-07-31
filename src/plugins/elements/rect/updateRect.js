import { isDeepEqual } from "../../../util/isDeepEqual.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";
import {
  getBlurTargetState,
  hasBlurUpdateAnimation,
  syncBlurEffect,
} from "../util/blurEffect.js";
import {
  getShaderFilterTargetState,
  hasShaderProgressUpdateAnimation,
  prepareShaderFilterAnimationTargets,
  resetShaderFilterProgress,
  syncShaderFilters,
} from "../util/shaderFilterEffect.js";
import { setElementRenderState } from "../elementRenderState.js";
import { drawRectVisual } from "./rectDrawing.js";
import { bindRectInteractions } from "./rectInteractions.js";
import {
  getRectStyleTargetState,
  installRectStyleRuntime,
  syncRectStyleRuntime,
} from "./rectStyleRuntime.js";

/**
 * Update rectangle element (synchronous)
 * @param {import("../elementPlugin.js").UpdateElementOptions} params
 */
export const updateRect = ({
  app,
  parent,
  prevElement,
  nextElement,
  animations,
  animationBus,
  eventHandler,
  zIndex,
  completionTracker,
  deferRenderStateCommit,
  commitRenderState,
}) => {
  const rectElement = parent.children.find(
    (child) => child.label === prevElement.id,
  );

  if (!rectElement) return;

  rectElement.zIndex = zIndex;

  const { width, height, alpha, scaleX, scaleY } = nextElement;
  const shouldForceBlur = hasBlurUpdateAnimation(animations, prevElement.id);
  if (shouldForceBlur) {
    syncBlurEffect(rectElement, prevElement.blur, { force: true });
  }
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    prevElement.id,
  );
  if (shouldForceShaderProgress) {
    syncShaderFilters(rectElement, prevElement.filters, {
      width: prevElement.width,
      height: prevElement.height,
      force: true,
      animations,
      targetId: prevElement.id,
    });
  } else {
    resetShaderFilterProgress(rectElement);
  }
  prepareShaderFilterAnimationTargets({
    displayObject: rectElement,
    element: nextElement,
    animations,
    targetId: prevElement.id,
  });
  installRectStyleRuntime(rectElement, prevElement, (property, runtime) => {
    drawRectVisual(rectElement, runtime.state, {
      ...runtime.element,
      ...runtime.state,
    });
    const dimensionChanged =
      property === "rect.width" ||
      property === "rect.height" ||
      property?.has?.("rect.width") ||
      property?.has?.("rect.height");
    if (dimensionChanged) {
      syncShaderFilters(rectElement, runtime.element.filters, {
        width: runtime.state.width,
        height: runtime.state.height,
        force: shouldForceShaderProgress,
        animations,
        targetId: prevElement.id,
      });
    }
  });
  const targetState = getElementTransformTargetState(nextElement, { alpha });

  if (scaleX !== undefined) {
    targetState.scaleX = scaleX;
  }

  if (scaleY !== undefined) {
    targetState.scaleY = scaleY;
  }

  const updateElement = () => {
    if (!isDeepEqual(prevElement, nextElement)) {
      const styleRuntime = syncRectStyleRuntime(rectElement, nextElement);
      drawRectVisual(rectElement, styleRuntime.state, nextElement);
      rectElement.alpha = alpha;
      // Rect computed nodes already bake scale into width/height for layout.
      // Reset the live transform so update tweens do not double-apply scale.
      rectElement.scale.x = 1;
      rectElement.scale.y = 1;
      applyElementTransform(rectElement, nextElement);

      syncBlurEffect(rectElement, nextElement.blur, {
        force: shouldForceBlur,
      });
      syncShaderFilters(rectElement, nextElement.filters, {
        width,
        height,
        force: shouldForceShaderProgress,
        animations,
        targetId: prevElement.id,
      });
      bindRectInteractions({
        app,
        rect: rectElement,
        element: nextElement,
        eventHandler,
      });
    }

    setElementRenderState(rectElement, nextElement);
    commitRenderState?.(rectElement);
  };

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: prevElement.id,
    animationBus,
    completionTracker,
    element: rectElement,
    targetState: {
      ...targetState,
      ...getRectStyleTargetState(nextElement),
      ...getBlurTargetState(nextElement, { force: shouldForceBlur }),
      ...getShaderFilterTargetState(nextElement, {
        force: shouldForceShaderProgress,
      }),
    },
    onComplete: () => {
      updateElement();
    },
  });

  if (!dispatched) {
    // No animations, update immediately
    updateElement();
  } else {
    deferRenderStateCommit?.();
  }
};
