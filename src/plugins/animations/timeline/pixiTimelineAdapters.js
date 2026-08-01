import { TRANSITION_PROPERTY_PATH_MAP } from "../../../types.js";
import {
  applyAnimationProperty,
  createAnimationSubjectState,
  getAnimationProperty,
} from "../animationPropertyUtils.js";
import { getRectStyleAnimationBatchHooks } from "../../elements/rect/rectStyleRuntime.js";
import { getShaderFilterAnimationTarget } from "../../elements/util/shaderFilterEffect.js";
import {
  CanvasTextMetrics,
  Container,
  Text,
  fontStringFromTextStyle,
} from "pixi.js";
import { fnv1a64, randomStateHex } from "./random.js";
import { segmentPortableText } from "./textSegmentation.js";

export const PIXI_TIMELINE_TEXT_UNITS = Symbol.for(
  "routeGraphics.timelineTextUnits",
);

const pendingTextUnitPreparations = new WeakMap();
const textUnitStateByHandle = new WeakMap();

const copyDisplayTransform = (source, target) => {
  target.x = source.x ?? 0;
  target.y = source.y ?? 0;
  target.scale?.set?.(source.scale?.x ?? 1, source.scale?.y ?? 1);
  target.pivot?.set?.(source.pivot?.x ?? 0, source.pivot?.y ?? 0);
  target.skew?.set?.(source.skew?.x ?? 0, source.skew?.y ?? 0);
  target.rotation = source.rotation ?? 0;
  target.alpha = source.alpha ?? 1;
  target.zIndex = source.zIndex ?? 0;
  target.visible = source.visible;
};

const getTextStyleFingerprint = (style) =>
  [
    style?.fontFamily,
    style?.fontSize,
    style?.fontWeight,
    style?.fontStyle,
    style?.letterSpacing,
    style?.lineHeight,
    style?.align,
    style?.wordWrap,
    style?.wordWrapWidth,
  ].join("\u0000");

const getTextUnitFingerprint = (text, style, query) =>
  randomStateHex(
    fnv1a64(
      new TextEncoder().encode(
        [
          text,
          getTextStyleFingerprint(style),
          query.unit,
          query.order,
          query.segmentation.version,
        ].join("\u0001"),
      ),
    ),
  );

const countLineBreaks = (text, end) => {
  let count = 0;
  for (let index = 0; index < end; index++) {
    if (text[index] === "\n") count++;
  }
  return count;
};

const measureTextWidth = (text, style) =>
  text.length === 0
    ? 0
    : CanvasTextMetrics.measureText(text, style).maxLineWidth;

const measureTextAdvance = (text, style) => {
  if (text.length === 0) return 0;
  const context = CanvasTextMetrics._context;
  context.font = fontStringFromTextStyle(style);
  if ("letterSpacing" in context) context.letterSpacing = "0px";
  if ("textLetterSpacing" in context) context.textLetterSpacing = "0px";
  const graphemeCount = CanvasTextMetrics.graphemeSegmenter(text).length;
  return (
    context.measureText(text).width +
    Math.max(0, graphemeCount - 1) * Number(style?.letterSpacing ?? 0)
  );
};

const contextShapingScriptPattern =
  /[\u0590-\u08ff\u0900-\u0fff\u1780-\u18af\ufb1d-\ufdff\ufe70-\ufefc]/u;

