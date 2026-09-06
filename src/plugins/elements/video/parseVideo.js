import { parseCommonObject } from "../util/parseCommonObject.js";
import { normalizeBlurConfig } from "../util/blurEffect.js";
/**
 *  @typedef {import('../../../types.js').BaseElement} BaseElement
 *  @typedef {import('../../../types.js').VideoComputedNode} VideoComputedNode
 */

/**
 * @param {Object} params
 * @param {BaseElement} params.state - The video state to parse
 * @param {Array} params.parserPlugins - Array of parser plugins (not used by this parser)
 * @return {VideoComputedNode}
 */
export const parseVideo = ({ state }) => {
  const computedObj = parseCommonObject(state);

  let finalObj = computedObj;

  return {
    ...finalObj,
    src: state.src,
    volume: state.volume ?? 100,
    loop: state.loop ?? false,
    ...(state.blur !== undefined && {
      blur: normalizeBlurConfig(state.blur),
    }),
  };
};
