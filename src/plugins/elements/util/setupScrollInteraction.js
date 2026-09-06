import { Rectangle } from "pixi.js";
import { registerElementCleanup } from "./elementResources.js";

const SCROLL_HANDLED = "__rtglScrollHandled";
const CLEANUP_REGISTERED = Symbol("scrollCleanupRegistered");

const getPayload = (eventConfig) =>
  eventConfig?.payload && typeof eventConfig.payload === "object"
    ? eventConfig.payload
    : {};

/**
 * Attach semantic scrollUp / scrollDown handling to an interactive element.
 * Pixi wheel delivery can be inconsistent in VT/browser automation, so this
 * also listens on the canvas while the pointer is over the element.
 *
 * @param {Object} params
 * @param {HTMLCanvasElement | undefined} params.canvas
 * @param {import("pixi.js").Container} params.displayObject
 * @param {number | undefined} params.width
 * @param {number | undefined} params.height
 * @param {Object | undefined} params.scrollUpEvent
 * @param {Object | undefined} params.scrollDownEvent
 * @param {Function | undefined} params.eventHandler
 */
export const setupScrollInteraction = ({
  canvas,
  displayObject,
  width,
  height,
  scrollUpEvent,
  scrollDownEvent,
  eventHandler,
}) => {
  if (!scrollUpEvent && !scrollDownEvent) return;

  let isPointerOver = false;
  const shouldAssignHitArea =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0;

  displayObject.eventMode = "static";

  if (shouldAssignHitArea) {
    displayObject.hitArea = new Rectangle(
      0,
      0,
      Math.round(width),
      Math.round(height),
    );
  }

  const emitScrollEvent = (deltaY, nativeEvent) => {
    if (nativeEvent?.[SCROLL_HANDLED]) return;
    if (nativeEvent) {
      nativeEvent[SCROLL_HANDLED] = true;
    }

    if (deltaY < 0 && scrollUpEvent && eventHandler) {
      eventHandler("scrollUp", {
        _event: {
          id: displayObject.label,
        },
        ...getPayload(scrollUpEvent),
      });
    } else if (deltaY > 0 && scrollDownEvent && eventHandler) {
      eventHandler("scrollDown", {
        _event: {
          id: displayObject.label,
        },
        ...getPayload(scrollDownEvent),
      });
    }
  };

  const pointerOverListener = () => {
    isPointerOver = true;
  };

  const pointerOutListener = () => {
    isPointerOver = false;
  };

  const pixiWheelListener = (event) => {
    event.preventDefault?.();
    emitScrollEvent(event.deltaY, event.nativeEvent);
  };

  const nativeWheelListener = (event) => {
    if (!isPointerOver) return;
    event.preventDefault();
    emitScrollEvent(event.deltaY, event);
  };

  displayObject.on("pointerover", pointerOverListener);
  displayObject.on("pointerout", pointerOutListener);
  displayObject.on("wheel", pixiWheelListener);
  canvas?.addEventListener("wheel", nativeWheelListener, { passive: false });

  displayObject._cleanupScrollInteraction = () => {
    isPointerOver = false;
    displayObject.off("pointerover", pointerOverListener);
    displayObject.off("pointerout", pointerOutListener);
    displayObject.off("wheel", pixiWheelListener);
    canvas?.removeEventListener("wheel", nativeWheelListener);
    if (shouldAssignHitArea) {
      displayObject.hitArea = null;
    }
    delete displayObject._cleanupScrollInteraction;
  };
  if (!displayObject[CLEANUP_REGISTERED]) {
    displayObject[CLEANUP_REGISTERED] = true;
    registerElementCleanup(displayObject, () =>
      displayObject._cleanupScrollInteraction?.(),
    );
  }
};

export const cleanupScrollInteractionsInTree = ({ root }) => {
  root?._cleanupScrollInteraction?.();

  root?.children?.forEach((child) => {
    cleanupScrollInteractionsInTree({ root: child });
  });
};
