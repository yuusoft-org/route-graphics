import { afterEach, describe, expect, it, vi } from "vitest";
import { createInputDomBridge } from "../../src/util/inputDomBridge.js";

const createApp = () => {
  const ticker = {
    listener: null,
    add: vi.fn((listener) => {
      ticker.listener = listener;
    }),
    remove: vi.fn((listener) => {
      if (ticker.listener === listener) {
        ticker.listener = null;
      }
    }),
  };

  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = vi.fn(() => ({
    left: 40,
    top: 60,
    width: 200,
    height: 100,
  }));
  document.body.appendChild(canvas);

  return {
    app: {
      canvas,
      renderer: {
        width: 200,
        height: 100,
      },
      ticker,
    },
    ticker,
    canvas,
  };
};

describe("inputDomBridge", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a native input, syncs geometry, and emits focus/value/selection events", async () => {
    const { app, ticker } = createApp();
    const bridge = createInputDomBridge({ app });
    const callbacks = {
      onFocus: vi.fn(),
      onValueChange: vi.fn(),
      onSelectionChange: vi.fn(),
      onSubmit: vi.fn(),
    };

    const input = bridge.mount("name", {
      value: "",
      placeholder: "Name",
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
      textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
      getGeometry: () => ({
        x: 10,
        y: 20,
        width: 50,
        height: 25,
        visible: true,
      }),
      callbacks,
    });

    ticker.listener?.({ deltaMS: 16 });

    expect(input.style.left).toBe("50px");
    expect(input.style.top).toBe("80px");
    expect(input.style.width).toBe("50px");
    expect(input.style.height).toBe("25px");
    expect(input.style.pointerEvents).toBe("none");
    expect(input.style.opacity).toBe("0");

    input.focus();
    expect(callbacks.onFocus).toHaveBeenCalled();
    expect(input.style.pointerEvents).toBe("none");

    input.value = "abc";
    input.setSelectionRange(1, 3);
    input.dispatchEvent(new Event("input"));

    expect(callbacks.onValueChange).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "abc",
        selectionStart: 1,
        selectionEnd: 3,
      }),
    );

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(callbacks.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "abc",
      }),
      expect.any(KeyboardEvent),
    );

    bridge.setSelection("name", 0, 2);
    expect(callbacks.onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionStart: 0,
        selectionEnd: 2,
      }),
    );

    bridge.destroy();
  });

  it("mounts a textarea for multiline fields and applies clip-path insets", () => {
    const { app, ticker } = createApp();
    const bridge = createInputDomBridge({ app });

    const input = bridge.mount("bio", {
      value: "line 1\nline 2",
      multiline: true,
      padding: { top: 4, right: 5, bottom: 6, left: 7 },
      textStyle: { fontSize: 16, fill: "#ffffff", align: "left" },
      getGeometry: () => ({
        x: 10,
        y: 20,
        width: 80,
        height: 40,
        visible: true,
        clipInsets: {
          top: 2,
          right: 3,
          bottom: 4,
          left: 5,
        },
      }),
      callbacks: {},
    });

    ticker.listener?.({ deltaMS: 16 });

    expect(input.tagName).toBe("TEXTAREA");
    expect(input.style.clipPath).toBe("inset(2px 3px 4px 5px)");

    bridge.destroy();
  });

  it("applies ordered font family aliases to the native input", () => {
    const { app } = createApp();
    const bridge = createInputDomBridge({ app });

    const input = bridge.mount("name", {
      value: "",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      textStyle: {
        fontFamily: ["uiFont", "fallbackFont"],
      },
      getGeometry: () => ({
        x: 0,
        y: 0,
        width: 50,
        height: 25,
        visible: true,
      }),
      callbacks: {},
    });

    expect(input.style.fontFamily).toBe("uiFont, fallbackFont");

    bridge.destroy();
  });

  it("focuses synchronously when asked to focus from pointer-driven selection", () => {
    const { app } = createApp();
    const bridge = createInputDomBridge({ app });

    const input = bridge.mount("name", {
      value: "hello",
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
      getGeometry: () => ({
        x: 0,
        y: 0,
        width: 50,
        height: 25,
        visible: true,
      }),
      callbacks: {},
    });

    bridge.focus("name", {
      selectionStart: 1,
      selectionEnd: 4,
    });

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(4);

    bridge.destroy();
  });

  it("does not emit duplicate focus callbacks when focus is requested twice on the active input", () => {
    const { app } = createApp();
    const bridge = createInputDomBridge({ app });
    const callbacks = {
      onFocus: vi.fn(),
    };

    bridge.mount("name", {
      value: "hello",
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
      getGeometry: () => ({
        x: 0,
        y: 0,
        width: 50,
        height: 25,
        visible: true,
      }),
      callbacks,
    });

    bridge.focus("name", {
      selectionStart: 1,
      selectionEnd: 1,
    });
    bridge.focus("name", {
      selectionStart: 1,
      selectionEnd: 1,
    });

    expect(callbacks.onFocus).toHaveBeenCalledTimes(1);

    bridge.destroy();
  });

  it("prevents native default submission when Enter submits a single-line input", () => {
    const { app } = createApp();
    const bridge = createInputDomBridge({ app });
    const callbacks = {
      onSubmit: vi.fn(),
    };

    const input = bridge.mount("name", {
      value: "abc",
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
      getGeometry: () => ({
        x: 0,
        y: 0,
        width: 50,
        height: 25,
        visible: true,
      }),
      callbacks,
    });

    input.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(callbacks.onSubmit).toHaveBeenCalledTimes(1);

    bridge.destroy();
  });

  it("prevents single-line Enter without submitting when submitOnEnter is false", () => {
    const { app } = createApp();
    const bridge = createInputDomBridge({ app });
    const callbacks = {
      onSubmit: vi.fn(),
    };

    const input = bridge.mount("name", {
      value: "abc",
      submitOnEnter: false,
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
      getGeometry: () => ({
        x: 0,
        y: 0,
        width: 50,
        height: 25,
        visible: true,
      }),
      callbacks,
    });
    const onLaterInputKeydown = vi.fn();
    input.addEventListener("keydown", onLaterInputKeydown);
    input.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
    expect(onLaterInputKeydown).not.toHaveBeenCalled();

    bridge.destroy();
  });

  it("prevents multiline Enter from inserting a line break when submitOnEnter is false", () => {
    const { app } = createApp();
    const bridge = createInputDomBridge({ app });
    const callbacks = {
      onSubmit: vi.fn(),
      onValueChange: vi.fn(),
    };

    const input = bridge.mount("bio", {
      value: "abc",
      multiline: true,
      submitOnEnter: false,
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
      getGeometry: () => ({
        x: 0,
        y: 0,
        width: 50,
        height: 25,
        visible: true,
      }),
      callbacks,
    });
    const onLaterInputKeydown = vi.fn();
    input.addEventListener("keydown", onLaterInputKeydown);
    input.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(input.value).toBe("abc");
    expect(callbacks.onSubmit).not.toHaveBeenCalled();
    expect(callbacks.onValueChange).not.toHaveBeenCalled();
    expect(onLaterInputKeydown).not.toHaveBeenCalled();

    bridge.destroy();
  });

  it("keeps focused input keyboard events from bubbling to document shortcuts", () => {
    const { app } = createApp();
    const bridge = createInputDomBridge({ app });
    const onDocumentKeydown = vi.fn();
    const onDocumentKeyup = vi.fn();
    const callbacks = {
      onSubmit: vi.fn(),
    };

    document.addEventListener("keydown", onDocumentKeydown);
    document.addEventListener("keyup", onDocumentKeyup);

    const input = bridge.mount("name", {
      value: "abc",
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
      getGeometry: () => ({
        x: 0,
        y: 0,
        width: 50,
        height: 25,
        visible: true,
      }),
      callbacks,
    });

    input.focus();

    const spaceDown = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    const spaceUp = new KeyboardEvent("keyup", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    const enterDown = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(spaceDown);
    input.dispatchEvent(spaceUp);
    input.dispatchEvent(enterDown);

    expect(spaceDown.defaultPrevented).toBe(false);
    expect(spaceUp.defaultPrevented).toBe(false);
    expect(enterDown.defaultPrevented).toBe(true);
    expect(callbacks.onSubmit).toHaveBeenCalledTimes(1);
    expect(onDocumentKeydown).not.toHaveBeenCalled();
    expect(onDocumentKeyup).not.toHaveBeenCalled();

    document.removeEventListener("keydown", onDocumentKeydown);
    document.removeEventListener("keyup", onDocumentKeyup);
    bridge.destroy();
  });

  it("blurs when the pointer lands inside the unclipped box but outside the visible clipped region", () => {
    vi.useFakeTimers();

    try {
      const { app } = createApp();
      const bridge = createInputDomBridge({ app });
      const callbacks = {
        onBlur: vi.fn(),
      };

      const input = bridge.mount("name", {
        value: "abc",
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
        textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
        getGeometry: () => ({
          x: 10,
          y: 20,
          width: 80,
          height: 40,
          visible: true,
          clipInsets: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 30,
          },
        }),
        callbacks,
      });

      input.focus();
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 60,
          clientY: 100,
        }),
      );
      vi.runAllTimers();

      expect(callbacks.onBlur).toHaveBeenCalledTimes(1);

      bridge.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("blurs when the pointer is inside the AABB but outside the transformed input shape", () => {
    vi.useFakeTimers();

    try {
      const { app } = createApp();
      const bridge = createInputDomBridge({ app });
      const callbacks = {
        onBlur: vi.fn(),
      };
      const hitTest = vi.fn(() => false);

      const input = bridge.mount("rotated-name", {
        value: "abc",
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
        textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
        getGeometry: () => ({
          x: 10,
          y: 20,
          width: 80,
          height: 40,
          visible: true,
        }),
        hitTest,
        callbacks,
      });

      input.focus();
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 60,
          clientY: 100,
        }),
      );
      vi.runAllTimers();

      expect(hitTest).toHaveBeenCalledWith({
        x: 20,
        y: 40,
      });
      expect(callbacks.onBlur).toHaveBeenCalledTimes(1);

      bridge.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses transient blur callbacks when the input is immediately refocused", () => {
    vi.useFakeTimers();

    try {
      const { app } = createApp();
      const bridge = createInputDomBridge({ app });
      const callbacks = {
        onBlur: vi.fn(),
      };

      const input = bridge.mount("name", {
        value: "abc",
        padding: { top: 1, right: 1, bottom: 1, left: 1 },
        textStyle: { fontSize: 18, fill: "#ffffff", align: "left" },
        getGeometry: () => ({
          x: 0,
          y: 0,
          width: 50,
          height: 25,
          visible: true,
        }),
        callbacks,
      });

      input.focus();
      input.blur();
      bridge.focus("name", {
        selectionStart: 3,
        selectionEnd: 3,
      });
      vi.runAllTimers();

      expect(callbacks.onBlur).not.toHaveBeenCalled();

      bridge.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
