import { isDeepEqual } from "../../../util/isDeepEqual.js";
import {
  INPUT_RUNTIME,
  getInputGeometry,
  syncInputView,
} from "./inputShared.js";
import { setElementRenderState } from "../elementRenderState.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
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

export const updateInput = ({
  app,
  parent,
  prevElement,
  nextElement,
  eventHandler,
  animations,
  animationBus,
  completionTracker,
  zIndex,
  deferRenderStateCommit,
  commitRenderState,
}) => {
  const container = parent.children.find(
    (child) => child.label === prevElement.id,
  );

  if (!container) return;
  if (!app.inputDomBridge?.update) {
    throw new Error(
      "Input plugin requires app.inputDomBridge to be initialized",
    );
  }

  container.zIndex = zIndex;

  const runtime = container[INPUT_RUNTIME];

  if (!runtime) return;

  const nextRuntimeElement = {
    ...nextElement,
  };

  const shouldAdoptExternalValue =
    runtime.focused !== true || nextElement.value !== prevElement.value;

  if (shouldAdoptExternalValue && runtime.composing !== true) {
    runtime.value = nextElement.value;
    runtime.lastExternalValue = nextElement.value;
  } else {
    nextRuntimeElement.value = runtime.value;
  }
  const adoptedExternalValue =
    shouldAdoptExternalValue && runtime.composing !== true;

  const updateElement = () => {
    if (adoptedExternalValue) {
      runtime.value = nextElement.value;
      runtime.lastExternalValue = nextElement.value;
    }

    runtime.element = nextRuntimeElement;
    container.label = nextElement.id;
    container.cursor = nextElement.disabled ? "default" : "text";
    container.alpha = nextElement.alpha;
    applyElementTransform(container, nextElement);

    if (nextElement.disabled === true) {
      runtime.draggingSelection = false;
    }

    if (!isDeepEqual(prevElement, nextElement) || shouldAdoptExternalValue) {
      syncInputView(runtime, nextRuntimeElement);
    }

    app.inputDomBridge.update(nextElement.id, {
      ...nextRuntimeElement,
      value: runtime.value,
      callbacks: createCallbacks({
        element: nextRuntimeElement,
        runtime,
        eventHandler,
      }),
      getGeometry: () => getInputGeometry(app, container, nextRuntimeElement),
    });
    setElementRenderState(container, nextElement);
    commitRenderState?.(container);
  };

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: prevElement.id,
    animationBus,
    completionTracker,
    element: container,
    targetState: getElementTransformTargetState(nextElement, {
      alpha: nextElement.alpha,
    }),
    onComplete: updateElement,
  });

  if (!dispatched) {
    updateElement();
  } else {
    deferRenderStateCommit?.();
  }
};

export default updateInput;
