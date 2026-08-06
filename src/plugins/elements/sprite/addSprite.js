import { Sprite, Texture } from "pixi.js";
import { normalizeVolume } from "../../../util/normalizeVolume.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import { isPrimaryPointerEvent } from "../util/isPrimaryPointerEvent.js";
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
  createHoverStateController,
  createPressStateController,
  createRightPressStateController,
} from "../util/hoverInheritance.js";
import { setupScrollInteraction } from "../util/setupScrollInteraction.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";

/**
 * Add sprite element to the stage (synchronous)
 * @param {import("../elementPlugin.js").AddElementOptions} params
 */
export const addSprite = ({
  app,
  parent,
  element,
  animations,
  eventHandler,
  animationBus,
  completionTracker,
  renderContext,
  zIndex,
}) => {
  const { id, width, height, src, alpha } = element;
  const texture = src ? Texture.from(src) : Texture.EMPTY;
  const sprite = new Sprite(texture);
  sprite.label = id;
  sprite.zIndex = zIndex;

  // Apply initial state
  sprite.width = Math.round(width);
  sprite.height = Math.round(height);
  sprite.alpha = alpha;
  applyElementTransform(sprite, element, { preserveScaleMagnitude: true });
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

  const hoverEvents = element?.hover;
  const clickEvents = element?.click;
  const rightClickEvents = element?.rightClick;
  const scrollUpEvent = element?.scrollUp;
  const scrollDownEvent = element?.scrollDown;

  let hoverController = null;
  let pressController = null;
  let rightPressController = null;

  const updateTexture = () => {
    const isHovering = hoverController?.isHovering() ?? false;
    const isPressed = pressController?.isPressed() ?? false;
    const isRightPressed = rightPressController?.isPressed() ?? false;

    if (isRightPressed && rightClickEvents?.src) {
      const rightClickTexture = Texture.from(rightClickEvents.src);
      sprite.texture = rightClickTexture;
    } else if (isPressed && clickEvents?.src) {
      const clickTexture = Texture.from(clickEvents.src);
      sprite.texture = clickTexture;
    } else if (isHovering && hoverEvents?.src) {
      const hoverTexture = Texture.from(hoverEvents.src);
      sprite.texture = hoverTexture;
    } else {
      sprite.texture = texture;
    }
  };

  if (hoverEvents) {
    const { cursor, soundSrc, soundVolume, payload } = hoverEvents;
    sprite.eventMode = "static";
    hoverController = createHoverStateController({
      displayObject: sprite,
      onHoverChange: updateTexture,
    });

    const overListener = () => {
      hoverController.setDirectHover(true);
      if (payload && eventHandler)
        eventHandler(`hover`, {
          _event: {
            id: sprite.label,
          },
          ...payload,
        });
      if (cursor) sprite.cursor = cursor;
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
      sprite.cursor = "auto";
    };

    sprite.on("pointerover", overListener);
    sprite.on("pointerout", outListener);
  }

  if (clickEvents) {
    const { soundSrc, soundVolume, payload } = clickEvents;
    sprite.eventMode = "static";
    pressController = createPressStateController({
      displayObject: sprite,
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
            id: sprite.label,
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

    sprite.on("pointerdown", clickListener);
    sprite.on("pointerup", releaseListener);
    sprite.on("pointerupoutside", outListener);
  }

  if (rightClickEvents) {
    const { soundSrc, payload } = rightClickEvents;
    sprite.eventMode = "static";
    rightPressController = createRightPressStateController({
      displayObject: sprite,
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
            id: sprite.label,
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

    sprite.on("rightdown", rightPressListener);
    sprite.on("rightup", rightReleaseListener);
    sprite.on("rightclick", rightClickListener);
    sprite.on("rightupoutside", rightOutListener);
  }

  if (scrollUpEvent || scrollDownEvent) {
    setupScrollInteraction({
      canvas: app.canvas,
      displayObject: sprite,
      scrollUpEvent,
      scrollDownEvent,
      eventHandler,
    });
  }

  parent.addChild(sprite);

  dispatchLiveAnimations({
    animations,
    targetId: id,
    animationBus,
    completionTracker,
    element: sprite,
    targetState: {
      ...getElementTransformTargetState(element),
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
};
