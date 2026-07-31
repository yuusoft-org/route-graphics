import { parseCommonObject } from "../util/parseCommonObject.js";
import { normalizeBlurConfig } from "../util/blurEffect.js";
import { normalizeCornerRadius, validateRectState } from "./rectConfig.js";
/**
 *  @typedef {import('../../../types.js').BaseElement}
 *  @typedef {import('../../../types.js').RectComputedNode}
 */

/**
 * @param {Object} params
 * @param {BaseElement} params.state - The rect state to parse
 * @param {Array} params.parserPlugins - Array of parser plugins (not used by this parser)
 * @return {RectComputedNode}
 */
export const parseRect = ({ state }) => {
  validateRectState(state);
  const computedObj = parseCommonObject(state);
  const border =
    state.border === undefined
      ? undefined
      : {
          alpha: state.border.alpha ?? 1,
          color: state.border.color ?? "black",
          width: state.border.width ?? 0,
        };

  return {
    ...computedObj,
    ...(state.fill !== undefined ? { fill: state.fill } : {}),
    ...(border !== undefined ? { border } : {}),
    ...(state.scaleX !== undefined ? { scaleX: state.scaleX } : {}),
    ...(state.scaleY !== undefined ? { scaleY: state.scaleY } : {}),
    ...(state.cornerRadius !== undefined
      ? { cornerRadius: normalizeCornerRadius(state.cornerRadius) }
      : {}),
    ...(state.blur !== undefined && {
      blur: normalizeBlurConfig(state.blur),
    }),
    rotation: state.rotation ?? 0,
    ...(state.drag && { drag: state.drag }),
    ...(state.rightClick && { rightClick: state.rightClick }),
    ...(state.scrollUp && { scrollUp: state.scrollUp }),
    ...(state.scrollDown && { scrollDown: state.scrollDown }),
  };
};