const assertIndependentTextUnitsAreLayoutSafe = (
  sourceText,
  style,
  units,
  elementId,
) => {
  if (units.length <= 1) return;
  if (style?.wordWrap) {
    throw new Error(
      `Text element "${elementId}" cannot animate text units with automatic wrapping because Pixi cannot preserve the shaped line layout.`,
    );
  }
  if (contextShapingScriptPattern.test(sourceText)) {
    throw new Error(
      `Text element "${elementId}" uses contextual or bidirectional shaping that cannot be preserved by independent Pixi text units.`,
    );
  }

  const letterSpacing = Number(style?.letterSpacing ?? 0);
  for (const unit of units) {
    const lineStart =
      sourceText.lastIndexOf("\n", Math.max(0, unit.start - 1)) + 1;
    const prefix = sourceText.slice(lineStart, unit.start);
    const throughUnit = sourceText.slice(lineStart, unit.end);
    const contextualAdvance =
      measureTextAdvance(throughUnit, style) -
      measureTextAdvance(prefix, style);
    const independentAdvance =
      measureTextAdvance(unit.segment, style) +
      (prefix.length > 0 && unit.segment.length > 0 ? letterSpacing : 0);
    const tolerance = Math.max(0.01, Math.abs(contextualAdvance) * 1e-6);
    if (Math.abs(contextualAdvance - independentAdvance) > tolerance) {
      throw new Error(
        `Text element "${elementId}" has kerning or ligature shaping across text-unit boundaries that Pixi cannot preserve.`,
      );
    }
  }
};

const createPixiTextUnitPreparation = (textTarget, query) => {
  const textElement = textTarget.handle;
  const previous = textElement[PIXI_TIMELINE_TEXT_UNITS];
  const sourceText = String(previous?.originalText ?? textElement.text ?? "");
  const fingerprint = getTextUnitFingerprint(
    sourceText,
    textElement.style,
    query,
  );
  if (previous?.fingerprint === fingerprint) return previous;

  const pending = pendingTextUnitPreparations.get(textElement);
  if (pending) {
    if (pending.fingerprint !== fingerprint) {
      throw new Error(
        `Text element "${query.elementId}" cannot bind incompatible text-unit queries in one activation.`,
      );
    }
    return pending;
  }

  const units = segmentPortableText(sourceText, query.unit, query.order);
  assertIndependentTextUnitsAreLayoutSafe(
    sourceText,
    textElement.style,
    units,
    query.elementId,
  );
  const textMetrics = CanvasTextMetrics.measureText(
    sourceText,
    textElement.style,
  );
  const container = new Container({
    label: `__timeline-text-units:${query.elementId}`,
  });
  copyDisplayTransform(textElement, container);
  const bounds = textElement.getLocalBounds?.().rectangle ??
    textElement.getLocalBounds?.() ?? { x: 0, y: 0 };
  const lineHeight = textMetrics.lineHeight;
  const getLineAlignmentOffset = (line) => {
    const remaining = textMetrics.maxLineWidth - textMetrics.lineWidths[line];
    if (textElement.style?.align === "center") return remaining / 2;
    if (textElement.style?.align === "right") return remaining;
    return 0;
  };
  const targets = units.map((unit, index) => {
    const lineStart =
      sourceText.lastIndexOf("\n", Math.max(0, unit.start - 1)) + 1;
    const line = countLineBreaks(sourceText, unit.start);
    const child = new Text({
      text: unit.segment,
      style: textElement.style,
      label: `__timeline-text-unit:${query.elementId}:${index}`,
    });
    child.x =
      (bounds.x ?? 0) +
      getLineAlignmentOffset(line) +
      measureTextWidth(
        sourceText.slice(lineStart, unit.start),
        textElement.style,
      );
    child.y = (bounds.y ?? 0) + line * lineHeight;
    container.addChild(child);
    return {
      handle: child,
      identity: `${query.elementId}:${fingerprint}:${unit.start}-${unit.end}`,
      stableId: `${query.elementId}:${unit.start}-${unit.end}`,
      subject: {
        x: child.x,
        y: child.y,
        width: child.width,
        height: child.height,
      },
    };
  });

  let committed = false;
  let sourceDestroy = null;
  let destroyWithTextUnits = null;
  const originalRenderable = textElement.renderable;
  const originalFilters = textElement.filters;
  const preparation = {
    fingerprint,
    originalText: sourceText,
    targets,
    commit: () => {
      if (committed) return;
      const current = textElement[PIXI_TIMELINE_TEXT_UNITS];
      if (current && current !== preparation) current.destroy();
      if (!textElement.parent) {
        throw new Error(
          `Text element "${query.elementId}" must be attached before text-unit activation.`,
        );
      }
      const parent = textElement.parent;
      const originalIndex = parent.getChildIndex
        ? parent.getChildIndex(textElement)
        : parent.children.indexOf(textElement);
      textElement.renderable = false;
      if (originalFilters?.length) {
        textElement.filters = [];
        container.filters = originalFilters;
      }
      if (typeof parent.addChildAt === "function") {
        parent.addChildAt(container, originalIndex);
      } else {
        parent.addChild(container);
        parent.setChildIndex?.(container, originalIndex);
      }
      textElement[PIXI_TIMELINE_TEXT_UNITS] = preparation;
      sourceDestroy = textElement.destroy;
      destroyWithTextUnits = function destroyTextWithUnits(...args) {
        preparation.destroy({ sourceDestroying: true });
        return sourceDestroy.apply(this, args);
      };
      textElement.destroy = destroyWithTextUnits;
      pendingTextUnitPreparations.delete(textElement);
      committed = true;
    },
    rollback: () => {
      if (committed) {
        preparation.destroy();
        return;
      }
      pendingTextUnitPreparations.delete(textElement);
      container.destroy({ children: true });
    },
    matches: (text, style) =>
      getTextUnitFingerprint(String(text ?? ""), style, query) === fingerprint,
    sync: () => copyDisplayTransform(textElement, container),
    destroy: ({ sourceDestroying = false } = {}) => {
      pendingTextUnitPreparations.delete(textElement);
      if (textElement.destroy === destroyWithTextUnits && sourceDestroy) {
        textElement.destroy = sourceDestroy;
      }
      if (originalFilters?.length) container.filters = [];
      if (!container.destroyed) container.destroy({ children: true });
      if (textElement[PIXI_TIMELINE_TEXT_UNITS] === preparation) {
        delete textElement[PIXI_TIMELINE_TEXT_UNITS];
      }
      if (!textElement.destroyed) {
        if (!sourceDestroying) textElement.renderable = originalRenderable;
        if (originalFilters?.length) textElement.filters = originalFilters;
      }
    },
  };
  for (const target of targets) {
    textUnitStateByHandle.set(target.handle, preparation);
  }
  pendingTextUnitPreparations.set(textElement, preparation);
  return preparation;
};

