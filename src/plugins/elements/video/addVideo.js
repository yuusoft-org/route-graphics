import { Texture, Sprite } from "pixi.js";
import { syncVideoPlaybackTracking } from "./playbackTracking.js";
import { queueDeferredVideoPlay } from "../renderContext.js";
import { normalizeVolume } from "../../../util/normalizeVolume.js";
import {
  dispatchLiveAnimations,
  getLiveAnimations,
} from "../../animations/planAnimations.js";
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
import {
  hasManagedVideoTextureDimensions,
  registerManagedVideoSprite,
  requestManagedVideoTextureUpdate,
  setManagedVideoSpriteResizeHandler,
} from "./managedVideoTextureSizing.js";
import {
  applyElementScaleAndPivot,
  applyElementTransform,
  getElementTransformTargetState,
  getTextureBackedScaleTargetState,
} from "../util/transform.js";

/**
 * Add video element to the stage
 * @param {import("../elementPlugin.js").AddElementOptions} params
 */
export const addVideo = ({
  parent,
  element,
  animations,
  animationBus,
  renderContext,
  completionTracker,
  zIndex,
  signal,
}) => {
  const { id, width, height, src, volume, loop, alpha } = element;

  const texture = Texture.from(src);
  const video = texture.source.resource;

  video.pause();
  video.currentTime = 0;
  video.loop = loop ?? false;
  video.volume = normalizeVolume(volume);
  video.muted = false;

  const sprite = new Sprite(texture);
  sprite.label = id;
  sprite.zIndex = zIndex;
  sprite._videoEndedListener = undefined;
  sprite._videoErrorListener = undefined;
  sprite._playbackStateVersion = null;

  sprite.width = Math.round(width);
  sprite.height = Math.round(height);
  applyElementTransform(sprite, element, { preserveScaleMagnitude: true });
  const targetState = {
    ...getElementTransformTargetState(element),
    ...getTextureBackedScaleTargetState(sprite, element, { width, height }),
    width,
    height,
    alpha: alpha ?? 1,
  };
  let waitingForTextureDimensions = false;
  let textureWaitVersion;

  const refreshScaleTargetState = () => {
    Object.assign(
      targetState,
      getTextureBackedScaleTargetState(sprite, element, { width, height }),
    );
  };

  const releaseTextureWait = () => {
    if (!waitingForTextureDimensions) return;
    waitingForTextureDimensions = false;
    signal?.removeEventListener?.("abort", cancelTextureWait);
    video.removeEventListener?.("error", cancelTextureWait);
    completionTracker?.complete?.(textureWaitVersion);
  };

  const cancelTextureWait = () => {
    releaseTextureWait();
  };

  const dispatchAnimations = () => {
    if (signal?.aborted || sprite.destroyed) {
      releaseTextureWait();
      return false;
    }

    refreshScaleTargetState();
    Object.assign(
      targetState,
      getBlurTargetState(element, { force: shouldForceBlur }),
      getShaderFilterTargetState(element, {
        force: shouldForceShaderProgress,
      }),
    );
    try {
      return dispatchLiveAnimations({
        animations,
        targetId: id,
        animationBus,
        completionTracker,
        element: sprite,
        targetState,
        renderContext,
      });
    } finally {
      releaseTextureWait();
    }
  };

  setManagedVideoSpriteResizeHandler(sprite, () => {
    applyElementScaleAndPivot(sprite, element, {
      preserveScaleMagnitude: true,
    });
    refreshScaleTargetState();

    if (
      waitingForTextureDimensions &&
      hasManagedVideoTextureDimensions(sprite)
    ) {
      dispatchAnimations();
    }
  });
  registerManagedVideoSprite(sprite);
  sprite.alpha = alpha ?? 1;
  const shouldForceBlur = hasBlurUpdateAnimation(animations, id);
  syncBlurEffect(sprite, element.blur, { force: shouldForceBlur });
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    id,
  );
  syncShaderFilters(sprite, element.filters, {
    width,
    height,
    force: shouldForceShaderProgress,
  });

  syncVideoPlaybackTracking({
    videoElement: sprite,
    video,
    loop,
    completionTracker,
  });

  parent.addChild(sprite);
  requestManagedVideoTextureUpdate(sprite);
  queueDeferredVideoPlay(renderContext, video);

  const needsStableAutoScaleTarget = getLiveAnimations(animations, id).some(
    (animation) =>
      animation.tween?.scaleX?.auto !== undefined ||
      animation.tween?.scaleY?.auto !== undefined,
  );

  if (needsStableAutoScaleTarget && !hasManagedVideoTextureDimensions(sprite)) {
    waitingForTextureDimensions = true;
    textureWaitVersion = completionTracker?.getVersion?.();
    completionTracker?.track?.(textureWaitVersion);
    signal?.addEventListener?.("abort", cancelTextureWait, { once: true });
    video.addEventListener?.("error", cancelTextureWait, { once: true });
    sprite.once?.("destroyed", cancelTextureWait);
    return;
  }

  dispatchAnimations();
};
