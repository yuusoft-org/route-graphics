import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import { destroyRectFillResource } from "./rectFill.js";
import { cleanupRectInteractions } from "./rectInteractions.js";
import { destroyRectAppearanceRuntime } from "./rectAppearanceRuntime.js";

/**
 * Delete rectangle element (synchronous)
 * @param {import("../elementPlugin.js").DeleteElementOptions} params
 */
export const deleteRect = ({
  parent,
  element,
  animations,
  animationBus,
  completionTracker,
}) => {
  const rect = parent.getChildByLabel(element.id);

  if (!rect) return;

  cleanupRectInteractions(rect);

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: element.id,
    animationBus,
    completionTracker,
    element: rect,
    targetState: null,
    onComplete: () => {
      if (rect && !rect.destroyed) {
        destroyRectAppearanceRuntime(rect);
        destroyRectFillResource(rect);
        rect.destroy();
      }
    },
  });

  if (!dispatched) {
    // No animation, destroy immediately
    destroyRectAppearanceRuntime(rect);
    destroyRectFillResource(rect);
    rect.destroy();
  }
};
