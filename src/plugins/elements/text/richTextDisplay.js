import { Container, Rectangle, Text, TextStyle } from "pixi.js";
import { toPixiTextStyle } from "../../../util/toPixiTextStyle.js";
import { DEFAULT_TEXT_STYLE } from "../../../types.js";
import { resolveInteractiveTextStyle } from "./textLayout.js";
import { setElementHitTestBounds } from "../elementRenderState.js";
import {
  applyElementPivot,
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";

const RICH_TEXT_DISPLAY = Symbol("routeGraphicsRichTextDisplay");

const getTextAlign = (style) => style?.align ?? DEFAULT_TEXT_STYLE.align;

const getHorizontalOffset = (layoutWidth, lineBounds, align) => {
  const remainingWidth = Math.max(0, layoutWidth - lineBounds.width);
  let visibleLeft = 0;

  if (align === "center") {
    visibleLeft = remainingWidth / 2;
  } else if (align === "right") {
    visibleLeft = remainingWidth;
  }

  return visibleLeft - lineBounds.x;
};

const destroyChildren = (container) => {
  const children = container.removeChildren();

  children.forEach((child) => {
    child.destroy({ children: true });
  });
};

const createTextObject = ({ text, style, x, y }) =>
  new Text({
    text,
    style: new TextStyle(toPixiTextStyle(style)),
    x: Math.round(x),
    y: Math.round(y),
  });

const applyOverrideStyle = (style, overrideStyle) =>
  overrideStyle ? resolveInteractiveTextStyle(style, overrideStyle) : style;

const getRichTextHitBounds = (container, layoutWidth, layoutHeight) => {
  const contentBounds = container.getLocalBounds();
  const x = Math.min(0, contentBounds.x);
  const y = Math.min(0, contentBounds.y);
  const right = Math.max(layoutWidth, contentBounds.x + contentBounds.width);
  const bottom = Math.max(layoutHeight, contentBounds.y + contentBounds.height);

  return new Rectangle(x, y, right - x, bottom - y);
};

export const isRichTextComputedNode = (element) =>
  Array.isArray(element?.content);

export const isRichTextDisplayObject = (displayObject) =>
  Boolean(displayObject?.[RICH_TEXT_DISPLAY]);

export const getRichTextLayoutPosition = (element) =>
  getElementTransformTargetState(element);

export const renderRichTextDisplayObject = (
  container,
  element,
  overrideStyle,
  { preserveTransform = false } = {},
) => {
  destroyChildren(container);

  container.label = element.id;
  if (!preserveTransform) {
    container.alpha = element.alpha ?? 1;
  }

  const layoutWidth =
    element.__layoutWidth ?? element.width ?? element.measuredWidth ?? 0;

  for (let chunkIndex = 0; chunkIndex < element.content.length; chunkIndex++) {
    const chunk = element.content[chunkIndex];
    const lineContainer = new Container({
      label: `${element.id}-line-${chunkIndex}`,
    });

    for (const part of chunk.lineParts ?? []) {
      if (part.furigana) {
        lineContainer.addChild(
          createTextObject({
            text: part.furigana.text,
            style: applyOverrideStyle(part.furigana.textStyle, overrideStyle),
            x: part.furigana.x,
            y: part.furigana.y,
          }),
        );
      }

      lineContainer.addChild(
        createTextObject({
          text: part.text,
          style: applyOverrideStyle(part.textStyle, overrideStyle),
          x: part.x,
          y: part.y,
        }),
      );
    }

    const lineBounds = lineContainer.getLocalBounds();

    lineContainer.x = getHorizontalOffset(
      layoutWidth,
      lineBounds,
      getTextAlign(element.textStyle),
    );

    container.addChild(lineContainer);
  }

  const hitAreaWidth = Math.max(0, layoutWidth);
  const hitAreaHeight = Math.max(
    0,
    element.__layoutHeight ?? element.height ?? 0,
  );
  container.hitArea = new Rectangle(0, 0, hitAreaWidth, hitAreaHeight);
  if (preserveTransform) {
    applyElementPivot(container, element);
  } else {
    applyElementTransform(container, element, { scaleMode: "full" });
  }
  setElementHitTestBounds(container, (displayObject) =>
    getRichTextHitBounds(displayObject, hitAreaWidth, hitAreaHeight),
  );
};

export const createRichTextDisplayObject = (element, zIndex) => {
  const container = new Container({
    label: element.id,
  });

  container[RICH_TEXT_DISPLAY] = true;
  container.zIndex = zIndex;
  renderRichTextDisplayObject(container, element);

  return container;
};
