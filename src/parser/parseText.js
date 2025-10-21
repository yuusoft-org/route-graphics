import { CanvasTextMetrics, TextStyle } from 'pixi.js';
import { calculatePositionAfterAnchor } from './common.js';

/**
 * @import { BaseElement, ASTNode } from '../types.js' 
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
  const position = { x: state.x, y: state.y };
  const dimensions = { width: textWidth, height: textHeight };
  const anchor = { anchorX: state.anchorX, anchorY: state.anchorY };
  const adjustedPosition = calculatePositionAfterAnchor(position, dimensions, anchor);

  const astObj = {
    id: state.id,
    type: "text",
    text: state.text,
    style: {
      fontSize: state.style.fontSize,
      fontFamily: state.style.fontFamily,
      fill: state.style.fill
    },
    x: adjustedPosition.x,
    y: adjustedPosition.y,
    zIndex: state.zIndex || 0
  }

  return astObj;
}

