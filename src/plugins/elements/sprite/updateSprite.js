import { Texture } from "pixi.js";
import { isDeepEqual } from "../../../util/isDeepEqual.js";
import { normalizeVolume } from "../../../util/normalizeVolume.js";
import {
  dispatchLiveAnimations,
  getLiveAnimations,
} from "../../animations/planAnimations.js";
import { isPrimaryPointerEvent } from "../util/isPrimaryPointerEvent.js";
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
  clearInheritedHoverTarget,
  clearInheritedPressTarget,
  clearInheritedRightPressTarget,
  createHoverStateController,
  createPressStateController,
  createRightPressStateController,
} from "../util/hoverInheritance.js";
import { setupScrollInteraction } from "../util/setupScrollInteraction.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";
import { setElementRenderState } from "../elementRenderState.js";

/**
 * Update sprite element (synchronous)
 * @param {import("../elementPlugin.js").UpdateElementOptions} params
 */
export const updateSprite = ({
  app,
  parent,
  prevElement,
  nextElement,
  animations,
  animationBus,
  completionTracker,
  eventHandler,
  zIndex,
  deferRenderStateCommit,
  commitRenderState,
}) => {
  const spriteElement = parent.children.find(
    (child) => child.label === prevElement.id,
  );

  if (!spriteElement) return;

  spriteElement.zIndex = zIndex;

  const { width, height, src, alpha } = nextElement;
  const shouldForceBlur = hasBlurUpdateAnimation(animations, prevElement.id);
  if (shouldForceBlur) {
    syncBlurEffect(spriteElement, prevElement.blur, { force: true });
  }
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    prevElement.id,
  );
  if (shouldForceShaderProgress) {
    syncShaderFilters(spriteElement, prevElement.filters, {
      width: prevElement.width,
      height: prevElement.height,
      force: true,
    });
  } else {
    resetShaderFilterProgress(spriteElement);
  }
  prepareShaderFilterAnimationTargets({
    displayObject: spriteElement,
    element: nextElement,
    animations,
    targetId: prevElement.id,
  });

  let didSyncResourceBeforeAnimation = false;
  const liveAnimations = getLiveAnimations(animations, prevElement.id);
  const hasLiveAnimation = liveAnimations.length > 0;
  const hasLiveAnimationTween = (property) =>
    liveAnimations.some((animation) =>
      Object.prototype.hasOwnProperty.call(animation.tween ?? {}, property),
    );

  const bindSpriteInteractions = (texture) => {
    spriteElement._cleanupScrollInteraction?.();
    spriteElement.removeAllListeners("pointerover");
    spriteElement.removeAllListeners("pointerout");
    spriteElement.removeAllListeners("pointerdown");
    spriteElement.removeAllListeners("pointerupoutside");
    spriteElement.removeAllListeners("pointerup");
    spriteElement.removeAllListeners("rightdown");
    spriteElement.removeAllListeners("rightclick");
    spriteElement.removeAllListeners("rightup");
    spriteElement.removeAllListeners("rightupoutside");
    spriteElement.removeAllListeners("wheel");
    clearInheritedHoverTarget(spriteElement);
    clearInheritedPressTarget(spriteElement);
    clearInheritedRightPressTarget(spriteElement);

    const hoverEvents = nextElement?.hover;
    const clickEvents = nextElement?.click;
    const rightClickEvents = nextElement?.rightClick;
    const scrollUpEvent = nextElement?.scrollUp;
    const scrollDownEvent = nextElement?.scrollDown;

    let hoverController = null;
    let pressController = null;
    let rightPressController = null;

    const updateTexture = () => {
      const isHovering = hoverController?.isHovering() ?? false;
      const isPressed = pressController?.isPressed() ?? false;
      const isRightPressed = rightPressController?.isPressed() ?? false;

      if (isRightPressed && rightClickEvents?.src) {
        const rightClickTexture = Texture.from(rightClickEvents.src);
        spriteElement.texture = rightClickTexture;
      } else if (isPressed && clickEvents?.src) {
        const clickTexture = Texture.from(clickEvents.src);
        spriteElement.texture = clickTexture;
      } else if (isHovering && hoverEvents?.src) {
        const hoverTexture = Texture.from(hoverEvents.src);
        spriteElement.texture = hoverTexture;
      } else {
        spriteElement.texture = texture;
      }
    };

    if (hoverEvents) {
      const { cursor, soundSrc, soundVolume, payload } = hoverEvents;
      spriteElement.eventMode = "static";
      hoverController = createHoverStateController({
        displayObject: spriteElement,
        onHoverChange: updateTexture,
      });

      const overListener = () => {
        hoverController.setDirectHover(true);
        if (payload && eventHandler)
          eventHandler(`hover`, {
            _event: {
              id: spriteElement.label,
            },
            ...payload,
          });
        if (cursor) spriteElement.cursor = cursor;
        if (soundSrc)
          app.audioStage.add({
            id: `hover-${Date.now()}`,
            url: soundSrc,
            loop: false,
            volume: normalizeVolume(soundVolume),
          });
      };

      const outListener = () => {
        hoverController.setDirectHover(false);
        spriteElement.cursor = "auto";
      };

      spriteElement.on("pointerover", overListener);
      spriteElement.on("pointerout", outListener);
    }

    if (clickEvents) {
      const { soundSrc, soundVolume, payload } = clickEvents;
      spriteElement.eventMode = "static";
      pressController = createPressStateController({
        displayObject: spriteElement,
        onPressChange: updateTexture,
      });

      const clickListener = (event) => {
        if (!isPrimaryPointerEvent(event)) {
          return;
        }

        pressController.setDirectPress(true);
      };

      const releaseListener = (event) => {
        if (!isPrimaryPointerEvent(event)) {
          return;
        }

        pressController.setDirectPress(false);

        if (payload && eventHandler)
          eventHandler(`click`, {
            _event: {
              id: spriteElement.label,
            },
            ...payload,
          });
        if (soundSrc)
          app.audioStage.add({
            id: `click-${Date.now()}`,
            url: soundSrc,
            loop: false,
            volume: normalizeVolume(soundVolume),
          });
      };

      const outListener = () => {
        pressController.setDirectPress(false);
      };

      spriteElement.on("pointerdown", clickListener);
      spriteElement.on("pointerup", releaseListener);
      spriteElement.on("pointerupoutside", outListener);
    }

    if (rightClickEvents) {
      const { soundSrc, payload } = rightClickEvents;
      spriteElement.eventMode = "static";
      rightPressController = createRightPressStateController({
        displayObject: spriteElement,
        onPressChange: updateTexture,
      });

      const rightPressListener = () => {
        rightPressController.setDirectPress(true);
      };

      const rightReleaseListener = () => {
        rightPressController.setDirectPress(false);
      };

      const rightClickListener = () => {
        rightPressController.setDirectPress(false);

        if (payload && eventHandler) {
          eventHandler(`rightClick`, {
            _event: {
              id: spriteElement.label,
            },
            ...payload,
          });
        }
        if (soundSrc) {
          app.audioStage.add({
            id: `rightClick-${Date.now()}`,
            url: soundSrc,
            loop: false,
          });
        }
      };

      const rightOutListener = () => {
        rightPressController.setDirectPress(false);
      };

      spriteElement.on("rightdown", rightPressListener);
      spriteElement.on("rightup", rightReleaseListener);
      spriteElement.on("rightclick", rightClickListener);
      spriteElement.on("rightupoutside", rightOutListener);
    }

    if (scrollUpEvent || scrollDownEvent) {
      setupScrollInteraction({
        canvas: app.canvas,
        displayObject: spriteElement,
        scrollUpEvent,
        scrollDownEvent,
        eventHandler,
      });
    }
  };

  const syncSpriteResource = ({
    preserveWidth = false,
    preserveHeight = false,
  } = {}) => {
    const currentWidth = spriteElement.width;
    const currentHeight = spriteElement.height;
    const texture = src ? Texture.from(src) : Texture.EMPTY;
    spriteElement.texture = texture;
    spriteElement.width = Math.round(preserveWidth ? currentWidth : width);
    spriteElement.height = Math.round(preserveHeight ? currentHeight : height);
    bindSpriteInteractions(texture);
  };

  const updateElement = () => {
    if (!isDeepEqual(prevElement, nextElement)) {
      if (!didSyncResourceBeforeAnimation) {
        syncSpriteResource();
      }

      spriteElement.width = Math.round(width);
      spriteElement.height = Math.round(height);
      spriteElement.alpha = alpha;
      applyElementTransform(spriteElement, nextElement);
      syncBlurEffect(spriteElement, nextElement.blur, {
        force: shouldForceBlur,
      });
      syncShaderFilters(spriteElement, nextElement.filters, {
        width,
        height,
        force: shouldForceShaderProgress,
        animations,
        targetId: prevElement.id,
      });
    }

    setElementRenderState(spriteElement, nextElement);
    commitRenderState?.(spriteElement);
  };

  if (prevElement.src !== nextElement.src && hasLiveAnimation) {
    syncSpriteResource({
      preserveWidth: hasLiveAnimationTween("width"),
      preserveHeight: hasLiveAnimationTween("height"),
    });
    didSyncResourceBeforeAnimation = true;
  }

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: prevElement.id,
    animationBus,
    completionTracker,
    element: spriteElement,
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
      updateElement();
    },
  });

  if (!dispatched) {
    // No animations, update immediately
    updateElement();
  } else {
    deferRenderStateCommit?.();
  }
};
