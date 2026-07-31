import { Spritesheet, Texture } from "pixi.js";
import { setupDebugMode, cleanupDebugMode } from "./util/debugUtils.js";
import { isDeepEqual } from "../../../util/isDeepEqual.js";
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
  prepareShaderFilterAnimationTargets,
  resetShaderFilterProgress,
  syncShaderFilters,
} from "../util/shaderFilterEffect.js";
import {
  normalizeAnimatedSpriteAtlas,
  normalizeAnimatedSpriteClips,
  normalizeAnimatedSpritePlayback,
  playbackFpsToAnimationSpeed,
  resolveAnimatedSpriteFrameTextures,
} from "./animatedSpriteConfig.js";
import { setElementRenderState } from "../elementRenderState.js";
import { getElementTransformTargetState } from "../util/transform.js";
import {
  applyAnimatedSpriteTransform,
  refreshAnimatedSpritePivot,
  setAnimatedSpriteTransformElement,
} from "./animatedSpriteTransform.js";

/**
 * Update spritesheet animation element
 * @param {import("../elementPlugin.js").UpdateElementOptions} params
 */
export const updateAnimatedSprite = async ({
  app,
  parent,
  prevElement,
  nextElement,
  animations,
  animationBus,
  completionTracker,
  zIndex,
  signal,
  deferRenderStateCommit,
  commitRenderState,
}) => {
  if (signal?.aborted) return;

  const animatedSpriteElement = parent.children.find(
    (child) => child.label === prevElement.id,
  );

  if (!animatedSpriteElement) return;

  animatedSpriteElement.zIndex = zIndex;
  setAnimatedSpriteTransformElement(animatedSpriteElement, prevElement);
  const shouldForceBlur = hasBlurUpdateAnimation(animations, prevElement.id);
  if (shouldForceBlur) {
    syncBlurEffect(animatedSpriteElement, prevElement.blur, { force: true });
  }
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    prevElement.id,
  );
  if (shouldForceShaderProgress) {
    syncShaderFilters(animatedSpriteElement, prevElement.filters, {
      width: prevElement.width,
      height: prevElement.height,
      force: true,
      animations,
      targetId: prevElement.id,
    });
  } else {
    resetShaderFilterProgress(animatedSpriteElement);
  }
  prepareShaderFilterAnimationTargets({
    displayObject: animatedSpriteElement,
    element: nextElement,
    animations,
    targetId: prevElement.id,
  });

  const prevAtlas = normalizeAnimatedSpriteAtlas(prevElement.atlas);
  const prevClips = normalizeAnimatedSpriteClips(
    prevElement.clips,
    prevElement.atlas?.animations,
    prevElement.atlas?.meta,
    Object.keys(prevAtlas.frames ?? {}),
  );
  const prevPlayback = normalizeAnimatedSpritePlayback({
    atlas: prevAtlas,
    clips: prevClips,
    playback: prevElement.playback,
  });
  const nextSrc = nextElement.src;
  const nextAtlas = normalizeAnimatedSpriteAtlas(nextElement.atlas);
  const nextClips = normalizeAnimatedSpriteClips(
    nextElement.clips,
    nextElement.atlas?.animations,
    nextElement.atlas?.meta,
    Object.keys(nextAtlas.frames ?? {}),
  );
  const nextPlayback = normalizeAnimatedSpritePlayback({
    atlas: nextAtlas,
    clips: nextClips,
    playback: nextElement.playback,
  });
  const playbackChanged = !isDeepEqual(
    prevElement.playback,
    nextElement.playback,
  );
  const clipSetChanged = !isDeepEqual(prevElement.clips, nextElement.clips);
  const atlasChanged =
    prevElement.src !== nextSrc ||
    !isDeepEqual(prevElement.atlas, nextElement.atlas);
  const playbackFramesChanged = !isDeepEqual(
    prevPlayback.frames,
    nextPlayback.frames,
  );
  const frameResourceChanged =
    atlasChanged || clipSetChanged || playbackFramesChanged;
  const shouldSyncFrameResource =
    playbackChanged || clipSetChanged || atlasChanged;
  let didSyncFrameResource = false;

  const syncFrameResource = async ({
    completeOnFinish = true,
    renderAfterSync = true,
  } = {}) => {
    if (signal?.aborted || animatedSpriteElement.destroyed) {
      return { synced: false, completionVersion: undefined };
    }

    animatedSpriteElement.animationSpeed = playbackFpsToAnimationSpeed(
      nextPlayback.fps,
    );
    animatedSpriteElement.loop = nextPlayback.loop;

    if (!shouldSyncFrameResource || didSyncFrameResource) {
      return { synced: true, completionVersion: undefined };
    }

    const completionVersion = completionTracker?.getVersion?.();
    completionTracker?.track?.(completionVersion);

    try {
      const spriteSheet = new Spritesheet(Texture.from(nextSrc), nextAtlas);
      await spriteSheet.parse();
      if (signal?.aborted || animatedSpriteElement.destroyed) {
        return { synced: false, completionVersion };
      }

      const { frameTextures } = resolveAnimatedSpriteFrameTextures({
        spritesheet: spriteSheet,
        atlas: nextAtlas,
        clips: nextClips,
        playback: nextPlayback,
      });
      animatedSpriteElement.textures = frameTextures;
      refreshAnimatedSpritePivot(animatedSpriteElement);
      didSyncFrameResource = true;

      if (renderAfterSync && typeof app.render === "function") {
        app.render();
      }

      if (!app.debug && nextPlayback.autoplay) {
        animatedSpriteElement.play();
      } else {
        if (!app.debug) {
          animatedSpriteElement.stop?.();
        }

        if (prevElement.id !== nextElement.id) {
          cleanupDebugMode(animatedSpriteElement);
          setupDebugMode(
            animatedSpriteElement,
            nextElement.id,
            app.debug,
            () => {
              if (typeof app.render === "function") {
                app.render();
              }
            },
          );
        }
      }
    } finally {
      if (completeOnFinish) {
        completionTracker?.complete?.(completionVersion);
      }
    }

    return { synced: true, completionVersion };
  };

  const updateElement = async () => {
    if (signal?.aborted || animatedSpriteElement.destroyed) return;

    if (!isDeepEqual(prevElement, nextElement)) {
      animatedSpriteElement.width = Math.round(nextElement.width);
      animatedSpriteElement.height = Math.round(nextElement.height);
      applyAnimatedSpriteTransform(animatedSpriteElement, nextElement);
      animatedSpriteElement.alpha = nextElement.alpha;
      syncBlurEffect(animatedSpriteElement, nextElement.blur, {
        force: shouldForceBlur,
      });
      syncShaderFilters(animatedSpriteElement, nextElement.filters, {
        width: nextElement.width,
        height: nextElement.height,
        force: shouldForceShaderProgress,
        animations,
        targetId: prevElement.id,
      });

      await syncFrameResource();
    }

    if (!signal?.aborted && !animatedSpriteElement.destroyed) {
      setElementRenderState(animatedSpriteElement, nextElement);
      commitRenderState?.(animatedSpriteElement);
    }
  };

  const { width, height, alpha } = nextElement;
  const liveAnimations = getLiveAnimations(animations, prevElement.id);
  const hasLiveAnimation = liveAnimations.length > 0;
  const hasLiveAnimationTween = (property) =>
    liveAnimations.some((animation) =>
      Object.prototype.hasOwnProperty.call(animation.tween ?? {}, property),
    );
  let preDispatchFrameResourceCompletionVersion;

  if (frameResourceChanged && hasLiveAnimation) {
    const currentWidth = animatedSpriteElement.width;
    const currentHeight = animatedSpriteElement.height;
    const result = await syncFrameResource({
      completeOnFinish: false,
      renderAfterSync: false,
    });
    if (!result?.synced) {
      completionTracker?.complete?.(result?.completionVersion);
      return;
    }

    animatedSpriteElement.width = Math.round(
      hasLiveAnimationTween("width") ? currentWidth : width,
    );
    animatedSpriteElement.height = Math.round(
      hasLiveAnimationTween("height") ? currentHeight : height,
    );
    refreshAnimatedSpritePivot(animatedSpriteElement);

    if (typeof app.render === "function") {
      app.render();
    }

    preDispatchFrameResourceCompletionVersion = result.completionVersion;
  }

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: prevElement.id,
    animationBus,
    completionTracker,
    element: animatedSpriteElement,
    targetState: {
      ...getElementTransformTargetState(nextElement),
      width,
      height,
      alpha,
      ...getBlurTargetState(nextElement, {
        force: shouldForceBlur,
      }),
      ...getShaderFilterTargetState(nextElement, {
        force: shouldForceShaderProgress,
      }),
    },
    onComplete: () => {
      void updateElement();
    },
  });

  if (preDispatchFrameResourceCompletionVersion !== undefined) {
    completionTracker?.complete?.(preDispatchFrameResourceCompletionVersion);
  }

  if (!dispatched) {
    // No animations, update immediately
    await updateElement();
  } else {
    deferRenderStateCommit?.();
  }
};
