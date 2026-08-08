import { drawRectVisual } from "./rectDrawing.js";

export const RECT_APPEARANCE_STATE_KEY = "_routeGraphicsRectAppearance";

const INTERACTION_PRIORITY = ["rightClick", "click", "hover"];

const getInteractionField = (runtime, field) => {
  for (const interaction of INTERACTION_PRIORITY) {
    if (
      runtime.active[interaction] &&
      runtime.interactionElement?.[interaction]?.[field] !== undefined
    ) {
      return runtime.interactionElement[interaction][field];
    }
  }

  return field === "fill"
    ? runtime.styleRuntime.state.fill
    : runtime._baseAlpha;
};

const applyAlpha = (displayObject, runtime) => {
  displayObject.alpha = getInteractionField(runtime, "alpha");
};

const applyAppearance = (displayObject, runtime) => {
  const style = runtime.styleRuntime.state;
  const effectiveStyle = {
    ...style,
    fill: getInteractionField(runtime, "fill"),
  };

  drawRectVisual(displayObject, effectiveStyle, {
    ...runtime.element,
    ...effectiveStyle,
  });
  applyAlpha(displayObject, runtime);
};

export const installRectAppearanceRuntime = (
  displayObject,
  element,
  styleRuntime,
) => {
  let runtime = displayObject[RECT_APPEARANCE_STATE_KEY];

  if (!runtime) {
    const target = {
      displayObject,
      element,
      interactionElement: element,
      styleRuntime,
      _baseAlpha: element.alpha ?? 1,
      active: {
        hover: false,
        click: false,
        rightClick: false,
      },
      sync(nextElement, nextStyleRuntime) {
        this.element = nextElement;
        this.interactionElement = nextElement;
        this.styleRuntime = nextStyleRuntime;
        this._baseAlpha = nextElement.alpha ?? 1;
        applyAppearance(displayObject, runtime);
      },
      syncInteractions(nextElement) {
        this.interactionElement = nextElement;
        applyAppearance(displayObject, runtime);
      },
      setInteractionActive(interaction, isActive) {
        if (this.active[interaction] === isActive) return;
        this.active[interaction] = isActive;
        applyAppearance(displayObject, runtime);
      },
      notifyBaseStyleChange() {
        applyAppearance(displayObject, runtime);
      },
      apply() {
        applyAppearance(displayObject, runtime);
      },
      destroy() {
        if (displayObject[RECT_APPEARANCE_STATE_KEY] === runtime) {
          delete displayObject[RECT_APPEARANCE_STATE_KEY];
        }
      },
    };

    runtime = new Proxy(target, {
      get(current, property, receiver) {
        if (property === "baseAlpha") return current._baseAlpha;
        return Reflect.get(current, property, receiver);
      },
      set(current, property, value, receiver) {
        if (property === "baseAlpha") {
          current._baseAlpha = value;
          applyAlpha(displayObject, runtime);
          return true;
        }
        return Reflect.set(current, property, value, receiver);
      },
    });
    displayObject[RECT_APPEARANCE_STATE_KEY] = runtime;
    applyAppearance(displayObject, runtime);
  } else {
    runtime.element = element;
    runtime.interactionElement = element;
    runtime.styleRuntime = styleRuntime;
  }

  return runtime;
};

export const syncRectAppearanceRuntime = (
  displayObject,
  element,
  styleRuntime,
) => {
  const runtime = displayObject?.[RECT_APPEARANCE_STATE_KEY];
  if (!runtime) {
    return installRectAppearanceRuntime(displayObject, element, styleRuntime);
  }
  runtime.sync(element, styleRuntime);
  return runtime;
};

export const syncRectInteractionAppearance = (displayObject, element) => {
  displayObject?.[RECT_APPEARANCE_STATE_KEY]?.syncInteractions(element);
};

export const notifyRectBaseStyleChange = (displayObject) => {
  displayObject?.[RECT_APPEARANCE_STATE_KEY]?.notifyBaseStyleChange();
};

export const setRectInteractionActive = (
  displayObject,
  interaction,
  isActive,
) => {
  displayObject?.[RECT_APPEARANCE_STATE_KEY]?.setInteractionActive(
    interaction,
    isActive,
  );
};

export const getRectBaseAlpha = (displayObject) =>
  displayObject?.[RECT_APPEARANCE_STATE_KEY]?.baseAlpha;

export const getRectEffectiveAppearance = (displayObject) => {
  const runtime = displayObject?.[RECT_APPEARANCE_STATE_KEY];
  if (!runtime) return null;

  return {
    fill: getInteractionField(runtime, "fill"),
    alpha: getInteractionField(runtime, "alpha"),
  };
};

export const destroyRectAppearanceRuntime = (displayObject) => {
  displayObject?.[RECT_APPEARANCE_STATE_KEY]?.destroy();
};
