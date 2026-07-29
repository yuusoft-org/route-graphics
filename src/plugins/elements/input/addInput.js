import { Container } from "pixi.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import {
  INPUT_RUNTIME,
  buildInputRuntime,
  createInputDisplay,
  getInputGeometry,
  getInputIndexFromLocalPoint,
  hitTestInput,
  syncInputView,
} from "./inputShared.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";

const emitInputEvent = ({
  eventHandler,
  eventName,
  element,
  eventConfig,
  snapshot,
}) => {
  if (!eventHandler || !eventConfig) return;

  eventHandler(eventName, {
    _event: {
      id: element.id,
      value: snapshot.value,
      selectionStart: snapshot.selectionStart,
      selectionEnd: snapshot.selectionEnd,
      composing: snapshot.composing,
    },
    ...eventConfig.payload,
  });
};

const createCallbacks = ({ element, runtime, eventHandler }) => ({
  onValueChange: (snapshot) => {
    runtime.value = snapshot.value;
    runtime.selectionStart = snapshot.selectionStart;
    runtime.selectionEnd = snapshot.selectionEnd;
    runtime.lastExternalValue = snapshot.value;
    syncInputView(runtime, element);
    emitInputEvent({
      eventHandler,
      eventName: "change",
      element,
      eventConfig: element.change,
      snapshot,
    });
  },
  onFocus: (snapshot) => {
    const wasFocused = runtime.nativeFocused === true;

    runtime.nativeFocused = true;
    runtime.focused = true;
    runtime.selectionStart = snapshot.selectionStart;
    runtime.selectionEnd = snapshot.selectionEnd;
    runtime.selectionAnchor =
      snapshot.selectionStart === snapshot.selectionEnd
        ? snapshot.selectionEnd
        : runtime.selectionAnchor;
    runtime.blinkVisible = true;
    runtime.blinkTick = 0;
    syncInputView(runtime, element);
    if (wasFocused) {
      return;
    }
    emitInputEvent({
      eventHandler,
      eventName: "focus",
      element,
      eventConfig: element.focusEvent,
      snapshot,
    });
  },
  onBlur: (snapshot) => {
    runtime.nativeFocused = false;
    runtime.focused = false;
    runtime.selectionStart = snapshot.selectionStart;
    runtime.selectionEnd = snapshot.selectionEnd;
    runtime.blinkVisible = false;
    runtime.composing = false;
    syncInputView(runtime, element);
    emitInputEvent({
      eventHandler,
      eventName: "blur",
      element,
      eventConfig: element.blurEvent,
      snapshot,
    });
  },
  onSelectionChange: (snapshot) => {
    runtime.nativeFocused = snapshot.focused;
    runtime.focused = snapshot.focused;
    runtime.selectionStart = snapshot.selectionStart;
    runtime.selectionEnd = snapshot.selectionEnd;
    if (snapshot.selectionStart === snapshot.selectionEnd) {
      runtime.selectionAnchor = snapshot.selectionEnd;
    }
    syncInputView(runtime, element);
    emitInputEvent({
      eventHandler,
      eventName: "selectionChange",
      element,
      eventConfig: element.selectionChange,
      snapshot,
    });
  },
  ...(element.submit && {
    onSubmit: (snapshot) => {
      emitInputEvent({
        eventHandler,
        eventName: "submit",
        element,
        eventConfig: element.submit,
        snapshot,
      });
    },
  }),
  onCompositionStart: (snapshot) => {
    runtime.composing = true;
    syncInputView(runtime, element);
    emitInputEvent({
      eventHandler,
      eventName: "compositionStart",
      element,
      eventConfig: element.compositionStart,
      snapshot,
    });
  },
  onCompositionUpdate: (snapshot) => {
    runtime.composing = true;
    runtime.selectionStart = snapshot.selectionStart;
    runtime.selectionEnd = snapshot.selectionEnd;
    syncInputView(runtime, element);
    emitInputEvent({
      eventHandler,
      eventName: "compositionUpdate",
      element,
      eventConfig: element.compositionUpdate,
      snapshot,
    });
  },
  onCompositionEnd: (snapshot) => {
    runtime.composing = false;
    runtime.value = snapshot.value;
    runtime.selectionStart = snapshot.selectionStart;
    runtime.selectionEnd = snapshot.selectionEnd;
    syncInputView(runtime, element);
    emitInputEvent({
      eventHandler,
      eventName: "compositionEnd",
      element,
      eventConfig: element.compositionEnd,
      snapshot,
    });
  },
});

