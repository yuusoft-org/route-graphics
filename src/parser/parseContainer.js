

import { parseCommonObject } from './parseCommonObject.js';
import { parseRect } from './parseRect.js';
import { parseText } from './parseText.js';
import { parseSprite } from './parseSprite.js';

/**
 * @typedef {import('../types.js').BaseElement} BaseElement
 * @typedef {import('../types.js').ContainerASTNode} ContainerASTNode
 */

/**
 * @param {BaseElement} state
 * @returns {ContainerASTNode}
 * 
 * This will parse the container element.
 * 
 * If it doesn't have width/height it will expand the width/height based on the position x/y and the dimensions of the children
 * If the direction has horizontal/vertical, it will reposition the children to be horizontal/vertical
 * If direction is set and the width/height is set than the container will wrap the element based on the setted width/height
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
    }

    if(direction === 'horizontal'){
        if(state.width && child.width + currentRowWidth > state.width && !scroll){
            //Wrap the child
            currentX = 0;
            currentRowWidth = 0;
            lastRowHeight += maxRowHeight + gap;
            maxRowHeight = child.height;

            child.x = 0;
            child.y = lastRowHeight;
        }
        else{
          maxRowHeight = Math.max(maxRowHeight, child.height);
        }
        currentX += child.width + gapValue;
        currentRowWidth = child.x + child.width;
        containerWidth = Math.max(currentX, containerWidth);
        containerHeight = Math.max(child.height + child.y, containerHeight);
    }
    else if(direction === 'vertical'){
        if(state.height && child.height + currentColHeight > state.height && !scroll){
            //Wrap the child
            currentY = 0;
            currentColHeight = 0;
            lastColWidth += maxColWidth + gap
            maxColWidth = child.width;

            child.x = lastColWidth;
            child.y = 0;
        }
        else{
          maxColWidth = Math.max(maxColWidth, child.width);
        }
        currentY += child.height + gapValue;
        currentColHeight = child.y + child.height;
        containerWidth = Math.max(child.width + child.x, containerWidth);
        containerHeight = Math.max(currentY, containerHeight)
    }

    parsedChildren.push(child);
  }

  const containerAST = parseCommonObject({
    ...state,
    width: state.width? state.width : containerWidth,
    height: state.height? state.height : containerHeight
  });

  return {
    ...containerAST,
    children: parsedChildren,
    direction,
    gap,
    scroll,
    rotation: state.rotation ?? 0
  };
}