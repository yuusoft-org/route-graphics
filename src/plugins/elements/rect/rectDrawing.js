import { resolveRectFill } from "./rectFill.js";
import { normalizeCornerRadius } from "./rectConfig.js";

const clampDimension = (value) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

export const resolveRenderedCornerRadius = (cornerRadius, width, height) => {
  const normalized = normalizeCornerRadius(cornerRadius);
  const safeWidth = clampDimension(width);
  const safeHeight = clampDimension(height);
  const top = normalized.topLeft + normalized.topRight;
  const bottom = normalized.bottomLeft + normalized.bottomRight;
  const left = normalized.topLeft + normalized.bottomLeft;
  const right = normalized.topRight + normalized.bottomRight;
  const scale = Math.min(
    1,
    top > 0 ? safeWidth / top : 1,
    bottom > 0 ? safeWidth / bottom : 1,
    left > 0 ? safeHeight / left : 1,
    right > 0 ? safeHeight / right : 1,
  );

  return Object.fromEntries(
    Object.entries(normalized).map(([corner, radius]) => [
      corner,
      Math.max(0, radius * scale),
    ]),
  );
};

export const appendRectPath = (graphics, width, height, cornerRadius) => {
  const safeWidth = clampDimension(width);
  const safeHeight = clampDimension(height);
  const radius = resolveRenderedCornerRadius(
    cornerRadius,
    safeWidth,
    safeHeight,
  );

  if (Object.values(radius).every((value) => value === 0)) {
    graphics.rect(0, 0, safeWidth, safeHeight);
    return graphics;
  }

  graphics
    .moveTo(radius.topLeft, 0)
    .lineTo(safeWidth - radius.topRight, 0)
    .quadraticCurveTo(safeWidth, 0, safeWidth, radius.topRight)
    .lineTo(safeWidth, safeHeight - radius.bottomRight)
    .quadraticCurveTo(
      safeWidth,
      safeHeight,
      safeWidth - radius.bottomRight,
      safeHeight,
    )
    .lineTo(radius.bottomLeft, safeHeight)
    .quadraticCurveTo(0, safeHeight, 0, safeHeight - radius.bottomLeft)
    .lineTo(0, radius.topLeft)
    .quadraticCurveTo(0, 0, radius.topLeft, 0)
    .closePath();

  return graphics;
};

export const drawRectVisual = (graphics, style, element = style) => {
  graphics.clear();
  appendRectPath(graphics, style.width, style.height, style.cornerRadius);
  graphics.fill(resolveRectFill(graphics, style.fill, element));

  if (style.border?.width > 0) {
    graphics.stroke({
      color: style.border.color,
      alpha: style.border.alpha,
      width: style.border.width,
    });
  }
};
