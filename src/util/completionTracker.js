/**
 * Creates a completion tracker for managing render completion events.
 * Tracks pending animations and text-revealing elements, fires a single
 * renderComplete event when all are done.
 *
 * @param {Function} eventHandler - Event handler function to emit events
 * @returns {CompletionTracker}
 */
export const createCompletionTracker = (eventHandler) => {
  let pendingCount = 0;
  let stateVersion = 0;
  let currentStateId = null;
  let renderInProgress = false;
  let emittedForCurrentState = false;

  const emitRenderComplete = (payload) => {
    if (emittedForCurrentState) {
      return;
    }

    emittedForCurrentState = true;
    eventHandler?.("renderComplete", payload);
  };

  /**
   * Reset the tracker for a new render.
   * If there were pending completions, emits aborted event for previous render.
   * @param {string|undefined} id - The new state's id
   */
  const reset = (id) => {
    const abortedId =
      pendingCount > 0 && currentStateId !== null && !emittedForCurrentState
        ? currentStateId
        : null;
    stateVersion++;
    pendingCount = 0;
    currentStateId = id;
    renderInProgress = true;
    emittedForCurrentState = false;
    // Establish the new generation before notifying a handler that can render again.
    if (abortedId !== null) {
      eventHandler?.("renderComplete", { id: abortedId, aborted: true });
    }
  };

  /**
   * Track a new pending completion (animation or text-revealing).
   * @param {number} version - The state version when this was tracked
   */
  const track = (version) => {
    if (version !== stateVersion) return; // Stale
    pendingCount++;
  };

  /**
   * Mark a completion as done.
   * When all completions are done, fires renderComplete event.
   * @param {number} version - The state version when this was started
   */
  const complete = (version) => {
    if (version !== stateVersion || pendingCount === 0) return; // Stale
    pendingCount--;
    if (pendingCount === 0 && !renderInProgress) {
      emitRenderComplete({ id: currentStateId, aborted: false });
    }
  };

  /**
   * Get the current state version.
   * @returns {number}
   */
  const getVersion = () => stateVersion;

  const fail = (version, error) => {
    if (version !== stateVersion || emittedForCurrentState) return;
    pendingCount = 0;
    renderInProgress = false;
    emitRenderComplete({
      id: currentStateId,
      aborted: true,
      failed: true,
      error,
    });
  };

  /**
   * If nothing is being tracked, fire renderComplete immediately.
   * Called after render to handle states with no animations.
   */
  const completeIfEmpty = () => {
    renderInProgress = false;

    if (pendingCount === 0) {
      emitRenderComplete({ id: currentStateId, aborted: false });
    }
  };

  return {
    reset,
    track,
    complete,
    getVersion,
    fail,
    completeIfEmpty,
  };
};
