import { CanvasTextMetrics, TextStyle } from 'pixi.js';
import { calculatePositionAfterAnchor } from './common.js';

/**
 * @typedef {import('../types.js').BaseElement} BaseElement
 * @typedef {import('../types.js').ASTNode} ASTNode
 */

/**
 * Parse text object and calculate final position after anchor adjustment
 * @param {BaseElement} state
 * @returns {ASTNode}
 */
export function parseText(state) {
  // Calculate text dimensions

  const { width: textWidth, height: textHeight } = CanvasTextMetrics.measureText(state.text, new TextStyle({
    fontFamily: state.style.fontFamily,
    fontSize: state.style.fontSize
  }));

  // Calculate position after anchor
  const adjustedPosition = calculatePositionAfterAnchor({
    positionX: state.x,
    positionY: state.y,
    width: textWidth,
    height: textHeight,
    anchorX: state.anchorX,
    anchorY: state.anchorY
  });

  const astObj = {
    id: state.id,
    type: "text",
    text: state.text,
    style: {
      fontSize: state.style.fontSize,
      fontFamily: state.style.fontFamily,
      fill: state.style.fill
    },
    width: textWidth,
    height: textHeight,
    x: adjustedPosition.x,
    y: adjustedPosition.y,
    zIndex: state.zIndex || 0
  }

  return astObj;
}

