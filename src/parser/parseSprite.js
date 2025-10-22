import { parseCommonObject } from './parseCommonObject.js';
/**
 *  @typedef {import('../types.js').BaseElement} BaseElement
 *  @typedef {import('../types.js').SpriteASTNode} SpriteASTNode
 */


/**
 * @param {BaseElement} state
 * @return {SpriteASTNode}
 */
export function parseSprite(state) {

  const astObj = parseCommonObject(state)

  return {
    ...astObj,
    url: state.url,
    alpha: state.alpha,
    cursor: state.cursor,
    clickUrl: state.clickUrl,
    hoverUrl: state.hoverUrl
  };
}