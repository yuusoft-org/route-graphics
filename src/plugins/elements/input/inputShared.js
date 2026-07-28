import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Text,
  TextStyle,
} from "pixi.js";
import applyTextStyle from "../../../util/applyTextStyle.js";
import { DEFAULT_TEXT_STYLE } from "../../../types.js";
import { toPixiTextStyle } from "../../../util/toPixiTextStyle.js";
import { destroyRectFillResource, resolveRectFill } from "../rect/rectFill.js";

export const INPUT_RUNTIME = Symbol("routeGraphicsInputRuntime");

export const DEFAULT_INPUT_PADDING = {
  top: 10,
  right: 12,
  bottom: 10,
  left: 12,
};

export const DEFAULT_INPUT_FILL = "#FFFFFF";

export const DEFAULT_INPUT_BORDER = {
  color: "#2E2E2E",
  width: 1,
  alpha: 1,
};

export const DEFAULT_INPUT_FOCUS_RING = {
  color: "#4A89FF",
  width: 2,
  alpha: 1,
};

export const DEFAULT_INPUT_SELECTION_STYLE = {
  fill: "#4A89FF",
  alpha: 0.3,
};

export const DEFAULT_INPUT_CARET_STYLE = {
  fill: "#111111",
  width: 2,
};

export const toRoundedLineHeight = (style = {}) => {
  const fontSize = style.fontSize ?? DEFAULT_TEXT_STYLE.fontSize;
  const lineHeight = style.lineHeight ?? DEFAULT_TEXT_STYLE.lineHeight;

  if (typeof lineHeight !== "number") {
    return Math.round(fontSize * DEFAULT_TEXT_STYLE.lineHeight);
  }

  if (lineHeight > 8) {
    return Math.round(lineHeight);
  }

  return Math.round(fontSize * lineHeight);
};

export const resolveInputTextStyle = (style = {}, options = {}) => ({
  ...DEFAULT_TEXT_STYLE,
  ...style,
  align: style.align ?? "left",
  lineHeight: toRoundedLineHeight(style),
  wordWrap: false,
  breakWords: false,
  wordWrapWidth: options.wordWrapWidth ?? 0,
  whiteSpace: "pre",
});

export const resolvePadding = (padding) => {
  if (typeof padding === "number") {
    return {
      top: padding,
      right: padding,
      bottom: padding,
      left: padding,
    };
  }

  if (Array.isArray(padding)) {
    return {
      top: padding[0] ?? 0,
      right: padding[1] ?? padding[0] ?? 0,
      bottom: padding[2] ?? padding[0] ?? 0,
      left: padding[3] ?? padding[1] ?? padding[0] ?? 0,
    };
  }

  return {
    top: padding?.top ?? DEFAULT_INPUT_PADDING.top,
    right: padding?.right ?? DEFAULT_INPUT_PADDING.right,
    bottom: padding?.bottom ?? DEFAULT_INPUT_PADDING.bottom,
    left: padding?.left ?? DEFAULT_INPUT_PADDING.left,
  };
};

const resolveStrokeWidth = (width, fallback) => {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return fallback;
  }

  return Math.max(0, Math.round(width));
};

const resolveStrokeAlpha = (alpha, fallback) =>
  typeof alpha === "number" && Number.isFinite(alpha) ? alpha : fallback;

export const resolveInputStrokeStyle = (style, defaults) => ({
  color: style?.color ?? defaults.color,
  width: resolveStrokeWidth(style?.width, defaults.width),
  alpha: resolveStrokeAlpha(style?.alpha, defaults.alpha),
});

const normalizeInputValue = (value) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

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

const createMeasuredStyle = (style) =>
  new TextStyle(toPixiTextStyle(style, { includeShadow: false }));

const measureWidth = (text, style) =>
  CanvasTextMetrics.measureText(text, createMeasuredStyle(style)).width;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getNearestTextIndex = ({ text, style, targetX }) => {
  const normalizedTargetX = Number.isFinite(targetX) ? targetX : 0;

  if (normalizedTargetX <= 0 || text.length === 0) {
    return 0;
  }

  const fullWidth = measureWidth(text, style);

  if (normalizedTargetX >= fullWidth) {
    return text.length;
  }

  for (let index = 1; index <= text.length; index += 1) {
    const previousWidth = measureWidth(text.slice(0, index - 1), style);
    const currentWidth = measureWidth(text.slice(0, index), style);
    const midpoint = previousWidth + (currentWidth - previousWidth) / 2;

    if (normalizedTargetX < midpoint) {
      return index - 1;
    }
  }

  return text.length;
};

