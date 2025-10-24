import { parseCommonObject } from './parseCommonObject.js';
/**
 *  @typedef {import('../types.js').BaseElement}
 *  @typedef {import('../types.js').RectASTNode}
 */

/**
 * @param {BaseElement} state
 * @return {RectASTNode}
 */
export function parseRect(state) {

  let astObj = parseCommonObject(state)

  if(state.border){
    astObj = {
        ...astObj,
        border:{
            alpha: state?.border?.alpha ?? 1,
            color: state?.border?.color ?? "black",
            width: state?.border?.width ?? 0
        }
    }
  }

  return {
    ...astObj,
    cursor: state.cursor ?? "",
    fill: state.fill ?? "white",
    pointerDown: state.pointerDown ?? "",
    pointerMove: state.pointerMove ?? "",
    pointerUp: state.pointerUp ?? "",
    rotation: state.rotation ?? 0
  };
}