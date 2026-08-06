import { CanvasTextMetrics, TextStyle } from "pixi.js";
import { parseCommonObject } from "../util/parseCommonObject.js";
import { DEFAULT_TEXT_STYLE } from "../../../types.js";
import { toPixiTextStyle } from "../../../util/toPixiTextStyle.js";
import { mergeTextStyle } from "../../../util/mergeTextStyle.js";
import {
  normalizeAnimatedSpriteAtlas,
  normalizeAnimatedSpriteClips,
  normalizeAnimatedSpritePlayback,
} from "../animated-sprite/animatedSpriteConfig.js";
import { normalizeSoftWipeConfig } from "./softWipeConfig.js";

const normalizeInitialRevealedCharacters = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
};

const DEFAULT_FURIGANA_PLACEMENT = "top";
const LEGACY_TOP_FURIGANA_OFFSET = 2;
const FURIGANA_PLACEMENTS = ["top", "bottom"];
const FURIGANA_PLACEMENT_SET = new Set(FURIGANA_PLACEMENTS);
const DEFAULT_TEXT_REVEAL_INDICATOR_OFFSET_X = 16;
const DEFAULT_TEXT_REVEAL_INDICATOR_OFFSET_Y = 0;
const INDICATOR_VISUAL_KINDS = ["image", "spritesheet"];
const INDICATOR_VISUAL_KIND_SET = new Set(INDICATOR_VISUAL_KINDS);
const DEFAULT_REVEAL_SOUND_VOLUME = 100;
const DEFAULT_REVEAL_SOUND_LOOP = true;
const DEFAULT_REVEAL_SOUND_STOP_TIMING = "loopEnd";
const REVEAL_SOUND_STOP_TIMINGS = ["loopEnd", "immediate"];
const REVEAL_SOUND_STOP_TIMING_SET = new Set(REVEAL_SOUND_STOP_TIMINGS);

export const normalizeFuriganaPlacement = (placement, path) => {
  if (placement === undefined) {
    return DEFAULT_FURIGANA_PLACEMENT;
  }

  if (FURIGANA_PLACEMENT_SET.has(placement)) {
    return placement;
  }

  throw new Error(
    `Input Error: ${path}.placement must be one of ${FURIGANA_PLACEMENTS.join(
      ", ",
    )}.`,
  );
};

export const normalizeFuriganaGap = (gap, path) => {
  if (gap === undefined) {
    return 0;
  }

  if (typeof gap === "number" && Number.isFinite(gap) && gap >= 0) {
    return gap;
  }

  throw new Error(`Input Error: ${path}.gap must be a finite number >= 0.`);
};

const getIndicatorVisualKind = (visual = {}) =>
  visual.kind ??
  (visual.atlas !== undefined ||
  visual.clips !== undefined ||
  visual.playback !== undefined
    ? "spritesheet"
    : "image");

export const normalizeIndicatorVisual = (visual = {}, path) => {
  const kind = getIndicatorVisualKind(visual);

  if (!INDICATOR_VISUAL_KIND_SET.has(kind)) {
    throw new Error(
      `Input Error: ${path}.kind must be one of ${INDICATOR_VISUAL_KINDS.join(
        ", ",
      )}.`,
    );
  }

  const baseVisual = {
    kind,
    src: visual.src ?? "",
    width: visual.width ?? 12,
    height: visual.height ?? 12,
  };

  if (visual.offsetX !== undefined) {
    baseVisual.offsetX = visual.offsetX;
  }

  if (visual.offsetY !== undefined) {
    baseVisual.offsetY = visual.offsetY;
  }

  if (kind === "image") {
    return baseVisual;
  }

  const atlasInput = visual.atlas;
  const atlas = normalizeAnimatedSpriteAtlas(atlasInput);
  const clips = normalizeAnimatedSpriteClips(
    visual.clips,
    atlasInput?.animations,
    atlasInput?.meta,
    Object.keys(atlas.frames ?? {}),
  );
  const playback = normalizeAnimatedSpritePlayback({
    atlas,
    clips,
    playback: visual.playback,
  });

  return {
    ...baseVisual,
    atlas,
    clips,
    playback,
  };
};

