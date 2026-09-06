const resources = new WeakMap();

/** Register resource cleanup before Pixi destroys an element or its children. */
export const registerElementCleanup = (element, cleanup) => {
  let state = resources.get(element);
  if (!state) {
    state = { cleanups: new Set(), disposed: false };
    resources.set(element, state);
    const destroy = element.destroy;
    element.destroy = function (...args) {
      disposeElementResources(this);
      return destroy.apply(this, args);
    };
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    state.cleanups.delete(release);
    cleanup();
  };
  if (state.disposed || element.destroyed) release();
  else state.cleanups.add(release);
  return release;
};

export const disposeElementResources = (element) => {
  const state = resources.get(element);
  if (!state || state.disposed) return;
  state.disposed = true;
  // Cleanup removes its own registration and may release another resource.
  // eslint-disable-next-line unicorn/no-useless-spread
  for (const cleanup of [...state.cleanups]) {
    try {
      cleanup();
    } catch {
      /* One resource must not prevent the remaining cleanup or Pixi destruction. */
    }
  }
};
