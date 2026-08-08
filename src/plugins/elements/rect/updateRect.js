import { isDeepEqual } from "../../../util/isDeepEqual.js";
import {
  dispatchLiveAnimations,
  getLiveAnimations,
} from "../../animations/planAnimations.js";
import {
  applyElementPivot,
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
import { bindRectInteractions } from "./rectInteractions.js";
import {
  installRectAppearanceRuntime,
  notifyRectBaseStyleChange,
  syncRectAppearanceRuntime,
  syncRectInteractionAppearance,
} from "./rectAppearanceRuntime.js";
import {
  RECT_STYLE_STATE_KEY,
  getRectStyleTargetState,
  installRectStyleRuntime,
  syncRectStyleRuntime,
} from "./rectStyleRuntime.js";

export const shouldRestoreStaticRectTransform = ({ parent, nextElement }) => {
  const rectElement = parent.children.find(
    (child) => child.label === nextElement.id,
  );

  if (!rectElement) {
    return false;
  }

  const styleRuntime = rectElement[RECT_STYLE_STATE_KEY];

  return (
    rectElement.scale.x !== Math.sign(nextElement.scaleX ?? 1) ||
    rectElement.scale.y !== Math.sign(nextElement.scaleY ?? 1) ||
    (styleRuntime !== undefined &&
      (styleRuntime.state.width !== nextElement.width ||
        styleRuntime.state.height !== nextElement.height))
  );
};

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
  const liveAnimations = getLiveAnimations(animations, prevElement.id);
  const liveScaleX = liveAnimations.some(
    (animation) => animation.tween?.scaleX !== undefined,
  );
  const liveScaleY = liveAnimations.some(
    (animation) => animation.tween?.scaleY !== undefined,
  );
  const rectStyleTargetState = getRectStyleTargetState(nextElement, {
    liveScaleX,
    liveScaleY,
  });
  const rectStyleRuntime = installRectStyleRuntime(
    rectElement,
    prevElement,
    (property, runtime) => {
      notifyRectBaseStyleChange(rectElement);
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
    },
  );
  installRectAppearanceRuntime(rectElement, prevElement, rectStyleRuntime);
  const rectStyleStartState = getRectStyleTargetState(prevElement, {
    liveScaleX,
    liveScaleY,
  });
  const authoredScaleX = prevElement.scaleX ?? 1;
  const authoredScaleY = prevElement.scaleY ?? 1;
  const staticScaleX = Math.sign(authoredScaleX);
  const staticScaleY = Math.sign(authoredScaleY);
  const shouldUnbakeWidth =
    liveScaleX &&
    Math.abs(authoredScaleX) > 0 &&
    rectStyleRuntime.state.width === prevElement.width &&
    rectStyleRuntime.state.width !== rectStyleStartState["rect.width"];
  const shouldUnbakeHeight =
    liveScaleY &&
    Math.abs(authoredScaleY) > 0 &&
    rectStyleRuntime.state.height === prevElement.height &&
    rectStyleRuntime.state.height !== rectStyleStartState["rect.height"];
  const shouldBakeWidth =
    !liveScaleX &&
    (rectStyleRuntime.state.width !== prevElement.width ||
      rectElement.scale.x !== staticScaleX);
  const shouldBakeHeight =
    !liveScaleY &&
    (rectStyleRuntime.state.height !== prevElement.height ||
      rectElement.scale.y !== staticScaleY);

  if (
    shouldUnbakeWidth ||
    shouldUnbakeHeight ||
    shouldBakeWidth ||
    shouldBakeHeight
  ) {
    rectStyleRuntime.beginBatch();
    if (shouldBakeWidth) {
      rectElement.scale.x = staticScaleX;
      rectStyleRuntime["rect.width"] = prevElement.width;
    } else if (shouldUnbakeWidth) {
      rectElement.scale.x *= Math.abs(authoredScaleX);
      rectStyleRuntime["rect.width"] = rectStyleStartState["rect.width"];
    }
    if (shouldBakeHeight) {
      rectElement.scale.y = staticScaleY;
      rectStyleRuntime["rect.height"] = prevElement.height;
    } else if (shouldUnbakeHeight) {
      rectElement.scale.y *= Math.abs(authoredScaleY);
      rectStyleRuntime["rect.height"] = rectStyleStartState["rect.height"];
    }
    rectStyleRuntime.endBatch();
    applyElementPivot(rectElement, prevElement, {
      baseScaleX: liveScaleX ? authoredScaleX : staticScaleX,
      baseScaleY: liveScaleY ? authoredScaleY : staticScaleY,
    });
  }
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
      syncRectAppearanceRuntime(rectElement, nextElement, styleRuntime);
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
      ...rectStyleTargetState,
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
    if (!isDeepEqual(prevElement, nextElement)) {
      syncRectInteractionAppearance(rectElement, nextElement);
      bindRectInteractions({
        app,
        rect: rectElement,
        element: nextElement,
        eventHandler,
      });
    }
    deferRenderStateCommit?.();
  }
};
