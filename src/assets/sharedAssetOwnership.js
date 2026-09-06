// Shared caches require shared ownership across RouteGraphics instances.
export const sharedTextureAssetOwners = new Map();
export const sharedTextureAliasOwners = new Map();
export const sharedUrlTextureAssetOwners = new Map();
export const sharedPendingTextureLoads = new Map();
export const sharedAudioAssetOwners = new Map();

export const retainSharedOwnership = (ownership) => {
  ownership.referenceCount += 1;
  return ownership;
};

export const retainSharedAsset = ({ registry, identity, value, dispose }) => {
  let ownership = registry.get(identity);
  if (!ownership) {
    ownership = {
      registry,
      identity,
      value,
      referenceCount: 0,
      dispose,
      unregister: () => {
        if (registry.get(identity) === ownership) registry.delete(identity);
      },
    };
    registry.set(identity, ownership);
  }
  return retainSharedOwnership(ownership);
};

export const releaseSharedAsset = async (ownership) => {
  ownership.referenceCount -= 1;
  if (ownership.referenceCount > 0) return;
  if (ownership.onZeroReferences) {
    await ownership.onZeroReferences();
    return;
  }
  ownership.unregister?.();
  await ownership.dispose?.();
};

export const trackPendingLoad = (pending, key, load) => {
  if (pending.has(key)) return pending.get(key);
  let resolveLoad;
  let rejectLoad;
  const operation = new Promise((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  // Publish before invoking the loader so synchronous reservations and
  // reentrant callers see the same operation.
  pending.set(key, operation);
  const clear = () => {
    if (pending.get(key) === operation) pending.delete(key);
  };
  void operation.then(clear, clear);
  try {
    Promise.resolve(load()).then(resolveLoad, rejectLoad);
  } catch (error) {
    rejectLoad(error);
  }
  return operation;
};
