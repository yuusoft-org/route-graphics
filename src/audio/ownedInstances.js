/** Keep resource ownership independent of the current logical ID lookup. */
export const createOwnedInstances = (create, cleanup) => {
  const instances = new Set();
  const dispose = (instance) => {
    try {
      cleanup(instance);
    } finally {
      instances.delete(instance);
    }
  };
  return {
    create: (...args) => {
      const instance = create(...args);
      instances.add(instance);
      return instance;
    },
    dispose,
    destroy: () => {
      // Cleanup can mutate ownership while the original instances are retired.
      // eslint-disable-next-line unicorn/no-useless-spread
      for (const instance of [...instances]) dispose(instance);
    },
  };
};