const normalizeRevealSoundVolume = (volume, path) => {
  if (volume === undefined) {
    return DEFAULT_REVEAL_SOUND_VOLUME;
  }

  if (
    typeof volume === "number" &&
    Number.isFinite(volume) &&
    volume >= 0 &&
    volume <= 100
  ) {
    return volume;
  }

  throw new Error(
    `Input Error: ${path}.volume must be a finite number between 0 and 100.`,
  );
};

const normalizeRevealSoundLoop = (loop, path) => {
  if (loop === undefined) {
    return DEFAULT_REVEAL_SOUND_LOOP;
  }

  if (typeof loop === "boolean") {
    return loop;
  }

  throw new Error(`Input Error: ${path}.loop must be a boolean.`);
};

const normalizeRevealSoundStopTiming = (stopTiming, path) => {
  if (stopTiming === undefined) {
    return DEFAULT_REVEAL_SOUND_STOP_TIMING;
  }

  if (REVEAL_SOUND_STOP_TIMING_SET.has(stopTiming)) {
    return stopTiming;
  }

  throw new Error(
    `Input Error: ${path}.stopTiming must be one of ${REVEAL_SOUND_STOP_TIMINGS.join(
      ", ",
    )}.`,
  );
};

export const normalizeRevealSound = (revealSound, path = "revealSound") => {
  if (revealSound === undefined || revealSound === null) {
    return null;
  }

  if (typeof revealSound !== "object" || Array.isArray(revealSound)) {
    throw new Error(`Input Error: ${path} must be an object.`);
  }

  if (typeof revealSound.src !== "string" || revealSound.src.length === 0) {
    throw new Error(`Input Error: ${path}.src must be a non-empty string.`);
  }

  return {
    src: revealSound.src,
    volume: normalizeRevealSoundVolume(revealSound.volume, path),
    loop: normalizeRevealSoundLoop(revealSound.loop, path),
    stopTiming: normalizeRevealSoundStopTiming(revealSound.stopTiming, path),
  };
};

const getFuriganaPosition = ({
  placement,
  gap,
  x,
  y,
  partWidth,
  partHeight,
  furiganaWidth,
  furiganaHeight,
}) => {
  const furiganaX = Math.round(x + (partWidth - furiganaWidth) / 2);

  if (placement === "bottom") {
    return {
      x: furiganaX,
      y: y + partHeight + gap,
    };
  }

  return {
    x: furiganaX,
    y: y - furiganaHeight + LEGACY_TOP_FURIGANA_OFFSET - gap,
  };
};

/**
 * @typedef {import('../../../types.js').BaseElement} BaseElement
 * @typedef {import('../../../types.js').TextRevealingComputedNode} TextRevealingComputedNode
 */

/**
 * @param {string} character
 * @returns {boolean}
 */
const isNewlineCharacter = (character) =>
  character === "\n" || character === "\r";

/**
 * @param {string} character
 * @returns {boolean}
 */
const isBreakingSpaceCharacter = (character) =>
  typeof character === "string" && CanvasTextMetrics.isBreakingSpace(character);

/**
 * Consume the original source text that produced the first measured line.
 * Wrapped whitespace is discarded, while explicit newline boundaries are kept.
 *
 * @param {string} originalText
 * @param {string} visibleText
 * @param {boolean} wrappedToAdditionalLines
 * @returns {{ remainingText: string, consumedExplicitNewline: boolean }}
 */
