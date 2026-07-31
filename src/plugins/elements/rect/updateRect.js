import { isDeepEqual } from "../../../util/isDeepEqual.js";
import { normalizeVolume } from "../../../util/normalizeVolume.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import { setupScrollInteraction } from "../util/setupScrollInteraction.js";
import { isPrimaryPointerEvent } from "../util/isPrimaryPointerEvent.js";
import { resolveRectFill } from "./rectFill.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";
import {
  getShaderFilterTargetState,
  hasShaderProgressUpdateAnimation,
  prepareShaderFilterAnimationTargets,
  resetShaderFilterProgress,
  syncShaderFilters,
} from "../util/shaderFilterEffect.js";
import { setElementRenderState } from "../elementRenderState.js";

/**
 * Update rectangle element (synchronous)
 * @param {import("../elementPlugin.js").UpdateElementOptions} params
 */
export const updateRect = ({
  app,
  parent,
  prevElement,
  nextElement,
  animations,
  animationBus,
  eventHandler,
  zIndex,
  completionTracker,
  deferRenderStateCommit,
  commitRenderState,
}) => {
  const rectElement = parent.children.find(
    (child) => child.label === prevElement.id,
  );

  if (!rectElement) return;

  rectElement.zIndex = zIndex;

  const { width, height, fill, border, alpha, scaleX, scaleY } = nextElement;
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    prevElement.id,
  );
  if (shouldForceShaderProgress) {
    syncShaderFilters(rectElement, prevElement.filters, {
      width: prevElement.width,
      height: prevElement.height,
      force: true,
      animations,
      targetId: prevElement.id,
    });
  } else {
    resetShaderFilterProgress(rectElement);
  }
  prepareShaderFilterAnimationTargets({
    displayObject: rectElement,
    element: nextElement,
    animations,
    targetId: prevElement.id,
  });
  const targetState = getElementTransformTargetState(nextElement, { alpha });

  if (scaleX !== undefined) {
    targetState.scaleX = scaleX;
  }

  if (scaleY !== undefined) {
    targetState.scaleY = scaleY;
  }

  const updateElement = () => {
    if (!isDeepEqual(prevElement, nextElement)) {
      rectElement._cleanupScrollInteraction?.();
      rectElement.clear();

      rectElement
        .rect(0, 0, Math.round(width), Math.round(height))
        .fill(resolveRectFill(rectElement, fill, nextElement));
      rectElement.alpha = alpha;
      // Rect computed nodes already bake scale into width/height for layout.
      // Reset the live transform so update tweens do not double-apply scale.
      rectElement.scale.x = 1;
      rectElement.scale.y = 1;
      applyElementTransform(rectElement, nextElement);

      if (border) {
        rectElement.stroke({
          color: border.color,
          alpha: border.alpha,
          width: Math.round(border.width),
        });
      }

      syncShaderFilters(rectElement, nextElement.filters, {
        width,
        height,
        force: shouldForceShaderProgress,
        animations,
        targetId: prevElement.id,
      });

      rectElement.removeAllListeners("pointerover");
      rectElement.removeAllListeners("pointerout");
      rectElement.removeAllListeners("pointerup");
      rectElement.removeAllListeners("rightclick");
      rectElement.removeAllListeners("wheel");
      rectElement.removeAllListeners("pointerdown");
      rectElement.removeAllListeners("globalpointermove");
      rectElement.removeAllListeners("pointerupoutside");

      const hoverEvents = nextElement?.hover;
      const clickEvents = nextElement?.click;
      const rightClickEvents = nextElement?.rightClick;
      const scrollUpEvent = nextElement?.scrollUp;
      const scrollDownEvent = nextElement?.scrollDown;
      const dragEvents = nextElement?.drag;

      if (hoverEvents) {
        const { cursor, soundSrc, soundVolume, payload } = hoverEvents;
        rectElement.eventMode = "static";

        const overListener = () => {
          if (payload && eventHandler)
            eventHandler(`hover`, {
              _event: {
                id: rectElement.label,
              },
              ...payload,
            });
          if (cursor) rectElement.cursor = cursor;
          if (soundSrc)
            app.audioStage.add({
              id: `hover-${Date.now()}`,
              url: soundSrc,
              loop: false,
              volume: normalizeVolume(soundVolume),
            });
        };

        const outListener = () => {
          rectElement.cursor = "auto";
        };

        rectElement.on("pointerover", overListener);
        rectElement.on("pointerout", outListener);
      }

      if (clickEvents) {
        const { soundSrc, soundVolume, payload } = clickEvents;
        rectElement.eventMode = "static";

        const clickListener = (event) => {
          if (!isPrimaryPointerEvent(event)) {
            return;
          }

          if (payload && eventHandler)
            eventHandler(`click`, {
              _event: {
                id: rectElement.label,
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

        rectElement.on("pointerup", clickListener);
      }

      if (rightClickEvents) {
        const { soundSrc, payload } = rightClickEvents;
        rectElement.eventMode = "static";

        const rightClickListener = () => {
          if (payload && eventHandler)
            eventHandler(`rightClick`, {
              _event: {
                id: rectElement.label,
              },
              ...payload,
            });
          if (soundSrc)
            app.audioStage.add({
              id: `rightClick-${Date.now()}`,
              url: soundSrc,
              loop: false,
            });
        };

        rectElement.on("rightclick", rightClickListener);
      }

      if (scrollUpEvent || scrollDownEvent) {
        setupScrollInteraction({
          canvas: app.canvas,
          displayObject: rectElement,
          width,
          height,
          scrollUpEvent,
          scrollDownEvent,
          eventHandler,
        });
      }

      if (dragEvents) {
        const { start, end, move } = dragEvents;
        rectElement.eventMode = "static";

        const downListener = () => {
          rectElement._isDragging = true;
          if (start && eventHandler) {
            eventHandler("dragStart", {
              _event: {
                id: rectElement.label,
              },
              ...(typeof start?.payload === "object" ? start.payload : {}),
            });
          }
        };

        const upListener = () => {
          rectElement._isDragging = false;
          if (end && eventHandler) {
            eventHandler("dragEnd", {
              _event: {
                id: rectElement.label,
              },
              ...(typeof end?.payload === "object" ? end.payload : {}),
            });
          }
        };

        const moveListener = (e) => {
          if (move && eventHandler && rectElement._isDragging) {
            eventHandler("dragMove", {
              _event: {
                id: rectElement.label,
                x: e.global.x,
                y: e.global.y,
              },
              ...(typeof move?.payload === "object" ? move.payload : {}),
            });
          }
        };

        rectElement.on("pointerdown", downListener);
        rectElement.on("pointerup", upListener);
        rectElement.on("globalpointermove", moveListener);
        rectElement.on("pointerupoutside", upListener);
      }
    }

    setElementRenderState(rectElement, nextElement);
    commitRenderState?.(rectElement);
  };

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: prevElement.id,
    animationBus,
    completionTracker,
    element: rectElement,
    targetState: {
      ...targetState,
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
