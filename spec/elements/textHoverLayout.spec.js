import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  addText,
  getTextAnimationTargetState,
} from "../../src/plugins/elements/text/addText.js";
import { parseText } from "../../src/plugins/elements/text/parseText.js";
import { getTextLayoutPosition } from "../../src/plugins/elements/text/textLayout.js";
import { updateText } from "../../src/plugins/elements/text/updateText.js";
import { hitTestElementBounds } from "../../src/util/hitTestElementBounds.js";
import { isDeepEqual } from "../../src/util/isDeepEqual.js";

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

const getWorldPosition = (displayObject, localPosition = { x: 0, y: 0 }) =>
  displayObject.toGlobal(localPosition);

const getWorldPivotPosition = (displayObject) =>
  getWorldPosition(displayObject, displayObject.pivot);

describe("text hover layout", () => {
  it.each(
    [0, 0.25, 1, 2, -0.5, -2].flatMap((scaleX) =>
      ["left", "center", "right"].flatMap((align) =>
        [0, 30].map((rotation) => ({ scaleX, align, rotation })),
      ),
    ),
  )("keeps $align alignment in local layout units at scale $scaleX, rotation $rotation", ({ scaleX, align, rotation }) => {
    const parent = new Container();
    const state = {
      type: "text", x: 240, y: 120, width: 600,
      anchorX: 0.5, anchorY: 0.5, scaleX, scaleY: 1.5, rotation,
      content: "Scaled text",
      textStyle: { fontFamily: "Arial", fontSize: 24, strokeWidth: 8, strokeColor: "#000000" },
      hover: { textStyle: { fontSize: 30 } },
    };
    const leftElement = parseText({ state: { ...state, id: "left-reference" } });
    const alignedElement = parseText({ state: {
      ...state, id: "aligned", textStyle: { ...state.textStyle, align },
    } });
    for (const element of [leftElement, alignedElement]) {
      addText({ ...createSharedParams(), parent, zIndex: 0, element });
    }
    const left = parent.getChildByLabel("left-reference");
    const aligned = parent.getChildByLabel("aligned");
    const assertAlignment = () => {
      // A layout offset is local text space: transform it exactly once,
      // including mirrored scales and rotation around the authored anchor.
      const width = scaleX === 0 ? 0 : Math.abs(left.width / scaleX);
      const ratio = align === "center" ? 0.5 : align === "right" ? 1 : 0;
      const offset = Math.max(0, 600 - width) * ratio;
      const expected = getWorldPosition(left, { x: offset, y: 0 });
      const actual = getWorldPosition(aligned);
      expect(actual.x).toBeCloseTo(expected.x, 4);
      expect(actual.y).toBeCloseTo(expected.y, 4);
      expect(Number.isFinite(aligned.pivot.x)).toBe(true);
    };
    assertAlignment();
    left.emit("pointerover");
    aligned.emit("pointerover");
    assertAlignment();
    left.emit("pointerout");
    aligned.emit("pointerout");
    assertAlignment();
  });

  it("renders the full authored scale magnitude around the text anchor", () => {
    const parent = new Container();
    const element = parseText({
      state: {
        id: "scaled-text",
        type: "text",
        x: 240,
        y: 120,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: -2,
        scaleY: 1.5,
        content: "Scaled text",
        textStyle: { fontFamily: "Arial", fontSize: 24 },
      },
    });

    addText({
      ...createSharedParams(),
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("scaled-text");

    expect(text.scale.x).toBe(-2);
    expect(text.scale.y).toBe(1.5);
    expect(Math.abs(text.width - element.width)).toBeLessThan(1);
    expect(Math.abs(text.height - element.height)).toBeLessThan(1);
    expect(text.pivot.x * text.scale.x).toBeCloseTo(element.originX);
    expect(text.pivot.y * text.scale.y).toBeCloseTo(element.originY);
    expect(getTextAnimationTargetState(element)).toMatchObject({
      scaleX: -2,
      scaleY: 1.5,
    });
  });

  it("applies degree rotation around an explicit text origin", () => {
    const parent = new Container();
    const element = parseText({
      state: {
        id: "rotated-text",
        type: "text",
        x: 120,
        y: 80,
        originX: 18,
        originY: 12,
        rotation: 30,
        content: "Rotated",
      },
    });

    addText({
      ...createSharedParams(),
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("rotated-text");

    expect(text.x).toBe(138);
    expect(text.y).toBe(92);
    expect(text.pivot.x).toBe(18);
    expect(text.pivot.y).toBe(12);
    expect(text.rotation).toBeCloseTo(Math.PI / 6);
  });

  it("applies configured text texture padding", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-padding",
        type: "text",
        x: 20,
        y: 30,
        alpha: 1,
        content: "Padding",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          padding: 18,
        },
        hover: {
          textStyle: {
            padding: 30,
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-padding");

    expect(text.style.padding).toBe(18);

    text.emit("pointerover");
    expect(text.style.padding).toBe(30);

    text.emit("pointerout");
    expect(text.style.padding).toBe(18);
  });

  it("keeps the text anchor stable when hover styles change text metrics", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-hover-layout",
        type: "text",
        x: 240,
        y: 120,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 1,
        content: "Hover layout",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
        },
        hover: {
          textStyle: {
            fontSize: 36,
            fontFamily: "Arial",
            fill: "#FFFFFF",
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-hover-layout");
    const beforeHoverAnchor = getWorldPivotPosition(text);

    text.emit("pointerover");

    expect(getWorldPivotPosition(text).x).toBeCloseTo(beforeHoverAnchor.x, 4);
    expect(getWorldPivotPosition(text).y).toBeCloseTo(beforeHoverAnchor.y, 4);

    text.emit("pointerout");

    expect(getWorldPivotPosition(text).x).toBeCloseTo(beforeHoverAnchor.x, 4);
    expect(getWorldPivotPosition(text).y).toBeCloseTo(beforeHoverAnchor.y, 4);
  });

  it("preserves a live tweened rotation during interactive style changes", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-live-rotation",
        type: "text",
        x: 240,
        y: 120,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: 15,
        content: "Tweening",
        hover: {
          textStyle: {
            fontSize: 36,
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-live-rotation");
    text.rotation = 1.25;

    text.emit("pointerover");
    expect(text.rotation).toBe(1.25);

    text.emit("pointerout");
    expect(text.rotation).toBe(1.25);
  });

  it("diffs an explicit origin from an equal anchor-derived origin", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const state = {
      id: "text-explicit-origin-diff",
      type: "text",
      x: 240,
      y: 120,
      anchorX: 0.5,
      anchorY: 0.5,
      content: "Origin",
      textStyle: {
        fontSize: 24,
      },
      hover: {
        textStyle: {
          fontSize: 48,
        },
      },
    };
    const derivedElement = parseText({ state });
    const explicitElement = parseText({
      state: {
        ...state,
        originX: derivedElement.originX,
        originY: derivedElement.originY,
      },
    });

    expect(explicitElement.originX).toBe(derivedElement.originX);
    expect(explicitElement.originY).toBe(derivedElement.originY);
    expect(Object.keys(explicitElement)).toContain("__explicitOriginX");
    expect(Object.keys(explicitElement)).toContain("__explicitOriginY");
    expect(isDeepEqual(derivedElement, explicitElement)).toBe(false);

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element: derivedElement,
    });
    updateText({
      ...shared,
      parent,
      prevElement: derivedElement,
      nextElement: explicitElement,
      zIndex: 0,
    });

    const text = parent.getChildByLabel("text-explicit-origin-diff");
    text.emit("pointerover");

    expect(text.pivot.x).toBeCloseTo(explicitElement.originX);
    expect(text.pivot.y).toBeCloseTo(explicitElement.originY);
  });

  it("keeps hover and click textStyle states working together", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-hover-click-styles",
        type: "text",
        x: 240,
        y: 120,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 1,
        content: "Hover then click",
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
        click: {
          textStyle: {
            fill: "#D9D9D9",
            fontSize: 48,
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-hover-click-styles");

    text.emit("pointerover");
    expect(text.style.fill).toBe("#FFFFFF");
    expect(text.style.fontSize).toBe(24);
    expect(text.style.fontFamily).toBe("Arial");

    text.emit("pointerdown");
    expect(text.style.fill).toBe("#D9D9D9");
    expect(text.style.fontSize).toBe(48);
    expect(text.style.fontFamily).toBe("Arial");
    expect(text.style.lineHeight).toBe(58);

    text.emit("pointerup");
    expect(text.style.fill).toBe("#FFFFFF");
    expect(text.style.fontSize).toBe(24);

    text.emit("pointerout");
    expect(text.style.fill).toBe("#A6A6A6");
    expect(text.style.fontSize).toBe(24);
  });

  it("hit-tests the live fixed-width alignment and auto-width metrics", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const fixedWidthElement = parseText({
      state: {
        id: "fixed-live-bounds",
        type: "text",
        x: 40,
        y: 30,
        width: 200,
        alpha: 1,
        content: "Aligned",
        textStyle: {
          align: "center",
          fontSize: 20,
          fontFamily: "Arial",
          fill: "#FFFFFF",
        },
        hover: {
          textStyle: {
            align: "right",
            fontSize: 36,
          },
        },
      },
    });
    const autoWidthElement = parseText({
      state: {
        id: "auto-live-bounds",
        type: "text",
        x: 40,
        y: 100,
        alpha: 1,
        content: "Growing text",
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
      ...shared,
      parent,
      zIndex: 0,
      element: fixedWidthElement,
    });
    addText({
      ...shared,
      parent,
      zIndex: 1,
      element: autoWidthElement,
    });

    const fixedText = parent.getChildByLabel("fixed-live-bounds");
    const autoText = parent.getChildByLabel("auto-live-bounds");
    fixedText.emit("pointerover");
    autoText.emit("pointerover");

    const [fixedHit] = hitTestElementBounds({
      stage: parent,
      elements: [fixedWidthElement, autoWidthElement],
      x: fixedWidthElement.x + 1,
      y: fixedWidthElement.y + 1,
    });
    const autoProbeX = autoWidthElement.x + autoWidthElement.width + 2;
    const autoHits = hitTestElementBounds({
      stage: parent,
      elements: [fixedWidthElement, autoWidthElement],
      x: autoProbeX,
      y: autoText.y + autoText.height / 2,
    });

    expect(fixedHit.path[0].bounds).toMatchObject({
      x: fixedWidthElement.x,
      width: fixedWidthElement.width,
    });
    expect(autoProbeX).toBeLessThan(autoText.x + autoText.width);
    expect(autoHits[0].path[0].id).toBe("auto-live-bounds");
    expect(autoHits[0].path[0].bounds.width).toBeCloseTo(autoText.width, 4);
  });

  it("maps strokeColor and strokeWidth to Pixi stroke options", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-stroke-style",
        type: "text",
        x: 20,
        y: 30,
        alpha: 1,
        content: "Outlined",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          strokeColor: "#112233",
          strokeWidth: 4,
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-stroke-style");

    expect(text.style.stroke).toMatchObject({
      color: "#112233",
      width: 4,
    });
  });

  it("maps shadow to Pixi dropShadow options", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-shadow-style",
        type: "text",
        x: 20,
        y: 30,
        alpha: 1,
        content: "Shadowed",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          shadow: {
            color: "#112233",
            alpha: 0.5,
            blur: 4,
            offsetX: 3,
            offsetY: 4,
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-shadow-style");

    expect(text.style.dropShadow).toMatchObject({
      color: "#112233",
      alpha: 0.5,
      blur: 4,
      distance: 5,
    });
    expect(text.style.dropShadow.angle).toBeCloseTo(Math.atan2(4, 3), 8);
    expect(text.style.padding).toBe(10);
  });

  it("deep-merges and removes shadow in interactive textStyle states", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-interactive-shadow",
        type: "text",
        x: 20,
        y: 30,
        alpha: 1,
        content: "Interactive shadow",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#A6A6A6",
          shadow: {
            color: "#111111",
            alpha: 0.35,
            blur: 3,
            offsetX: 2,
            offsetY: 5,
          },
        },
        hover: {
          textStyle: {
            fill: "#FFFFFF",
            shadow: {
              color: "#333333",
              alpha: 0.85,
            },
          },
        },
        click: {
          textStyle: {
            shadow: null,
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-interactive-shadow");
    const baseDistance = Math.hypot(2, 5);
    const baseAngle = Math.atan2(5, 2);

    expect(text.style.dropShadow).toMatchObject({
      color: "#111111",
      alpha: 0.35,
      blur: 3,
      distance: baseDistance,
    });

    text.emit("pointerover");

    expect(text.style.fill).toBe("#FFFFFF");
    expect(text.style.dropShadow).toMatchObject({
      color: "#333333",
      alpha: 0.85,
      blur: 3,
      distance: baseDistance,
    });
    expect(text.style.dropShadow.angle).toBeCloseTo(baseAngle, 8);

    text.emit("pointerdown");

    expect(text.style.dropShadow).toBeNull();

    text.emit("pointerup");

    expect(text.style.dropShadow).toMatchObject({
      color: "#333333",
      alpha: 0.85,
      blur: 3,
      distance: baseDistance,
    });

    text.emit("pointerout");

    expect(text.style.dropShadow).toMatchObject({
      color: "#111111",
      alpha: 0.35,
      blur: 3,
      distance: baseDistance,
    });
  });

  it("positions centered fixed-width text inside the layout box", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-fixed-center",
        type: "text",
        x: 40,
        y: 60,
        width: 200,
        content: "Centered",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          align: "center",
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-fixed-center");
    const glyphPosition = getWorldPosition(text);

    expect(glyphPosition.x).toBeCloseTo(
      element.x + (element.width - text.width) / 2,
      4,
    );
    expect(glyphPosition.y).toBe(element.y);
  });

  it("positions centered fixed-width text with shadows by glyph width", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-fixed-center-shadow",
        type: "text",
        x: 40,
        y: 60,
        width: 260,
        content: "Centered",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          align: "center",
          shadow: {
            color: "#737373",
            blur: 0,
            offsetX: 12,
            offsetY: 0,
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-fixed-center-shadow");
    const targetPosition = getTextLayoutPosition(element);
    const glyphPosition = getWorldPosition(text);

    expect(text.width).toBeGreaterThan(element.measuredWidth);
    expect(glyphPosition.x).toBeCloseTo(targetPosition.x, 4);
    expect(glyphPosition.x).toBeCloseTo(
      element.x + (element.width - element.measuredWidth) / 2,
      4,
    );
  });

  it("positions right-aligned fixed-width text inside the layout box", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-fixed-right",
        type: "text",
        x: 40,
        y: 60,
        width: 200,
        content: "Right",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          align: "right",
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-fixed-right");
    const glyphPosition = getWorldPosition(text);

    expect(glyphPosition.x).toBeCloseTo(
      element.x + element.width - text.width,
      4,
    );
    expect(glyphPosition.y).toBe(element.y);
  });

  it("positions right-aligned fixed-width text with shadows by glyph width", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-fixed-right-shadow",
        type: "text",
        x: 40,
        y: 60,
        width: 260,
        content: "Right",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          align: "right",
          shadow: {
            color: "#737373",
            blur: 0,
            offsetX: 12,
            offsetY: 0,
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-fixed-right-shadow");
    const targetPosition = getTextLayoutPosition(element);
    const glyphPosition = getWorldPosition(text);

    expect(text.width).toBeGreaterThan(element.measuredWidth);
    expect(glyphPosition.x).toBeCloseTo(targetPosition.x, 4);
    expect(glyphPosition.x).toBeCloseTo(
      element.x + element.width - element.measuredWidth,
      4,
    );
  });

  it("keeps a fixed-width box anchor stable when hover styles change text metrics", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-fixed-width-hover-layout",
        type: "text",
        x: 240,
        y: 120,
        width: 200,
        anchorX: 0.5,
        anchorY: 0.5,
        alpha: 1,
        content: "Hover layout",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          align: "center",
        },
        hover: {
          textStyle: {
            fontSize: 36,
            fontFamily: "Arial",
            fill: "#FFFFFF",
            align: "center",
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-fixed-width-hover-layout");
    const getBoxAnchor = () => getWorldPivotPosition(text);

    const beforeHoverAnchor = getBoxAnchor();

    text.emit("pointerover");

    expect(getBoxAnchor().x).toBeCloseTo(beforeHoverAnchor.x, 4);
    expect(getBoxAnchor().y).toBeCloseTo(beforeHoverAnchor.y, 4);

    text.emit("pointerout");

    expect(getBoxAnchor().x).toBeCloseTo(beforeHoverAnchor.x, 4);
    expect(getBoxAnchor().y).toBeCloseTo(beforeHoverAnchor.y, 4);
  });

  it("keeps fixed-width aligned text stable when only shadow metrics change", () => {
    const parent = new Container();
    const shared = createSharedParams();
    const element = parseText({
      state: {
        id: "text-fixed-shadow-hover-layout",
        type: "text",
        x: 80,
        y: 120,
        width: 260,
        alpha: 1,
        content: "Shadow hover",
        textStyle: {
          fontSize: 24,
          fontFamily: "Arial",
          fill: "#FFFFFF",
          align: "center",
          shadow: {
            color: "#737373",
            blur: 0,
            offsetX: 4,
            offsetY: 0,
          },
        },
        hover: {
          textStyle: {
            shadow: {
              offsetX: 28,
            },
          },
        },
      },
    });

    addText({
      ...shared,
      parent,
      zIndex: 0,
      element,
    });

    const text = parent.getChildByLabel("text-fixed-shadow-hover-layout");
    const beforeHoverX = text.x;
    const beforeHoverWidth = text.width;

    text.emit("pointerover");

    expect(text.style.dropShadow.distance).toBe(28);
    expect(text.width).toBeGreaterThan(beforeHoverWidth);
    expect(text.x).toBeCloseTo(beforeHoverX, 4);

    text.emit("pointerout");

    expect(text.style.dropShadow.distance).toBe(4);
    expect(text.x).toBeCloseTo(beforeHoverX, 4);
  });
});
