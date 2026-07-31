import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import { destroyRectFillResource } from "./rectFill.js";
import { cleanupRectInteractions } from "./rectInteractions.js";

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

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: element.id,
    animationBus,
    completionTracker,
    element: rect,
    targetState: null,
    onComplete: () => {
      if (rect && !rect.destroyed) {
        cleanupRectInteractions(rect);
        destroyRectFillResource(rect);
        rect.destroy();
      }
    },
  });

  if (!dispatched) {
    // No animation, destroy immediately
    cleanupRectInteractions(rect);
    destroyRectFillResource(rect);
    rect.destroy();
  }
};
