import { diffElements } from "../../util/diffElements.js";
import { isDeepEqual } from "../../util/isDeepEqual.js";
import {
  getTransitionAnimation,
  groupAnimationsByTarget,
} from "../animations/planAnimations.js";
import { runReplaceAnimation } from "../animations/replace/runReplaceAnimation.js";
import {
  addElementWithRenderState,
  prepareElementRenderState,
  pruneElementRenderState,
  registerPendingElementReplacement,
  updateElementWithRenderState,
} from "./elementRenderState.js";
import { createRenderContext } from "./renderContext.js";
import { shouldUpdateUnchangedShaderFilterParameters } from "./util/shaderFilterEffect.js";

/**
 * Render elements using plugin system.
 * @param {Object} params
 * @param {import('../../types.js').Application} params.app - The PixiJS application
 * @param {import('../../types.js').Container} params.parent - Parent container
 * @param {import('../../types.js').ComputedNode[]} params.prevComputedTree - Previous computed tree
 * @param {import('../../types.js').ComputedNode[]} params.nextComputedTree - Next computed tree
 * @param {import("./elementPlugin.js").ElementPlugin[]} params.elementPlugins - Array of element plugins
 * @param {import("../animations/animationBus.js").createAnimationBus} params.animationBus - Animation bus
 * @param {Object} params.completionTracker - Completion tracker for state events
 * @param {Object[]} params.animations - Animation configurations
 * @param {Function} params.eventHandler - Event handler function
 * @param {Object} [params.renderContext] - Render context flags for nested mounts
 * @param {AbortSignal} [params.signal] - Render cancellation signal
 * @param {number} [params.shaderTime] - Current deterministic shader time in seconds
 * @param {Function} [params.getShaderTime] - Returns the current deterministic shader time in seconds
 */
