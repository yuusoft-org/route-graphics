import { CanvasTextMetrics, TextStyle } from "pixi.js";
import applyTextStyle from "../../../util/applyTextStyle.js";
import { DEFAULT_TEXT_STYLE } from "../../../types.js";
import { mergeTextStyle } from "../../../util/mergeTextStyle.js";
import { toPixiTextStyle } from "../../../util/toPixiTextStyle.js";
import { setElementHitTestBounds } from "../elementRenderState.js";
import { applyElementTransform, radiansToDegrees } from "../util/transform.js";

const TEXT_ANCHOR_RATIOS = Symbol("routeGraphicsTextAnchorRatios");
const TEXT_LAYOUT_STATE = Symbol("routeGraphicsTextLayoutState");
const TEXT_TRANSFORM_STATE = Symbol("routeGraphicsTextTransformState");

const getAnchorRatio = (size, origin) => {
  if (typeof size !== "number" || size === 0) return 0;
  return origin / size;
};

const getTextAlign = (style) => style?.align ?? DEFAULT_TEXT_STYLE.align;

const getAuthoredLayoutWidth = (textComputedNode) =>
  textComputedNode.__layoutWidth ?? textComputedNode.width;

const getLayoutWidth = (textElement) => {
  const layoutState = textElement[TEXT_LAYOUT_STATE];

  if (layoutState?.fixedWidth && typeof layoutState.layoutWidth === "number") {
    return layoutState.layoutWidth;
  }

  if (typeof layoutState?.measuredWidth === "number") {
    return layoutState.measuredWidth;
  }

  return textElement.width;
};

const measureTextLayout = (textValue, style) => {
  const metrics = CanvasTextMetrics.measureText(
    String(textValue ?? ""),
    new TextStyle(toPixiTextStyle(style, { includeShadow: false })),
  );

  return {
    width: metrics.width,
    height: metrics.height,
  };
};

const usesTextShadow = (style) =>
  style?.shadow !== undefined &&
  style.shadow !== null &&
  style.shadow !== false;

const getRuntimeTextLayout = (textElement, style) => {
  if (usesTextShadow(style)) {
    return measureTextLayout(textElement.text, style);
  }

  const scaleX = Math.abs(textElement.scale?.x);
  const scaleY = Math.abs(textElement.scale?.y);
  if (!(scaleX > 0) || !(scaleY > 0)) {
    return measureTextLayout(textElement.text, style);
  }

  return {
    width: Math.abs(textElement.width) / scaleX,
    height: Math.abs(textElement.height) / scaleY,
  };
};

const getMeasuredWidth = (textElement) => {
  const layoutState = textElement[TEXT_LAYOUT_STATE];

  if (typeof layoutState?.measuredWidth === "number") {
    return layoutState.measuredWidth;
  }

  return textElement.width;
};

const getMeasuredHeight = (textElement) => {
  const layoutState = textElement[TEXT_LAYOUT_STATE];

  if (typeof layoutState?.measuredHeight === "number") {
    return layoutState.measuredHeight;
  }

  return textElement.height;
};

const setTextLayoutState = (textElement, textComputedNode, measurements) => {
  const fixedWidth = Boolean(textComputedNode.__fixedWidth);
  const runtimeMeasurements =
    measurements ??
    getRuntimeTextLayout(textElement, textComputedNode.textStyle);
  const measuredWidth =
    runtimeMeasurements.width ??
    textComputedNode.measuredWidth ??
    textComputedNode.width;
  const measuredHeight =
    runtimeMeasurements.height ?? textComputedNode.height ?? textElement.height;

  textElement[TEXT_LAYOUT_STATE] = {
    fixedWidth,
    layoutWidth: fixedWidth
      ? getAuthoredLayoutWidth(textComputedNode)
      : measuredWidth,
    measuredWidth,
    measuredHeight,
  };
};

const getHorizontalOffset = (layoutWidth, measuredWidth, align) => {
  const remainingWidth = Math.max(0, layoutWidth - measuredWidth);

  if (align === "center") {
    return remainingWidth / 2;
  }

  if (align === "right") {
    return remainingWidth;
  }

  return 0;
};

const applyTextElementTransform = (
  textElement,
  textComputedNode,
  {
    layoutWidth = getLayoutWidth(textElement),
    measuredWidth = getMeasuredWidth(textElement),
    measuredHeight = getMeasuredHeight(textElement),
    originX = textComputedNode.originX ?? 0,
    originY = textComputedNode.originY ?? 0,
    positionX,
    positionY,
    rotation = textComputedNode.rotation,
  } = {},
) => {
  const offsetX = getHorizontalOffset(
    layoutWidth,
    measuredWidth,
    getTextAlign(textElement.style ?? textComputedNode.textStyle),
  );
  const transformedElement = {
    ...textComputedNode,
    x: positionX === undefined ? textComputedNode.x : positionX - originX,
    y: positionY === undefined ? textComputedNode.y : positionY - originY,
    originX,
    originY,
    rotation,
  };

  applyElementTransform(textElement, transformedElement, {
    localOriginX: originX - offsetX,
    localOriginY: originY,
    scaleMode: "full",
  });

  textElement[TEXT_TRANSFORM_STATE] = {
    textComputedNode,
    layoutWidth,
    measuredWidth,
    measuredHeight,
  };
};

const getTextLayoutHitBounds = (textElement) => {
  const layoutState = textElement[TEXT_LAYOUT_STATE];
  if (!layoutState) return null;

  const layoutWidth = getLayoutWidth(textElement);
  const measuredWidth = getMeasuredWidth(textElement);

  return {
    x: -getHorizontalOffset(
      layoutWidth,
      measuredWidth,
      getTextAlign(textElement.style),
    ),
    y: 0,
    width: layoutWidth,
    height: getMeasuredHeight(textElement),
  };
};

