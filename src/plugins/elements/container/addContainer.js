import { Container } from "pixi.js";
import { setupScrolling } from "./util/scrollingUtils.js";
import { bindContainerInteractions } from "./util/bindContainerInteractions.js";
import { renderElements } from "../renderElements.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import {
  getBlurTargetState,
  hasBlurUpdateAnimation,
  syncBlurEffect,
} from "../util/blurEffect.js";
import {
  getShaderFilterTargetState,
  hasShaderProgressUpdateAnimation,
  syncShaderFilters,
} from "../util/shaderFilterEffect.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";

const hasDuplicateChildIds = (children = []) => {
  const seen = new Set();

  for (const child of children) {
    if (!child?.id) {
      continue;
    }

    if (seen.has(child.id)) {
      return true;
    }

    seen.add(child.id);
  }

  return false;
};

const addChildrenDirectly = ({
  app,
  container,
  children,
  eventHandler,
  animationBus,
  elementPlugins,
  renderContext,
  completionTracker,
  signal,
  shaderTime,
}) => {
  const pendingOperations = [];

  for (const child of children) {
    const childPlugin = elementPlugins.find(
      (plugin) => plugin.type === child.type,
    );
    if (!childPlugin) {
      throw new Error(`No plugin found for child element type: ${child.type}`);
    }

    const operation = childPlugin.add({
      app,
      parent: container,
      element: child,
      animations: [],
      eventHandler,
      animationBus,
      elementPlugins,
      renderContext,
      completionTracker,
      signal,
      shaderTime,
    });

    if (operation && typeof operation.then === "function") {
      pendingOperations.push(operation);
    }
  }

  if (pendingOperations.length === 0) {
    return undefined;
  }

  return Promise.all(pendingOperations).then(() => undefined);
};

/**
 * Add container element to the stage.
 * @param {import("../elementPlugin").AddElementOptions} params
 */
export const addContainer = ({
  app,
  parent,
  element,
  animations,
  eventHandler,
  animationBus,
  elementPlugins,
  renderContext,
  zIndex,
  completionTracker,
  signal,
  shaderTime,
}) => {
  const { id, children, scroll, alpha } = element;

  const container = new Container();
  container.label = id;
  container.zIndex = zIndex;

  // Apply initial state
  container.alpha = alpha;
  applyElementTransform(container, element);
  const shouldForceBlur = hasBlurUpdateAnimation(animations, id);
  syncBlurEffect(container, element.blur, { force: shouldForceBlur });
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    id,
  );
  syncShaderFilters(container, element.filters, {
    width: element.width,
    height: element.height,
    force: shouldForceShaderProgress,
  });

  parent.addChild(container);
  let childMountOperation;

  if (children && children.length > 0) {
    if (hasDuplicateChildIds(children)) {
      childMountOperation = addChildrenDirectly({
        app,
        container,
        children,
        eventHandler,
        animationBus,
        elementPlugins,
        renderContext,
        completionTracker,
        signal,
        shaderTime,
      });
    } else {
      // Route unique fresh mounts through the planner so child transitions can run.
      childMountOperation = renderElements({
        app,
        parent: container,
        prevComputedTree: [],
        nextComputedTree: children,
        animations,
        animationBus,
        completionTracker,
        eventHandler,
        elementPlugins,
        renderContext,
        signal,
        shaderTime,
      });
    }
  }

  const shouldUseViewport = scroll || element.anchorToBottom;
  if (shouldUseViewport) {
    setupScrolling({
      container,
      element,
      interactive: !!scroll,
      allowViewportWithoutScroll: !!element.anchorToBottom,
    });
  }

  bindContainerInteractions({
    app,
    container,
    element,
    eventHandler,
  });

  dispatchLiveAnimations({
    animations,
    targetId: id,
    animationBus,
    completionTracker,
    element: container,
    targetState: {
      ...getElementTransformTargetState(element, { alpha }),
      ...getBlurTargetState(element, { force: shouldForceBlur }),
      ...getShaderFilterTargetState(element, {
        force: shouldForceShaderProgress,
      }),
    },
    renderContext,
  });

  return childMountOperation;
};