const ordinaryChannelProperties = Object.freeze({
  "transform.x": "x",
  "transform.y": "y",
  "transform.scale.x": "scaleX",
  "transform.scale.y": "scaleY",
  "transform.rotation.degrees": "rotation",
  "appearance.alpha": "alpha",
  "effect.blur.x": "blurX",
  "effect.blur.y": "blurY",
  "geometry.width": "width",
  "geometry.height": "height",
});

const findInSubtree = (root, label) => {
  if (!root) return null;
  if (root.label === label) return root;
  for (const child of root.children ?? []) {
    const match = findInSubtree(child, label);
    if (match) return match;
  }
  return null;
};

const handleGenerations = new WeakMap();
let nextHandleGeneration = 1;

const getHandleGeneration = (handle) => {
  if (!handleGenerations.has(handle)) {
    handleGenerations.set(handle, nextHandleGeneration++);
  }
  return handleGenerations.get(handle);
};

export const getPixiTimelineTargetIdentity = (handle, stableId) =>
  `${stableId}@${getHandleGeneration(handle)}`;

const createTarget = (handle, identity, targetState) => ({
  handle,
  identity: getPixiTimelineTargetIdentity(handle, identity),
  stableId: identity,
  subject: createAnimationSubjectState(handle),
  targetState,
});

const getFilterChannel = (channel) => {
  const match = /^filter\.([^.]+)\.parameter\.(.+)$/.exec(channel);
  return match ? { filterId: match[1], parameter: match[2] } : null;
};

