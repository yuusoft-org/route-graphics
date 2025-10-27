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
  const defaultTextStyle = {
    fill: 'black',
    fontFamily: 'Arial',
    fontSize: 16,
  }

  const textStyle = {
    ...defaultTextStyle,
    ...state.style,
  }

  const { width, height } = CanvasTextMetrics.measureText(state.text, new TextStyle({
    fontFamily: textStyle.fontFamily,
    fontSize: textStyle.fontSize,
    wordWrap: state.breakWords ?? false,
    wordWrapWidth: state.wordWrapWidth ?? 0
  }));

  const astObj = parseCommonObject({...state,width,height})

  return {
    ...astObj,
    text:state.text ?? "",
    breakWords: state.breakWords ?? false,
    wordWrapWidth: state.wordWrapWidth ?? 0,
    style: {
      ...textStyle
    },
  };
}

