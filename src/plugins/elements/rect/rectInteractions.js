import { normalizeVolume } from "../../../util/normalizeVolume.js";
import { isPrimaryPointerEvent } from "../util/isPrimaryPointerEvent.js";
import { setupScrollInteraction } from "../util/setupScrollInteraction.js";

const LISTENER_EVENTS = [
  "pointerover",
  "pointerout",
  "pointerup",
  "rightclick",
  "wheel",
  "pointerdown",
  "globalpointermove",
  "pointerupoutside",
];

const getPayload = (config) =>
  config?.payload && typeof config.payload === "object" ? config.payload : {};

const emit = (eventHandler, eventName, rect, config, eventData = {}) => {
  eventHandler?.(eventName, {
    _event: {
      id: rect.label,
      ...eventData,
    },
    ...getPayload(config),
  });
};

const playSound = (app, eventName, config) => {
  if (!config?.soundSrc) return;
  app.audioStage.add({
    id: `${eventName}-${Date.now()}`,
    url: config.soundSrc,
    loop: false,
    volume: normalizeVolume(config.soundVolume),
  });
};

export const cleanupRectInteractions = (rect) => {
  rect._cleanupScrollInteraction?.();
  for (const eventName of LISTENER_EVENTS) {
    rect.removeAllListeners(eventName);
  }
  rect.eventMode = "auto";
  rect.cursor = "auto";
  rect.hitArea = null;
  rect._isDragging = false;
};

export const bindRectInteractions = ({ app, rect, element, eventHandler }) => {
  cleanupRectInteractions(rect);

  const hover = element.hover;
  const click = element.click;
  const rightClick = element.rightClick;
  const scrollUp = element.scrollUp;
  const scrollDown = element.scrollDown;
  const drag = element.drag;
  const hasInteraction = Boolean(
    hover || click || rightClick || scrollUp || scrollDown || drag,
  );

  if (!hasInteraction) {
    return;
  }

  rect.eventMode = "static";

  if (hover) {
    rect.on("pointerover", () => {
      emit(eventHandler, "hover", rect, hover);
      if (hover.cursor) rect.cursor = hover.cursor;
      playSound(app, "hover", hover);
    });
    rect.on("pointerout", () => {
      rect.cursor = "auto";
    });
  }

  if (click) {
    rect.on("pointerup", (event) => {
      if (!isPrimaryPointerEvent(event)) return;
      emit(eventHandler, "click", rect, click);
      playSound(app, "click", click);
    });
  }

  if (rightClick) {
    rect.on("rightclick", () => {
      emit(eventHandler, "rightClick", rect, rightClick);
      playSound(app, "rightClick", rightClick);
    });
  }

  if (scrollUp || scrollDown) {
    setupScrollInteraction({
      canvas: app.canvas,
      displayObject: rect,
      width: element.width,
      height: element.height,
      scrollUpEvent: scrollUp,
      scrollDownEvent: scrollDown,
      eventHandler,
    });
  }

  if (drag) {
    const { start, end, move } = drag;
    const endDrag = (event) => {
      if (!isPrimaryPointerEvent(event) || !rect._isDragging) return;
      rect._isDragging = false;
      if (end) emit(eventHandler, "dragEnd", rect, end);
    };

    rect.on("pointerdown", (event) => {
      if (!isPrimaryPointerEvent(event)) return;
      rect._isDragging = true;
      if (start) emit(eventHandler, "dragStart", rect, start);
    });
    rect.on("pointerup", endDrag);
    rect.on("pointerupoutside", endDrag);
    rect.on("globalpointermove", (event) => {
      if (!move || !rect._isDragging) return;
      emit(eventHandler, "dragMove", rect, move, {
        x: event.global.x,
        y: event.global.y,
      });
    });
  }
};
