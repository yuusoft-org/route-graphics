import { isDeepEqual } from "./isDeepEqual.js";

/**
 * @typedef {import("../types.js").ComputedNode} ComputedNode
 * @typedef {import("../types.js").DiffElementResult} DiffElementResult
 * @typedef {import("../types.js").HoverProps} HoverPops
 * @typedef {import("../types.js").ClickProps} ClickProps
 * @typedef {import("../types.js").Application} App
 */

/**
 *
 * @param {ComputedNode} prevElements
 * @param {ComputedNode} nextElements
 * @param {Object[]} animations
 * @returns {DiffElementResult}
 */
export const diffElements = (prevElements, nextElements, animations = []) => {
  const animationTargets = new Set(
    animations instanceof Map
      ? animations.keys()
      : animations.map((animation) => animation.targetId),
  );
  const hasAnimatedDescendant = (element) => {
    if (animationTargets.has(element.id)) return true;
    return (
      Array.isArray(element.children) &&
      element.children.some(hasAnimatedDescendant)
    );
  };
  const allIdSet = new Set();
  const prevElementMap = new Map();
  const nextElementMap = new Map();

  const toAddElement = [];
  const toDeleteElement = [];
  const toUpdateElement = [];

  for (const element of prevElements) {
    allIdSet.add(element.id);
    prevElementMap.set(element.id, element);
  }

  for (const element of nextElements) {
    allIdSet.add(element.id);
    nextElementMap.set(element.id, element);
  }

  for (const id of allIdSet) {
    const prevEl = prevElementMap.get(id);
    const nextEl = nextElementMap.get(id);

    if (!prevEl && nextEl) {
      // New element
      toAddElement.push(nextEl);
    } else if (prevEl && !nextEl) {
      // Element is deleted
      toDeleteElement.push(prevEl);
    } else {
      if (
        !isDeepEqual(prevEl, nextEl) ||
        (animationTargets.size > 0 && hasAnimatedDescendant(nextEl))
      ) {
        // Update element - definition changed or has animations targeting it or children
        toUpdateElement.push({
          prev: prevEl,
          next: nextEl,
        });
      }
    }
  }
  return { toAddElement, toDeleteElement, toUpdateElement };
};
