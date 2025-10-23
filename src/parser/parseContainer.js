

import { parseCommonObject } from './parseCommonObject.js';
import { parseRect } from './parseRect.js';
import { parseText } from './parseText.js';
import { parseSprite } from './parseSprite.js';

/**
 * @typedef {import('../types.js').BaseElement} BaseElement
 * @typedef {import('../types.js').ContainerASTNode} ContainerASTNode
 */

/**
 * Parse container and calculate positions of children based on flexbox-like layout
 * @param {BaseElement} state
 * @returns {ContainerASTNode}
 */
export function parseContainer(state) {
  const direction = state.direction;
  const scroll = state.scroll? true : false
  const gap = state.gap || 0;
  const children = state.children || [];
  const parsedChildren = []

  let containerWidth = 0;
  let containerHeight = 0;
  let currentX = 0;
  let currentY = 0;
  let maxRowHeight = 0;
  let maxColWidth = 0;
  let lastRowHeight = 0;
  let lastColWidth = 0;
  let currentRowWidth = 0;
  let currentColHeight = 0;

  // Calculate container dimensions and position children
  for (let i = 0; i < children.length; i++) {
    const gapValue = i < children.length - 1 ? gap : 0
    let child = children[i];

    if( i > 0 ) {
        if (direction === 'horizontal') {
            child.x = currentX;
            child.y = lastRowHeight;
        }
        else if (direction === 'vertical') {
            child.x = lastColWidth;
            child.y = currentY;
        }
    }
    else if(direction === 'horizontal' || direction === 'vertical') {
        child.x = 0;
        child.y = 0;
    }

    switch (child.type) {
      case 'rect':
        child = parseRect(child);
        break;
      case 'text':
        child = parseText(child);
        break;
      case 'sprite':
        child = parseSprite(child);
        break;
      case 'container':
        child = parseContainer(child);
        break;
      default:
        throw new Error(`Unsupported element type: ${child.type}`);
    }

    if(direction === 'horizontal'){
        if(state.width && child.width + currentRowWidth > state.width){
            //Wrap the child
            currentX = 0;
            currentRowWidth = 0;
            lastRowHeight = maxRowHeight;
            maxRowHeight = child.height;

            child.x = 0;
            child.y = lastRowHeight + gap;
        }
        else{
            currentRowWidth += child.width + gapValue;
            maxRowHeight = Math.max(maxRowHeight, child.height);
        }
        currentX += child.width + gapValue;
        containerWidth = Math.max(currentX, containerWidth);
        containerHeight = Math.max(child.height + child.y, containerHeight);
    }
    else if(direction === 'vertical'){
        if(state.height && child.height + currentColHeight > state.height){
            //Wrap the child
            currentY = 0;
            currentColHeight = 0;
            lastColWidth = maxColWidth
            maxColWidth = child.width;

            child.x = lastColWidth + gap;
            child.y = 0;
        }
        else{
            currentColHeight += child.height + gapValue;
            maxColWidth = Math.max(maxColWidth, child.width);
        }
        currentY += child.height + gapValue;
        containerWidth = Math.max(child.width + child.x, containerWidth);
        containerHeight = Math.max(currentY, containerHeight)
    }

    parsedChildren.push(child);
  }

  // Parse container as common object with calculated dimensions\
  const containerAST = parseCommonObject({
    ...state,
    width: state.width? state.width : containerWidth,
    height: state.height? state.height : containerHeight
  });

  // Add container-specific properties
  return {
    ...containerAST,
    children: parsedChildren,
    direction,
    gap,
    scroll,
    rotation: state.rotation
  };
}