export const getTextLayoutPosition = (textComputedNode) => {
  const measuredWidth =
    textComputedNode.measuredWidth ?? textComputedNode.width;
  const offsetX = getHorizontalOffset(
    textComputedNode.width,
    measuredWidth,
    getTextAlign(textComputedNode.textStyle),
  );

  return {
    x: textComputedNode.x + offsetX,
    y: textComputedNode.y,
  };
};

export const syncTextAnchorRatios = (textElement, textComputedNode) => {
  const measurements = getRuntimeTextLayout(
    textElement,
    textComputedNode.textStyle,
  );
  const width =
    textComputedNode.__fixedWidth &&
    typeof getAuthoredLayoutWidth(textComputedNode) === "number"
      ? getAuthoredLayoutWidth(textComputedNode)
      : measurements.width;
  const height = measurements.height;
  const anchorXRatio =
    typeof textComputedNode.__anchorXRatio === "number"
      ? textComputedNode.__anchorXRatio
      : getAnchorRatio(width, textComputedNode.originX);
  const anchorYRatio =
    typeof textComputedNode.__anchorYRatio === "number"
      ? textComputedNode.__anchorYRatio
      : getAnchorRatio(height, textComputedNode.originY);

  textElement[TEXT_ANCHOR_RATIOS] = {
    x: anchorXRatio,
    y: anchorYRatio,
  };
  setTextLayoutState(textElement, textComputedNode, measurements);
  textElement[TEXT_TRANSFORM_STATE] = {
    textComputedNode,
    layoutWidth: width,
    measuredWidth: measurements.width,
    measuredHeight: measurements.height,
  };
  setElementHitTestBounds(textElement, getTextLayoutHitBounds);
};

const getLineHeightRatio = (style) => {
  if (
    typeof style?.fontSize !== "number" ||
    style.fontSize === 0 ||
    typeof style?.lineHeight !== "number"
  ) {
    return DEFAULT_TEXT_STYLE.lineHeight;
  }

  return style.lineHeight / style.fontSize;
};

export const resolveInteractiveTextStyle = (baseStyle, overrideStyle) => {
  if (!overrideStyle) return baseStyle;

  const resolvedStyle = mergeTextStyle(baseStyle, overrideStyle);

  if (
    overrideStyle.fontSize !== undefined ||
    overrideStyle.lineHeight !== undefined
  ) {
    const lineHeightRatio =
      overrideStyle.lineHeight ?? getLineHeightRatio(baseStyle);
    resolvedStyle.lineHeight = Math.round(
      resolvedStyle.fontSize * lineHeightRatio,
    );
  }

  return resolvedStyle;
};

export const applyInteractiveTextStyle = (
  textElement,
  baseStyle,
  overrideStyle,
) => {
  const anchorRatios = textElement[TEXT_ANCHOR_RATIOS];
  const layoutWidth = getLayoutWidth(textElement);
  const resolvedStyle = resolveInteractiveTextStyle(baseStyle, overrideStyle);

  if (!anchorRatios) {
    applyTextStyle(textElement, resolvedStyle);
    return;
  }

  const transformState = textElement[TEXT_TRANSFORM_STATE];
  const transformPositionX = textElement.x;
  const transformPositionY = textElement.y;
  const transformRotation = radiansToDegrees(textElement.rotation);

  applyTextStyle(textElement, resolvedStyle);

  const nextMeasurements = getRuntimeTextLayout(textElement, resolvedStyle);
  const fixedWidth = textElement[TEXT_LAYOUT_STATE]?.fixedWidth === true;
  const nextLayoutWidth = fixedWidth ? layoutWidth : nextMeasurements.width;
  textElement[TEXT_LAYOUT_STATE] = {
    ...textElement[TEXT_LAYOUT_STATE],
    layoutWidth: nextLayoutWidth,
    measuredWidth: nextMeasurements.width,
    measuredHeight: nextMeasurements.height,
  };
  const textComputedNode = transformState?.textComputedNode;

  if (textComputedNode) {
    const originX =
      textComputedNode.__explicitOriginX === true
        ? textComputedNode.originX
        : nextLayoutWidth * anchorRatios.x;
    const originY =
      textComputedNode.__explicitOriginY === true
        ? textComputedNode.originY
        : nextMeasurements.height * anchorRatios.y;

    applyTextElementTransform(textElement, textComputedNode, {
      layoutWidth: nextLayoutWidth,
      measuredWidth: nextMeasurements.width,
      measuredHeight: nextMeasurements.height,
      originX,
      originY,
      positionX: transformPositionX,
      positionY: transformPositionY,
      rotation: transformRotation,
    });
  }
};

export const positionTextInLayoutBox = (textElement, textComputedNode) => {
  setTextLayoutState(textElement, textComputedNode);
  const measuredWidth = usesTextShadow(textComputedNode.textStyle)
    ? (textComputedNode.measuredWidth ?? getMeasuredWidth(textElement))
    : getMeasuredWidth(textElement);
  applyTextElementTransform(textElement, textComputedNode, {
    layoutWidth:
      textComputedNode.__fixedWidth &&
      typeof getAuthoredLayoutWidth(textComputedNode) === "number"
        ? getAuthoredLayoutWidth(textComputedNode)
        : measuredWidth,
    measuredWidth,
    measuredHeight: getMeasuredHeight(textElement),
  });
};
