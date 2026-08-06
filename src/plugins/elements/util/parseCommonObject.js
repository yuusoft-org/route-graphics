import { calculatePositionAfterAnchor } from "./common.js";
import { ComputedNodeType } from "../../../types.js";
import { normalizeElementShaderFilters } from "./shaderConfig.js";

const SHADER_FILTER_ELEMENT_TYPES = new Set(Object.values(ComputedNodeType));

/**
 * @typedef {import('../types.js').BaseElement} BaseElement
 * @typedef {import('../types.js').ParseCommonObjectOption} ParseCommonObjectOption
 * @typedef {import('../types.js').ComputedNode} ComputedNode
 * @typedef {import('../types.js').ComputedNodeType} ComputedNodeType
 */

/**
 * @param {BaseElement} state
 * @param {ParseCommonObjectOption} [option]
 * @returns  {ComputedNode}
 */
export const parseCommonObject = (state, { scaleMode = "baked" } = {}) => {
  if (!Number.isFinite(state.width) || !Number.isFinite(state.height))
    throw new Error("Input Error: Width or height is missing");

  if (!Object.values(ComputedNodeType).includes(state.type))
    throw new Error(
      "Input Error: Type must be one of " +
        Object.values(ComputedNodeType).join(", "),
    );

  if (!state.id) throw new Error("Input Error: Id is missing");

  const scaleX = state.scaleX ?? 1;
  const scaleY = state.scaleY ?? 1;

  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    throw new Error("Input Error: scaleX and scaleY must be finite numbers");
  }

  let widthAfterScale = Math.abs(scaleX * state.width);
  let heightAfterScale = Math.abs(scaleY * state.height);
  let anchorWidth = Math.sign(scaleX) * widthAfterScale;
  let anchorHeight = Math.sign(scaleY) * heightAfterScale;

  // Container scale magnitudes are baked into descendants. Only the sign is
  // applied to the container itself so a negative scale mirrors the subtree as
  // one group instead of mirroring every child around its own origin.
  if (state.type === ComputedNodeType.CONTAINER) {
    widthAfterScale = Math.abs(state.width);
    heightAfterScale = Math.abs(state.height);
    anchorWidth = Math.sign(scaleX) * widthAfterScale;
    anchorHeight = Math.sign(scaleY) * heightAfterScale;
  } else if (scaleMode === "live") {
    // Particle dimensions describe the emitter's local area, so its complete
    // scale (magnitude and sign) remains a live transform.
    widthAfterScale = Math.abs(state.width);
    heightAfterScale = Math.abs(state.height);
    anchorWidth = scaleX * widthAfterScale;
    anchorHeight = scaleY * heightAfterScale;
  }

  const {
    x: adjustedPositionX,
    y: adjustedPositionY,
    originX: originX,
    originY: originY,
  } = calculatePositionAfterAnchor({
    positionX: state.x,
    positionY: state.y,
    width: anchorWidth,
    height: anchorHeight,
    anchorX: state.anchorX,
    anchorY: state.anchorY,
  });
  const transformOriginX =
    typeof state.originX === "number" ? state.originX : originX;
  const transformOriginY =
    typeof state.originY === "number" ? state.originY : originY;

  // Round all pixel calculations
  const includeScaleX = scaleMode === "live" || scaleX <= 0;
  const includeScaleY = scaleMode === "live" || scaleY <= 0;
  let computedObj = {
    id: state.id,
    type: state.type,
    width: Math.round(widthAfterScale),
    height: Math.round(heightAfterScale),
    x: Math.round(adjustedPositionX),
    y: Math.round(adjustedPositionY),
    originX: Math.round(transformOriginX),
    originY: Math.round(transformOriginY),
    alpha: state.alpha ?? 1,
    rotation: state.rotation ?? 0,
    ...(state.scaleX !== undefined && includeScaleX ? { scaleX } : {}),
    ...(state.scaleY !== undefined && includeScaleY ? { scaleY } : {}),
  };

  if (state.hover) {
    computedObj.hover = state.hover;
  }

  if (state.click) {
    computedObj.click = state.click;
  }

  if (state.filters !== undefined) {
    if (!SHADER_FILTER_ELEMENT_TYPES.has(state.type)) {
      throw new Error(
        `Input Error: filters are not supported on ${state.type} elements`,
      );
    }

    computedObj.filters = normalizeElementShaderFilters(state.filters);
  }

  return computedObj;
};
