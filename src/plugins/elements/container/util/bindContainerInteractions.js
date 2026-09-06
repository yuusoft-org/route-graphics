import { Rectangle } from "pixi.js";
import { normalizeVolume } from "../../../../util/normalizeVolume.js";
import {
  isPrimaryPointerEvent,
  isSecondaryPointerEvent,
} from "../../util/isPrimaryPointerEvent.js";
import {
  getTreeInheritedPressState,
  getTreeInheritedHoverState,
  getTreeInheritedRightPressState,
  setTreeInheritedPress,
  setTreeInheritedHover,
  setTreeInheritedRightPress,
} from "../../util/hoverInheritance.js";
import { setupScrollInteraction } from "../../util/setupScrollInteraction.js";

const setContainerHitArea = ({ container, element, enabled }) => {
  const width = Number.isFinite(element?.width) ? element.width : 0;
  const height = Number.isFinite(element?.height) ? element.height : 0;

  if (enabled && width > 0 && height > 0) {
    container.hitArea = new Rectangle(0, 0, width, height);
    return;
  }

  container.hitArea = null;
};

const isWithinContainer = (container, displayObject) => {
  let current = displayObject ?? null;

  while (current) {
    if (current === container) {
      return true;
    }

    current = current.parent ?? null;
  }

  return false;
};

const isWithinScrollbarChrome = (container, displayObject) => {
  let current = displayObject ?? null;

  while (current) {
    if (current === container) {
      return false;
    }

    if (
      typeof current.label === "string" &&
      current.label.startsWith(`${container.label}-scrollbar-`)
    ) {
      return true;
    }

    current = current.parent ?? null;
  }

  return false;
};

const isPointWithinContainer = (container, point) => {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
    return false;
  }

  const localPoint = container.toLocal(point);
  const hitArea = container.hitArea;

  if (hitArea?.contains) {
    return hitArea.contains(localPoint.x, localPoint.y);
  }

  return false;
};

