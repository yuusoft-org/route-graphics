import { CanvasTextMetrics, TextStyle } from "pixi.js";
import { parseCommonObject } from "../util/parseCommonObject.js";
import { DEFAULT_TEXT_STYLE } from "../../../types.js";
import { toPixiTextStyle } from "../../../util/toPixiTextStyle.js";
import { mergeTextStyle } from "../../../util/mergeTextStyle.js";
import {
  createTextChunks,
  prepareRichTextSegments,
} from "../text-revealing/parseTextRevealing.js";

const RICH_TEXT_NO_WRAP_WIDTH = 100000;

const getRichTextWordWrapWidth = (state, textStyle) => {
  if (typeof state.width === "number") {
    return state.width;
  }

  if (
    textStyle.wordWrap &&
    typeof textStyle.wordWrapWidth === "number" &&
    Number.isFinite(textStyle.wordWrapWidth) &&
    textStyle.wordWrapWidth > 0
  ) {
    return textStyle.wordWrapWidth;
  }

  return RICH_TEXT_NO_WRAP_WIDTH;
};

/**
 * @typedef {import('../../../types.js').BaseElement} BaseElement
 * @typedef {import('../../../types.js').TextComputedNode} TextComputedNode
 */

/**
 * Parse text object and calculate final position after anchor adjustment
 * @param {Object} params
 * @param {BaseElement} params.state - The text state to parse
 * @param {Array} params.parserPlugins - Array of parser plugins (not used by this parser)
 * @returns {TextComputedNode}
 */
export const parseText = ({ state }) => {
  const contentIsRich = Array.isArray(state.content);
  const baseTextStyle = mergeTextStyle(DEFAULT_TEXT_STYLE, state.textStyle);
  const textStyle = { ...baseTextStyle };

  textStyle.lineHeight = Math.round(textStyle.fontSize * textStyle.lineHeight);

  // Handle word wrap width based on element width
  if (typeof state.width === "number") {
    textStyle.wordWrapWidth = state.width;
    textStyle.wordWrap = true;
  }

  if (contentIsRich) {
    const wordWrapWidth = getRichTextWordWrapWidth(state, baseTextStyle);
    const processedContent = prepareRichTextSegments({
      content: state.content,
      defaultTextStyle: baseTextStyle,
      width: typeof state.width === "number" ? state.width : undefined,
    });
    const {
      chunks,
      width: calculatedWidth,
      height: calculatedHeight,
    } = createTextChunks(processedContent, wordWrapWidth, {
      minimumWidth: 0,
    });
    const roundedMeasuredWidth = Math.round(calculatedWidth);
    const roundedHeight = Math.round(calculatedHeight);
    const layoutWidth =
      typeof state.width === "number"
        ? Math.round(state.width)
        : roundedMeasuredWidth;

    let computedObj = parseCommonObject({
      ...state,
      width: layoutWidth,
      height: roundedHeight,
    });

    const computedText = {
      ...computedObj,
      content: chunks,
      measuredWidth: roundedMeasuredWidth,
      textStyle: {
        ...textStyle,
      },
      ...(state.hover && { hover: state.hover }),
      ...(state.click && { click: state.click }),
      ...(state.rightClick && { rightClick: state.rightClick }),
      ...(state.scrollUp && { scrollUp: state.scrollUp }),
      ...(state.scrollDown && { scrollDown: state.scrollDown }),
    };

    Object.defineProperties(computedText, {
      __anchorXRatio: {
        value: state.anchorX ?? 0,
        enumerable: false,
      },
      __anchorYRatio: {
        value: state.anchorY ?? 0,
        enumerable: false,
      },
      __fixedWidth: {
        value: typeof state.width === "number",
        enumerable: false,
      },
      ...(typeof state.originX === "number" && {
        __explicitOriginX: {
          value: true,
          enumerable: true,
        },
      }),
      ...(typeof state.originY === "number" && {
        __explicitOriginY: {
          value: true,
          enumerable: true,
        },
      }),
    });

    return computedText;
  }

  // Convert string content to string for measurement
  const contentString = String(state.content ?? "");

  const { width, height } = CanvasTextMetrics.measureText(
    contentString,
    new TextStyle(toPixiTextStyle(textStyle, { includeShadow: false })),
  );

  // Round pixel calculations
  const roundedMeasuredWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  const layoutWidth =
    typeof state.width === "number"
      ? Math.round(state.width)
      : roundedMeasuredWidth;

  let computedObj = parseCommonObject({
    ...state,
    width: layoutWidth,
    height: roundedHeight,
  });

  const computedText = {
    ...computedObj,
    content: contentString,
    measuredWidth: roundedMeasuredWidth,
    textStyle: {
      ...textStyle,
    },
    ...(state.hover && { hover: state.hover }),
    ...(state.click && { click: state.click }),
    ...(state.rightClick && { rightClick: state.rightClick }),
    ...(state.scrollUp && { scrollUp: state.scrollUp }),
    ...(state.scrollDown && { scrollDown: state.scrollDown }),
  };

  Object.defineProperties(computedText, {
    __anchorXRatio: {
      value: state.anchorX ?? 0,
      enumerable: false,
    },
    __anchorYRatio: {
      value: state.anchorY ?? 0,
      enumerable: false,
    },
    __fixedWidth: {
      value: typeof state.width === "number",
      enumerable: false,
    },
    ...(typeof state.originX === "number" && {
      __explicitOriginX: {
        value: true,
        enumerable: true,
      },
    }),
    ...(typeof state.originY === "number" && {
      __explicitOriginY: {
        value: true,
        enumerable: true,
      },
    }),
  });

  return computedText;
};