const consumeMeasuredLineFromSource = (
  originalText,
  visibleText,
  wrappedToAdditionalLines,
) => {
  let sourceIndex = 0;
  let visibleIndex = 0;

  while (
    sourceIndex < originalText.length &&
    visibleIndex < visibleText.length &&
    originalText[sourceIndex] === visibleText[visibleIndex]
  ) {
    sourceIndex += 1;
    visibleIndex += 1;
  }

  if (visibleIndex < visibleText.length) {
    const fallbackIndex = Math.min(originalText.length, visibleText.length);

    return {
      remainingText: originalText.slice(fallbackIndex),
      consumedExplicitNewline: false,
    };
  }

  const matchedIndex = sourceIndex;
  let nextIndex = matchedIndex;

  while (
    nextIndex < originalText.length &&
    isBreakingSpaceCharacter(originalText[nextIndex])
  ) {
    nextIndex += 1;
  }

  if (isNewlineCharacter(originalText[nextIndex])) {
    let consumedIndex = nextIndex + 1;

    if (
      originalText[nextIndex] === "\r" &&
      originalText[nextIndex + 1] === "\n"
    ) {
      consumedIndex += 1;
    }

    return {
      remainingText: originalText.slice(consumedIndex),
      consumedExplicitNewline: true,
    };
  }

  if (wrappedToAdditionalLines) {
    return {
      remainingText: originalText.slice(nextIndex),
      consumedExplicitNewline: false,
    };
  }

  return {
    remainingText: originalText.slice(matchedIndex),
    consumedExplicitNewline: false,
  };
};

/**
 * Creates text chunks (lines) from content segments
 * @param {Array} segments - Text segments with styles
 * @param {number} wordWrapWidth - Maximum width for wrapping
 * @returns {Object} Object containing chunks and dimensions
 */
