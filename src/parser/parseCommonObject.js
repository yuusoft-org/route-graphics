import { calculatePositionAfterAnchor } from './common.js';

/**
 * @typedef {import('../types.js').BaseElement} BaseElement
 * @typedef {import('../types.js').ParseCommonObjectOption} ParseCommonObjectOption
 * @typedef {import('../types.js').ASTNode} ASTNode
 */


/**
 * @param {BaseElement} state
 * @param {ParseCommonObjectOption} option
 * @returns  {ASTNode}
 */
export function parseCommonObject(state){
  if(!(typeof state.width ==="number") || !(typeof state.height === "number")){
    throw new Error("Input Error: Width or height is missing")
  }

  let widthAfterScale = state.scaleX? state.scaleX * state.width : state.width
  let heightAfterScale = state.scaleY? state.scaleY * state.height : state.height

  //We don't let scale affect container type for now
  if(state.type === "container"){
    widthAfterScale = state.width
    heightAfterScale = state.height
  }

  const {
    x: adjustedPositionX,
    y: adjustedPositionY,
    originX: originX,
    originY: originY
  } = calculatePositionAfterAnchor({
    positionX: state.x,
    positionY: state.y,
    width: widthAfterScale,
    height: heightAfterScale,
    anchorX: state.anchorX,
    anchorY: state.anchorY
  });

  const astObj = {
    id: state.id,
    type: state.type,
    width: widthAfterScale,
    height: heightAfterScale,
    x: adjustedPositionX,
    y: adjustedPositionY,
    originX,
    originY,
    zIndex: state.zIndex || 0
  }

  return astObj
}