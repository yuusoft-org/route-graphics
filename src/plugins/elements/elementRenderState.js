import { isDeepEqual } from "../../util/isDeepEqual.js";
import {
  hasInstalledShaderFilters,
  setShaderTime,
  syncShaderFilters,
} from "./util/shaderFilterEffect.js";

const ELEMENT_RENDER_STATE = Symbol("routeGraphicsElementRenderState");
const ELEMENT_HIT_TEST_BOUNDS = Symbol("routeGraphicsElementHitTestBounds");
const DEFERRED_RENDER_STATE_COMMIT = Symbol(
  "routeGraphicsDeferredRenderStateCommit",
);
const PARENT_RENDER_STATE = Symbol("routeGraphicsParentRenderState");
const RENDER_LIFECYCLE = Symbol("routeGraphicsElementRenderLifecycle");

const isPromise = (value) => value && typeof value.then === "function";
const getElementKey = (ownerElementId, id) =>
  JSON.stringify([ownerElementId, id]);

export const getElementRenderState = (displayObject) =>
  displayObject?.[ELEMENT_RENDER_STATE] ?? null;

export const setElementRenderState = (displayObject, element) => {
  if (displayObject && element) {
    displayObject[ELEMENT_RENDER_STATE] = element;
  }
};

export const setElementHitTestBounds = (displayObject, resolveBounds) => {
  if (displayObject && typeof resolveBounds === "function") {
    displayObject[ELEMENT_HIT_TEST_BOUNDS] = resolveBounds;
  }
};

export const getElementHitTestBounds = (displayObject) =>
  displayObject?.[ELEMENT_HIT_TEST_BOUNDS]?.(displayObject) ?? null;

const getParentRenderState = (parent) => {
  if (!parent[PARENT_RENDER_STATE]) {
    parent[PARENT_RENDER_STATE] = { lifecycle: null, managed: false };
  }
  return parent[PARENT_RENDER_STATE];
};

const getMountedChild = (parent, id) => {
  for (let index = parent.children.length - 1; index >= 0; index--) {
    const child = parent.children[index];
    if (!child.destroyed && child.label === id) {
      return child;
    }
  }
  return undefined;
};

const getAddedChild = (parent, element, childrenBefore) => {
  for (let index = parent.children.length - 1; index >= 0; index--) {
    const child = parent.children[index];
    if (
      !child.destroyed &&
      child.label === element.id &&
      !childrenBefore.has(child)
    ) {
      const rendered = getElementRenderState(child);
      if (!rendered || rendered.type === element.type) {
        return child;
      }
    }
  }
  return null;
};

const markMountedElement = (
  child,
  element,
  { animations, targetId = element?.id, shaderTime = 0, getShaderTime } = {},
) => {
  if (child) {
    const hasRuntimeReadyFilters =
      Array.isArray(element.filters) &&
      element.filters.every(
        (filter) => Array.isArray(filter?.passes) || filter?.source,
      );
    if (hasRuntimeReadyFilters || hasInstalledShaderFilters(child)) {
      syncShaderFilters(child, element.filters, {
        width: element.width,
        height: element.height,
        force: true,
        animations,
        targetId,
      });
      setShaderTime(
        child,
        typeof getShaderTime === "function" ? getShaderTime() : shaderTime,
      );
    }
    setElementRenderState(child, element);
  }
};

export const addElementWithRenderState = ({ plugin, ...options }) => {
  const childrenBefore = new Set(options.parent.children);
  const { parent, element } = options;
  const discardPartialMount = () => {
    if (options.signal?.aborted || parent.destroyed) return;
    const child = getAddedChild(parent, element, childrenBefore);
    if (child) child.destroy({ children: true });
  };
  let operation;
  try {
    operation = plugin.add(options);
  } catch (error) {
    discardPartialMount();
    throw error;
  }
  let mountedChild = getAddedChild(parent, element, childrenBefore);
  markMountedElement(mountedChild, element, {
    animations: options.animations,
    shaderTime: options.shaderTime,
    getShaderTime: options.getShaderTime,
  });

  if (!isPromise(operation)) {
    return operation;
  }

  return operation.then(
    () => {
      if (!mountedChild || mountedChild.destroyed) {
        mountedChild = getAddedChild(parent, element, childrenBefore);
      }
      markMountedElement(mountedChild, element, {
        animations: options.animations,
        shaderTime: options.shaderTime,
        getShaderTime: options.getShaderTime,
      });
    },
    (error) => {
      discardPartialMount();
      throw error;
    },
  );
};