export const createTextChunks = (
  segments,
  wordWrapWidth,
  { minimumWidth = wordWrapWidth } = {},
) => {
  const chunks = [];
  let lineParts = [];
  let x = 0;
  let y = 0;
  let lineMaxHeight = 0;
  let maxTotalWidth = 0;
  let iterationCount = 0;

  const segmentCopy = [...segments];
  const segmentFuriganaAdded = new WeakSet();
  const maxIterations = Math.max(
    10,
    segments.reduce((sum, segment) => sum + (segment?.text?.length ?? 0), 0) *
      4,
  );
  const pushCurrentLine = () => {
    chunks.push({
      lineParts: [...lineParts],
      y,
      lineMaxHeight,
    });

    x = 0;
    y += lineMaxHeight;
    lineMaxHeight = 0;
    lineParts = [];
  };

  while (segmentCopy.length > 0) {
    iterationCount += 1;
    if (iterationCount > maxIterations) {
      throw new Error(
        "[parseTextRevealing] Failed to make progress while wrapping text.",
      );
    }

    const segment = segmentCopy[0];

    // Skip empty segments
    if (!segment.text || segment.text.length === 0) {
      segmentCopy.shift();
      continue;
    }

    const originalText = segment.text;
    const remainingWidth = Math.max(1, Math.round(wordWrapWidth - x));
    const styleWithWordWrap = segment.textStyle.wordWrap
      ? {
          ...segment.textStyle,
          wordWrapWidth: remainingWidth,
        }
      : segment.textStyle;

    const measurements = CanvasTextMetrics.measureText(
      segment.text,
      new TextStyle(
        toPixiTextStyle(styleWithWordWrap, { includeShadow: false }),
      ),
    );

    // Check if text fits on current line
    if (measurements.lineWidths[0] > remainingWidth && lineParts.length > 0) {
      // Wrap to next line
      pushCurrentLine();
      continue; // Try again with full width
    }

    // Extract text that fits on this line
    let textPart = measurements.lines[0] ?? "";
    const wrappedToAdditionalLines = measurements.lines.length > 1;
    let remainingText = "";
    let consumedExplicitNewline = false;

    // Preserve trailing spaces that might get trimmed by measureText
    if (
      measurements.lines.length === 1 &&
      segment.text.endsWith(" ") &&
      !textPart.endsWith(" ")
    ) {
      textPart += " ";
    }

    if (textPart.length > 0) {
      const consumed = consumeMeasuredLineFromSource(
        originalText,
        textPart,
        wrappedToAdditionalLines,
      );

      remainingText = consumed.remainingText;
      consumedExplicitNewline = consumed.consumedExplicitNewline;
    }

    if (textPart.length === 0 && originalText.length > 0) {
      const leadingWhitespace = originalText.match(/^\s+/)?.[0] ?? "";

      textPart =
        leadingWhitespace.length > 0 ? leadingWhitespace : originalText[0];
      remainingText = originalText.slice(textPart.length);
    }

    if (remainingText === originalText) {
      const fallbackPart =
        originalText.match(/^\s+/)?.[0] ?? originalText[0] ?? "";

      if (fallbackPart.length === 0) {
        throw new Error(
          "[parseTextRevealing] Failed to consume text while wrapping.",
        );
      }

      textPart = fallbackPart;
      remainingText = originalText.slice(fallbackPart.length);
    }

    //Get the height with now wrapping
    const measurementsWithNoWrapping = CanvasTextMetrics.measureText(
      textPart,
      new TextStyle({
        ...toPixiTextStyle(segment.textStyle, { includeShadow: false }),
        wordWrap: false,
        breakWords: false,
      }),
    );
    const partWidth = Math.max(
      0,
      Math.round(
        measurementsWithNoWrapping.width ?? measurements.lineWidths[0] ?? 0,
      ),
    );

    // Create text part object
    const newTextPart = {
      text: textPart,
      textStyle: styleWithWordWrap,
      height: measurementsWithNoWrapping.height,
      x,
      y,
    };

    // Add furigana if present and not already added for this segment
    if (segment.furigana && !segmentFuriganaAdded.has(segment)) {
      segmentFuriganaAdded.add(segment);

      const furiganaMeasurements = CanvasTextMetrics.measureText(
        segment.furigana.text,
        new TextStyle(
          toPixiTextStyle(segment.furigana.textStyle, {
            includeShadow: false,
          }),
        ),
      );

      const furiganaPosition = getFuriganaPosition({
        placement: segment.furigana.placement,
        gap: segment.furigana.gap,
        x,
        y,
        partWidth,
        partHeight: measurementsWithNoWrapping.height,
        furiganaWidth: furiganaMeasurements.width,
        furiganaHeight: furiganaMeasurements.height,
      });

      const furiganaPart = {
        text: segment.furigana.text,
        textStyle: segment.furigana.textStyle,
        x: furiganaPosition.x,
        y: furiganaPosition.y,
      };

      newTextPart.furigana = furiganaPart;
    }
    lineParts.push(newTextPart);

    lineMaxHeight = Math.max(lineMaxHeight, measurementsWithNoWrapping.height);

    // Update horizontal position and track max width
    x += partWidth;
    maxTotalWidth = Math.max(maxTotalWidth, x);

    // Handle remaining text
    if (remainingText && remainingText.length > 0) {
      segment.text = remainingText;
    } else {
      segmentCopy.shift();
    }

    if ((wrappedToAdditionalLines || consumedExplicitNewline) && x > 0) {
      pushCurrentLine();
    }
  }

  // Add final line if there are remaining parts
  if (lineParts.length > 0) {
    chunks.push({
      lineParts,
      y,
      lineMaxHeight,
    });
  }

  //Align them to the bottom
  for (let i = 0; i < chunks.length; i++) {
    const tallestHeight = chunks[i].lineMaxHeight;
    chunks[i].lineParts = chunks[i].lineParts.map((part) => {
      const partHeight = part.height;
      if (part.height) delete part.height;
      const bottomAlignYPos = part.y + (tallestHeight - partHeight);

      let furigana = part.furigana;
      if (furigana) {
        furigana.y = furigana.y - part.y + bottomAlignYPos;
      }

      return {
        ...part,
        ...(furigana && { furigana }),
        y: bottomAlignYPos,
      };
    });
  }

  // Calculate final height
  const finalHeight =
    chunks.length > 0
      ? chunks[chunks.length - 1].y + chunks[chunks.length - 1].lineMaxHeight
      : 0;

  return {
    chunks,
    width: Math.max(maxTotalWidth, minimumWidth),
    height: finalHeight,
  };
};

