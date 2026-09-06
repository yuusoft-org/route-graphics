import { disposeVideoPlayback } from "./playbackTracking.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";

/**
 * Delete video element
 * @param {import("../elementPlugin.js").DeleteElementOptions} params
 */
export const deleteVideo = ({
  parent,
  element,
  animations,
  animationBus,
  completionTracker,
}) => {
  const videoElement = parent.children.find(
    (child) => child.label === element.id,
  );

  if (!videoElement) return;

  const deleteElement = () => {
    if (videoElement && !videoElement.destroyed) {
      disposeVideoPlayback(videoElement, completionTracker);
      parent.removeChild(videoElement);
      videoElement.destroy();
    }
  };

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: element.id,
    animationBus,
    completionTracker,
    element: videoElement,
    targetState: null,
    onComplete: deleteElement,
  });

  if (!dispatched) {
    deleteElement();
  }
};
