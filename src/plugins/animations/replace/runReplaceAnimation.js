import { Container } from "pixi.js";
import { compileTransitionAnimation } from "../timeline/index.js";
import {
  clearDeferredMountOperations,
  createRenderContext,
  flushDeferredMountOperations,
} from "../../elements/renderContext.js";
import {
  setElementHitTestBounds,
  setElementRenderState,
} from "../../elements/elementRenderState.js";
import { cleanupParticlesInTree } from "../../elements/particles/particleRuntime.js";
import { getAnimationContinuitySignature } from "../planAnimations.js";
import { setShaderTimeInTree } from "../../elements/util/shaderFilterEffect.js";
import {
  createSnapshotSubject,
  createLiveSubject,
  hasAnimatedSpriteInTree,
  isLiveSubject,
  createTransitionTimelineController,
  detachChildFromParent,
  destroySubjectSnapshot,
  resolveOverlaySubjects,
  createReplaceOverlay,
} from "./transitionSurfaces.js";

const instantiateNextLiveElement = ({
  app,
  parent,
  nextElement,
  plugin,
  animations,
  eventHandler,
  animationBus,
  completionTracker,
  elementPlugins,
  renderContext,
  zIndex,
  signal,
  shaderTime,
  getShaderTime,
}) => {
  if (!nextElement) {
    return null;
  }

  const result = plugin.add({
    app,
    parent,
    element: nextElement,
    animations,
    eventHandler,
    animationBus,
    completionTracker,
    elementPlugins,
    renderContext,
    zIndex,
    signal,
    shaderTime,
    getShaderTime,
  });

  if (result && typeof result.then === "function") {
    return result.then(() => {
      if (signal?.aborted || parent.destroyed) {
        return null;
      }

      const nextDisplayObject =
        parent.children.find((child) => child.label === nextElement.id) ?? null;
      if (nextDisplayObject) {
        setElementRenderState(nextDisplayObject, nextElement);
      }
      return nextDisplayObject;
    });
  }

  if (signal?.aborted || parent.destroyed) {
    return null;
  }

  const nextDisplayObject =
    parent.children.find((child) => child.label === nextElement.id) ?? null;
  if (nextDisplayObject) {
    setElementRenderState(nextDisplayObject, nextElement);
  }
  return nextDisplayObject;
};

const resolveNextDisplayObject = async (nextDisplayObjectOrPromise) => {
  if (
    nextDisplayObjectOrPromise &&
    typeof nextDisplayObjectOrPromise.then === "function"
  ) {
    return nextDisplayObjectOrPromise;
  }

  return nextDisplayObjectOrPromise ?? null;
};

