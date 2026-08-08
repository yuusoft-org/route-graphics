import { Graphics } from "pixi.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import { destroyRectFillResource } from "./rectFill.js";
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
  syncShaderFilters,
} from "../util/shaderFilterEffect.js";
import { bindRectInteractions } from "./rectInteractions.js";
import {
  installRectAppearanceRuntime,
  notifyRectBaseStyleChange,
} from "./rectAppearanceRuntime.js";
import {
  getRectStyleTargetState,
  installRectStyleRuntime,
} from "./rectStyleRuntime.js";

/**
 * Add rectangle element to the stage (synchronous)
 * @param {import("../elementPlugin.js").AddElementOptions} params
 */
export const addRect = ({
  app,
  parent,
  element,
  animations,
  animationBus,
  eventHandler,
  zIndex,
  completionTracker,
  renderContext,
}) => {
  const { id, width, height, alpha, scaleX, scaleY } = element;
  const shouldForceBlur = hasBlurUpdateAnimation(animations, id);
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    id,
  );

  const rect = new Graphics();
  rect.label = id;
  rect.zIndex = zIndex;
  rect.on("destroyed", () => {
    destroyRectFillResource(rect);
  });
  const styleRuntime = installRectStyleRuntime(
    rect,
    element,
    (property, runtime) => {
      notifyRectBaseStyleChange(rect);
      const dimensionChanged =
        property === "rect.width" ||
        property === "rect.height" ||
        property?.has?.("rect.width") ||
        property?.has?.("rect.height");
      if (dimensionChanged) {
        syncShaderFilters(rect, runtime.element.filters, {
          width: runtime.state.width,
          height: runtime.state.height,
          force: shouldForceShaderProgress,
          animations,
          targetId: id,
        });
      }
    },
  );
  installRectAppearanceRuntime(rect, element, styleRuntime);
  const targetState = getElementTransformTargetState(element, { alpha });

  if (scaleX !== undefined) {
    targetState.scaleX = scaleX;
  }

  if (scaleY !== undefined) {
    targetState.scaleY = scaleY;
  }

  const drawRect = () => {
    // Rect computed nodes already bake scale into width/height for layout.
    // Reset the live transform so update tweens do not double-apply scale.
    rect.scale.x = 1;
    rect.scale.y = 1;
    applyElementTransform(rect, element);

    syncBlurEffect(rect, element.blur, { force: shouldForceBlur });
    syncShaderFilters(rect, element.filters, {
      width,
      height,
      force: shouldForceShaderProgress,
    });
  };

  drawRect();
  bindRectInteractions({ app, rect, element, eventHandler });

  parent.addChild(rect);

  dispatchLiveAnimations({
    animations,
    targetId: id,
    animationBus,
    completionTracker,
    element: rect,
    targetState: {
      ...targetState,
      ...getRectStyleTargetState(element),
      ...getBlurTargetState(element, { force: shouldForceBlur }),
      ...getShaderFilterTargetState(element, {
        force: shouldForceShaderProgress,
      }),
    },
    renderContext,
  });
};