export const updateElementWithRenderState = ({ plugin, ...options }) => {
  const { parent, prevElement, nextElement, signal } = options;
  let didCommit = false;
  let deferredCommit = null;

  const deferRenderStateCommit = () => {
    if (deferredCommit) {
      return;
    }

    let resolveCommit;
    const committed = new Promise((resolve) => {
      resolveCommit = resolve;
    });
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", settle);
      resolveCommit();
    };

    deferredCommit = {
      result: { [DEFERRED_RENDER_STATE_COMMIT]: committed },
      settle,
    };
    if (didCommit || signal?.aborted || parent.destroyed) {
      settle();
    } else {
      signal?.addEventListener?.("abort", settle, { once: true });
    }
  };

  const commitRenderState = (displayObject) => {
    didCommit = true;

    if (!signal?.aborted && !parent.destroyed) {
      const mountedChild =
        displayObject ??
        getMountedChild(parent, nextElement.id) ??
        getMountedChild(parent, prevElement.id);
      markMountedElement(mountedChild, nextElement, {
        animations: options.animations,
        targetId: prevElement.id,
        shaderTime: options.shaderTime,
        getShaderTime: options.getShaderTime,
      });
    }
    deferredCommit?.settle();
  };

  let operation;
  try {
    operation = plugin.update({
      ...options,
      commitRenderState,
      deferRenderStateCommit,
    });
  } catch (error) {
    deferredCommit?.settle();
    throw error;
  }

  const finishUpdate = (result) => {
    if (deferredCommit) {
      return deferredCommit.result;
    }

    commitRenderState();
    return result;
  };

  if (!isPromise(operation)) {
    return finishUpdate(operation);
  }

  return operation.then(finishUpdate, (error) => {
    deferredCommit?.settle();
    throw error;
  });
};

const getOwnerElementId = (parent) => {
  let ancestor = parent;
  while (ancestor) {
    const element = getElementRenderState(ancestor);
    if (element) {
      return element.id;
    }
    ancestor = ancestor.parent;
  }
  return null;
};

const collectDesiredElements = (
  elements,
  ownerElementId,
  desired = new Map(),
) => {
  for (let zIndex = 0; zIndex < elements.length; zIndex++) {
    const element = elements[zIndex];
    desired.set(getElementKey(ownerElementId, element.id), {
      element,
      ownerElementId,
      zIndex,
    });
    if (Array.isArray(element.children)) {
      collectDesiredElements(element.children, element.id, desired);
    }
  }
  return desired;
};

const createLifecycle = (rootParent) => ({
  currentRender: null,
  desiredElements: new Map(),
  pendingReplacements: new Map(),
  renderParents: new Map(),
  rootOwnerElementId: getOwnerElementId(rootParent),
  rootParent,
});

const getLifecycle = (parent, renderContext) => {
  if (renderContext[RENDER_LIFECYCLE]) {
    return { lifecycle: renderContext[RENDER_LIFECYCLE], isRootRender: false };
  }

  const parentState = getParentRenderState(parent);
  const lifecycle = parentState.lifecycle ?? createLifecycle(parent);
  parentState.lifecycle = lifecycle;
  renderContext[RENDER_LIFECYCLE] = lifecycle;
  return { lifecycle, isRootRender: true };
};

const reserveCompletion = (replacement, currentRender) => {
  const tracker = currentRender?.completionTracker;
  if (!tracker?.getVersion || !tracker?.track) {
    return;
  }

  const version = tracker.getVersion();
  const previous = replacement.completionReservation;
  if (previous?.tracker === tracker && previous.version === version) {
    return;
  }

  tracker.track(version);
  replacement.completionReservation = { tracker, version };
  previous?.tracker.complete?.(previous.version);
};

const releaseCompletion = (replacement) => {
  const reservation = replacement.completionReservation;
  replacement.completionReservation = null;
  reservation?.tracker.complete?.(reservation.version);
};