const intersectRect = (left, right) => {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  const width = rightEdge - x;
  const height = bottomEdge - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
};

const getMaskBounds = (target) => {
  const maskTarget = target?.mask;

  if (!maskTarget?.getBounds) {
    return null;
  }

  const bounds = maskTarget.getBounds();

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
};

const getVisibleBounds = ({ app, container, fallbackElement }) => {
  if (!container || container.destroyed) return null;

  const bounds = container.getBounds?.();
  const fullBounds = bounds
    ? {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    : {
        x: container.x ?? fallbackElement.x,
        y: container.y ?? fallbackElement.y,
        width: fallbackElement.width,
        height: fallbackElement.height,
      };

  if (fullBounds.width <= 0 || fullBounds.height <= 0) {
    return null;
  }

  let visibleBounds = { ...fullBounds };
  let current = container;

  while (current) {
    if (current.visible === false || current.renderable === false) {
      return {
        fullBounds,
        visibleBounds: null,
      };
    }

    const maskBounds = getMaskBounds(current);

    if (maskBounds) {
      visibleBounds = intersectRect(visibleBounds, maskBounds);

      if (!visibleBounds) {
        return {
          fullBounds,
          visibleBounds: null,
        };
      }
    }

    current = current.parent;
  }

  const viewport = app?.renderer
    ? {
        x: 0,
        y: 0,
        width: app.renderer.width,
        height: app.renderer.height,
      }
    : null;

  if (viewport) {
    visibleBounds = intersectRect(visibleBounds, viewport);
  }

  return {
    fullBounds,
    visibleBounds,
  };
};

const getClipInsets = (fullBounds, visibleBounds) => {
  if (!visibleBounds) {
    return {
      top: fullBounds.height,
      right: 0,
      bottom: 0,
      left: 0,
    };
  }

  return {
    top: Math.max(0, visibleBounds.y - fullBounds.y),
    right: Math.max(
      0,
      fullBounds.x + fullBounds.width - (visibleBounds.x + visibleBounds.width),
    ),
    bottom: Math.max(
      0,
      fullBounds.y +
        fullBounds.height -
        (visibleBounds.y + visibleBounds.height),
    ),
    left: Math.max(0, visibleBounds.x - fullBounds.x),
  };
};

const buildSingleLineLayout = ({ displayedValue, textStyle }) => {
  const width = measureWidth(displayedValue, textStyle);

  return {
    lines: [
      {
        text: displayedValue,
        width,
        startIndex: 0,
      },
    ],
    lineHeight: textStyle.lineHeight,
    totalHeight: textStyle.lineHeight,
    maxLineWidth: width,
    textValue: displayedValue,
  };
};

const buildMultilineLayout = ({ displayedValue, textStyle }) => {
  const normalizedValue = normalizeInputValue(displayedValue);
  const lines = normalizedValue.split("\n");
  const measuredLines = lines.map((lineText, lineIndex) => ({
    text: lineText,
    width: measureWidth(lineText, textStyle),
    startIndex:
      lineIndex === 0
        ? 0
        : lines
            .slice(0, lineIndex)
            .reduce((total, line) => total + line.length + 1, 0),
  }));
  const maxLineWidth = measuredLines.reduce(
    (max, line) => Math.max(max, line.width),
    0,
  );
  const lineHeight = textStyle.lineHeight;

  return {
    lines: measuredLines,
    lineHeight,
    totalHeight: measuredLines.length * lineHeight,
    maxLineWidth,
    textValue: normalizedValue,
  };
};

const getLayout = ({ element, displayedValue, textStyle }) =>
  element.multiline
    ? buildMultilineLayout({ displayedValue, textStyle })
    : buildSingleLineLayout({ displayedValue, textStyle });

const getCaretLocationFromValue = ({ value, index }) => {
  const normalizedValue = normalizeInputValue(value);
  const clampedIndex = clamp(index, 0, normalizedValue.length);
  let line = 0;
  let column = 0;

  for (let i = 0; i < clampedIndex; i += 1) {
    if (normalizedValue[i] === "\n") {
      line += 1;
      column = 0;
      continue;
    }

    column += 1;
  }

  return {
    line,
    column,
  };
};

const getTextLineX = ({ contentWidth, lineWidth, align }) =>
  getHorizontalOffset(contentWidth, lineWidth, align);

const createTextNode = (label) =>
  new Text({
    label,
    text: "",
  });

const ensureTextLineNodes = (runtime, count) => {
  while (runtime.textNodes.length < count) {
    const node = createTextNode(
      `${runtime.element.id}-text-line-${runtime.textNodes.length}`,
    );

    runtime.text.addChild(node);
    runtime.textNodes.push(node);
  }

  while (runtime.textNodes.length > count) {
    const node = runtime.textNodes.pop();

    node?.removeFromParent();
    node?.destroy();
  }
};

const getSingleLineTextOffsetX = ({
  contentWidth,
  lineWidth,
  align,
  scrollOffsetX,
}) =>
  lineWidth > contentWidth
    ? -scrollOffsetX
    : getTextLineX({
        contentWidth,
        lineWidth,
        align,
      });

const getMultilineLineOffsetX = ({ contentWidth, lineWidth, align }) =>
  getTextLineX({
    contentWidth,
    lineWidth,
    align,
  });

const getMultilineLineOriginX = ({
  padding,
  contentWidth,
  lineWidth,
  align,
  scrollOffsetX,
}) =>
  padding.left +
  getMultilineLineOffsetX({
    contentWidth,
    lineWidth,
    align,
  }) -
  scrollOffsetX;

export const createInputDisplay = (element) => {
  const background = new Graphics();
  background.label = `${element.id}-background`;
  background.on("destroyed", () => {
    destroyRectFillResource(background);
  });

  const selection = new Graphics();
  selection.label = `${element.id}-selection`;

  const text = new Container();
  text.label = `${element.id}-text`;

  const placeholder = new Text({
    label: `${element.id}-placeholder`,
    text: element.placeholder,
  });

  const caret = new Graphics();
  caret.label = `${element.id}-caret`;

  const clip = new Graphics();
  clip.label = `${element.id}-clip`;

  text.mask = clip;
  placeholder.mask = clip;
  selection.mask = clip;
  caret.mask = clip;

  return {
    background,
    selection,
    text,
    placeholder,
    caret,
    clip,
  };
};

export const buildInputRuntime = ({ app, container, display, element }) => ({
  app,
  container,
  ...display,
  value: normalizeInputValue(element.value ?? ""),
  selectionStart: normalizeInputValue(element.value ?? "").length,
  selectionEnd: normalizeInputValue(element.value ?? "").length,
  focused: false,
  nativeFocused: false,
  composing: false,
  blinkVisible: true,
  blinkTick: 0,
  scrollOffsetX: 0,
  scrollOffsetY: 0,
  selectionAnchor: null,
  draggingSelection: false,
  textNodes: [],
  layoutState: null,
  lastExternalValue: normalizeInputValue(element.value ?? ""),
  tickerListener: null,
  element,
});

export const getInputGeometry = (app, container, fallbackElement) => {
  const boundsInfo = getVisibleBounds({
    app,
    container,
    fallbackElement,
  });

  if (!boundsInfo) {
    return null;
  }

  const { fullBounds, visibleBounds } = boundsInfo;
  const clipInsets = getClipInsets(fullBounds, visibleBounds);

  return {
    x: fullBounds.x,
    y: fullBounds.y,
    width: fullBounds.width,
    height: fullBounds.height,
    visible:
      Boolean(visibleBounds) &&
      container.visible !== false &&
      container.renderable !== false,
    clipInsets,
  };
};

export const hitTestInput = (container, element, point) => {
  if (
    !container ||
    container.destroyed === true ||
    typeof container.toLocal !== "function" ||
    !Number.isFinite(point?.x) ||
    !Number.isFinite(point?.y) ||
    !Number.isFinite(element?.width) ||
    !Number.isFinite(element?.height) ||
    element.width <= 0 ||
    element.height <= 0
  ) {
    return false;
  }

  const localPoint = container.toLocal(point);

  return (
    localPoint.x >= 0 &&
    localPoint.x <= element.width &&
    localPoint.y >= 0 &&
    localPoint.y <= element.height
  );
};

export const syncInputView = (runtime, element) => {
  const padding = resolvePadding(element.padding);
  const contentWidth = Math.max(
    0,
    element.width - padding.left - padding.right,
  );
  const contentHeight = Math.max(
    0,
    element.height - padding.top - padding.bottom,
  );
  const textStyle = resolveInputTextStyle(element.textStyle, {
    wordWrapWidth: contentWidth,
  });
  const placeholderStyle = resolveInputTextStyle(
    {
      ...element.textStyle,
      fill: "#7A7A7A",
    },
    {
      wordWrapWidth: contentWidth,
    },
  );
  const displayedValue = String(runtime.value ?? "");
  const layout = getLayout({
    element,
    displayedValue,
    textStyle,
  });
  const align = textStyle.align ?? "left";
  const selectionStart = clamp(
    Math.min(runtime.selectionStart, runtime.selectionEnd),
    0,
    displayedValue.length,
  );
  const selectionEnd = clamp(
    Math.max(runtime.selectionStart, runtime.selectionEnd),
    0,
    displayedValue.length,
  );
  const caretIndex = clamp(
    runtime.selectionEnd ?? displayedValue.length,
    0,
    displayedValue.length,
  );

  runtime.layoutState = {
    padding,
    contentWidth,
    contentHeight,
    textStyle,
    placeholderStyle,
    displayedValue,
    layout,
    align,
  };

  ensureTextLineNodes(runtime, layout.lines.length);

  runtime.textNodes.forEach((textNode, lineIndex) => {
    const line = layout.lines[lineIndex] ?? {
      text: "",
      width: 0,
    };

    applyTextStyle(textNode, textStyle);
    textNode.text = line.text;
  });

  applyTextStyle(runtime.placeholder, placeholderStyle);
  runtime.placeholder.text = element.placeholder ?? "";

  if (!element.multiline) {
    const line = layout.lines[0];
    const caretXUnscrolled = measureWidth(
      line.text.slice(0, caretIndex),
      textStyle,
    );

    if (line.width <= contentWidth) {
      runtime.scrollOffsetX = 0;
    } else if (runtime.focused) {
      const caretMargin = 8;
      const maxScrollOffset = Math.max(0, line.width - contentWidth);

      if (
        caretXUnscrolled - runtime.scrollOffsetX >
        contentWidth - caretMargin
      ) {
        runtime.scrollOffsetX = caretXUnscrolled - (contentWidth - caretMargin);
      } else if (caretXUnscrolled - runtime.scrollOffsetX < caretMargin) {
        runtime.scrollOffsetX = caretXUnscrolled - caretMargin;
      }

      runtime.scrollOffsetX = clamp(runtime.scrollOffsetX, 0, maxScrollOffset);
    } else {
      runtime.scrollOffsetX = 0;
    }

    runtime.scrollOffsetY = 0;
  } else {
    const caretLocation = getCaretLocationFromValue({
      value: displayedValue,
      index: caretIndex,
    });
    const caretLine = layout.lines[caretLocation.line] ?? layout.lines.at(-1);
    const caretLineWidth = caretLine?.width ?? 0;
    const caretXUnscrolled = measureWidth(
      (caretLine?.text ?? "").slice(0, caretLocation.column),
      textStyle,
    );
    const totalHeight = layout.totalHeight;
    const caretTop = caretLocation.line * layout.lineHeight;
    const caretBottom = caretTop + layout.lineHeight;

    if (caretLineWidth <= contentWidth) {
      runtime.scrollOffsetX = 0;
    } else if (runtime.focused) {
      const caretMargin = 8;
      const maxScrollOffset = Math.max(0, caretLineWidth - contentWidth);

      if (
        caretXUnscrolled - runtime.scrollOffsetX >
        contentWidth - caretMargin
      ) {
        runtime.scrollOffsetX = caretXUnscrolled - (contentWidth - caretMargin);
      } else if (caretXUnscrolled - runtime.scrollOffsetX < caretMargin) {
        runtime.scrollOffsetX = caretXUnscrolled - caretMargin;
      }

      runtime.scrollOffsetX = clamp(runtime.scrollOffsetX, 0, maxScrollOffset);
    } else {
      runtime.scrollOffsetX = 0;
    }

    if (totalHeight <= contentHeight) {
      runtime.scrollOffsetY = 0;
    } else if (runtime.focused) {
      const maxScrollOffsetY = Math.max(0, totalHeight - contentHeight);

      if (caretBottom - runtime.scrollOffsetY > contentHeight) {
        runtime.scrollOffsetY = caretBottom - contentHeight;
      } else if (caretTop - runtime.scrollOffsetY < 0) {
        runtime.scrollOffsetY = caretTop;
      }

      runtime.scrollOffsetY = clamp(runtime.scrollOffsetY, 0, maxScrollOffsetY);
    } else {
      runtime.scrollOffsetY = 0;
    }
  }

  if (element.multiline) {
    runtime.text.x = padding.left - runtime.scrollOffsetX;
    runtime.text.y = padding.top - runtime.scrollOffsetY;

    runtime.textNodes.forEach((textNode, lineIndex) => {
      const line = layout.lines[lineIndex] ?? {
        width: 0,
      };

      textNode.x = getMultilineLineOffsetX({
        contentWidth,
        lineWidth: line.width,
        align,
      });
      textNode.y = lineIndex * layout.lineHeight;
    });
  } else {
    const line = layout.lines[0];
    const textNode = runtime.textNodes[0];
    const textOffsetX = getSingleLineTextOffsetX({
      contentWidth,
      lineWidth: line.width,
      align,
      scrollOffsetX: runtime.scrollOffsetX,
    });

    textNode.x = 0;
    textNode.y = 0;
    runtime.text.x = padding.left + textOffsetX;
    runtime.text.y =
      padding.top + Math.max(0, (contentHeight - textNode.height) / 2);
  }

  const placeholderMetrics = CanvasTextMetrics.measureText(
    runtime.placeholder.text,
    createMeasuredStyle(placeholderStyle),
  );

  runtime.placeholder.x = padding.left;
  runtime.placeholder.y = element.multiline
    ? padding.top
    : padding.top +
      Math.max(0, (contentHeight - runtime.placeholder.height) / 2);

  if (placeholderMetrics.width <= contentWidth) {
    runtime.placeholder.x += getTextLineX({
      contentWidth,
      lineWidth: placeholderMetrics.width,
      align,
    });
  }

  runtime.placeholder.visible =
    runtime.value.length === 0 && runtime.composing !== true;

  const drawBackgroundRect = () => {
    runtime.background.rect(0, 0, element.width, element.height);
  };
  const fill = element.fill !== undefined ? element.fill : DEFAULT_INPUT_FILL;
  const border = element.border ?? DEFAULT_INPUT_BORDER;
  const focusRing = element.focusRing ?? DEFAULT_INPUT_FOCUS_RING;

  runtime.background.clear();
  drawBackgroundRect();
  runtime.background.fill(resolveRectFill(runtime.background, fill, element));

  if (border.width > 0) {
    runtime.background.stroke({
      color: border.color,
      alpha: border.alpha,
      width: border.width,
    });
  }

  if (runtime.focused && focusRing.width > 0 && element.disabled !== true) {
    drawBackgroundRect();
    runtime.background.stroke({
      color: focusRing.color,
      alpha: focusRing.alpha,
      width: focusRing.width,
    });
  }

  runtime.clip.clear();
  runtime.clip.rect(
    padding.left,
    padding.top,
    contentWidth,
    Math.max(0, contentHeight),
  );
  runtime.clip.fill({ color: 0xffffff, alpha: 1 });

  runtime.selection.clear();

  if (
    runtime.focused &&
    selectionStart !== selectionEnd &&
    element.disabled !== true
  ) {
    if (!element.multiline) {
      const line = layout.lines[0];
      const lineOffsetX = getSingleLineTextOffsetX({
        contentWidth,
        lineWidth: line.width,
        align,
        scrollOffsetX: runtime.scrollOffsetX,
      });
      const startX =
        padding.left +
        lineOffsetX +
        measureWidth(line.text.slice(0, selectionStart), textStyle);
      const endX =
        padding.left +
        lineOffsetX +
        measureWidth(line.text.slice(0, selectionEnd), textStyle);
      const selectionY =
        padding.top + Math.max(0, (contentHeight - runtime.text.height) / 2);

      runtime.selection.rect(
        startX,
        selectionY,
        Math.max(endX - startX, 1),
        Math.max(runtime.text.height, textStyle.lineHeight),
      );
    } else {
      const startLocation = getCaretLocationFromValue({
        value: displayedValue,
        index: selectionStart,
      });
      const endLocation = getCaretLocationFromValue({
        value: displayedValue,
        index: selectionEnd,
      });

      for (
        let lineIndex = startLocation.line;
        lineIndex <= endLocation.line;
        lineIndex += 1
      ) {
        const line = layout.lines[lineIndex];

        if (!line) continue;

        const lineStartColumn =
          lineIndex === startLocation.line ? startLocation.column : 0;
        const lineEndColumn =
          lineIndex === endLocation.line
            ? endLocation.column
            : line.text.length;
        const startX =
          getMultilineLineOriginX({
            padding,
            contentWidth,
            lineWidth: line.width,
            align,
            scrollOffsetX: runtime.scrollOffsetX,
          }) + measureWidth(line.text.slice(0, lineStartColumn), textStyle);
        const endX =
          getMultilineLineOriginX({
            padding,
            contentWidth,
            lineWidth: line.width,
            align,
            scrollOffsetX: runtime.scrollOffsetX,
          }) + measureWidth(line.text.slice(0, lineEndColumn), textStyle);
        const lineY =
          padding.top + lineIndex * layout.lineHeight - runtime.scrollOffsetY;

        runtime.selection.rect(
          startX,
          lineY,
          Math.max(endX - startX, 1),
          layout.lineHeight,
        );
      }
    }

    runtime.selection.fill({
      color: DEFAULT_INPUT_SELECTION_STYLE.fill,
      alpha: DEFAULT_INPUT_SELECTION_STYLE.alpha,
    });
  }

  runtime.caret.clear();

  if (
    runtime.focused &&
    runtime.selectionStart === runtime.selectionEnd &&
    runtime.blinkVisible !== false &&
    element.disabled !== true
  ) {
    if (!element.multiline) {
      const line = layout.lines[0];
      const lineOffsetX = getSingleLineTextOffsetX({
        contentWidth,
        lineWidth: line.width,
        align,
        scrollOffsetX: runtime.scrollOffsetX,
      });
      const caretX =
        padding.left +
        lineOffsetX +
        measureWidth(line.text.slice(0, caretIndex), textStyle);
      const caretY =
        padding.top + Math.max(0, (contentHeight - runtime.text.height) / 2);

      runtime.caret.rect(
        caretX,
        caretY,
        DEFAULT_INPUT_CARET_STYLE.width,
        Math.max(runtime.text.height, textStyle.lineHeight),
      );
    } else {
      const caretLocation = getCaretLocationFromValue({
        value: displayedValue,
        index: caretIndex,
      });
      const caretLine = layout.lines[caretLocation.line] ?? layout.lines.at(-1);
      const caretX =
        getMultilineLineOriginX({
          padding,
          contentWidth,
          lineWidth: caretLine?.width ?? 0,
          align,
          scrollOffsetX: runtime.scrollOffsetX,
        }) +
        measureWidth(
          (caretLine?.text ?? "").slice(0, caretLocation.column),
          textStyle,
        );
      const caretY =
        padding.top +
        caretLocation.line * layout.lineHeight -
        runtime.scrollOffsetY;

      runtime.caret.rect(
        caretX,
        caretY,
        DEFAULT_INPUT_CARET_STYLE.width,
        layout.lineHeight,
      );
    }

    runtime.caret.fill({
      color: DEFAULT_INPUT_CARET_STYLE.fill,
      alpha: 1,
    });
  }
};

export const getInputIndexFromLocalPoint = (runtime, point) => {
  const layoutState = runtime.layoutState;

  if (!layoutState) {
    return 0;
  }

  const { padding, contentWidth, textStyle, displayedValue, layout, align } =
    layoutState;
  const localX = point?.x ?? 0;
  const localY = point?.y ?? 0;

  if (!runtime.element.multiline) {
    const line = layout.lines[0] ?? {
      text: displayedValue,
      width: measureWidth(displayedValue, textStyle),
    };
    const lineOffsetX = getSingleLineTextOffsetX({
      contentWidth,
      lineWidth: line.width,
      align,
      scrollOffsetX: runtime.scrollOffsetX,
    });
    const textOriginX = padding.left + lineOffsetX;

    return getNearestTextIndex({
      text: line.text,
      style: textStyle,
      targetX: localX - textOriginX,
    });
  }

  const lineHeight = layout.lineHeight || textStyle.lineHeight || 1;
  const lineIndex = clamp(
    Math.floor((localY - padding.top + runtime.scrollOffsetY) / lineHeight),
    0,
    Math.max(layout.lines.length - 1, 0),
  );
  const line = layout.lines[lineIndex] ?? {
    text: "",
    startIndex: 0,
  };
  const column = getNearestTextIndex({
    text: line.text,
    style: textStyle,
    targetX:
      localX -
      getMultilineLineOriginX({
        padding,
        contentWidth,
        lineWidth: line.width ?? 0,
        align,
        scrollOffsetX: runtime.scrollOffsetX,
      }),
  });

  return line.startIndex + column;
};