export const addInput = ({
  app,
  parent,
  element,
  animations,
  animationBus,
  completionTracker,
  eventHandler,
  renderContext,
  zIndex,
}) => {
  if (
    !app.inputDomBridge?.mount ||
    !app.inputDomBridge?.focus ||
    !app.inputDomBridge?.setSelection
  ) {
    throw new Error(
      "Input plugin requires app.inputDomBridge to be initialized",
    );
  }

  const container = new Container({
    label: element.id,
  });

  container.zIndex = zIndex;
  container.sortableChildren = true;
  container.eventMode = "static";
  container.cursor = element.disabled ? "default" : "text";
  container.alpha = element.alpha;
  applyElementTransform(container, element);

  const display = createInputDisplay(element);
  const runtime = buildInputRuntime({
    app,
    container,
    display,
    element,
  });

  container.addChild(
    runtime.background,
    runtime.selection,
    runtime.text,
    runtime.placeholder,
    runtime.caret,
    runtime.clip,
  );

  runtime.tickerListener = (ticker) => {
    if (!runtime.focused) {
      if (runtime.blinkVisible === false) return;

      runtime.blinkVisible = false;
      syncInputView(runtime, runtime.element);
      return;
    }

    runtime.blinkTick += ticker.deltaMS ?? ticker.deltaTime ?? 16;
    if (runtime.blinkTick >= 530) {
      runtime.blinkTick = 0;
      runtime.blinkVisible = !runtime.blinkVisible;
      syncInputView(runtime, runtime.element);
    }
  };

  app.ticker?.add?.(runtime.tickerListener);

  const syncSelectionToDom = ({ start, end, shouldFocus = false }) => {
    if (shouldFocus) {
      app.inputDomBridge.focus(element.id, {
        selectionStart: start,
        selectionEnd: end,
      });
      return;
    }

    app.inputDomBridge.setSelection(element.id, start, end);
  };

  const stopInputPointerPropagation = (event) => {
    event?.stopPropagation?.();
  };

  const updateRuntimeSelection = ({
    start,
    end,
    shouldFocus = false,
    anchor = runtime.selectionAnchor,
  }) => {
    runtime.focused = true;
    runtime.selectionStart = start;
    runtime.selectionEnd = end;
    runtime.selectionAnchor = anchor;
    runtime.blinkVisible = true;
    runtime.blinkTick = 0;
    syncInputView(runtime, runtime.element);
    syncSelectionToDom({ start, end, shouldFocus });
  };

  const dragStartListener = (event) => {
    stopInputPointerPropagation(event);

    if (runtime.element.disabled === true) return;

    const localPoint = container.toLocal(event.global);
    const index = getInputIndexFromLocalPoint(runtime, localPoint);
    const extendSelection = Boolean(event.shiftKey) && runtime.focused;
    const anchor = extendSelection
      ? (runtime.selectionAnchor ??
        (runtime.selectionStart !== runtime.selectionEnd
          ? runtime.selectionStart
          : runtime.selectionEnd))
      : index;
    const start = extendSelection ? Math.min(anchor, index) : index;
    const end = extendSelection ? Math.max(anchor, index) : index;

    runtime.draggingSelection = true;

    updateRuntimeSelection({
      start,
      end,
      shouldFocus: true,
      anchor,
    });
  };

  const dragMoveListener = (event) => {
    if (!runtime.draggingSelection || runtime.element.disabled === true) return;

    stopInputPointerPropagation(event);

    const localPoint = container.toLocal(event.global);
    const index = getInputIndexFromLocalPoint(runtime, localPoint);
    const anchor = runtime.selectionAnchor ?? index;
    const start = Math.min(anchor, index);
    const end = Math.max(anchor, index);

    updateRuntimeSelection({
      start,
      end,
      anchor,
    });
  };

  const dragEndListener = (event) => {
    stopInputPointerPropagation(event);
    runtime.draggingSelection = false;
  };

  const releaseListener = (event) => {
    stopInputPointerPropagation(event);
    runtime.draggingSelection = false;

    if (runtime.element.disabled === true) return;
    app.inputDomBridge.focus(element.id, {
      selectionStart: runtime.selectionStart,
      selectionEnd: runtime.selectionEnd,
    });
  };

  container.on("pointerdown", dragStartListener);
  container.on("globalpointermove", dragMoveListener);
  container.on("pointerup", releaseListener);
  container.on("pointerupoutside", dragEndListener);
  container.on("rightclick", stopInputPointerPropagation);

  container[INPUT_RUNTIME] = runtime;

  syncInputView(runtime, element);

  app.inputDomBridge.mount(element.id, {
    ...element,
    value: runtime.value,
    callbacks: createCallbacks({
      element,
      runtime,
      eventHandler,
    }),
    getGeometry: () => getInputGeometry(app, container, element),
    hitTest: (point) => hitTestInput(container, element, point),
  });

  parent.addChild(container);

  dispatchLiveAnimations({
    animations,
    targetId: element.id,
    animationBus,
    completionTracker,
    element: container,
    targetState: getElementTransformTargetState(element, {
      alpha: element.alpha,
    }),
    renderContext,
  });
};

export default addInput;