const beginRootRender = (
  lifecycle,
  { nextComputedTree, parent, renderSnapshot },
) => {
  lifecycle.rootParent = parent;
  lifecycle.rootOwnerElementId = getOwnerElementId(parent);
  lifecycle.currentRender = renderSnapshot;
  lifecycle.desiredElements = collectDesiredElements(
    nextComputedTree,
    lifecycle.rootOwnerElementId,
  );
  pruneElementRenderState(lifecycle);

  for (const replacement of lifecycle.pendingReplacements.values()) {
    reserveCompletion(replacement, renderSnapshot);
  }
};

const getRenderedPreviousElements = (parent, prevComputedTree) => {
  const parentState = getParentRenderState(parent);
  const committedById = new Map(
    prevComputedTree.map((element) => [element.id, element]),
  );
  const renderedById = new Map();

  for (const child of parent.children) {
    if (child.destroyed) continue;

    const committed = committedById.get(child.label);
    let rendered = getElementRenderState(child);
    if (!rendered && committed) {
      rendered = committed;
      setElementRenderState(child, committed);
    }
    if (rendered) {
      renderedById.set(
        rendered.id,
        committed?.type === rendered.type ? committed : rendered,
      );
    }
  }

  // A first render may legitimately describe an element whose async plugin has
  // not mounted a display object. Preserve those committed entries, but never
  // overwrite a marker carried by a child that was reparented here.
  if (!parentState.managed) {
    for (const element of prevComputedTree) {
      if (!renderedById.has(element.id)) {
        renderedById.set(element.id, element);
      }
    }
  }

  parentState.managed = true;
  return Array.from(renderedById.values());
};

export const prepareElementRenderState = ({
  nextComputedTree,
  parent,
  prevComputedTree,
  renderContext,
  renderSnapshot,
}) => {
  const { lifecycle, isRootRender } = getLifecycle(parent, renderContext);
  if (isRootRender) {
    beginRootRender(lifecycle, { nextComputedTree, parent, renderSnapshot });
  }

  const ownerElementId = getOwnerElementId(parent);
  const renderedPrevComputedTree = getRenderedPreviousElements(
    parent,
    prevComputedTree,
  );
  for (const element of [...renderedPrevComputedTree, ...nextComputedTree]) {
    lifecycle.renderParents.set(
      getElementKey(ownerElementId, element.id),
      parent,
    );
  }

  const pendingReplacementIds = new Set();
  for (const replacement of lifecycle.pendingReplacements.values()) {
    if (replacement.ownerElementId === ownerElementId) {
      pendingReplacementIds.add(replacement.id);
    }
  }

  return {
    lifecycle,
    ownerElementId,
    pendingReplacementIds,
    renderedPrevComputedTree,
    resolveRenderParent: (id) =>
      resolveRenderParent(lifecycle, ownerElementId, id),
  };
};

const findByLabel = (parent, label) => {
  for (const child of parent.children ?? []) {
    if (child.destroyed) continue;
    if (child.label === label) return child;
    const match = findByLabel(child, label);
    if (match) return match;
  }
  return null;
};

const isInLifecycleTree = (displayObject, rootParent) => {
  let current = displayObject;
  while (current) {
    if (current === rootParent) return true;
    current = current.parent;
  }
  return false;
};

export const pruneElementRenderState = (lifecycle) => {
  for (const [key, parent] of lifecycle.renderParents) {
    if (
      lifecycle.desiredElements.has(key) ||
      lifecycle.pendingReplacements.has(key)
    )
      continue;
    const [, id] = JSON.parse(key);
    const mounted =
      !parent.destroyed &&
      isInLifecycleTree(parent, lifecycle.rootParent) &&
      parent.children?.some((child) => !child.destroyed && child.label === id);
    if (!mounted) lifecycle.renderParents.delete(key);
  }
};

const findMountedParent = (parent, id) => {
  for (const child of parent.children ?? []) {
    if (child.destroyed) continue;
    const rendered = getElementRenderState(child);
    if (child.label === id && rendered?.id === id) {
      return child.parent;
    }
    const match = findMountedParent(child, id);
    if (match) return match;
  }
  return null;
};