export const createPixiTimelineBindingContext = ({
  program,
  ownerElement,
  ownerTargetState,
  targetStates,
  animationId = program.programId,
  activationOrdinal = 0,
  resolveTextUnits,
}) => {
  const targetCache = new Map();
  const stagedTextUnits = new Set();
  const bindingCache = new WeakMap();
  const groupCache = new WeakMap();

  const resolveElement = (elementId) => {
    if (targetCache.has(elementId)) return targetCache.get(elementId);
    const handle = findInSubtree(ownerElement, elementId);
    if (!handle) return null;
    const targetState =
      elementId === program.ownerId
        ? ownerTargetState
        : targetStates instanceof Map
          ? targetStates.get(elementId)
          : targetStates?.[elementId];
    const target = createTarget(handle, elementId, targetState);
    targetCache.set(elementId, target);
    return target;
  };

  const getGroup = (handle) => {
    if (!groupCache.has(handle)) {
      const textUnitState = textUnitStateByHandle.get(handle);
      groupCache.set(
        handle,
        textUnitState
          ? { afterApplyFrame: () => textUnitState.sync() }
          : getRectStyleAnimationBatchHooks(handle),
      );
    }
    return groupCache.get(handle);
  };

  const resolveChannel = (target, channel) => {
    let byChannel = bindingCache.get(target.handle);
    if (!byChannel) {
      byChannel = new Map();
      bindingCache.set(target.handle, byChannel);
    }
    if (byChannel.has(channel)) return byChannel.get(channel);

    const filter = getFilterChannel(channel);
    let binding;
    if (filter) {
      const filterTarget = getShaderFilterAnimationTarget(
        target.handle,
        filter.filterId,
        animationId,
      );
      binding = {
        property: filter.parameter,
        get: () => filterTarget[filter.parameter],
        apply: (_handle, value) => {
          filterTarget[filter.parameter] = value;
        },
      };
    } else {
      const property = channel.startsWith("geometry.rect.")
        ? channel.slice("geometry.".length)
        : ordinaryChannelProperties[channel];
      if (!property) return null;
      binding = {
        property,
        group: getGroup(target.handle),
        get: () =>
          getAnimationProperty(
            target.handle,
            property,
            TRANSITION_PROPERTY_PATH_MAP,
          ),
        apply: (_handle, value) =>
          applyAnimationProperty({
            object: target.handle,
            property,
            propertyPathMap: TRANSITION_PROPERTY_PATH_MAP,
            subjectState: target.subject,
            value,
          }),
      };
    }
    byChannel.set(channel, binding);
    return binding;
  };

  const capabilities = new Set(program.requirements);

  return {
    activationOrdinal,
    capabilities,
    resolveTargetQuery: (query, alias) => {
      if (query.kind === "element") {
        const target = resolveElement(query.elementId);
        if (!target)
          throw new Error(
            `Target query "${alias}" cannot find element "${query.elementId}" in owner "${program.ownerId}".`,
          );
        return [target];
      }
      if (query.kind === "elements") {
        return query.elementIds.map((elementId) => {
          const target = resolveElement(elementId);
          if (!target)
            throw new Error(
              `Target query "${alias}" cannot find element "${elementId}" in owner "${program.ownerId}".`,
            );
          return target;
        });
      }
      if (query.kind === "textUnits") {
        const textElement = resolveElement(query.elementId);
        if (!textElement)
          throw new Error(
            `Target query "${alias}" cannot find text element "${query.elementId}".`,
          );
        if (resolveTextUnits) return resolveTextUnits(textElement, query);
        if (typeof textElement.handle?.text !== "string") {
          throw new Error(
            `Target query "${alias}" requires a plain Pixi text element.`,
          );
        }
        const existingPreparation =
          textElement.handle[PIXI_TIMELINE_TEXT_UNITS];
        const preparation = createPixiTextUnitPreparation(textElement, query);
        if (preparation !== existingPreparation) {
          stagedTextUnits.add(preparation);
        }
        return preparation.targets;
      }
      throw new Error(
        `Target query "${alias}" is not valid for a Pixi update animation.`,
      );
    },
    channelRegistry: { resolve: resolveChannel },
    commit: () => {
      for (const preparation of stagedTextUnits) preparation.commit();
    },
    rollback: () => {
      for (const preparation of stagedTextUnits) preparation.rollback();
    },
  };
};

export const isPixiTimelineTargetValid = (target) =>
  Boolean(target?.handle) && target.handle.destroyed !== true;