export const runReplaceAnimation = ({
  app,
  parent,
  prevElement,
  nextElement,
  animation,
  animations,
  animationBus,
  completionTracker,
  eventHandler,
  elementPlugins,
  renderContext,
  plugin,
  prevPlugin = plugin,
  nextPlugin = plugin,
  resolveParent,
  zIndex,
  signal,
  shaderTime = 0,
  getShaderTime,
}) => {
  if (!prevElement && !nextElement) {
    throw new Error(
      `Replace animation "${animation.id}" must receive prevElement and/or nextElement.`,
    );
  }

  if (signal?.aborted || parent.destroyed) {
    return;
  }

  const transitionProgram = compileTransitionAnimation(animation, {
    sourcePath: `animation.${animation.id}`,
  });
  for (const query of Object.values(transitionProgram.targetQueries)) {
    if (query.kind === "transitionMask") {
      if (!animation.mask?.length) {
        throw new Error(
          `Transition animation "${animation.id}" targets a mask but has no mask resource.`,
        );
      }
      if (
        query.index !== undefined &&
        animation.mask[query.index] === undefined
      ) {
        throw new Error(
          `Transition animation "${animation.id}" targets missing mask index ${query.index}.`,
        );
      }
    }
    if (query.kind === "transitionCompositor" && !animation.compositor) {
      throw new Error(
        `Transition animation "${animation.id}" targets a compositor but has no compositor resource.`,
      );
    }
  }
  // Pure virtual binding validates capabilities, finite duration, value
  // shapes, and orchestrated terminal progress before snapshots/GPU resources.
  createTransitionTimelineController({
    animation,
    program: transitionProgram,
    validateTerminal: true,
  });

  const prevDisplayObject = prevElement
    ? (parent.children.find((child) => child.label === prevElement.id) ?? null)
    : null;

  if (prevElement && !prevDisplayObject) {
    throw new Error(
      `Transition animation "${animation.id}" could not find the previous element "${prevElement.id}".`,
    );
  }

  const isPersistent = animation.playback?.continuity === "persistent";
  const continuitySignature = getAnimationContinuitySignature(animation);
  const transitionSignalController = isPersistent
    ? new AbortController()
    : null;
  const transitionSignal = transitionSignalController?.signal ?? signal;
  const getCurrentParent = () => {
    if (typeof resolveParent === "function") {
      const resolvedParent = resolveParent();
      return resolvedParent && !resolvedParent.destroyed
        ? resolvedParent
        : null;
    }

    return parent.destroyed ? null : parent;
  };
  const resolveShaderTime = () =>
    typeof getShaderTime === "function" ? getShaderTime() : shaderTime;

  const transitionMountParent = new Container();
  const hiddenMountContext = createRenderContext({
    suppressAnimations: true,
  });
  const trackCompletion = !isPersistent;
  const stateVersion = trackCompletion ? completionTracker.getVersion() : null;
  let completionTracked = false;
  let currentZIndex = zIndex;

  const trackTransition = () => {
    if (!trackCompletion || completionTracked) {
      return;
    }

    completionTracker.track(stateVersion);
    completionTracked = true;
  };

  const completeTransition = () => {
    if (!completionTracked) {
      return;
    }

    completionTracked = false;
    completionTracker.complete(stateVersion);
  };
  const nextDisplayObjectRef = { value: null };
  const replaceOverlayRef = { value: null };
  let finalizationStarted = false;
  let finalizationOperation;
  let previousLiveDeleted = false;
  let pendingRegistration;
  let cleanupPreparedResources;
  let preparationFailed = false;
  const cleanupPendingTransition = () => {
    if (typeof animationBus?.removePending === "function") {
      animationBus.removePending(animation.id, pendingRegistration);
    }
  };
  const handleContinuationUpdate = ({ zIndex: nextZIndex } = {}) => {
    if (typeof nextZIndex !== "number") {
      return;
    }

    currentZIndex = nextZIndex;

    if (nextDisplayObjectRef.value && !nextDisplayObjectRef.value.destroyed) {
      nextDisplayObjectRef.value.zIndex = currentZIndex;
    }

    if (
      replaceOverlayRef.value?.overlay &&
      !replaceOverlayRef.value.overlay.destroyed
    ) {
      replaceOverlayRef.value.overlay.zIndex = currentZIndex;
    }
  };

  const deletePreviousLiveElement = () => {
    const prevSubject = replaceOverlayRef.value?.prevSubject;
    if (
      previousLiveDeleted ||
      !isLiveSubject(prevSubject) ||
      !prevElement ||
      !prevDisplayObject ||
      prevDisplayObject.destroyed
    ) {
      return undefined;
    }

    previousLiveDeleted = true;
    return prevPlugin.delete({
      app,
      parent: prevDisplayObject.parent ?? replaceOverlayRef.value.overlay,
      element: prevElement,
      animations: [],
      animationBus,
      completionTracker,
      eventHandler,
      elementPlugins,
      renderContext,
      signal: transitionSignal,
    });
  };

  const presentNextDisplayObject = () => {
    const currentParent = getCurrentParent();
    if (nextDisplayObjectRef.value && !nextDisplayObjectRef.value.destroyed) {
      nextDisplayObjectRef.value.zIndex = currentZIndex;
      if (
        currentParent &&
        nextDisplayObjectRef.value.parent !== currentParent
      ) {
        nextDisplayObjectRef.value.parent?.removeChild?.(
          nextDisplayObjectRef.value,
        );
        currentParent.addChild(nextDisplayObjectRef.value);
      } else if (!currentParent) {
        nextDisplayObjectRef.value.removeFromParent?.();
        cleanupParticlesInTree({ app, root: nextDisplayObjectRef.value });
        nextDisplayObjectRef.value.destroy({ children: true });
      }
      if (currentParent) {
        nextDisplayObjectRef.value.visible = true;
      }
    }
  };

  const releaseTransitionResources = ({ flushDeferredEffects }) => {
    replaceOverlayRef.value?.destroy();

    if (flushDeferredEffects) {
      flushDeferredMountOperations(hiddenMountContext);
      return;
    }

    clearDeferredMountOperations(hiddenMountContext);
  };

  const finalize = ({ flushDeferredEffects }) => {
    if (finalizationStarted) return finalizationOperation;
    finalizationStarted = true;

    let deleteOperation;
    try {
      deleteOperation = deletePreviousLiveElement();
    } catch (error) {
      presentNextDisplayObject();
      releaseTransitionResources({ flushDeferredEffects: false });
      throw error;
    }

    // Make the committed next object available synchronously. A superseding
    // render can then reconcile its actual plugin type while old live-subject
    // cleanup remains pending inside the transition overlay.
    presentNextDisplayObject();

    if (!deleteOperation || typeof deleteOperation.then !== "function") {
      releaseTransitionResources({ flushDeferredEffects });
      return undefined;
    }

    finalizationOperation = deleteOperation.then(
      () => releaseTransitionResources({ flushDeferredEffects }),
      (error) => {
        releaseTransitionResources({ flushDeferredEffects: false });
        throw error;
      },
    );
    return finalizationOperation;
  };

  const failTransition = (error) => {
    if (trackCompletion) completionTracker.fail?.(stateVersion, error);
  };

  const finishTransition = ({ flushDeferredEffects }) => {
    let operation;
    try {
      operation = finalize({ flushDeferredEffects });
    } catch (error) {
      failTransition(error);
      completeTransition();
      throw error;
    }
    if (!operation || typeof operation.then !== "function") {
      completeTransition();
      return undefined;
    }

    const completionOperation = operation
      .catch((error) => {
        failTransition(error);
        throw error;
      })
      .finally(completeTransition);
    // AnimationBus callbacks are synchronous hooks. Mark the rejection as
    // observed even when no direct caller awaits the returned operation.
    void completionOperation.catch(() => {});
    return completionOperation;
  };

  if (isPersistent && typeof animationBus?.registerPending === "function") {
    pendingRegistration = animationBus.registerPending({
      id: animation.id,
      animationType: animation.type,
      targetId: animation.targetId,
      signature: continuitySignature,
      continuity: "persistent",
      playbackSpeed: animation.playback?.speed,
      onCancel: () => {
        transitionSignalController?.abort();
        clearDeferredMountOperations(hiddenMountContext);
        cleanupParticlesInTree({ app, root: transitionMountParent });
        transitionMountParent.destroy({ children: true });
        completeTransition();
      },
      onContinuationUpdate: handleContinuationUpdate,
    });
  }

  trackTransition();

  const continueWithNextDisplayObject = (
    nextDisplayObject,
    continuedAsynchronously = false,
  ) => {
    if (transitionSignal?.aborted || !getCurrentParent()) {
      cleanupPendingTransition();
      clearDeferredMountOperations(hiddenMountContext);
      cleanupParticlesInTree({ app, root: transitionMountParent });
      transitionMountParent.destroy({ children: true });
      completeTransition();
      return;
    }

    if (nextElement && !nextDisplayObject) {
      cleanupPendingTransition();
      clearDeferredMountOperations(hiddenMountContext);
      completeTransition();
      throw new Error(
        `Transition animation "${animation.id}" could not create the next element "${nextElement.id}".`,
      );
    }

    if (nextDisplayObject) {
      setShaderTimeInTree(nextDisplayObject, resolveShaderTime());
    }

    const useLivePlainOverlay =
      animation.mask === undefined &&
      animation.compositor === undefined &&
      (hasAnimatedSpriteInTree(prevDisplayObject) ||
        hasAnimatedSpriteInTree(nextDisplayObject));
    const preparedSubjects = new Set();
    cleanupPreparedResources = () => {
      for (const subject of preparedSubjects)
        destroySubjectSnapshot(subject, app);
      preparedSubjects.clear();
      if (nextDisplayObject && !nextDisplayObject.destroyed) {
        nextDisplayObject.removeFromParent?.();
        nextDisplayObject.destroy({ children: true });
      }
    };
    const prevSubject = prevDisplayObject
      ? useLivePlainOverlay
        ? createLiveSubject(prevDisplayObject)
        : createSnapshotSubject(app, prevDisplayObject)
      : null;
    preparedSubjects.add(prevSubject);
    const nextSubject = nextDisplayObject
      ? useLivePlainOverlay
        ? createLiveSubject(nextDisplayObject)
        : createSnapshotSubject(app, nextDisplayObject)
      : null;

    preparedSubjects.add(nextSubject);
    const overlaySubjects = resolveOverlaySubjects({
      prevElement,
      nextElement,
      animation,
      prevSubject,
      nextSubject,
    });

    if (overlaySubjects.prevSubject !== prevSubject) {
      destroySubjectSnapshot(prevSubject, app);
    }

    if (overlaySubjects.nextSubject !== nextSubject) {
      destroySubjectSnapshot(nextSubject, app);
    }

    detachChildFromParent(nextDisplayObject, transitionMountParent);
    cleanupParticlesInTree({ app, root: transitionMountParent });
    transitionMountParent.destroy({ children: true });

    const cleanupPreparedTransition = () => {
      cleanupPendingTransition();
      clearDeferredMountOperations(hiddenMountContext);
      destroySubjectSnapshot(overlaySubjects.prevSubject, app);
      destroySubjectSnapshot(overlaySubjects.nextSubject, app);

      if (nextDisplayObject && !nextDisplayObject.destroyed) {
        nextDisplayObject.removeFromParent?.();
        cleanupParticlesInTree({ app, root: nextDisplayObject });
        nextDisplayObject.destroy({ children: true });
      }
    };

    cleanupPreparedResources = cleanupPreparedTransition;

    const installTransition = ({ activateImmediately = false } = {}) => {
      const currentParent = getCurrentParent();
      if (transitionSignal?.aborted || !currentParent) {
        cleanupPreparedTransition();
        completeTransition();
        return;
      }

      if (nextDisplayObject && !isLiveSubject(overlaySubjects.nextSubject)) {
        nextDisplayObject.zIndex = currentZIndex;
        currentParent.addChild(nextDisplayObject);
        nextDisplayObject.visible = false;
      }

      const replaceOverlay = createReplaceOverlay({
        app,
        animation,
        program: transitionProgram,
        prevSubject: overlaySubjects.prevSubject,
        nextSubject: overlaySubjects.nextSubject,
        zIndex: currentZIndex,
        getShaderTime: resolveShaderTime,
      });
      replaceOverlayRef.value = replaceOverlay;
      nextDisplayObjectRef.value = nextDisplayObject;

      setElementRenderState(replaceOverlay.overlay, nextElement ?? prevElement);
      setElementHitTestBounds(replaceOverlay.overlay, (overlay) => {
        const localBounds = overlay.getLocalBounds?.();
        return localBounds?.rectangle ?? localBounds;
      });

      currentParent.addChild(replaceOverlay.overlay);
      if (isLiveSubject(overlaySubjects.nextSubject)) {
        flushDeferredMountOperations(
          hiddenMountContext,
          (operation) => operation?.type === "play-animated-sprite",
        );
      }
      const animationPayload = {
        id: animation.id,
        driver: "custom",
        program: transitionProgram,
        instance: replaceOverlay.timelineController.instance,
        animationBackend: replaceOverlay.timelineController.backend,
        dispose: replaceOverlay.timelineController.destroy,
        animationType: animation.type,
        targetId: animation.targetId,
        signature: continuitySignature,
        continuity: isPersistent ? "persistent" : "render",
        playbackSpeed: 1,
        onContinuationUpdate: handleContinuationUpdate,
        duration: replaceOverlay.duration,
        deferCompletionUntilNextFrame: animation.compositor !== undefined,
        applyFrame: replaceOverlay.apply,
        applyTargetState: () => {
          replaceOverlay.apply(replaceOverlay.duration);
          return finalize({ flushDeferredEffects: false });
        },
        onComplete: () => finishTransition({ flushDeferredEffects: true }),
        onCancel: () => finishTransition({ flushDeferredEffects: false }),
        onFailure: failTransition,
        isValid: () =>
          Boolean(replaceOverlay.overlay) &&
          !replaceOverlay.overlay.destroyed &&
          (!nextDisplayObject || !nextDisplayObject.destroyed),
      };

      if (
        isPersistent &&
        typeof animationBus?.activatePending === "function" &&
        animationBus.activatePending(animation.id, animationPayload)
      ) {
        return;
      }

      cleanupPendingTransition();
      animationBus.dispatch({
        type: "START",
        payload: animationPayload,
      });
      if (activateImmediately) {
        animationBus.flush?.();
      }
    };

    const attemptedCleanupParents = new Set();
    const deletePreviousSnapshot = () => {
      if (
        transitionSignal?.aborted ||
        !prevDisplayObject ||
        isLiveSubject(overlaySubjects.prevSubject) ||
        prevDisplayObject.destroyed ||
        !prevDisplayObject.parent
      ) {
        return undefined;
      }

      // Observe a reparented live object before cleanup removes the only
      // generic evidence of a custom composite's current render slot.
      getCurrentParent();
      const cleanupParent = prevDisplayObject.parent;
      if (attemptedCleanupParents.has(cleanupParent)) {
        throw new Error(
          `Element plugin cleanup did not remove "${prevElement.id}" during transition "${animation.id}".`,
        );
      }
      attemptedCleanupParents.add(cleanupParent);

      const operation = prevPlugin.delete({
        app,
        parent: cleanupParent,
        element: prevElement,
        animations: [],
        animationBus,
        completionTracker,
        eventHandler,
        elementPlugins,
        renderContext,
        signal: transitionSignal,
      });

      if (!operation || typeof operation.then !== "function") {
        return undefined;
      }

      return operation.then(() => deletePreviousSnapshot());
    };

    const deleteOperation = deletePreviousSnapshot();

    if (deleteOperation && typeof deleteOperation.then === "function") {
      return deleteOperation
        .then(() => installTransition({ activateImmediately: true }))
        .catch(failPreparation);
    }

    return installTransition({
      activateImmediately: continuedAsynchronously,
    });
  };

  const failPreparation = (error) => {
    if (!preparationFailed) {
      preparationFailed = true;
      cleanupPendingTransition();
      transitionSignalController?.abort();
      clearDeferredMountOperations(hiddenMountContext);
      if (!transitionMountParent.destroyed) {
        cleanupParticlesInTree({ app, root: transitionMountParent });
        transitionMountParent.destroy({ children: true });
      }
      cleanupPreparedResources?.();
      // A failure handler may immediately render a fallback with the same ID.
      // Discard prepared objects before exposing them to that render, and do
      // not release completion until failure has prevented a success event.
      if (trackCompletion) completionTracker.fail?.(stateVersion, error);
      completeTransition();
    }
    throw error;
  };
  try {
    const nextDisplayObjectOrPromise = nextElement
      ? instantiateNextLiveElement({
          app,
          parent: transitionMountParent,
          nextElement,
          plugin: nextPlugin,
          animations,
          eventHandler,
          animationBus,
          completionTracker,
          elementPlugins,
          renderContext: hiddenMountContext,
          zIndex,
          signal: transitionSignal,
          shaderTime,
          getShaderTime,
        })
      : null;

    if (
      nextDisplayObjectOrPromise &&
      typeof nextDisplayObjectOrPromise.then === "function"
    ) {
      return resolveNextDisplayObject(nextDisplayObjectOrPromise)
        .then((nextDisplayObject) =>
          continueWithNextDisplayObject(nextDisplayObject, true),
        )
        .catch(failPreparation);
    }

    return continueWithNextDisplayObject(nextDisplayObjectOrPromise ?? null);
  } catch (error) {
    return failPreparation(error);
  }
};
export {
  sampleMaskReveal,
  selectSequenceMaskFrameState,
} from "./transitionSurfaces.js";
export default runReplaceAnimation;