const resolveRenderParent = (lifecycle, ownerElementId, id) => {
  const { rootOwnerElementId, rootParent } = lifecycle;
  if (!rootParent || rootParent.destroyed) return null;

  const key = getElementKey(ownerElementId, id);
  const registeredParent = lifecycle.renderParents.get(key);
  const registeredParentIsCurrent =
    registeredParent &&
    !registeredParent.destroyed &&
    isInLifecycleTree(registeredParent, rootParent);
  const owner =
    ownerElementId === rootOwnerElementId
      ? rootParent
      : (rootParent.getChildByLabel?.(ownerElementId, true) ??
        findByLabel(rootParent, ownerElementId));
  if (!owner) return null;

  const mountedParent = findMountedParent(owner, id);
  if (
    registeredParentIsCurrent &&
    (!mountedParent || isInLifecycleTree(mountedParent, registeredParent))
  ) {
    return registeredParent;
  }

  if (mountedParent) {
    lifecycle.renderParents.set(key, mountedParent);
    return mountedParent;
  }

  const builtInContent = owner.children?.find(
    (child) => !child.destroyed && child.label === `${ownerElementId}-content`,
  );
  const resolvedParent = builtInContent ?? owner;
  lifecycle.renderParents.set(key, resolvedParent);
  return resolvedParent;
};

const getDesiredElement = (lifecycle, replacement) =>
  lifecycle.desiredElements.get(
    getElementKey(replacement.ownerElementId, replacement.id),
  );

const isActive = (lifecycle, render) =>
  lifecycle.currentRender === render &&
  !render?.signal?.aborted &&
  !lifecycle.rootParent?.destroyed;

const settleReplacement = async (lifecycle, replacement) => {
  let lastMountAttempt = null;

  while (true) {
    const render = lifecycle.currentRender;
    if (!isActive(lifecycle, render)) return false;

    const parent = resolveRenderParent(
      lifecycle,
      replacement.ownerElementId,
      replacement.id,
    );
    if (!parent || parent.destroyed) return false;

    const desired = getDesiredElement(lifecycle, replacement);
    const child = getMountedChild(parent, replacement.id);
    const rendered = child
      ? (getElementRenderState(child) ??
        lastMountAttempt?.element ??
        replacement.prevElement)
      : null;

    if (child && desired && rendered.type === desired.element.type) {
      if (!isDeepEqual(rendered, desired.element)) {
        const updateResult = await render.updateElement({
          parent,
          prevElement: rendered,
          nextElement: desired.element,
          zIndex: desired.zIndex,
        });
        await updateResult?.[DEFERRED_RENDER_STATE_COMMIT];
        if (!isActive(lifecycle, render)) continue;
      }
      if (!child.destroyed && child.parent === parent) {
        setElementRenderState(child, desired.element);
      }
      return true;
    }

    if (child) {
      await render.deleteElement({ parent, element: rendered });
      if (
        isActive(lifecycle, render) &&
        resolveRenderParent(
          lifecycle,
          replacement.ownerElementId,
          replacement.id,
        ) === parent &&
        getMountedChild(parent, replacement.id) === child
      ) {
        throw new Error(
          `Element plugin cleanup did not remove "${replacement.id}".`,
        );
      }
      continue;
    }

    if (!desired) return true;

    lastMountAttempt = desired;
    const operation = render.mountElement({
      parent,
      element: desired.element,
      zIndex: desired.zIndex,
    });
    if (!isPromise(operation)) return true;

    await operation;
    if (isActive(lifecycle, render)) return true;
  }
};

const removePendingReplacement = (lifecycle, replacement) =>
  lifecycle.pendingReplacements.delete(
    getElementKey(replacement.ownerElementId, replacement.id),
  );

const requestCurrentFrame = (lifecycle) => {
  const render = lifecycle.currentRender;
  if (isActive(lifecycle, render)) {
    render.requestFrame?.();
  }
};

export const registerPendingElementReplacement = ({
  lifecycle,
  operation,
  replacement,
}) => {
  const key = getElementKey(replacement.ownerElementId, replacement.id);
  lifecycle.pendingReplacements.set(key, replacement);
  reserveCompletion(replacement, lifecycle.currentRender);

  return operation
    .then(() => settleReplacement(lifecycle, replacement))
    .then(
      (shouldPresent) => {
        if (lifecycle.pendingReplacements.get(key) === replacement) {
          removePendingReplacement(lifecycle, replacement);
          if (shouldPresent) requestCurrentFrame(lifecycle);
          releaseCompletion(replacement);
        }
      },
      (error) => {
        if (lifecycle.pendingReplacements.get(key) === replacement) {
          removePendingReplacement(lifecycle, replacement);
          releaseCompletion(replacement);
        }
        throw error;
      },
    );
};
