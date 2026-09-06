import { Cache, Container, Rectangle, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { addContainer } from "../../src/plugins/elements/container/addContainer.js";
import { updateContainer } from "../../src/plugins/elements/container/updateContainer.js";
import { containerPlugin } from "../../src/plugins/elements/container/index.js";
import { parseContainerForTesting } from "../support/parseContainer.js";
import { sliderPlugin } from "../../src/plugins/elements/slider/index.js";
import { getSliderParts } from "../../src/plugins/elements/slider/sliderRuntime.js";
import { spritePlugin } from "../../src/plugins/elements/sprite/index.js";
import { textPlugin } from "../../src/plugins/elements/text/index.js";

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
  signal: new AbortController().signal,
});

const elementPlugins = [
  containerPlugin,
  textPlugin,
  spritePlugin,
  sliderPlugin,
];

const parseContainerState = (state) => parseContainerForTesting({ state });
const createPrimaryPointerEvent = (overrides = {}) => ({
  button: 0,
  ...overrides,
});

let textureIndex = 0;

const createTextureId = (prefix) => {
  textureIndex += 1;
  const id = `${prefix}-${textureIndex}`;
  const texture = new Texture({
    source: Texture.WHITE.source,
    label: id,
  });

  Cache.set(id, texture);

  return id;
};

