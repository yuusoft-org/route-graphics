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
 * @param {ParseCommonObjectOption} option
 * @returns  {ComputedNode}
 */
export const parseCommonObject = (state) => {
  if (!(typeof state.width === "number") || !(typeof state.height === "number"))
    throw new Error("Input Error: Width or height is missing");

  if (!Object.values(ComputedNodeType).includes(state.type))
    throw new Error(
      "Input Error: Type must be one of " +
        Object.values(ComputedNodeType).join(", "),
    );

  if (!state.id) throw new Error("Input Error: Id is missing");

  let widthAfterScale = state.scaleX ? state.scaleX * state.width : state.width;
  let heightAfterScale = state.scaleY
    ? state.scaleY * state.height
    : state.height;

  //We don't let scale affect container type for now
  if (state.type === ComputedNodeType.CONTAINER) {
    widthAfterScale = state.width;
    heightAfterScale = state.height;
  }

  const {
    x: adjustedPositionX,
    y: adjustedPositionY,
    originX: originX,
    originY: originY,
  } = calculatePositionAfterAnchor({
    positionX: state.x,
    positionY: state.y,
    width: widthAfterScale,
    height: heightAfterScale,
    anchorX: state.anchorX,
    anchorY: state.anchorY,
  });
  const transformOriginX =
    typeof state.originX === "number" ? state.originX : originX;
  const transformOriginY =
    typeof state.originY === "number" ? state.originY : originY;

  // Round all pixel calculations
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
