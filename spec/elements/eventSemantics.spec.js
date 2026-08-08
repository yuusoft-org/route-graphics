import { Container, Graphics } from "pixi.js";
import hotkeys from "hotkeys-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addRect } from "../../src/plugins/elements/rect/addRect.js";
import { addSprite } from "../../src/plugins/elements/sprite/addSprite.js";
import { addText } from "../../src/plugins/elements/text/addText.js";
import { addContainer } from "../../src/plugins/elements/container/addContainer.js";
import { addSlider } from "../../src/plugins/elements/slider/addSlider.js";
import { createKeyboardManager } from "../../src/util/keyboardManager.js";
import { bindRectInteractions } from "../../src/plugins/elements/rect/rectInteractions.js";

const createSharedParams = () => ({
  app: {
    audioStage: {
      add: vi.fn(),
    },
  },
  animations: [],
  animationBus: {
    dispatch: vi.fn(),
  },
  completionTracker: {
    getVersion: () => 0,
    track: () => {},
    complete: () => {},
  },
});

const createPointerEvent = (button) => ({ button });
const dispatchKeyboardEvent = (type, key, options = {}) => {
  const { target = document, ...eventOptions } = options;

  target.dispatchEvent(
    new KeyboardEvent(type, {
      key,
      code:
        eventOptions.code ??
        (key.length === 1 ? `Key${key.toUpperCase()}` : undefined),
      bubbles: true,
      cancelable: true,
      ...eventOptions,
    }),
  );
};

afterEach(() => {
  hotkeys.unbind();
});

