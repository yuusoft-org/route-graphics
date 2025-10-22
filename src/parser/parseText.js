import { CanvasTextMetrics, TextStyle } from 'pixi.js';
import { parseCommonObject } from './parseCommonObject.js';

/**
 * @typedef {import('../types.js').BaseElement} BaseElement
 * @typedef {import('../types.js').TextASTNode} TextASTNode
 */

/**
 * Parse text object and calculate final position after anchor adjustment
 * @param {BaseElement} state
 * @returns {TextASTNode}
 */
export function parseText(state) {

  const { width, height } = CanvasTextMetrics.measureText(state.text, new TextStyle({
    fontFamily: state.style.fontFamily,
    fontSize: state.style.fontSize
  }));

  const astObj = parseCommonObject({...state,width,height})

  return {
    ...astObj,
    text:state.text,
    style: {
      fontSize: state.style.fontSize,
      fontFamily: state.style.fontFamily,
      fill: state.style.fill
    },
  };
}

