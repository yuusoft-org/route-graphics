import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { addText } from "../../src/plugins/elements/text/addText.js";
import { parseText } from "../../src/plugins/elements/text/parseText.js";
import { updateText } from "../../src/plugins/elements/text/updateText.js";
import { hitTestElementBounds } from "../../src/util/hitTestElementBounds.js";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";

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
  eventHandler: vi.fn(),
});

describe("text rich content", () => {
  it("applies degree rotation around an explicit rich-text origin", () => {
    const parent = new Container();
    const element = parseText({
      state: {
        id: "rotated-rich-text",
        type: "text",
        x: 40,
        y: 60,
        originX: 14,
        originY: 9,
        rotation: -45,
        content: [{ text: "Rich" }, { text: " rotation" }],
      },
    });

    addText({
      ...createSharedParams(),
      parent,
      element,
      zIndex: 0,
    });

    const text = parent.getChildByLabel("rotated-rich-text");

    expect(text.x).toBe(54);
    expect(text.y).toBe(69);
    expect(text.pivot.x).toBe(14);
    expect(text.pivot.y).toBe(9);
    expect(text.rotation).toBeCloseTo(-Math.PI / 4);
  });

  it("renders array content as styled text segment objects", () => {
    const parent = new Container();
    const element = parseText({
      state: {
        id: "rich-text",
        type: "text",
        x: 20,
        y: 30,
        width: 260,
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
        },
        content: [
          { text: "HP" },
          {
            text: "42",
            textStyle: {
              fill: "#D9D9D9",
              fontWeight: "bold",
            },
          },
        ],
      },
    });

    addText({
      ...createSharedParams(),
      parent,
      element,
      zIndex: 0,
    });

    const text = parent.getChildByLabel("rich-text");
    const line = text.children[0];

    expect(text.children).toHaveLength(1);
    expect(line.children).toHaveLength(2);
    expect(line.children[0].text).toBe("HP");
    expect(line.children[0].style.fill).toBe("#FFFFFF");
    expect(line.children[1].text).toBe("42");
    expect(line.children[1].style.fill).toBe("#D9D9D9");
    expect(line.children[1].style.fontWeight).toBe("bold");
  });

  it("keeps parsed rich-text line height stable for ratio-based hover styles", () => {
    const parent = new Container();
    const element = parseText({
      state: {
        id: "rich-text-hover",
        type: "text",
        x: 240,
        y: 120,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 1,
        content: [{ text: "Menu item" }],
        textStyle: {
          fontSize: 36,
          fontFamily: "Arial",
          fontWeight: "700",
          lineHeight: 1.5,
          fill: "#FFFFFF",
        },
        hover: {
          textStyle: {
            fontSize: 36,
            fontFamily: "Arial",
            fontWeight: "400",
            lineHeight: 1.5,
            fill: "#D9D9D9",
          },
        },
      },
    });

    addText({
      ...createSharedParams(),
      parent,
      element,
      zIndex: 0,
    });

    const text = parent.getChildByLabel("rich-text-hover");
    const getTextPart = () => text.children[0].children[0];
    const initialY = text.y;

    expect(getTextPart().style.lineHeight).toBe(54);

    text.emit("pointerover");

    expect(getTextPart().style.fontWeight).toBe("400");
    expect(getTextPart().style.lineHeight).toBe(54);
    expect(text.y).toBe(initialY);

    text.emit("pointerout");

    expect(getTextPart().style.fontWeight).toBe("700");
    expect(getTextPart().style.lineHeight).toBe(54);
    expect(text.y).toBe(initialY);
  });

  it("preserves a live tweened transform during rich-text style changes", () => {
    const parent = new Container();
    const element = parseText({
      state: {
        id: "rich-text-live-transform",
        type: "text",
        x: 240,
        y: 120,
        rotation: 15,
        alpha: 0.8,
        content: [{ text: "Tweening" }],
        hover: {
          textStyle: {
            fontSize: 48,
          },
        },
      },
    });

    addText({
      ...createSharedParams(),
      parent,
      element,
      zIndex: 0,
    });

    const text = parent.getChildByLabel("rich-text-live-transform");
    text.x = 333;
    text.y = 222;
    text.rotation = 1.25;
    text.alpha = 0.4;

    text.emit("pointerover");
    expect(text.x).toBe(333);
    expect(text.y).toBe(222);
    expect(text.rotation).toBe(1.25);
    expect(text.alpha).toBe(0.4);

    text.emit("pointerout");
    expect(text.x).toBe(333);
    expect(text.y).toBe(222);
    expect(text.rotation).toBe(1.25);
    expect(text.alpha).toBe(0.4);
  });

  it("hit-tests rich text using live interactive glyph bounds", () => {
    const parent = new Container();
    const element = parseText({
      state: {
        id: "rich-text-live-bounds",
        type: "text",
        x: 20,
        y: 30,
        alpha: 1,
        content: [{ text: "Growing text" }],
        textStyle: {
          fontSize: 16,
          fontFamily: "Arial",
          fill: "#FFFFFF",
        },
        hover: {
          textStyle: {
            fontSize: 40,
          },
        },
      },
    });

    addText({
      ...createSharedParams(),
      parent,
      element,
      zIndex: 0,
    });

    const text = parent.getChildByLabel("rich-text-live-bounds");
    const originalHitArea = text.hitArea.clone();
    text.emit("pointerover");
    const probeX = element.x + element.width + 2;
    const [hit] = hitTestElementBounds({
      stage: parent,
      elements: [element],
      x: probeX,
      y: element.y + text.hitArea.height / 2,
    });

    expect(text.hitArea).toEqual(originalHitArea);
    expect(text.hitArea.width).toBe(element.width);
    expect(hit.path[0].bounds.width).toBeGreaterThan(element.width);
    expect(probeX).toBeLessThan(
      hit.path[0].bounds.x + hit.path[0].bounds.width,
    );
    expect(hit.path[0]).toMatchObject({
      id: "rich-text-live-bounds",
      bounds: {
        height: expect.any(Number),
      },
    });
  });

  it("updates between plain and rich text display objects", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const prevElement = parseText({
      state: {
        id: "updating-text",
        type: "text",
        x: 20,
        y: 30,
        content: "Plain",
      },
    });
    const nextElement = parseText({
      state: {
        id: "updating-text",
        type: "text",
        x: 20,
        y: 30,
        content: [
          { text: "Rich" },
          {
            text: "Text",
            textStyle: {
              fill: "#A6A6A6",
            },
          },
        ],
      },
    });

    addText({
      ...shared,
      parent,
      element: prevElement,
      zIndex: 0,
    });

    updateText({
      ...shared,
      parent,
      prevElement,
      nextElement,
      zIndex: 0,
    });

    const text = parent.getChildByLabel("updating-text");

    expect(text.children[0].children[0].text).toBe("Rich");
    expect(text.children[0].children[1].text).toBe("Text");
    expect(text.children[0].children[1].style.fill).toBe("#A6A6A6");
  });

  it("moves a looping update onto a replacement rich-text display object", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const animationBus = createAnimationBus();
    const prevElement = parseText({
      state: {
        id: "looping-replacement-text",
        type: "text",
        x: 20,
        y: 30,
        content: "Plain",
      },
    });
    const nextElement = parseText({
      state: {
        id: "looping-replacement-text",
        type: "text",
        x: 120,
        y: 30,
        content: [{ text: "Rich" }, { text: " replacement" }],
      },
    });

    addText({
      ...shared,
      parent,
      element: prevElement,
      zIndex: 0,
    });
    const previousDisplayObject = parent.getChildByLabel(
      "looping-replacement-text",
    );

    updateText({
      ...shared,
      parent,
      prevElement,
      nextElement,
      animations: [
        {
          id: "replacement-loop",
          targetId: prevElement.id,
          type: "update",
          playback: { loop: true },
          tween: {
            x: {
              initialValue: 20,
              keyframes: [{ duration: 1000, value: 120, easing: "linear" }],
            },
          },
        },
      ],
      animationBus,
      zIndex: 0,
    });

    const replacement = parent.getChildByLabel("looping-replacement-text");
    animationBus.flush();
    animationBus.tick(500);

    expect(previousDisplayObject.destroyed).toBe(true);
    expect(replacement).not.toBe(previousDisplayObject);
    expect(replacement.destroyed).toBe(false);
    expect(replacement.x).toBeCloseTo(70);
    expect(animationBus.getState().activeCount).toBe(1);
  });

  it("wraps rich content using textStyle.wordWrapWidth when width is omitted", () => {
    const element = parseText({
      state: {
        id: "style-wrapped-rich-text",
        type: "text",
        x: 20,
        y: 30,
        textStyle: {
          fontSize: 20,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          wordWrap: true,
          wordWrapWidth: 100,
        },
        content: [{ text: "Alpha beta gamma delta" }],
      },
    });

    expect(element.content.length).toBeGreaterThan(1);
    expect(element.textStyle.wordWrapWidth).toBe(100);
    expect(element.content[0].lineParts[0].text).not.toBe(
      "Alpha beta gamma delta",
    );
    expect(element.content[0].lineParts[0].textStyle.wordWrapWidth).toBe(100);
  });

  it.each([
    ["center", (bounds) => bounds.x + bounds.width / 2, 100],
    ["right", (bounds) => bounds.x + bounds.width, 200],
  ])(
    "aligns %s rich text by visible line bounds when furigana extends left",
    (align, getVisiblePosition, expectedPosition) => {
      const parent = new Container();
      const element = parseText({
        state: {
          id: `${align}-furigana-rich-text`,
          type: "text",
          x: 20,
          y: 30,
          width: 200,
          textStyle: {
            fontSize: 32,
            fontFamily: "Arial",
            fill: "#FFFFFF",
            align,
          },
          content: [
            {
              text: "日",
              furigana: {
                text: "wide annotation",
                textStyle: {
                  fontSize: 16,
                  fontFamily: "Arial",
                  fill: "#D9D9D9",
                },
              },
            },
          ],
        },
      });

      addText({
        ...createSharedParams(),
        parent,
        element,
        zIndex: 0,
      });

      const text = parent.getChildByLabel(`${align}-furigana-rich-text`);
      const line = text.children[0];
      const bounds = line.getLocalBounds();

      expect(bounds.x).toBeLessThan(0);
      expect(line.x + getVisiblePosition(bounds, element.width)).toBeCloseTo(
        expectedPosition,
        1,
      );
    },
  );
});
