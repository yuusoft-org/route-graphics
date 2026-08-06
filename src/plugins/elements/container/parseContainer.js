import { parseCommonObject } from "../util/parseCommonObject.js";
import { normalizeBlurConfig } from "../util/blurEffect.js";

/**
 * @typedef {import('../../../types.js').BaseElement} BaseElement
 * @typedef {import('../../../types.js').ContainerComputedNode} ContainerComputedNode
 */

/**
 * @param {Object} params
 * @param {BaseElement} params.state - The container state to parse
 * @param {import("../parserPlugin.js").ParserPlugin[]} params.parserPlugins - Array of parser plugins
 * @returns {ContainerComputedNode}
 *
 * This will parse the container element.
 *
 * If it doesn't have width/height it will expand the width/height based on the position x/y and the dimensions of the children
 * If the direction has horizontal/vertical, it will reposition the children to be horizontal/vertical
 * If direction is set and the width/height is set than the container will wrap the element based on the setted width/height
 */
export const parseContainer = ({ state, parserPlugins = [] }) => {
  // Treat missing or legacy empty direction as explicit absolute positioning.
  const direction =
    state.direction === "horizontal" || state.direction === "vertical"
      ? state.direction
      : "absolute";
  const scroll = state.scroll ? true : false;
  const gapX = state.gapX ?? 0;
  const gapY = state.gapY ?? 0;
  const children = structuredClone(state.children || []);
  const parsedChildren = [];

  if (state.gap !== undefined) {
    throw new Error(
      "Input Error: container.gap is no longer supported. Use gapX and gapY.",
    );
  }

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
    let child = children[i];

    if (i > 0) {
      if (direction === "horizontal") {
        child.x = currentX;
        child.y = lastRowHeight;
      } else if (direction === "vertical") {
        child.x = lastColWidth;
        child.y = currentY;
      }
    } else if (direction === "horizontal" || direction === "vertical") {
      child.x = 0;
      child.y = 0;
    }

    const plugin = parserPlugins.find((p) => p.type === child.type);
    if (plugin) {
      const hasScaleX =
        child.scaleX !== undefined || state.scaleX !== undefined;
      const hasScaleY =
        child.scaleY !== undefined || state.scaleY !== undefined;
      const childScaleX = (child.scaleX ?? 1) * Math.abs(state.scaleX ?? 1);
      const childScaleY = (child.scaleY ?? 1) * Math.abs(state.scaleY ?? 1);

      child = plugin.parse({
        state: {
          ...child,
          ...(hasScaleX ? { scaleX: childScaleX } : {}),
          ...(hasScaleY ? { scaleY: childScaleY } : {}),
        },
        parserPlugins,
      });
    }

    if (direction === "horizontal") {
      const gapValue = i < children.length - 1 ? gapX : 0;

      if (
        state.width &&
        child.width + currentRowWidth > state.width &&
        !scroll &&
        !state.anchorToBottom
      ) {
        //Wrap the child
        currentX = 0;
        currentRowWidth = 0;
        lastRowHeight += maxRowHeight + gapY;
        maxRowHeight = child.height;

        child.x = 0;
        child.y = lastRowHeight;
      } else {
        maxRowHeight = Math.max(maxRowHeight, child.height);
      }
      currentX += child.width + gapValue;
      currentRowWidth = child.x + child.width;
      containerWidth = Math.max(currentX, containerWidth);
      containerHeight = Math.max(child.height + child.y, containerHeight);
    } else if (direction === "vertical") {
      const gapValue = i < children.length - 1 ? gapY : 0;

      if (
        state.height &&
        child.height + currentColHeight > state.height &&
        !scroll &&
        !state.anchorToBottom
      ) {
        //Wrap the child
        currentY = 0;
        currentColHeight = 0;
        lastColWidth += maxColWidth + gapX;
        maxColWidth = child.width;

        child.x = lastColWidth;
        child.y = 0;
      } else {
        maxColWidth = Math.max(maxColWidth, child.width);
      }
      currentY += child.height + gapValue;
      currentColHeight = child.y + child.height;
      containerWidth = Math.max(child.width + child.x, containerWidth);
      containerHeight = Math.max(currentY, containerHeight);
    } else {
      containerWidth = Math.max(child.width + child.x, containerWidth);
      containerHeight = Math.max(child.height + child.y, containerHeight);
    }

    parsedChildren.push(child);
  }

  const containerComputed = parseCommonObject({
    ...state,
    width: state.width ? state.width : containerWidth,
    height: state.height ? state.height : containerHeight,
  });

  const finalContainer = {
    ...containerComputed,
    children: parsedChildren,
    direction,
    gapX,
    gapY,
    scroll,
    ...(state.anchorToBottom && { anchorToBottom: true }),
    ...(state.scrollbar && { scrollbar: structuredClone(state.scrollbar) }),
    ...(state.blur !== undefined && {
      blur: normalizeBlurConfig(state.blur),
    }),
    rotation: state.rotation ?? 0,
  };

  if (state.rightClick) {
    finalContainer.rightClick = state.rightClick;
  }

  if (state.scrollUp) {
    finalContainer.scrollUp = state.scrollUp;
  }

  if (state.scrollDown) {
    finalContainer.scrollDown = state.scrollDown;
  }

  return finalContainer;
};