describe("container hover inheritance", () => {
  it("applies hover visuals from real container entry and ignores internal target changes", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();
    const outside = new Container();
    const spriteIdleSrc = createTextureId("icon-idle");
    const spriteHoverSrc = createTextureId("icon-hover");
    const element = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 360,
      height: 120,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "icon",
          type: "sprite",
          x: 0,
          y: 0,
          width: 32,
          height: 32,
          src: spriteIdleSrc,
          hover: {
            src: spriteHoverSrc,
            payload: { source: "child-hover" },
          },
        },
        {
          id: "nested",
          type: "container",
          x: 60,
          y: 0,
          children: [
            {
              id: "label",
              type: "text",
              x: 0,
              y: 0,
              content: "Nested",
              textStyle: {
                fontSize: 24,
                fontFamily: "Arial",
                fill: "#A6A6A6",
              },
              hover: {
                textStyle: {
                  fill: "#FFFFFF",
                },
              },
            },
          ],
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element,
      eventHandler,
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("menu");
    const sprite = container.getChildByLabel("icon");
    const nested = container.getChildByLabel("nested");
    const text = nested.getChildByLabel("label");

    expect(container.hitArea).toBeInstanceOf(Rectangle);
    expect(container.hitArea.width).toBe(360);
    expect(container.hitArea.height).toBe(120);
    expect(text.style.fill).toBe("#A6A6A6");
    expect(sprite.texture).toBe(Texture.from(spriteIdleSrc));

    container.emit("pointerover", { relatedTarget: null });

    expect(text.style.fill).toBe("#FFFFFF");
    expect(sprite.texture).toBe(Texture.from(spriteHoverSrc));
    expect(eventHandler).not.toHaveBeenCalled();

    container.emit("pointerout", { relatedTarget: sprite });

    expect(text.style.fill).toBe("#FFFFFF");
    expect(sprite.texture).toBe(Texture.from(spriteHoverSrc));

    sprite.emit("pointerover");

    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler).toHaveBeenCalledWith(
      "hover",
      expect.objectContaining({
        _event: { id: "icon" },
        source: "child-hover",
      }),
    );

    sprite.emit("pointerout");
    expect(sprite.texture).toBe(Texture.from(spriteHoverSrc));

    container.emit("pointerout", { relatedTarget: outside });

    expect(text.style.fill).toBe("#A6A6A6");
    expect(sprite.texture).toBe(Texture.from(spriteIdleSrc));
  });

  it("applies inherited hover visuals to slider descendants", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const idleBarSrc = createTextureId("bar-idle");
    const hoverBarSrc = createTextureId("bar-hover");
    const idleThumbSrc = createTextureId("thumb-idle");
    const hoverThumbSrc = createTextureId("thumb-hover");
    const element = parseContainerState({
      id: "controls",
      type: "container",
      x: 0,
      y: 0,
      width: 260,
      height: 80,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "volume",
          type: "slider",
          x: 0,
          y: 0,
          width: 180,
          height: 20,
          direction: "horizontal",
          min: 0,
          max: 100,
          step: 1,
          initialValue: 50,
          barSrc: idleBarSrc,
          thumbSrc: idleThumbSrc,
          hover: {
            barSrc: hoverBarSrc,
            thumbSrc: hoverThumbSrc,
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("controls");
    const slider = container.getChildByLabel("volume");
    const { bar, thumb } = getSliderParts({
      sliderContainer: slider,
      id: "volume",
    });

    expect(bar.texture).toBe(Texture.from(idleBarSrc));
    expect(thumb.texture).toBe(Texture.from(idleThumbSrc));

    container.emit("pointerover", { relatedTarget: null });

    expect(bar.texture).toBe(Texture.from(hoverBarSrc));
    expect(thumb.texture).toBe(Texture.from(hoverThumbSrc));

    container.emit("pointerout", { relatedTarget: null });

    expect(bar.texture).toBe(Texture.from(idleBarSrc));
    expect(thumb.texture).toBe(Texture.from(idleThumbSrc));
  });

  it("reapplies inherited hover to children added while the container is already hovered", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();
    const prevElement = parseContainerState({
      id: "chat",
      type: "container",
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "message-1",
          type: "text",
          x: 0,
          y: 0,
          content: "Hello",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          hover: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element: prevElement,
      eventHandler,
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("chat");
    container.emit("pointerover", { relatedTarget: null });

    const nextElement = parseContainerState({
      id: "chat",
      type: "container",
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "message-1",
          type: "text",
          x: 0,
          y: 0,
          content: "Hello",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          hover: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
        {
          id: "message-2",
          type: "text",
          x: 0,
          y: 30,
          content: "World",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          hover: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    updateContainer({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler,
      elementPlugins,
      zIndex: 0,
    });

    const nextMessage = container.getChildByLabel("message-2");

    expect(nextMessage.style.fill).toBe("#FFFFFF");
  });

  it("keeps outer inherited hover active when a nested inherited container is exited", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const outside = new Container();
    const element = parseContainerState({
      id: "outer",
      type: "container",
      x: 0,
      y: 0,
      width: 320,
      height: 160,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "inner",
          type: "container",
          x: 40,
          y: 20,
          width: 200,
          height: 100,
          hover: {
            inheritToChildren: true,
          },
          children: [
            {
              id: "label",
              type: "text",
              x: 0,
              y: 0,
              content: "Nested",
              textStyle: {
                fontSize: 24,
                fontFamily: "Arial",
                fill: "#A6A6A6",
              },
              hover: {
                textStyle: {
                  fill: "#FFFFFF",
                },
              },
            },
          ],
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const outer = parent.getChildByLabel("outer");
    const inner = outer.getChildByLabel("inner");
    const text = inner.getChildByLabel("label");

    outer.emit("pointerover", { relatedTarget: null });
    inner.emit("pointerover", { relatedTarget: null });
    inner.emit("pointerout", { relatedTarget: outer });

    expect(text.style.fill).toBe("#FFFFFF");

    outer.emit("pointerout", { relatedTarget: outside });

    expect(text.style.fill).toBe("#A6A6A6");
  });

  it("clears inherited hover state when the feature is removed during update", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const prevElement = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "label",
          type: "text",
          x: 0,
          y: 0,
          content: "Settings",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          hover: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element: prevElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("menu");
    const text = container.getChildByLabel("label");
    container.emit("pointerover", { relatedTarget: null });

    expect(text.style.fill).toBe("#FFFFFF");

    const nextElement = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      children: [
        {
          id: "label",
          type: "text",
          x: 0,
          y: 0,
          content: "Settings",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          hover: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    updateContainer({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    expect(text.style.fill).toBe("#A6A6A6");
    expect(container.hitArea).toBeNull();
    expect(container.eventMode).toBe("auto");
  });

  it("uses a fallback hit area for non-overflowing scroll containers on initial render", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseContainerState({
      id: "scrolling-menu",
      type: "container",
      x: 0,
      y: 0,
      width: 280,
      height: 120,
      scroll: true,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "label",
          type: "text",
          x: 20,
          y: 20,
          content: "Fits",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          hover: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("scrolling-menu");
    const text = container.getChildByLabel("label");

    expect(container.hitArea).toBeInstanceOf(Rectangle);
    expect(container.hitArea.width).toBe(280);
    expect(container.hitArea.height).toBe(120);

    container.emit("pointerover", { relatedTarget: null });

    expect(text.style.fill).toBe("#FFFFFF");
  });

  it("keeps scroll containers interactive after content shrinks below overflow on update", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const prevElement = parseContainerState({
      id: "scrolling-menu",
      type: "container",
      x: 0,
      y: 0,
      width: 180,
      height: 80,
      scroll: true,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "label",
          type: "text",
          x: 0,
          y: 0,
          content: "This is intentionally long enough to overflow",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          hover: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element: prevElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const nextElement = parseContainerState({
      id: "scrolling-menu",
      type: "container",
      x: 0,
      y: 0,
      width: 180,
      height: 80,
      scroll: true,
      hover: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "label",
          type: "text",
          x: 0,
          y: 0,
          content: "Fits",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          hover: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    updateContainer({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("scrolling-menu");
    const text = container.getChildByLabel("label");

    expect(container.hitArea).toBeInstanceOf(Rectangle);
    expect(container.hitArea.width).toBe(180);
    expect(container.hitArea.height).toBe(80);

    container.emit("pointerover", { relatedTarget: null });

    expect(text.style.fill).toBe("#FFFFFF");
  });

  it("applies click visuals to descendants without firing child click payloads", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();
    const spriteIdleSrc = createTextureId("click-icon-idle");
    const spritePressedSrc = createTextureId("click-icon-pressed");
    const element = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 360,
      height: 140,
      click: {
        inheritToChildren: true,
        payload: { source: "container-click" },
      },
      children: [
        {
          id: "icon",
          type: "sprite",
          x: 0,
          y: 0,
          width: 32,
          height: 32,
          src: spriteIdleSrc,
          click: {
            src: spritePressedSrc,
            payload: { source: "child-click" },
          },
        },
        {
          id: "label",
          type: "text",
          x: 60,
          y: 0,
          content: "Press me",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          click: {
            textStyle: {
              fill: "#FFFFFF",
            },
            payload: { source: "child-click-text" },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element,
      eventHandler,
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("menu");
    const sprite = container.getChildByLabel("icon");
    const text = container.getChildByLabel("label");

    expect(sprite.texture).toBe(Texture.from(spriteIdleSrc));
    expect(text.style.fill).toBe("#A6A6A6");

    container.emit("pointerdown", createPrimaryPointerEvent());

    expect(sprite.texture).toBe(Texture.from(spritePressedSrc));
    expect(text.style.fill).toBe("#FFFFFF");
    expect(eventHandler).not.toHaveBeenCalled();

    container.emit("pointerupoutside", createPrimaryPointerEvent());

    expect(sprite.texture).toBe(Texture.from(spriteIdleSrc));
    expect(text.style.fill).toBe("#A6A6A6");

    container.emit("pointerdown", createPrimaryPointerEvent());
    container.emit("pointerup", createPrimaryPointerEvent());

    expect(sprite.texture).toBe(Texture.from(spriteIdleSrc));
    expect(text.style.fill).toBe("#A6A6A6");
    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler).toHaveBeenCalledWith(
      "click",
      expect.objectContaining({
        _event: { id: "menu" },
        source: "container-click",
      }),
    );
  });

  it("reapplies inherited click to children added while the container is already pressed", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const prevElement = parseContainerState({
      id: "chat",
      type: "container",
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      click: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "message-1",
          type: "text",
          x: 0,
          y: 0,
          content: "Hello",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          click: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element: prevElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("chat");
    container.emit("pointerdown", createPrimaryPointerEvent());

    const nextElement = parseContainerState({
      id: "chat",
      type: "container",
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      click: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "message-1",
          type: "text",
          x: 0,
          y: 0,
          content: "Hello",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          click: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
        {
          id: "message-2",
          type: "text",
          x: 0,
          y: 30,
          content: "World",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          click: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    updateContainer({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const nextMessage = container.getChildByLabel("message-2");

    expect(nextMessage.style.fill).toBe("#FFFFFF");
  });

  it("clears inherited click state when the feature is removed during update", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const prevElement = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      click: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "label",
          type: "text",
          x: 0,
          y: 0,
          content: "Settings",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          click: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element: prevElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("menu");
    const text = container.getChildByLabel("label");
    container.emit("pointerdown", createPrimaryPointerEvent());

    expect(text.style.fill).toBe("#FFFFFF");

    const nextElement = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      children: [
        {
          id: "label",
          type: "text",
          x: 0,
          y: 0,
          content: "Settings",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          click: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    updateContainer({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    expect(text.style.fill).toBe("#A6A6A6");
  });

  it("applies right-click visuals to descendants without firing child rightClick payloads", () => {
    const parent = new Container();
    const eventHandler = vi.fn();
    const shared = createSharedParams();
    const spriteIdleSrc = createTextureId("right-click-icon-idle");
    const spritePressedSrc = createTextureId("right-click-icon-pressed");
    const element = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 360,
      height: 140,
      rightClick: {
        inheritToChildren: true,
        payload: { source: "container-right-click" },
      },
      children: [
        {
          id: "icon",
          type: "sprite",
          x: 0,
          y: 0,
          width: 32,
          height: 32,
          src: spriteIdleSrc,
          rightClick: {
            src: spritePressedSrc,
            payload: { source: "child-right-click" },
          },
        },
        {
          id: "label",
          type: "text",
          x: 60,
          y: 0,
          content: "Press me",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          rightClick: {
            textStyle: {
              fill: "#FFFFFF",
            },
            payload: { source: "child-right-click-text" },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element,
      eventHandler,
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("menu");
    const sprite = container.getChildByLabel("icon");
    const text = container.getChildByLabel("label");

    expect(sprite.texture).toBe(Texture.from(spriteIdleSrc));
    expect(text.style.fill).toBe("#A6A6A6");

    container.emit("rightdown");

    expect(sprite.texture).toBe(Texture.from(spritePressedSrc));
    expect(text.style.fill).toBe("#FFFFFF");
    expect(eventHandler).not.toHaveBeenCalled();

    container.emit("pointerup", { button: 2 });

    expect(sprite.texture).toBe(Texture.from(spriteIdleSrc));
    expect(text.style.fill).toBe("#A6A6A6");

    container.emit("rightdown");
    container.emit("rightup");
    container.emit("rightclick");

    expect(sprite.texture).toBe(Texture.from(spriteIdleSrc));
    expect(text.style.fill).toBe("#A6A6A6");
    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(eventHandler).toHaveBeenCalledWith(
      "rightClick",
      expect.objectContaining({
        _event: { id: "menu" },
        source: "container-right-click",
      }),
    );
  });

  it("reapplies inherited right-click to children added while the container is already right-pressed", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const prevElement = parseContainerState({
      id: "chat",
      type: "container",
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      rightClick: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "message-1",
          type: "text",
          x: 0,
          y: 0,
          content: "Hello",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          rightClick: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element: prevElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("chat");
    container.emit("rightdown");

    const nextElement = parseContainerState({
      id: "chat",
      type: "container",
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      rightClick: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "message-1",
          type: "text",
          x: 0,
          y: 0,
          content: "Hello",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          rightClick: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
        {
          id: "message-2",
          type: "text",
          x: 0,
          y: 30,
          content: "World",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          rightClick: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    updateContainer({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const nextMessage = container.getChildByLabel("message-2");

    expect(nextMessage.style.fill).toBe("#FFFFFF");
  });

  it("clears inherited right-click state when the feature is removed during update", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const prevElement = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      rightClick: {
        inheritToChildren: true,
      },
      children: [
        {
          id: "label",
          type: "text",
          x: 0,
          y: 0,
          content: "Settings",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          rightClick: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    addContainer({
      ...shared,
      parent,
      element: prevElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    const container = parent.getChildByLabel("menu");
    const text = container.getChildByLabel("label");
    container.emit("rightdown");

    expect(text.style.fill).toBe("#FFFFFF");

    const nextElement = parseContainerState({
      id: "menu",
      type: "container",
      x: 0,
      y: 0,
      width: 240,
      height: 100,
      children: [
        {
          id: "label",
          type: "text",
          x: 0,
          y: 0,
          content: "Settings",
          textStyle: {
            fontSize: 24,
            fontFamily: "Arial",
            fill: "#A6A6A6",
          },
          rightClick: {
            textStyle: {
              fill: "#FFFFFF",
            },
          },
        },
      ],
    });

    updateContainer({
      ...shared,
      parent,
      prevElement,
      nextElement,
      eventHandler: vi.fn(),
      elementPlugins,
      zIndex: 0,
    });

    expect(text.style.fill).toBe("#A6A6A6");
  });
});
