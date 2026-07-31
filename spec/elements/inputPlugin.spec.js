import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { addInput } from "../../src/plugins/elements/input/addInput.js";
import { deleteInput } from "../../src/plugins/elements/input/deleteInput.js";
import { parseInput } from "../../src/plugins/elements/input/parseInput.js";
import { updateInput } from "../../src/plugins/elements/input/updateInput.js";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import {
  createAnimatedShaderFilterFixture,
  createFilterAnimationFixture,
} from "../util/shaderFilterFixtures.js";

const createApp = () => {
  const bridgeState = {
    mountArgs: null,
    updateArgs: null,
  };

  const app = {
    ticker: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    inputDomBridge: {
      mount: vi.fn((id, options) => {
        bridgeState.mountArgs = [id, options];
      }),
      update: vi.fn((id, options) => {
        bridgeState.updateArgs = [id, options];
      }),
      focus: vi.fn(),
      setSelection: vi.fn(),
      unmount: vi.fn(),
    },
  };

  return { app, bridgeState };
};

describe("input plugin", () => {
  it("installs shader filters before dispatching mount animations", () => {
    const parent = new Container();
    const { app } = createApp();
    const element = parseInput({
      state: {
        id: "animated-input",
        type: "input",
        width: 200,
        height: 44,
      },
    });
    element.filters = createAnimatedShaderFilterFixture();
    const animationBus = createAnimationBus();

    addInput({
      app,
      parent,
      element,
      animations: createFilterAnimationFixture(element.id),
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      zIndex: 0,
    });
    animationBus.flush();

    const input = parent.getChildByLabel(element.id);
    expect(
      input.filters[0].resources.shaderUniforms.uniforms.uAmount,
    ).toBeCloseTo(0.4);
    input.destroy({ children: true });
  });

  it("applies and resets degree rotation around the configured origin", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const { app, bridgeState } = createApp();
    const initialElement = parseInput({
      state: {
        id: "rotated-input",
        type: "input",
        x: 30,
        y: 40,
        width: 200,
        height: 44,
        originX: 24,
        originY: 12,
        rotation: 45,
      },
    });

    addInput({
      app,
      parent,
      element: initialElement,
      eventHandler,
      zIndex: 0,
    });

    const input = parent.getChildByLabel("rotated-input");

    expect(input.x).toBe(54);
    expect(input.y).toBe(52);
    expect(input.pivot.x).toBe(24);
    expect(input.pivot.y).toBe(12);
    expect(input.rotation).toBeCloseTo(Math.PI / 4);

    const initialBridgeOptions = bridgeState.mountArgs[1];
    const initialGeometry = initialBridgeOptions.getGeometry();
    const inputCenter = input.toGlobal({
      x: initialElement.width / 2,
      y: initialElement.height / 2,
    });

    expect(initialBridgeOptions.hitTest(inputCenter)).toBe(true);
    expect(
      initialBridgeOptions.hitTest({
        x: initialGeometry.x + 1,
        y: initialGeometry.y + 1,
      }),
    ).toBe(false);

    const nextElement = parseInput({
      state: {
        id: "rotated-input",
        type: "input",
        x: 80,
        y: 70,
        width: 200,
        height: 44,
        originX: 10,
        originY: 8,
        rotation: 0,
      },
    });

    updateInput({
      app,
      parent,
      prevElement: initialElement,
      nextElement,
      eventHandler,
      animations: [],
      animationBus: { dispatch: vi.fn() },
      completionTracker: {},
      zIndex: 0,
    });

    expect(input.x).toBe(90);
    expect(input.y).toBe(78);
    expect(input.pivot.x).toBe(10);
    expect(input.pivot.y).toBe(8);
    expect(input.rotation).toBe(0);
  });

  it("renders a field and preserves native-edited value across unchanged rerenders", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const { app, bridgeState } = createApp();
    const initialElement = parseInput({
      state: {
        id: "name",
        type: "input",
        x: 20,
        y: 40,
        width: 200,
        height: 44,
        placeholder: "Name",
        change: {
          payload: {
            source: "input",
          },
        },
      },
    });

    addInput({
      app,
      parent,
      element: initialElement,
      eventHandler,
      zIndex: 0,
    });

    expect(app.inputDomBridge.mount).toHaveBeenCalledTimes(1);
    const inputContainer = parent.getChildByLabel("name");
    expect(inputContainer).toBeTruthy();
    expect(inputContainer.x).toBe(20);
    expect(inputContainer.y).toBe(40);
    expect(inputContainer.alpha).toBe(1);

    const mountOptions = bridgeState.mountArgs[1];
    expect(mountOptions.callbacks.onSubmit).toBeUndefined();
    mountOptions.callbacks.onFocus({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      focused: true,
      composing: false,
    });
    mountOptions.callbacks.onValueChange({
      value: "native text",
      selectionStart: 11,
      selectionEnd: 11,
      focused: true,
      composing: false,
    });

    expect(eventHandler).toHaveBeenCalledWith(
      "change",
      expect.objectContaining({
        _event: expect.objectContaining({
          id: "name",
          value: "native text",
        }),
      }),
    );

    updateInput({
      app,
      parent,
      prevElement: initialElement,
      nextElement: parseInput({
        state: {
          id: "name",
          type: "input",
          x: 20,
          y: 40,
          width: 200,
          height: 44,
          placeholder: "Name",
          value: "",
        },
      }),
      eventHandler,
      zIndex: 0,
    });

    expect(app.inputDomBridge.update).toHaveBeenCalledTimes(1);
    expect(bridgeState.updateArgs[1].value).toBe("native text");
    expect(bridgeState.updateArgs[1].callbacks.onSubmit).toBeUndefined();
  });

  it("emits focus only once while the field stays focused across repeated native focus callbacks", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const { app, bridgeState } = createApp();
    const element = parseInput({
      state: {
        id: "name",
        type: "input",
        x: 20,
        y: 40,
        width: 200,
        height: 44,
        focusEvent: {
          payload: {
            source: "input",
          },
        },
      },
    });

    addInput({
      app,
      parent,
      element,
      eventHandler,
      zIndex: 0,
    });

    const { callbacks } = bridgeState.mountArgs[1];

    callbacks.onFocus({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      focused: true,
      composing: false,
    });
    callbacks.onFocus({
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      focused: true,
      composing: false,
    });

    expect(
      eventHandler.mock.calls.filter(([eventName]) => eventName === "focus"),
    ).toHaveLength(1);
  });

  it("emits submit payload when configured", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const { app, bridgeState } = createApp();
    const element = parseInput({
      state: {
        id: "name",
        type: "input",
        x: 20,
        y: 40,
        width: 200,
        height: 44,
        submit: {
          payload: {
            action: "nextLine",
          },
        },
      },
    });

    addInput({
      app,
      parent,
      element,
      eventHandler,
      zIndex: 0,
    });

    const { callbacks } = bridgeState.mountArgs[1];

    callbacks.onSubmit({
      value: "Jane",
      selectionStart: 4,
      selectionEnd: 4,
      focused: true,
      composing: false,
    });

    expect(eventHandler).toHaveBeenCalledWith("submit", {
      _event: {
        id: "name",
        value: "Jane",
        selectionStart: 4,
        selectionEnd: 4,
        composing: false,
      },
      action: "nextLine",
    });
  });

  it("passes multiline fields through to the DOM bridge and updates their transform", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const { app, bridgeState } = createApp();
    const initialElement = parseInput({
      state: {
        id: "bio",
        type: "input",
        x: 12,
        y: 18,
        width: 220,
        height: 80,
        multiline: true,
        value: "Line 1\nLine 2",
      },
    });

    addInput({
      app,
      parent,
      element: initialElement,
      eventHandler,
      zIndex: 2,
    });

    expect(bridgeState.mountArgs[1].multiline).toBe(true);
    expect(parent.getChildByLabel("bio").y).toBe(18);

    updateInput({
      app,
      parent,
      prevElement: initialElement,
      nextElement: parseInput({
        state: {
          id: "bio",
          type: "input",
          x: 32,
          y: 28,
          width: 220,
          height: 80,
          multiline: true,
          value: "Line 1\nLine 2",
          alpha: 0.5,
        },
      }),
      eventHandler,
      zIndex: 3,
    });

    const updatedContainer = parent.getChildByLabel("bio");
    expect(updatedContainer.x).toBe(32);
    expect(updatedContainer.y).toBe(28);
    expect(updatedContainer.alpha).toBe(0.5);
    expect(bridgeState.updateArgs[1].multiline).toBe(true);
  });

  it("uses Pixi pointer input to move the caret and sync selection to the hidden DOM control", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const { app } = createApp();
    const element = parseInput({
      state: {
        id: "name",
        type: "input",
        x: 20,
        y: 40,
        width: 200,
        height: 44,
        value: "Hello",
      },
    });

    addInput({
      app,
      parent,
      element,
      eventHandler,
      zIndex: 0,
    });

    const inputContainer = parent.getChildByLabel("name");

    const pointerDownEvent = {
      global: { x: 24, y: 52 },
      shiftKey: false,
      stopPropagation: vi.fn(),
    };

    inputContainer.emit("pointerdown", pointerDownEvent);

    expect(pointerDownEvent.stopPropagation).toHaveBeenCalledTimes(1);

    expect(app.inputDomBridge.focus).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        selectionStart: expect.any(Number),
        selectionEnd: expect.any(Number),
      }),
    );
    expect(app.inputDomBridge.focus).toHaveBeenCalledTimes(1);

    const pointerMoveEvent = {
      global: { x: 120, y: 52 },
      stopPropagation: vi.fn(),
    };

    inputContainer.emit("globalpointermove", pointerMoveEvent);

    expect(pointerMoveEvent.stopPropagation).toHaveBeenCalledTimes(1);

    expect(app.inputDomBridge.setSelection).toHaveBeenCalledWith(
      "name",
      expect.any(Number),
      expect.any(Number),
    );

    const pointerUpEvent = {
      global: { x: 120, y: 52 },
      stopPropagation: vi.fn(),
    };

    inputContainer.emit("pointerup", pointerUpEvent);

    expect(pointerUpEvent.stopPropagation).toHaveBeenCalledTimes(1);

    const rightClickEvent = { stopPropagation: vi.fn() };

    inputContainer.emit("rightclick", rightClickEvent);

    expect(rightClickEvent.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("re-adopts an external value after input changes during an update tween", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const { app, bridgeState } = createApp();
    const initialElement = parseInput({
      state: {
        id: "name",
        type: "input",
        x: 20,
        y: 40,
        width: 200,
        height: 44,
        value: "old value",
      },
    });
    const nextElement = parseInput({
      state: {
        ...initialElement,
        x: 120,
        value: "external value",
      },
    });
    const animationBus = { dispatch: vi.fn() };

    addInput({
      app,
      parent,
      element: initialElement,
      eventHandler,
      zIndex: 0,
    });

    bridgeState.mountArgs[1].callbacks.onFocus({
      value: "old value",
      selectionStart: 9,
      selectionEnd: 9,
      focused: true,
      composing: false,
    });

    updateInput({
      app,
      parent,
      prevElement: initialElement,
      nextElement,
      eventHandler,
      animations: [
        {
          id: "input-update",
          targetId: "name",
          type: "update",
          tween: {
            x: {
              auto: {
                duration: 300,
                easing: "linear",
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      zIndex: 0,
    });

    bridgeState.mountArgs[1].callbacks.onValueChange({
      value: "typed during tween",
      selectionStart: 18,
      selectionEnd: 18,
      focused: true,
      composing: false,
    });
    animationBus.dispatch.mock.calls[0][0].payload.onComplete();

    expect(bridgeState.updateArgs[1].value).toBe("external value");
  });

  it("runs update animations before unmounting a deleted input", () => {
    const parent = new Container();
    const { app } = createApp();
    const element = parseInput({
      state: {
        id: "name",
        type: "input",
        x: 20,
        y: 40,
        width: 200,
        height: 44,
      },
    });
    const animationBus = { dispatch: vi.fn() };
    const completionTracker = {
      getVersion: () => 4,
      track: vi.fn(),
      complete: vi.fn(),
    };

    addInput({
      app,
      parent,
      element,
      eventHandler: vi.fn(),
      zIndex: 0,
    });

    const inputContainer = parent.getChildByLabel("name");

    deleteInput({
      app,
      parent,
      element,
      animations: [
        {
          id: "input-exit",
          targetId: "name",
          type: "update",
          tween: {
            alpha: {
              keyframes: [{ duration: 300, value: 0, easing: "linear" }],
            },
          },
        },
      ],
      animationBus,
      completionTracker,
    });

    expect(app.inputDomBridge.unmount).not.toHaveBeenCalled();
    expect(completionTracker.track).toHaveBeenCalledWith(4);
    expect(animationBus.dispatch).toHaveBeenCalledWith({
      type: "START",
      payload: expect.objectContaining({
        id: "input-exit",
        animationType: "update",
        targetId: "name",
        element: inputContainer,
        targetState: null,
      }),
    });

    const onComplete =
      animationBus.dispatch.mock.calls[0][0].payload.onComplete;
    onComplete();

    expect(app.inputDomBridge.unmount).toHaveBeenCalledWith("name");
    expect(inputContainer.destroyed).toBe(true);
  });
});
