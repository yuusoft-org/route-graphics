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
  hasManagedVideoTextureDimensions,
  registerManagedVideoSprite,
  requestManagedVideoTextureUpdate,
  setManagedVideoSpriteResizeHandler,
  unregisterManagedVideoSprite,
} from "./managedVideoTextureSizing.js";
import { setElementRenderState } from "../elementRenderState.js";
import {
  applyElementScaleAndPivot,
  applyElementTransform,
  getElementTransformTargetState,
  getTextureBackedScaleTargetState,
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
  completionTracker,
  zIndex,
  deferRenderStateCommit,
  commitRenderState,
  signal,
}) => {
  const videoElement = parent.children.find(
    (child) => child.label === prevElement.id,
  );

  if (!videoElement) return;

  videoElement.zIndex = zIndex;
  let managedTransformElement = prevElement;
  let handleManagedTextureResize = () => {};
  setManagedVideoSpriteResizeHandler(videoElement, () => {
    applyElementScaleAndPivot(videoElement, managedTransformElement, {
      preserveScaleMagnitude: true,
    });
    handleManagedTextureResize();
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
  const needsStableAutoScaleTarget = liveAnimations.some(
    (animation) =>
      animation.tween?.scaleX?.auto !== undefined ||
      animation.tween?.scaleY?.auto !== undefined,
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
      applyElementScaleAndPivot(videoElement, managedTransformElement, {
        preserveScaleMagnitude: true,
      });
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
      applyElementTransform(videoElement, nextElement, {
        preserveScaleMagnitude: true,
      });
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
    applyElementScaleAndPivot(videoElement, managedTransformElement, {
      preserveScaleMagnitude: true,
    });
    didSyncResourceBeforeAnimation = true;
  }

  const targetState = {
    ...getElementTransformTargetState(nextElement),
    ...getTextureBackedScaleTargetState(videoElement, nextElement, {
      width,
      height,
    }),
    width,
    height,
    alpha: alpha ?? 1,
    ...getBlurTargetState(nextElement, {
      force: shouldForceBlur,
    }),
    ...getShaderFilterTargetState(nextElement, {
      force: shouldForceShaderProgress,
    }),
  };
  let waitingForTextureDimensions = false;
  let textureWaitVersion;
  const activeVideo = videoElement.texture?.source?.resource;

  const refreshScaleTargetState = () => {
    Object.assign(
      targetState,
      getTextureBackedScaleTargetState(videoElement, nextElement, {
        width,
        height,
      }),
    );
  };

  const releaseTextureWait = () => {
    if (!waitingForTextureDimensions) return;
    waitingForTextureDimensions = false;
    signal?.removeEventListener?.("abort", cancelTextureWait);
    activeVideo?.removeEventListener?.("error", failTextureWait);
    completionTracker?.complete?.(textureWaitVersion);
  };

  const cancelTextureWait = () => {
    releaseTextureWait();
  };

  const failTextureWait = () => {
    try {
      if (!signal?.aborted && !videoElement.destroyed) {
        updateElement();
      }
    } finally {
      releaseTextureWait();
    }
  };

  const dispatchAnimations = () => {
    if (signal?.aborted || videoElement.destroyed) {
      releaseTextureWait();
      return false;
    }

    refreshScaleTargetState();
    try {
      return dispatchLiveAnimations({
        animations,
        targetId: prevElement.id,
        animationBus,
        completionTracker,
        element: videoElement,
        targetState,
        onComplete: updateElement,
      });
    } finally {
      releaseTextureWait();
    }
  };

  handleManagedTextureResize = () => {
    refreshScaleTargetState();
    if (
      waitingForTextureDimensions &&
      hasManagedVideoTextureDimensions(videoElement)
    ) {
      dispatchAnimations();
    }
  };

  requestManagedVideoTextureUpdate(videoElement);

  if (
    needsStableAutoScaleTarget &&
    !hasManagedVideoTextureDimensions(videoElement)
  ) {
    waitingForTextureDimensions = true;
    textureWaitVersion = completionTracker?.getVersion?.();
    completionTracker?.track?.(textureWaitVersion);
    signal?.addEventListener?.("abort", cancelTextureWait, { once: true });
    activeVideo?.addEventListener?.("error", failTextureWait, { once: true });
    videoElement.once?.("destroyed", cancelTextureWait);
    deferRenderStateCommit?.();
    return;
  }

  const dispatched = dispatchAnimations();

  if (!dispatched) {
    // No animations, update immediately
    updateElement();
  } else {
    deferRenderStateCommit?.();
  }
};
