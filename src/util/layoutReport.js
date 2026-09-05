import { CanvasTextMetrics, Matrix, Text } from "pixi.js";

const finite = (value) =>
  Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
const point = (value) => ({ x: finite(value?.x), y: finite(value?.y) });
const bounds = (value) => ({
  x: finite(value.x),
  y: finite(value.y),
  width: finite(value.width),
  height: finite(value.height),
});

const describeDisplay = (display) => {
  const matrix = display.getGlobalTransform(new Matrix());
  return {
    position: point(display.position),
    pivot: point(display.pivot),
    scale: point(display.scale),
    rotation: finite(display.rotation),
    localBounds: bounds(display.getLocalBounds()),
    globalBounds: bounds(display.getBounds()),
    worldTransform: Object.fromEntries(
      ["a", "b", "c", "d", "tx", "ty"].map((key) => [key, finite(matrix[key])]),
    ),
    alpha: finite(display.alpha),
    globalAlpha: finite(display.getGlobalAlpha()),
    visible: display.visible,
    renderable: display.renderable,
    masked: Boolean(display.mask),
    filterCount: display.filters?.length ?? 0,
  };
};

const describeText = (display, path) => {
  const style = display.style;
  const metrics = CanvasTextMetrics.measureText(display.text, style);
  const fontFamily = Array.isArray(style.fontFamily)
    ? [...style.fontFamily]
    : style.fontFamily;
  return {
    path,
    text: display.text,
    display: describeDisplay(display),
    anchor: point(display.anchor),
    style: {
      fontFamily,
      fontSize: style.fontSize,
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      fontVariant: style.fontVariant,
      align: style.align,
      lineHeight: style.lineHeight,
      leading: style.leading,
      letterSpacing: style.letterSpacing,
      wordWrap: style.wordWrap,
      wordWrapWidth: style.wordWrapWidth,
      breakWords: style.breakWords,
      padding: style.padding,
      textBaseline: style.textBaseline,
      trim: style.trim,
      strokeWidth: style.stroke?.width ?? 0,
      shadowDistance: style.dropShadow?.distance ?? 0,
    },
    metrics: {
      width: metrics.width,
      height: metrics.height,
      lineHeight: metrics.lineHeight,
      maxLineWidth: metrics.maxLineWidth,
      font: {
        ascent: metrics.fontProperties.ascent,
        descent: metrics.fontProperties.descent,
        fontSize: metrics.fontProperties.fontSize,
      },
      lines: metrics.lines.map((text, index) => ({
        text,
        width: metrics.lineWidths[index],
      })),
    },
  };
};

const describeLayout = (node) => {
  const result = {};
  for (const key of [
    "x",
    "y",
    "width",
    "height",
    "originX",
    "originY",
    "rotation",
    "scaleX",
    "scaleY",
    "alpha",
    "measuredWidth",
  ]) {
    if (node[key] !== undefined) result[key] = finite(node[key]);
  }
  for (const [key, internal] of [
    ["anchorX", "__anchorXRatio"],
    ["anchorY", "__anchorYRatio"],
    ["layoutWidth", "__layoutWidth"],
    ["layoutHeight", "__layoutHeight"],
  ]) {
    if (node[internal] !== undefined) result[key] = finite(node[internal]);
  }
  if (node.__fixedWidth !== undefined) result.fixedWidth = node.__fixedWidth;
  return result;
};

/**
 * Snapshot committed parsed geometry and mounted Pixi Text runs. This does not
 * render, seek, dispatch events, or expose mutable Pixi/parser objects.
 */
export const createLayoutReport = ({ elements, stage, viewport }) => {
  const records = [];
  const visit = (nodes, parentIndex = null) => {
    for (const node of nodes) {
      const index = records.length;
      records.push({
        index,
        parentIndex,
        id: node.id,
        type: node.type,
        layout: describeLayout(node),
      });
      visit(node.children ?? [], index);
    }
  };
  visit(elements);

  const labels = new Map();
  const collect = (display) => {
    if (display.label) {
      const matches = labels.get(display.label) ?? [];
      matches.push(display);
      labels.set(display.label, matches);
    }
    for (const child of display.children ?? []) collect(child);
  };
  collect(stage);
  const ids = new Set(records.map((record) => record.id));
  const idCounts = new Map();
  for (const { id } of records) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);

  for (const record of records) {
    const matches = labels.get(record.id) ?? [];
    record.mountStatus =
      matches.length > 1 || idCounts.get(record.id) > 1
        ? "ambiguous"
        : matches.length === 0
          ? "absent"
          : "mounted";
    record.display = null;
    record.textRuns = [];
    if (record.mountStatus !== "mounted") continue;
    record.display = describeDisplay(matches[0]);
    const collectText = (display, path) => {
      // Nested authored elements own their runs; do not count them again in
      // every ancestor. Paths distinguish rich-text and furigana children.
      if (path.length > 0 && ids.has(display.label)) return;
      if (display instanceof Text) {
        record.textRuns.push(describeText(display, path));
      }
      (display.children ?? []).forEach((child, index) =>
        collectText(child, [...path, index]),
      );
    };
    collectText(matches[0], []);
  }

  return {
    schema: "route-graphics-layout-report-v1",
    coordinateSpace: "logical-pixels",
    viewport: { ...viewport },
    elements: records,
  };
};
