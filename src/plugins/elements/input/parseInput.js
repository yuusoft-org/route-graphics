import { parseCommonObject } from "../util/parseCommonObject.js";
import {
  DEFAULT_INPUT_BORDER,
  DEFAULT_INPUT_FILL,
  DEFAULT_INPUT_FOCUS_RING,
  resolveInputStrokeStyle,
  resolveInputTextStyle,
  resolvePadding,
} from "./inputShared.js";
import { validateRectFill } from "../rect/rectConfig.js";

export const parseInput = ({ state }) => {
  if (state.fill !== undefined) {
    validateRectFill(state.fill, "input.fill");
  }
  const computedObj = parseCommonObject(state);
  const value = String(state.value ?? "");
  const placeholder = String(state.placeholder ?? "");

  return {
    ...computedObj,
    value,
    placeholder,
    multiline: state.multiline === true,
    disabled: state.disabled === true,
    ...(typeof state.submitOnEnter === "boolean" && {
      submitOnEnter: state.submitOnEnter,
    }),
    ...(typeof state.maxLength === "number" && {
      maxLength: Math.round(state.maxLength),
    }),
    textStyle: resolveInputTextStyle(state.textStyle),
    padding: resolvePadding(state.padding),
    fill: state.fill !== undefined ? state.fill : DEFAULT_INPUT_FILL,
    border: resolveInputStrokeStyle(state.border, DEFAULT_INPUT_BORDER),
    focusRing: resolveInputStrokeStyle(
      state.focusRing,
      DEFAULT_INPUT_FOCUS_RING,
    ),
    ...(state.change && { change: state.change }),
    ...(state.submit && { submit: state.submit }),
    ...(state.focusEvent && { focusEvent: state.focusEvent }),
    ...(state.blurEvent && { blurEvent: state.blurEvent }),
    ...(state.selectionChange && { selectionChange: state.selectionChange }),
    ...(state.compositionStart && { compositionStart: state.compositionStart }),
    ...(state.compositionUpdate && {
      compositionUpdate: state.compositionUpdate,
    }),
    ...(state.compositionEnd && { compositionEnd: state.compositionEnd }),
  };
};

export default parseInput;
