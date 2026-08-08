import { normalizeVolume } from "../../../util/normalizeVolume.js";
import { isPrimaryPointerEvent } from "../util/isPrimaryPointerEvent.js";
import {
  createHoverStateController,
  createPressStateController,
  createRightPressStateController,
} from "../util/hoverInheritance.js";
import { setupScrollInteraction } from "../util/setupScrollInteraction.js";
import { setRectInteractionActive } from "./rectAppearanceRuntime.js";

const RECT_INTERACTION_BINDING = Symbol("routeGraphicsRectInteractions");

const LISTENER_EVENTS = [
  "pointerover",
  "pointerout",
  "pointerup",
  "rightclick",
  "wheel",
  "pointerdown",
  "globalpointermove",
  "pointerupoutside",
  "rightdown",
  "rightup",
  "rightupoutside",
];

const getPayload = (config) =>
  config?.payload && typeof config.payload === "object" ? config.payload : {};

const hasInteractionConfig = (element) =>
  Boolean(
    element.hover ||
    element.click ||
    element.rightClick ||
    element.scrollUp ||
    element.scrollDown ||
    element.drag,
  );

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

const syncAppearanceState = (binding) => {
  setRectInteractionActive(
    binding.rect,
    "hover",
    binding.hoverController.isHovering(),
  );
  setRectInteractionActive(
    binding.rect,
    "click",
    binding.pressController.isPressed(),
  );
  setRectInteractionActive(
    binding.rect,
    "rightClick",
    binding.rightPressController.isPressed(),
  );
};

const createBinding = ({ app, rect, element, eventHandler }) => {
  const binding = {
    app,
    rect,
    element,
    eventHandler,
    hoverController: null,
    pressController: null,
    rightPressController: null,
  };

  binding.hoverController = createHoverStateController({
    displayObject: rect,
    onHoverChange: (isActive) =>
      setRectInteractionActive(rect, "hover", isActive),
  });
  binding.pressController = createPressStateController({
    displayObject: rect,
    onPressChange: (isActive) =>
      setRectInteractionActive(rect, "click", isActive),
  });
  binding.rightPressController = createRightPressStateController({
    displayObject: rect,
    onPressChange: (isActive) =>
      setRectInteractionActive(rect, "rightClick", isActive),
  });

  rect.on("pointerover", () => {
    const hover = binding.element.hover;
    if (!hover) return;

    binding.hoverController.setDirectHover(true);
    emit(binding.eventHandler, "hover", rect, hover);
    if (hover.cursor) rect.cursor = hover.cursor;
    playSound(binding.app, "hover", hover);
  });

  rect.on("pointerout", () => {
    binding.hoverController.setDirectHover(false);
    rect.cursor = "auto";
  });

  rect.on("pointerdown", (event) => {
    if (!isPrimaryPointerEvent(event)) return;

    if (binding.element.click) {
      binding.pressController.setDirectPress(true);
    }

    const start = binding.element.drag?.start;
    if (binding.element.drag) {
      rect._isDragging = true;
      if (start) emit(binding.eventHandler, "dragStart", rect, start);
    }
  });

  const releasePrimary = (event, { outside = false } = {}) => {
    if (!isPrimaryPointerEvent(event)) return;

    binding.pressController.setDirectPress(false);

    const click = binding.element.click;
    if (!outside && click) {
      emit(binding.eventHandler, "click", rect, click);
      playSound(binding.app, "click", click);
    }

    if (rect._isDragging) {
      rect._isDragging = false;
      const end = binding.element.drag?.end;
      if (end) emit(binding.eventHandler, "dragEnd", rect, end);
    }
  };

  rect.on("pointerup", (event) => releasePrimary(event));
  rect.on("pointerupoutside", (event) =>
    releasePrimary(event, { outside: true }),
  );

  rect.on("globalpointermove", (event) => {
    const move = binding.element.drag?.move;
    if (!move || !rect._isDragging) return;
    emit(binding.eventHandler, "dragMove", rect, move, {
      x: event.global.x,
      y: event.global.y,
    });
  });

  rect.on("rightdown", () => {
    if (binding.element.rightClick) {
      binding.rightPressController.setDirectPress(true);
    }
  });

  const releaseRight = () => {
    binding.rightPressController.setDirectPress(false);
  };
  rect.on("rightup", releaseRight);
  rect.on("rightupoutside", releaseRight);
  rect.on("rightclick", () => {
    releaseRight();
    const rightClick = binding.element.rightClick;
    if (!rightClick) return;
    emit(binding.eventHandler, "rightClick", rect, rightClick);
    playSound(binding.app, "rightClick", rightClick);
  });

  return binding;
};

const syncBinding = (binding, { app, element, eventHandler }) => {
  binding.app = app;
  binding.element = element;
  binding.eventHandler = eventHandler;

  if (!element.hover) {
    binding.hoverController.setDirectHover(false);
  }
  binding.rect.cursor =
    element.hover && binding.hoverController.isHovering()
      ? (element.hover.cursor ?? "auto")
      : "auto";
  if (!element.click) {
    binding.pressController.setDirectPress(false);
  }
  if (!element.rightClick) {
    binding.rightPressController.setDirectPress(false);
  }
  if (!element.drag) {
    binding.rect._isDragging = false;
  }

  syncAppearanceState(binding);

  binding.rect._cleanupScrollInteraction?.();
  binding.rect.eventMode = "static";

  if (element.scrollUp || element.scrollDown) {
    setupScrollInteraction({
      canvas: app.canvas,
      displayObject: binding.rect,
      width: element.width,
      height: element.height,
      scrollUpEvent: element.scrollUp,
      scrollDownEvent: element.scrollDown,
      eventHandler,
    });
  }
};

export const cleanupRectInteractions = (rect) => {
  rect._cleanupScrollInteraction?.();
  const binding = rect[RECT_INTERACTION_BINDING];
  binding?.hoverController.destroy();
  binding?.pressController.destroy();
  binding?.rightPressController.destroy();
  for (const eventName of LISTENER_EVENTS) {
    rect.removeAllListeners(eventName);
  }
  delete rect[RECT_INTERACTION_BINDING];
  setRectInteractionActive(rect, "hover", false);
  setRectInteractionActive(rect, "click", false);
  setRectInteractionActive(rect, "rightClick", false);
  rect.eventMode = "auto";
  rect.cursor = "auto";
  rect.hitArea = null;
  rect._isDragging = false;
};

export const bindRectInteractions = ({ app, rect, element, eventHandler }) => {
  let binding = rect[RECT_INTERACTION_BINDING];
  if (!hasInteractionConfig(element)) {
    if (binding) {
      cleanupRectInteractions(rect);
    }
    return;
  }

  if (!binding) {
    binding = createBinding({ app, rect, element, eventHandler });
    rect[RECT_INTERACTION_BINDING] = binding;
  }

  syncBinding(binding, { app, element, eventHandler });
};
