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
    wordWrap: true
  }

  const textStyle = {
    ...defaultTextStyle,
    ...state.style,
  }

  textStyle.wordWrap = textStyle.wordWrapWidth? true : false

  const { width, height } = CanvasTextMetrics.measureText(state.text, new TextStyle({
    fontFamily: textStyle.fontFamily,
    fontSize: textStyle.fontSize,
    wordWrap: state?.style?.breakWords ?? false,
    wordWrapWidth: state?.style?.wordWrapWidth
  }));

  const astObj = parseCommonObject({...state,width,height})

  return {
    ...astObj,
    text:state.text ?? "",
    style: {
      ...textStyle
    },
  };
}