describe("event semantics", () => {
  it("rect emits configured events even when their payload is omitted", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addRect({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "rect-no-payload",
        type: "rect",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        alpha: 1,
        fill: "#ffffff",
        hover: {},
        click: {},
        rightClick: {},
      },
    });

    const rect = parent.getChildByLabel("rect-no-payload");
    rect.emit("pointerover");
    rect.emit("pointerup");
    rect.emit("rightclick");

    expect(eventHandler.mock.calls).toEqual([
      ["hover", { _event: { id: "rect-no-payload" } }],
      ["click", { _event: { id: "rect-no-payload" } }],
      ["rightClick", { _event: { id: "rect-no-payload" } }],
    ]);
  });

  it("fully resets rect interaction state when handlers are removed", () => {
    const rect = new Graphics();
    rect.label = "interactive";
    const eventHandler = vi.fn();
    const app = {
      audioStage: { add: vi.fn() },
      canvas: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    };

    bindRectInteractions({
      app,
      rect,
      eventHandler,
      element: {
        id: "interactive",
        width: 100,
        height: 60,
        hover: { cursor: "pointer" },
        click: {},
        drag: { start: {} },
        scrollUp: {},
      },
    });
    rect.emit("pointerover");
    rect.emit("pointerdown");

    expect(rect.eventMode).toBe("static");
    expect(rect.cursor).toBe("pointer");
    expect(rect._isDragging).toBe(true);

    bindRectInteractions({
      app,
      rect,
      eventHandler,
      element: { id: "interactive", width: 100, height: 60 },
    });

    expect(rect.eventMode).toBe("auto");
    expect(rect.cursor).toBe("auto");
    expect(rect._isDragging).toBe(false);
    expect(rect.hitArea).toBeNull();
    expect(rect.listenerCount("pointerover")).toBe(0);
    expect(rect.listenerCount("pointerdown")).toBe(0);
    expect(rect.listenerCount("rightclick")).toBe(0);
    expect(Symbol.for("routeGraphics.setInheritedHover") in rect).toBe(false);
    expect(Symbol.for("routeGraphics.setInheritedPress") in rect).toBe(false);
    expect(Symbol.for("routeGraphics.setInheritedRightPress") in rect).toBe(
      false,
    );
    expect(app.canvas.removeEventListener).toHaveBeenCalledWith(
      "wheel",
      expect.any(Function),
    );

    eventHandler.mockClear();
    rect.emit("pointerover");
    rect.emit("pointerup");
    expect(eventHandler).not.toHaveBeenCalled();
  });

  it("skips interaction bindings for decorative rects", () => {
    const rect = new Graphics();
    rect.label = "decorative";

    bindRectInteractions({
      app: { audioStage: { add: vi.fn() } },
      rect,
      eventHandler: vi.fn(),
      element: { id: "decorative", width: 100, height: 60 },
    });

    expect(rect.eventNames()).toEqual([]);
    expect(Symbol.for("routeGraphics.setInheritedHover") in rect).toBe(false);
    expect(Symbol.for("routeGraphics.setInheritedPress") in rect).toBe(false);
    expect(Symbol.for("routeGraphics.setInheritedRightPress") in rect).toBe(
      false,
    );
  });

  it("refreshes the cursor when an active hover config changes", () => {
    const rect = new Graphics();
    rect.label = "cursor-sync";
    const app = { audioStage: { add: vi.fn() } };
    const eventHandler = vi.fn();

    bindRectInteractions({
      app,
      rect,
      eventHandler,
      element: {
        id: "cursor-sync",
        width: 100,
        height: 60,
        hover: { cursor: "pointer" },
      },
    });
    rect.emit("pointerover");
    expect(rect.cursor).toBe("pointer");

    bindRectInteractions({
      app,
      rect,
      eventHandler,
      element: {
        id: "cursor-sync",
        width: 100,
        height: 60,
        hover: { cursor: "crosshair" },
      },
    });
    expect(rect.cursor).toBe("crosshair");

    bindRectInteractions({
      app,
      rect,
      eventHandler,
      element: {
        id: "cursor-sync",
        width: 100,
        height: 60,
        hover: {},
      },
    });
    expect(rect.cursor).toBe("auto");
  });

  it("applies right-click sound volume consistently", () => {
    const parent = new Container();
    const shared = createSharedParams();

    addRect({
      ...shared,
      parent,
      eventHandler: vi.fn(),
      zIndex: 0,
      element: {
        id: "rect-context-sound",
        type: "rect",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
        alpha: 1,
        fill: "#ffffff",
        rightClick: {
          soundSrc: "context.mp3",
          soundVolume: 35,
        },
      },
    });

    parent.getChildByLabel("rect-context-sound").emit("rightclick");

    expect(shared.app.audioStage.add).toHaveBeenCalledWith({
      id: expect.stringMatching(/^rightClick-/),
      url: "context.mp3",
      loop: false,
      volume: 0.35,
    });
  });

  it("rect emits hover/click/rightClick/scroll payload events", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addRect({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "rect-1",
        type: "rect",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        alpha: 1,
        fill: "#FFFFFF",
        hover: {
          soundSrc: "rect-hover.mp3",
          soundVolume: 25,
          payload: { source: "hover" },
        },
        click: {
          payload: { source: "click" },
        },
        rightClick: {
          payload: { source: "rightClick" },
        },
        scrollUp: { payload: { direction: "up" } },
        scrollDown: { payload: { direction: "down" } },
      },
    });

    const rect = parent.getChildByLabel("rect-1");
    rect.emit("pointerover");
    rect.emit("pointerup");
    rect.emit("rightclick");
    rect.emit("wheel", { deltaY: -1 });
    rect.emit("wheel", { deltaY: 1 });

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "hover",
      "click",
      "rightClick",
      "scrollUp",
      "scrollDown",
    ]);

    expect(eventHandler.mock.calls[0][1]).toMatchObject({
      _event: { id: "rect-1" },
      source: "hover",
    });
    expect(eventHandler.mock.calls[1][1]).toMatchObject({
      _event: { id: "rect-1" },
      source: "click",
    });
    expect(eventHandler.mock.calls[2][1]).toMatchObject({
      _event: { id: "rect-1" },
      source: "rightClick",
    });
    expect(eventHandler.mock.calls[3][1]).toMatchObject({
      _event: { id: "rect-1" },
      direction: "up",
    });
    expect(eventHandler.mock.calls[4][1]).toMatchObject({
      _event: { id: "rect-1" },
      direction: "down",
    });
    expect(shared.app.audioStage.add).toHaveBeenCalledWith({
      id: expect.stringMatching(/^hover-/),
      url: "rect-hover.mp3",
      loop: false,
      volume: 0.25,
    });
  });

  it("rect click does not fire for right mouse release", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addRect({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "rect-right-only",
        type: "rect",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        alpha: 1,
        fill: "#FFFFFF",
        click: { payload: { source: "click" } },
        rightClick: { payload: { source: "rightClick" } },
      },
    });

    const rect = parent.getChildByLabel("rect-right-only");
    rect.emit("pointerup", createPointerEvent(2));
    rect.emit("rightclick");

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "rightClick",
    ]);
  });

  it("rect emits scroll events from native canvas wheel while hovered", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const nativeListeners = new Map();
    const shared = {
      ...createSharedParams(),
      app: {
        ...createSharedParams().app,
        canvas: {
          addEventListener: vi.fn((name, listener) => {
            nativeListeners.set(name, listener);
          }),
          removeEventListener: vi.fn((name) => {
            nativeListeners.delete(name);
          }),
        },
      },
    };

    addRect({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "rect-scroll-native",
        type: "rect",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        alpha: 1,
        fill: "#FFFFFF",
        scrollUp: { payload: { direction: "up" } },
      },
    });

    const rect = parent.getChildByLabel("rect-scroll-native");
    rect.emit("pointerover");
    nativeListeners.get("wheel")?.({
      deltaY: -10,
      preventDefault: vi.fn(),
    });
    rect.emit("pointerout");
    nativeListeners.get("wheel")?.({
      deltaY: -10,
      preventDefault: vi.fn(),
    });

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "scrollUp",
    ]);
    expect(eventHandler.mock.calls[0][1]).toMatchObject({
      _event: { id: "rect-scroll-native" },
      direction: "up",
    });
  });

  it("rect drag emits dragStart/dragMove/dragEnd with pointer payload", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addRect({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "rect-drag",
        type: "rect",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        alpha: 1,
        fill: "#FFFFFF",
        drag: {
          start: { payload: { step: "start" } },
          move: { payload: { step: "move" } },
          end: { payload: { step: "end" } },
        },
      },
    });

    const rect = parent.getChildByLabel("rect-drag");
    rect.emit("pointerdown");
    rect.emit("globalpointermove", { global: { x: 320, y: 240 } });
    rect.emit("pointerup");

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "dragStart",
      "dragMove",
      "dragEnd",
    ]);
    expect(eventHandler.mock.calls[1][1]).toMatchObject({
      _event: { id: "rect-drag", x: 320, y: 240 },
      step: "move",
    });
  });

  it("sprite emits hover/click/rightClick/scroll payload events", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addSprite({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "sprite-1",
        type: "sprite",
        x: 50,
        y: 50,
        width: 120,
        height: 120,
        alpha: 1,
        hover: {
          soundSrc: "sprite-hover.mp3",
          soundVolume: 40,
          payload: { source: "hover" },
        },
        click: { payload: { source: "click" } },
        rightClick: { payload: { source: "rightClick" } },
        scrollUp: { payload: { direction: "up" } },
        scrollDown: { payload: { direction: "down" } },
      },
    });

    const sprite = parent.getChildByLabel("sprite-1");
    sprite.emit("pointerover");
    sprite.emit("pointerdown");
    sprite.emit("pointerup");
    sprite.emit("rightdown");
    sprite.emit("rightup");
    sprite.emit("rightclick");
    sprite.emit("wheel", { deltaY: -1 });
    sprite.emit("wheel", { deltaY: 1 });

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "hover",
      "click",
      "rightClick",
      "scrollUp",
      "scrollDown",
    ]);
    expect(eventHandler.mock.calls[2][1]).toMatchObject({
      _event: { id: "sprite-1" },
      source: "rightClick",
    });
    expect(eventHandler.mock.calls[3][1]).toMatchObject({
      _event: { id: "sprite-1" },
      direction: "up",
    });
    expect(eventHandler.mock.calls[4][1]).toMatchObject({
      _event: { id: "sprite-1" },
      direction: "down",
    });
    expect(shared.app.audioStage.add).toHaveBeenCalledWith({
      id: expect.stringMatching(/^hover-/),
      url: "sprite-hover.mp3",
      loop: false,
      volume: 0.4,
    });
  });

  it("sprite click does not fire for right mouse press/release", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addSprite({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "sprite-right-only",
        type: "sprite",
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        alpha: 1,
        click: { payload: { source: "click" } },
        rightClick: { payload: { source: "rightClick" } },
      },
    });

    const sprite = parent.getChildByLabel("sprite-right-only");
    sprite.emit("pointerdown", createPointerEvent(2));
    sprite.emit("pointerup", createPointerEvent(2));
    sprite.emit("rightdown");
    sprite.emit("rightup");
    sprite.emit("rightclick");

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "rightClick",
    ]);
  });

  it("scroll events emit element metadata without requiring app payload", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addSprite({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "sprite-scroll-empty-payload",
        type: "sprite",
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        alpha: 1,
        scrollUp: {},
      },
    });

    const sprite = parent.getChildByLabel("sprite-scroll-empty-payload");
    sprite.emit("wheel", { deltaY: -1 });

    expect(eventHandler.mock.calls).toEqual([
      [
        "scrollUp",
        {
          _event: { id: "sprite-scroll-empty-payload" },
        },
      ],
    ]);
  });

  it("text emits hover/click/rightClick/scroll payload events", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addText({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "text-1",
        type: "text",
        x: 20,
        y: 30,
        width: 200,
        alpha: 1,
        content: "sample",
        textStyle: {
          fontSize: 20,
          fill: "#FFFFFF",
          fontFamily: "Arial",
        },
        hover: {
          soundSrc: "text-hover.mp3",
          soundVolume: 55,
          payload: { source: "hover" },
        },
        click: { payload: { source: "click" } },
        rightClick: { payload: { source: "rightClick" } },
        scrollUp: { payload: { direction: "up" } },
        scrollDown: { payload: { direction: "down" } },
      },
    });

    const text = parent.getChildByLabel("text-1");
    text.emit("pointerover");
    text.emit("pointerdown");
    text.emit("pointerup");
    text.emit("rightdown");
    text.emit("rightup");
    text.emit("rightclick");
    text.emit("wheel", { deltaY: -1 });
    text.emit("wheel", { deltaY: 1 });

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "hover",
      "click",
      "rightClick",
      "scrollUp",
      "scrollDown",
    ]);
    expect(eventHandler.mock.calls[0][1]).toMatchObject({
      _event: { id: "text-1" },
      source: "hover",
    });
    expect(eventHandler.mock.calls[3][1]).toMatchObject({
      _event: { id: "text-1" },
      direction: "up",
    });
    expect(eventHandler.mock.calls[4][1]).toMatchObject({
      _event: { id: "text-1" },
      direction: "down",
    });
    expect(shared.app.audioStage.add).toHaveBeenCalledWith({
      id: expect.stringMatching(/^hover-/),
      url: "text-hover.mp3",
      loop: false,
      volume: 0.55,
    });
  });

  it("text click does not fire for right mouse press/release", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addText({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "text-right-only",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        alpha: 1,
        content: "sample",
        textStyle: {
          fontSize: 20,
          fill: "#FFFFFF",
          fontFamily: "Arial",
        },
        click: { payload: { source: "click" } },
        rightClick: { payload: { source: "rightClick" } },
      },
    });

    const text = parent.getChildByLabel("text-right-only");
    text.emit("pointerdown", createPointerEvent(2));
    text.emit("pointerup", createPointerEvent(2));
    text.emit("rightdown");
    text.emit("rightup");
    text.emit("rightclick");

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "rightClick",
    ]);
  });

  it("container emits hover/click/rightClick/scroll payload events", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addContainer({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      elementPlugins: [],
      signal: new AbortController().signal,
      element: {
        id: "container-1",
        type: "container",
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        alpha: 1,
        children: [],
        hover: {
          soundSrc: "container-hover.mp3",
          soundVolume: 70,
          payload: { source: "hover" },
        },
        click: { payload: { source: "click" } },
        rightClick: { payload: { source: "rightClick" } },
        scrollUp: { payload: { direction: "up" } },
        scrollDown: { payload: { direction: "down" } },
      },
    });

    const container = parent.getChildByLabel("container-1");
    container.emit("pointerover");
    container.emit("pointerup");
    container.emit("rightclick");
    container.emit("wheel", { deltaY: -1 });
    container.emit("wheel", { deltaY: 1 });

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "hover",
      "click",
      "rightClick",
      "scrollUp",
      "scrollDown",
    ]);
    expect(eventHandler.mock.calls[3][1]).toMatchObject({
      _event: { id: "container-1" },
      direction: "up",
    });
    expect(eventHandler.mock.calls[4][1]).toMatchObject({
      _event: { id: "container-1" },
      direction: "down",
    });
    expect(shared.app.audioStage.add).toHaveBeenCalledWith({
      id: expect.stringMatching(/^hover-/),
      url: "container-hover.mp3",
      loop: false,
      volume: 0.7,
    });
  });

  it("container click does not fire for right mouse release", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addContainer({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      elementPlugins: [],
      signal: new AbortController().signal,
      element: {
        id: "container-right-only",
        type: "container",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        alpha: 1,
        children: [],
        click: { payload: { source: "click" } },
        rightClick: { payload: { source: "rightClick" } },
      },
    });

    const container = parent.getChildByLabel("container-right-only");
    container.emit("pointerup", createPointerEvent(2));
    container.emit("rightclick");

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "rightClick",
    ]);
  });

  it("slider emits change payload with id and value", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();

    addSlider({
      ...shared,
      parent,
      eventHandler,
      zIndex: 0,
      element: {
        id: "slider-1",
        type: "slider",
        x: 100,
        y: 100,
        width: 200,
        height: 20,
        alpha: 1,
        direction: "horizontal",
        min: 0,
        max: 100,
        step: 1,
        initialValue: 0,
        hover: {
          soundSrc: "slider-hover.mp3",
          soundVolume: 85,
        },
        change: {
          payload: { source: "drag" },
        },
      },
    });

    const slider = parent.getChildByLabel("slider-1");
    slider.emit("pointerover");
    slider.emit("pointerdown", { global: { x: 280, y: 110 } });
    slider.emit("globalpointermove", { global: { x: 290, y: 110 } });
    slider.emit("pointerup");

    expect(eventHandler).toHaveBeenCalled();
    expect(eventHandler.mock.calls[0][0]).toBe("change");
    expect(eventHandler.mock.calls[0][1]).toMatchObject({
      _event: {
        id: "slider-1",
      },
      source: "drag",
    });
    expect(eventHandler.mock.calls[0][1]._event.value).toBeTypeOf("number");
    expect(shared.app.audioStage.add).toHaveBeenCalledWith({
      id: expect.stringMatching(/^hover-/),
      url: "slider-hover.mp3",
      loop: false,
      volume: 0.85,
    });
  });

  it("keyboard manager emits keydown and keyup payloads for registered keys", () => {
    const eventHandler = vi.fn();
    const keyboardManager = createKeyboardManager(eventHandler);

    keyboardManager.registerHotkeys({
      a: { keydown: { payload: { source: "A" } } },
      b: { keyup: { payload: { source: "B" } } },
      "shift+c": {
        keydown: { payload: { source: "ShiftCDown" } },
        keyup: { payload: { source: "ShiftCUp" } },
      },
    });

    hotkeys.trigger("a");
    dispatchKeyboardEvent("keydown", "b");
    dispatchKeyboardEvent("keyup", "b");
    hotkeys.trigger("shift+c");
    dispatchKeyboardEvent("keyup", "c", { code: "KeyC" });

    expect(eventHandler.mock.calls.map((call) => call[0])).toEqual([
      "keydown",
      "keyup",
      "keydown",
      "keyup",
    ]);
    expect(eventHandler.mock.calls[0][1]).toMatchObject({
      _event: { key: "a" },
      source: "A",
    });
    expect(eventHandler.mock.calls[1][1]).toMatchObject({
      _event: { key: "b" },
      source: "B",
    });
    expect(eventHandler.mock.calls[2][1]).toMatchObject({
      _event: { key: "shift+c" },
      source: "ShiftCDown",
    });
    expect(eventHandler.mock.calls[3][1]).toMatchObject({
      _event: { key: "shift+c" },
      source: "ShiftCUp",
    });

    keyboardManager.destroy();
  });

  it("keyboard manager emits keydown and keyup for real modifier-only bindings", () => {
    const eventHandler = vi.fn();
    const keyboardManager = createKeyboardManager(eventHandler);

    keyboardManager.registerHotkeys({
      shift: {
        keydown: { payload: { source: "ShiftDown" } },
        keyup: { payload: { source: "ShiftUp" } },
      },
    });

    dispatchKeyboardEvent("keydown", "Shift", { code: "ShiftLeft" });
    dispatchKeyboardEvent("keyup", "Shift", { code: "ShiftLeft" });

    expect(eventHandler.mock.calls).toEqual([
      [
        "keydown",
        {
          _event: { key: "shift" },
          source: "ShiftDown",
        },
      ],
      [
        "keyup",
        {
          _event: { key: "shift" },
          source: "ShiftUp",
        },
      ],
    ]);

    keyboardManager.destroy();
  });

  it("keyboard manager emits combo keyup even when the modifier is released first", () => {
    const eventHandler = vi.fn();
    const keyboardManager = createKeyboardManager(eventHandler);

    keyboardManager.registerHotkeys({
      "shift+c": {
        keyup: { payload: { source: "ShiftCUp" } },
      },
    });

    hotkeys.trigger("shift+c");
    dispatchKeyboardEvent("keyup", "Shift", { code: "ShiftLeft" });
    dispatchKeyboardEvent("keyup", "c", { code: "KeyC" });

    expect(eventHandler.mock.calls).toEqual([
      [
        "keyup",
        {
          _event: { key: "shift+c" },
          source: "ShiftCUp",
        },
      ],
    ]);

    keyboardManager.destroy();
  });

  it("keyboard manager matches keyup to the activated shortcut in comma-separated bindings", () => {
    const eventHandler = vi.fn();
    const keyboardManager = createKeyboardManager(eventHandler);

    keyboardManager.registerHotkeys({
      "a,b": {
        keyup: { payload: { source: "AlternateUp" } },
      },
    });

    hotkeys.trigger("a");
    dispatchKeyboardEvent("keyup", "b", { code: "KeyB" });

    expect(eventHandler).not.toHaveBeenCalled();

    dispatchKeyboardEvent("keyup", "a", { code: "KeyA" });

    expect(eventHandler.mock.calls).toEqual([
      [
        "keyup",
        {
          _event: { key: "a,b" },
          source: "AlternateUp",
        },
      ],
    ]);

    keyboardManager.destroy();
  });

  it("keyboard manager resolves numpad keyup from keyCode before key", () => {
    const eventHandler = vi.fn();
    const keyboardManager = createKeyboardManager(eventHandler);

    keyboardManager.registerHotkeys({
      num_0: {
        keyup: { payload: { source: "Numpad0Up" } },
      },
    });

    hotkeys.trigger("num_0");
    dispatchKeyboardEvent("keyup", "0", {
      code: "Numpad0",
      keyCode: 96,
      which: 96,
    });

    expect(eventHandler.mock.calls).toEqual([
      [
        "keyup",
        {
          _event: { key: "num_0" },
          source: "Numpad0Up",
        },
      ],
    ]);

    keyboardManager.destroy();
  });

  it("keyboard manager ignores key events from editable targets", () => {
    const eventHandler = vi.fn();
    const keyboardManager = createKeyboardManager(eventHandler);
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(input, editable);

    keyboardManager.registerHotkeys({
      space: {
        keydown: { payload: { source: "SpaceDown" } },
        keyup: { payload: { source: "SpaceUp" } },
      },
      enter: {
        keydown: { payload: { source: "EnterDown" } },
        keyup: { payload: { source: "EnterUp" } },
      },
      shift: {
        keydown: { payload: { source: "ShiftDown" } },
        keyup: { payload: { source: "ShiftUp" } },
      },
    });

    dispatchKeyboardEvent("keydown", " ", {
      target: input,
      code: "Space",
      keyCode: 32,
      which: 32,
    });
    dispatchKeyboardEvent("keyup", " ", {
      target: input,
      code: "Space",
      keyCode: 32,
      which: 32,
    });
    dispatchKeyboardEvent("keydown", "Shift", {
      target: input,
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });
    dispatchKeyboardEvent("keyup", "Shift", {
      target: input,
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });
    dispatchKeyboardEvent("keydown", "Shift", {
      target: editable,
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });
    dispatchKeyboardEvent("keyup", "Shift", {
      target: editable,
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });

    expect(eventHandler).not.toHaveBeenCalled();

    input.remove();
    editable.remove();
    keyboardManager.destroy();
  });

  it("keyboard manager ignores document-level shortcuts while an editable element is focused", () => {
    const eventHandler = vi.fn();
    const keyboardManager = createKeyboardManager(eventHandler);
    const input = document.createElement("input");
    document.body.appendChild(input);

    keyboardManager.registerHotkeys({
      space: {
        keydown: { payload: { source: "SpaceDown" } },
        keyup: { payload: { source: "SpaceUp" } },
      },
      enter: {
        keydown: { payload: { source: "EnterDown" } },
        keyup: { payload: { source: "EnterUp" } },
      },
    });

    input.focus();

    dispatchKeyboardEvent("keydown", " ", {
      code: "Space",
      keyCode: 32,
      which: 32,
    });
    dispatchKeyboardEvent("keyup", " ", {
      code: "Space",
      keyCode: 32,
      which: 32,
    });
    dispatchKeyboardEvent("keydown", "Enter", {
      code: "Enter",
      keyCode: 13,
      which: 13,
    });
    dispatchKeyboardEvent("keyup", "Enter", {
      code: "Enter",
      keyCode: 13,
      which: 13,
    });
    hotkeys.trigger("space");
    hotkeys.trigger("enter");

    expect(eventHandler).not.toHaveBeenCalled();

    input.blur();

    dispatchKeyboardEvent("keydown", " ", {
      code: "Space",
      keyCode: 32,
      which: 32,
    });
    dispatchKeyboardEvent("keyup", " ", {
      code: "Space",
      keyCode: 32,
      which: 32,
    });
    dispatchKeyboardEvent("keydown", "Enter", {
      code: "Enter",
      keyCode: 13,
      which: 13,
    });
    dispatchKeyboardEvent("keyup", "Enter", {
      code: "Enter",
      keyCode: 13,
      which: 13,
    });

    expect(eventHandler.mock.calls).toEqual([
      [
        "keydown",
        {
          _event: { key: "space" },
          source: "SpaceDown",
        },
      ],
      [
        "keyup",
        {
          _event: { key: "space" },
          source: "SpaceUp",
        },
      ],
      [
        "keydown",
        {
          _event: { key: "enter" },
          source: "EnterDown",
        },
      ],
      [
        "keyup",
        {
          _event: { key: "enter" },
          source: "EnterUp",
        },
      ],
    ]);

    input.remove();
    keyboardManager.destroy();
  });

  it("keyboard manager drops active keyup bindings when release moves into an input", () => {
    const eventHandler = vi.fn();
    const keyboardManager = createKeyboardManager(eventHandler);
    const input = document.createElement("input");
    document.body.appendChild(input);

    keyboardManager.registerHotkeys({
      shift: {
        keydown: { payload: { source: "ShiftDown" } },
        keyup: { payload: { source: "ShiftUp" } },
      },
    });

    dispatchKeyboardEvent("keydown", "Shift", {
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });
    dispatchKeyboardEvent("keyup", "Shift", {
      target: input,
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });
    dispatchKeyboardEvent("keyup", "Shift", {
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });
    dispatchKeyboardEvent("keydown", "Shift", {
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });
    dispatchKeyboardEvent("keyup", "Shift", {
      code: "ShiftLeft",
      keyCode: 16,
      which: 16,
    });

    expect(eventHandler.mock.calls).toEqual([
      [
        "keydown",
        {
          _event: { key: "shift" },
          source: "ShiftDown",
        },
      ],
      [
        "keydown",
        {
          _event: { key: "shift" },
          source: "ShiftDown",
        },
      ],
      [
        "keyup",
        {
          _event: { key: "shift" },
          source: "ShiftUp",
        },
      ],
    ]);

    input.remove();
    keyboardManager.destroy();
  });
});
