import { AnimatedSprite, Spritesheet, Texture } from "pixi.js";
import { setupDebugMode } from "./util/debugUtils.js";
import { queueDeferredAnimatedSpritePlay } from "../renderContext.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import {
  getBlurTargetState,
  hasBlurUpdateAnimation,
  syncBlurEffect,
} from "../util/blurEffect.js";
import {
  getShaderFilterTargetState,
  hasShaderProgressUpdateAnimation,
  setShaderTime,
  syncShaderFilters,
} from "../util/shaderFilterEffect.js";
import {
  normalizeAnimatedSpriteAtlas,
  normalizeAnimatedSpriteClips,
  normalizeAnimatedSpritePlayback,
  playbackFpsToAnimationSpeed,
  resolveAnimatedSpriteFrameTextures,
} from "./animatedSpriteConfig.js";
import {
  getElementTransformTargetState,
  getTextureBackedScaleTargetState,
} from "../util/transform.js";
import { applyAnimatedSpriteTransform } from "./animatedSpriteTransform.js";

/**
 * Add spritesheet animation element to the stage
 * @param {import("../elementPlugin.js").AddElementOptions} params
 */
export const addAnimatedSprite = async ({
  app,
  parent,
  element,
  animations,
  animationBus,
  renderContext,
  completionTracker,
  zIndex,
  signal,
  shaderTime = 0,
  getShaderTime,
}) => {
  if (signal?.aborted) return;

  const { id, width, height, src, atlas, clips, playback, alpha } = element;

  const normalizedAtlas = normalizeAnimatedSpriteAtlas(atlas);
  const normalizedClips = normalizeAnimatedSpriteClips(
    clips,
    atlas?.animations,
    atlas?.meta,
    Object.keys(normalizedAtlas.frames ?? {}),
  );
  const normalizedPlayback = normalizeAnimatedSpritePlayback({
    atlas: normalizedAtlas,
    clips: normalizedClips,
    playback,
  });
  const completionVersion = completionTracker?.getVersion?.();
  completionTracker?.track?.(completionVersion);

  try {
    const spriteSheet = new Spritesheet(Texture.from(src), normalizedAtlas);
    await spriteSheet.parse();
    if (signal?.aborted || parent.destroyed) return;

    const { frameTextures } = resolveAnimatedSpriteFrameTextures({
      spritesheet: spriteSheet,
      atlas: normalizedAtlas,
      clips: normalizedClips,
      playback: normalizedPlayback,
    });

    const animatedSprite = new AnimatedSprite(frameTextures);
    animatedSprite.label = id;
    animatedSprite.zIndex = zIndex;

    animatedSprite.animationSpeed = playbackFpsToAnimationSpeed(
      normalizedPlayback.fps,
    );
    animatedSprite.loop = normalizedPlayback.loop;

    if (app.debug) {
      setupDebugMode(animatedSprite, id, app.debug, () => {
        if (typeof app.render === "function") {
          app.render();
        }
      });
    } else if (normalizedPlayback.autoplay) {
      queueDeferredAnimatedSpritePlay(renderContext, animatedSprite);
    }

    animatedSprite.width = Math.round(width);
    animatedSprite.height = Math.round(height);
    applyAnimatedSpriteTransform(animatedSprite, element);
    animatedSprite.alpha = alpha;
    const shouldForceBlur = hasBlurUpdateAnimation(animations, id);
    syncBlurEffect(animatedSprite, element.blur, { force: shouldForceBlur });
    const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
      animations,
      id,
    );
    syncShaderFilters(animatedSprite, element.filters, {
      width,
      height,
      force: shouldForceShaderProgress,
    });
    setShaderTime(
      animatedSprite,
      typeof getShaderTime === "function" ? getShaderTime() : shaderTime,
    );

    parent.addChild(animatedSprite);

    dispatchLiveAnimations({
      animations,
      targetId: id,
      animationBus,
      completionTracker,
      element: animatedSprite,
      targetState: {
        ...getElementTransformTargetState(element),
        ...getTextureBackedScaleTargetState(animatedSprite, element, {
          width,
          height,
        }),
        width,
        height,
        alpha,
        ...getBlurTargetState(element, { force: shouldForceBlur }),
        ...getShaderFilterTargetState(element, {
          force: shouldForceShaderProgress,
        }),
      },
      renderContext,
    });

    if (typeof app.render === "function") {
      app.render();
    }
  } finally {
    completionTracker?.complete?.(completionVersion);
  }
};