export const prepareRichTextSegments = ({ content, defaultTextStyle, width }) =>
  (content || []).map((item, itemIndex) => {
    const itemTextStyle = mergeTextStyle(defaultTextStyle, item.textStyle);

    itemTextStyle.lineHeight = Math.round(
      itemTextStyle.lineHeight * itemTextStyle.fontSize,
    );

    if (typeof width === "number") {
      itemTextStyle.wordWrapWidth = width;
      itemTextStyle.wordWrap = true;
    }

    let furigana = null;
    if (item.furigana) {
      const furiganaTextStyle = mergeTextStyle(
        defaultTextStyle,
        item.furigana.textStyle,
      );

      furiganaTextStyle.lineHeight = Math.round(
        furiganaTextStyle.lineHeight * furiganaTextStyle.fontSize,
      );

      if (typeof width === "number") {
        furiganaTextStyle.wordWrapWidth = width;
        furiganaTextStyle.wordWrap = true;
      }

      furigana = {
        text: String(item.furigana.text),
        textStyle: furiganaTextStyle,
        placement: normalizeFuriganaPlacement(
          item.furigana.placement,
          `content[${itemIndex}].furigana`,
        ),
        gap: normalizeFuriganaGap(
          item.furigana.gap,
          `content[${itemIndex}].furigana`,
        ),
      };
    }

    const convertedText = String(item.text).replace(/ +$/, (match) =>
      "\u00A0".repeat(match.length),
    );

    return {
      text: convertedText,
      textStyle: itemTextStyle,
      ...(furigana && { furigana }),
    };
  });

/**
 * Parse text-revealing object and calculate final position after anchor adjustment
 * @param {Object} params
 * @param {BaseElement} params.state - The text-revealing state to parse
 * @param {Array} params.parserPlugins - Array of parser plugins (not used by this parser)
 * @returns {TextRevealingComputedNode}
 */
export const parseTextRevealing = ({ state }) => {
  const revealSound = normalizeRevealSound(state.revealSound);
  const defaultTextStyle = mergeTextStyle(
    {
      ...DEFAULT_TEXT_STYLE,
      wordWrap: true,
    },
    state.textStyle,
  );

  const processedContent = prepareRichTextSegments({
    content: state.content,
    defaultTextStyle,
    width: state.width || undefined,
  });

  // Calculate text dimensions using unified chunk approach
  const wordWrapWidth = state.width || 500;
  const {
    chunks,
    width: calculatedWidth,
    height: calculatedHeight,
  } = createTextChunks(processedContent, wordWrapWidth);

  const finalWidth = state.width || calculatedWidth;
  const finalHeight = calculatedHeight;

  let computedObj = parseCommonObject({
    ...state,
    width: finalWidth,
    height: finalHeight,
  });

  computedObj.alpha = state.alpha ?? 1;

  if (state.indicator) {
    const indicator = state.indicator;

    if (indicator.offset !== undefined) {
      throw new Error(
        "Input Error: indicator.offset is no longer supported. Use offsetX and offsetY.",
      );
    }

    computedObj.indicator = {
      revealing: normalizeIndicatorVisual(
        indicator.revealing,
        "indicator.revealing",
      ),
      complete: normalizeIndicatorVisual(
        indicator.complete,
        "indicator.complete",
      ),
      offsetX: indicator.offsetX ?? DEFAULT_TEXT_REVEAL_INDICATOR_OFFSET_X,
      offsetY: indicator.offsetY ?? DEFAULT_TEXT_REVEAL_INDICATOR_OFFSET_Y,
    };
  }

  return {
    ...computedObj,
    content: chunks,
    textStyle: {
      ...defaultTextStyle,
    },
    speed: state.speed ?? 50,
    revealEffect: state.revealEffect ?? "typewriter",
    ...(state.softWipe !== undefined && {
      softWipe: normalizeSoftWipeConfig(state.softWipe),
    }),
    ...(state.initialRevealedCharacters !== undefined && {
      initialRevealedCharacters: normalizeInitialRevealedCharacters(
        state.initialRevealedCharacters,
      ),
    }),
    ...(revealSound && { revealSound }),
    ...(state.scaleX !== undefined && { scaleX: state.scaleX }),
    ...(state.scaleY !== undefined && { scaleY: state.scaleY }),
    ...(state.complete && { complete: state.complete }),
  };
};
