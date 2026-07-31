import { Texture } from "pixi.js";
import { isDeepEqual } from "../../../util/isDeepEqual.js";
import {
  clearVideoPlaybackTracking,
  syncVideoPlaybackTracking,
} from "./playbackTracking.js";
import {
  dispatchLiveAnimations,
  getLiveAnimations,
} from "../../animations/planAnimations.js";
import { normalizeVolume } from "../../../util/normalizeVolume.js";
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
import {
  registerManagedVideoSprite,
  requestManagedVideoTextureUpdate,
  setManagedVideoSpriteResizeHandler,
  unregisterManagedVideoSprite,
} from "./managedVideoTextureSizing.js";
import { setElementRenderState } from "../elementRenderState.js";
import {
  applyElementPivot,
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";

/**
 * Update video element
 * @param {import("../elementPlugin.js").UpdateElementOptions} params
 */
export const updateVideo = ({
  parent,
  prevElement,
  nextElement,
  animations,
  animationBus,
  eventHandler,
  completionTracker,
  zIndex,
  deferRenderStateCommit,
  commitRenderState,
}) => {
  const videoElement = parent.children.find(
    (child) => child.label === prevElement.id,
  );

  if (!videoElement) return;

  videoElement.zIndex = zIndex;
  let managedTransformElement = prevElement;
  setManagedVideoSpriteResizeHandler(videoElement, () => {
    applyElementPivot(videoElement, managedTransformElement);
  });

  const { width, height, alpha } = nextElement;
  const shouldForceBlur = hasBlurUpdateAnimation(animations, prevElement.id);
  if (shouldForceBlur) {
    syncBlurEffect(videoElement, prevElement.blur, { force: true });
  }
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    prevElement.id,
  );
  if (shouldForceShaderProgress) {
    syncShaderFilters(videoElement, prevElement.filters, {
      width: prevElement.width,
      height: prevElement.height,
      force: true,
      animations,
      targetId: prevElement.id,
    });
  } else {
    resetShaderFilterProgress(videoElement);
  }
  prepareShaderFilterAnimationTargets({
    displayObject: videoElement,
    element: nextElement,
    animations,
    targetId: prevElement.id,
  });

  let currentSrc = prevElement.src;
  let didSyncResourceBeforeAnimation = false;
  const liveAnimations = getLiveAnimations(animations, prevElement.id);
  const hasLiveAnimation = liveAnimations.length > 0;
  const hasLiveAnimationTween = (property) =>
    liveAnimations.some((animation) =>
      Object.prototype.hasOwnProperty.call(animation.tween ?? {}, property),
    );

  const syncVideoResource = () => {
    let activeVideo = videoElement.texture.source.resource;
    const srcChanged = currentSrc !== nextElement.src;

    if (srcChanged) {
      const oldVideo = activeVideo;
      const oldSource = videoElement.texture?.source;
      clearVideoPlaybackTracking({
        videoElement,
        video: oldVideo,
      });

      if (oldVideo) {
        oldVideo.pause();
      }

      const newTexture = Texture.from(nextElement.src);
      videoElement.texture = newTexture;
      applyElementPivot(videoElement, managedTransformElement);
      unregisterManagedVideoSprite(videoElement, oldSource);
      registerManagedVideoSprite(videoElement);
      activeVideo = newTexture.source.resource;

      activeVideo.muted = false;
      activeVideo.pause();
      activeVideo.currentTime = 0;
      currentSrc = nextElement.src;
      requestManagedVideoTextureUpdate(videoElement);
    }

    syncVideoPlaybackTracking({
      videoElement,
      video: activeVideo,
      loop: nextElement.loop,
      completionTracker,
    });

    activeVideo.volume = normalizeVolume(nextElement.volume);
    activeVideo.loop = nextElement.loop ?? false;

    if (srcChanged) {
      activeVideo.play();
    }
  };

  const updateElement = () => {
    managedTransformElement = nextElement;

    if (!isDeepEqual(prevElement, nextElement)) {
      videoElement.width = Math.round(width);
      videoElement.height = Math.round(height);
      applyElementTransform(videoElement, nextElement);
      videoElement.alpha = alpha ?? 1;
      syncBlurEffect(videoElement, nextElement.blur, {
        force: shouldForceBlur,
      });
      syncShaderFilters(videoElement, nextElement.filters, {
        width,
        height,
        force: shouldForceShaderProgress,
        animations,
        targetId: prevElement.id,
      });

      if (!didSyncResourceBeforeAnimation) {
        syncVideoResource();
      }
    }

    setElementRenderState(videoElement, nextElement);
    commitRenderState?.(videoElement);
  };

  if (prevElement.src !== nextElement.src && hasLiveAnimation) {
    const currentWidth = videoElement.width;
    const currentHeight = videoElement.height;
    syncVideoResource();
    videoElement.width = Math.round(
      hasLiveAnimationTween("width") ? currentWidth : width,
    );
    videoElement.height = Math.round(
      hasLiveAnimationTween("height") ? currentHeight : height,
    );
    applyElementPivot(videoElement, managedTransformElement);
    didSyncResourceBeforeAnimation = true;
  }

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: prevElement.id,
    animationBus,
    completionTracker,
    element: videoElement,
    targetState: {
      ...getElementTransformTargetState(nextElement),
      width,
      height,
      alpha: alpha ?? 1,
      ...getBlurTargetState(nextElement, {
        force: shouldForceBlur,
      }),
      ...getShaderFilterTargetState(nextElement, {
        force: shouldForceShaderProgress,
      }),
    },
    onComplete: updateElement,
  });

  if (!dispatched) {
    // No animations, update immediately
    updateElement();
  } else {
    deferRenderStateCommit?.();
  }
};