export const renderElements = ({
  app,
  parent,
  prevComputedTree,
  nextComputedTree,
  animations,
  animationBus,
  completionTracker,
  eventHandler,
  elementPlugins,
  renderContext = createRenderContext(),
  signal,
  shaderTime = 0,
  getShaderTime,
}) => {
  // Enable PixiJS built-in sorting by zIndex
  parent.sortableChildren = true;
  const pendingOperations = [];
  const collectOperation = (operation) => {
    if (operation && typeof operation.then === "function") {
      const observed = Promise.resolve(operation);
      pendingOperations.push(observed);
      // A later synchronous plugin failure can exit this render before its
      // aggregate is returned; the original operation must still be observed.
      void observed.catch(() => {});
    }
  };

  const pluginByType = new Map(
    elementPlugins.map((plugin) => [plugin.type, plugin]),
  );
  const animationsByTarget = groupAnimationsByTarget(animations);
  const getPlugin = (type) => {
    const plugin = pluginByType.get(type);
    if (!plugin) {
      throw new Error(`No plugin found for element type: ${type}`);
    }

    return plugin;
  };
  const mountElement = ({
    parent: targetParent = parent,
    element,
    zIndex,
    plugin = getPlugin(element.type),
  }) =>
    addElementWithRenderState({
      app,
      parent: targetParent,
      element,
      animations: animationsByTarget,
      eventHandler,
      animationBus,
      completionTracker,
      elementPlugins,
      renderContext,
      zIndex,
      signal,
      shaderTime,
      getShaderTime,
      plugin,
    });
  const deleteElement = ({ parent: targetParent = parent, element }) =>
    getPlugin(element.type).delete({
      app,
      parent: targetParent,
      element,
      animations: [],
      animationBus,
      completionTracker,
      eventHandler,
      elementPlugins,
      renderContext,
    });
  const updateElement = ({
    parent: targetParent = parent,
    prevElement,
    nextElement,
    zIndex,
  }) => {
    const plugin = getPlugin(nextElement.type);

    return updateElementWithRenderState({
      app,
      parent: targetParent,
      prevElement,
      nextElement,
      animations: animationsByTarget,
      animationBus,
      completionTracker,
      eventHandler,
      elementPlugins,
      renderContext,
      zIndex,
      signal,
      shaderTime,
      getShaderTime,
      plugin,
    });
  };
  const {
    lifecycle,
    ownerElementId,
    pendingReplacementIds,
    renderedPrevComputedTree,
    resolveRenderParent,
  } = prepareElementRenderState({
    parent,
    prevComputedTree,
    nextComputedTree,
    renderContext,
    renderSnapshot: {
      completionTracker,
      deleteElement,
      mountElement,
      requestFrame: () => app?.render?.(),
      signal,
      updateElement,
    },
  });
  const prevElementById = new Map();
  const nextIndexById = new Map();
  for (const element of renderedPrevComputedTree) {
    prevElementById.set(element.id, element);
  }
  for (let index = 0; index < nextComputedTree.length; index++) {
    nextIndexById.set(nextComputedTree[index].id, index);
  }

  const diff = diffElements(
    renderedPrevComputedTree,
    nextComputedTree,
    animations,
  );
  const isPendingReplacement = (element) =>
    pendingReplacementIds.has(element.id);
  const toAddElement = diff.toAddElement.filter(
    (element) => !isPendingReplacement(element),
  );
  const toDeleteElement = diff.toDeleteElement.filter(
    (element) => !isPendingReplacement(element),
  );
  const toUpdateElement = diff.toUpdateElement.filter(
    ({ next }) => !isPendingReplacement(next),
  );
  const scheduledUpdateIds = new Set(
    toUpdateElement.map(({ next }) => next.id),
  );

  const getExistingChildZIndex = (targetId) =>
    parent.children.find((child) => child.label === targetId)?.zIndex ?? -1;

  const replaceElement = ({ prevElement, nextElement, nextPlugin, zIndex }) => {
    const addNextElement = () => {
      if (signal?.aborted || parent.destroyed) {
        return undefined;
      }

      return mountElement({
        plugin: nextPlugin,
        element: nextElement,
        zIndex,
      });
    };

    const replacement = {
      id: nextElement.id,
      ownerElementId,
      prevElement,
    };
    // The deletion belongs to the replacement lifecycle, not one render. Its
    // eventual add is gated by the lifecycle's latest signal and desired tree.
    const deleteOperation = deleteElement({ parent, element: prevElement });

    if (deleteOperation && typeof deleteOperation.then === "function") {
      return registerPendingElementReplacement({
        lifecycle,
        operation: deleteOperation,
        replacement,
      });
    }

    const addOperation = addNextElement();
    if (addOperation && typeof addOperation.then === "function") {
      return registerPendingElementReplacement({
        lifecycle,
        operation: addOperation,
        replacement,
      });
    }

    return addOperation;
  };

  for (const element of nextComputedTree) {
    if (pendingReplacementIds.has(element.id)) {
      continue;
    }

    const prevElement = prevElementById.get(element.id);
    if (!prevElement || scheduledUpdateIds.has(element.id)) {
      continue;
    }

    if (!isDeepEqual(prevElement, element)) {
      continue;
    }

    const plugin = getPlugin(element.type);

    const shouldUpdatePlugin =
      plugin.shouldUpdateUnchanged?.({
        app,
        parent,
        prevElement,
        nextElement: element,
        animations: animationsByTarget,
        animationBus,
        completionTracker,
        eventHandler,
        elementPlugins,
        renderContext,
        zIndex: nextIndexById.get(element.id) ?? -1,
        signal,
        shaderTime,
        getShaderTime,
      }) === true;
    const shouldResetShaderParameters =
      shouldUpdateUnchangedShaderFilterParameters({
        parent,
        nextElement: element,
        animations: animationsByTarget,
      });

    if (!shouldUpdatePlugin && !shouldResetShaderParameters) {
      continue;
    }

    toUpdateElement.push({
      prev: prevElement,
      next: element,
    });
    scheduledUpdateIds.add(element.id);
  }

  // Update zIndex for ALL existing children BEFORE any add/update/delete operations
  // This ensures correct z-ordering during animations
  for (const child of parent.children) {
    const expectedZIndex = nextIndexById.get(child.label);
    if (expectedZIndex !== undefined) {
      child.zIndex = expectedZIndex;
    }
  }

  // Delete elements
  for (const element of toDeleteElement) {
    const replaceAnimation = renderContext.suppressAnimations
      ? null
      : getTransitionAnimation(animationsByTarget, element.id);
    const continuedTransition =
      replaceAnimation &&
      typeof animationBus?.hasContext === "function" &&
      animationBus.hasContext(replaceAnimation.id);
    const plugin = getPlugin(element.type);

    if (continuedTransition) {
      continue;
    }

    if (replaceAnimation) {
      collectOperation(
        runReplaceAnimation({
          app,
          parent,
          prevElement: element,
          nextElement: null,
          animation: replaceAnimation,
          animations: animationsByTarget,
          animationBus,
          completionTracker,
          eventHandler,
          elementPlugins,
          renderContext,
          plugin,
          resolveParent: () => resolveRenderParent(element.id),
          zIndex: getExistingChildZIndex(element.id),
          signal,
          shaderTime,
          getShaderTime,
        }),
      );
      continue;
    }

    collectOperation(
      plugin.delete({
        app,
        parent,
        element,
        animations: animationsByTarget,
        animationBus,
        completionTracker,
        eventHandler,
        elementPlugins,
        renderContext,
        signal,
      }),
    );
  }

  // Add elements
  for (const element of toAddElement) {
    const replaceAnimation = renderContext.suppressAnimations
      ? null
      : getTransitionAnimation(animationsByTarget, element.id);
    const continuedTransition =
      replaceAnimation &&
      typeof animationBus?.hasContext === "function" &&
      animationBus.hasContext(replaceAnimation.id);
    const plugin = getPlugin(element.type);

    // Calculate zIndex based on position in nextComputedTree
    const zIndex = nextIndexById.get(element.id) ?? -1;

    if (continuedTransition) {
      if (typeof animationBus?.updateContinuation === "function") {
        animationBus.updateContinuation(replaceAnimation.id, { zIndex });
      }
      continue;
    }

    if (replaceAnimation) {
      collectOperation(
        runReplaceAnimation({
          app,
          parent,
          prevElement: null,
          nextElement: element,
          animation: replaceAnimation,
          animations: animationsByTarget,
          animationBus,
          completionTracker,
          eventHandler,
          elementPlugins,
          renderContext,
          plugin,
          resolveParent: () => resolveRenderParent(element.id),
          zIndex,
          signal,
          shaderTime,
          getShaderTime,
        }),
      );
      continue;
    }

    collectOperation(
      mountElement({
        plugin,
        element,
        zIndex,
      }),
    );
  }

  // Update elements
  for (const { prev, next } of toUpdateElement) {
    const prevPlugin = getPlugin(prev.type);
    const nextPlugin = getPlugin(next.type);
    const isTypeReplacement = prev.type !== next.type;

    // Calculate zIndex based on position in nextComputedTree
    const zIndex = nextIndexById.get(next.id) ?? -1;

    const replaceAnimation = renderContext.suppressAnimations
      ? null
      : getTransitionAnimation(animationsByTarget, next.id);
    const continuedTransition =
      replaceAnimation &&
      typeof animationBus?.hasContext === "function" &&
      animationBus.hasContext(replaceAnimation.id);

    if (continuedTransition) {
      if (typeof animationBus?.updateContinuation === "function") {
        animationBus.updateContinuation(replaceAnimation.id, { zIndex });
      }

      if (isTypeReplacement) {
        continue;
      }
    } else if (replaceAnimation) {
      collectOperation(
        runReplaceAnimation({
          app,
          parent,
          prevElement: prev,
          nextElement: next,
          animation: replaceAnimation,
          animations: animationsByTarget,
          animationBus,
          completionTracker,
          eventHandler,
          elementPlugins,
          renderContext,
          plugin: nextPlugin,
          prevPlugin,
          nextPlugin,
          resolveParent: () => resolveRenderParent(next.id),
          zIndex,
          signal,
          shaderTime,
          getShaderTime,
        }),
      );
      continue;
    }

    if (isTypeReplacement) {
      collectOperation(
        replaceElement({
          prevElement: prev,
          nextElement: next,
          nextPlugin,
          zIndex,
        }),
      );
      continue;
    }

    collectOperation(
      updateElement({
        prevElement: prev,
        nextElement: next,
        zIndex,
      }),
    );
  }

  if (pendingOperations.length === 0) {
    pruneElementRenderState(lifecycle);
    return undefined;
  }

  return Promise.all(pendingOperations)
    .then(() => undefined)
    .finally(() => pruneElementRenderState(lifecycle));
};