export const bindContainerInteractions = ({
  app,
  container,
  element,
  eventHandler,
}) => {
  const wasInheritedHoverActive = getTreeInheritedHoverState(container);
  const wasInheritedPressActive = getTreeInheritedPressState(container);
  const wasInheritedRightPressActive =
    getTreeInheritedRightPressState(container);
  let isHovered = wasInheritedHoverActive;

  container._cleanupScrollInteraction?.();
  setTreeInheritedHover({ root: container, isHovered: false });
  setTreeInheritedPress({ root: container, isPressed: false });
  setTreeInheritedRightPress({ root: container, isPressed: false });
  container.removeAllListeners("pointerover");
  container.removeAllListeners("pointerout");
  container.removeAllListeners("pointerdown");
  container.removeAllListeners("pointerup");
  container.removeAllListeners("pointerupoutside");
  container.removeAllListeners("rightdown");
  container.removeAllListeners("rightup");
  container.removeAllListeners("rightupoutside");
  container.removeAllListeners("rightclick");
  container.cursor = "auto";

  if (!element.scroll) {
    container.eventMode = "auto";
    setContainerHitArea({ container, element, enabled: false });
  }

  const hoverEvents = element?.hover;
  const clickEvents = element?.click;
  const rightClickEvents = element?.rightClick;
  const scrollUpEvent = element?.scrollUp;
  const scrollDownEvent = element?.scrollDown;
  const hasPointerInteraction = Boolean(
    hoverEvents ||
      clickEvents ||
      rightClickEvents ||
      scrollUpEvent ||
      scrollDownEvent,
  );

  if (hasPointerInteraction) {
    container.eventMode = "static";
    if (element.scroll) {
      if (!container.hitArea) {
        setContainerHitArea({ container, element, enabled: true });
      }
    } else {
      // Non-scroll containers with container-level pointer handlers should
      // respond across their declared bounds. Scroll/viewports still manage
      // their own hitArea in setupScrolling.
      setContainerHitArea({ container, element, enabled: true });
    }
  }

  if (hoverEvents) {
    const { cursor, soundSrc, soundVolume, payload, inheritToChildren } =
      hoverEvents;

    const overListener = (event) => {
      if (isWithinContainer(container, event?.relatedTarget)) {
        return;
      }

      if (isHovered) {
        return;
      }

      isHovered = true;

      if (payload && eventHandler)
        eventHandler(`hover`, {
          _event: {
            id: container.label,
          },
          ...payload,
        });
      if (cursor) container.cursor = cursor;
      if (soundSrc)
        app.audioStage.add({
          id: `hover-${Date.now()}`,
          url: soundSrc,
          loop: false,
          volume: normalizeVolume(soundVolume),
        });
      if (inheritToChildren) {
        setTreeInheritedHover({ root: container, isHovered: true });
      }
    };

    const outListener = (event) => {
      if (isWithinContainer(container, event?.relatedTarget)) {
        return;
      }

      if (isPointWithinContainer(container, event?.global)) {
        return;
      }

      if (!isHovered) {
        return;
      }

      isHovered = false;
      container.cursor = "auto";
      if (inheritToChildren) {
        setTreeInheritedHover({ root: container, isHovered: false });
      }
    };

    container.on("pointerover", overListener);
    container.on("pointerout", outListener);
  }

  if (clickEvents) {
    const { soundSrc, soundVolume, payload, inheritToChildren } = clickEvents;

    const pressListener = (event) => {
      if (!isPrimaryPointerEvent(event)) {
        return;
      }

      if (isWithinScrollbarChrome(container, event?.target)) {
        return;
      }

      if (inheritToChildren) {
        setTreeInheritedPress({ root: container, isPressed: true });
      }
    };

    const releaseListener = (event) => {
      if (!isPrimaryPointerEvent(event)) {
        return;
      }

      if (isWithinScrollbarChrome(container, event?.target)) {
        return;
      }

      if (inheritToChildren) {
        setTreeInheritedPress({ root: container, isPressed: false });
      }

      if (payload && eventHandler)
        eventHandler(`click`, {
          _event: {
            id: container.label,
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

    const releaseOutsideListener = (event) => {
      if (!isPrimaryPointerEvent(event)) {
        return;
      }

      if (isWithinScrollbarChrome(container, event?.target)) {
        return;
      }

      if (inheritToChildren) {
        setTreeInheritedPress({ root: container, isPressed: false });
      }
    };

    container.on("pointerdown", pressListener);
    container.on("pointerup", releaseListener);
    container.on("pointerupoutside", releaseOutsideListener);
  }

  if (rightClickEvents) {
    const { soundSrc, payload, inheritToChildren } = rightClickEvents;

    const rightPressListener = (event) => {
      if (isWithinScrollbarChrome(container, event?.target)) {
        return;
      }

      if (inheritToChildren) {
        setTreeInheritedRightPress({ root: container, isPressed: true });
      }
    };

    const rightReleaseListener = (event) => {
      if (isWithinScrollbarChrome(container, event?.target)) {
        return;
      }

      if (inheritToChildren) {
        setTreeInheritedRightPress({ root: container, isPressed: false });
      }
    };

    const rightPointerReleaseListener = (event) => {
      if (!isSecondaryPointerEvent(event)) {
        return;
      }

      if (isWithinScrollbarChrome(container, event?.target)) {
        return;
      }

      if (inheritToChildren) {
        setTreeInheritedRightPress({ root: container, isPressed: false });
      }
    };

    const rightClickListener = (event) => {
      if (isWithinScrollbarChrome(container, event?.target)) {
        return;
      }

      if (inheritToChildren) {
        setTreeInheritedRightPress({ root: container, isPressed: false });
      }

      if (payload && eventHandler)
        eventHandler(`rightClick`, {
          _event: {
            id: container.label,
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

    const rightOutListener = () => {
      if (inheritToChildren) {
        setTreeInheritedRightPress({ root: container, isPressed: false });
      }
    };

    container.on("rightdown", rightPressListener);
    container.on("rightup", rightReleaseListener);
    container.on("pointerup", rightPointerReleaseListener);
    container.on("rightclick", rightClickListener);
    container.on("pointerupoutside", rightPointerReleaseListener);
    container.on("rightupoutside", rightOutListener);
  }

  if (scrollUpEvent || scrollDownEvent) {
    setupScrollInteraction({
      canvas: app.canvas,
      displayObject: container,
      scrollUpEvent,
      scrollDownEvent,
      eventHandler,
    });
  }

  if (hoverEvents?.inheritToChildren && wasInheritedHoverActive) {
    setTreeInheritedHover({ root: container, isHovered: true });
  }

  if (clickEvents?.inheritToChildren && wasInheritedPressActive) {
    setTreeInheritedPress({ root: container, isPressed: true });
  }

  if (rightClickEvents?.inheritToChildren && wasInheritedRightPressActive) {
    setTreeInheritedRightPress({ root: container, isPressed: true });
  }
};

export const reapplyContainerInheritedHover = ({ container }) => {
  if (getTreeInheritedHoverState(container)) {
    setTreeInheritedHover({ root: container, isHovered: true });
  }
};

export const reapplyContainerInheritedPress = ({ container }) => {
  if (getTreeInheritedPressState(container)) {
    setTreeInheritedPress({ root: container, isPressed: true });
  }
};

export const reapplyContainerInheritedRightPress = ({ container }) => {
  if (getTreeInheritedRightPressState(container)) {
    setTreeInheritedRightPress({ root: container, isPressed: true });
  }
};
