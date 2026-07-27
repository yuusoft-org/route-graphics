import { diffAudio } from "../../util/diffAudio.js";
import {
  filterGraphAudio,
  filterPluginAudio,
  normalizeAudioRenderState,
} from "../../util/normalizeAudio.js";

const renderPluginDiff = ({
  app,
  prevAudioTree,
  nextAudioTree,
  audioPlugins,
}) => {
  const { toAddElement, toDeleteElement, toUpdateElement } = diffAudio(
    prevAudioTree,
    nextAudioTree,
  );

  // Delete audio elements
  for (const audio of toDeleteElement) {
    const plugin = audioPlugins.find((p) => p.type === audio.type);
    if (!plugin) {
      throw new Error(`No audio plugin found for type: ${audio.type}`);
    }

    plugin.delete({
      app,
      element: audio,
    });
  }

  // Add audio elements
  for (const audio of toAddElement) {
    const plugin = audioPlugins.find((p) => p.type === audio.type);
    if (!plugin) {
      throw new Error(`No audio plugin found for type: ${audio.type}`);
    }

    plugin.add({
      app,
      element: audio,
    });
  }

  // Update audio elements
  for (const { prev, next } of toUpdateElement) {
    const plugin = audioPlugins.find((p) => p.type === next.type);
    if (!plugin) {
      throw new Error(`No audio plugin found for type: ${next.type}`);
    }

    plugin.update({
      app,
      prevElement: prev,
      nextElement: next,
    });
  }
};

/**
 * Render audio using plugin system (synchronous)
 * @param {Object} params
 * @param {import('../types.js').Application} params.app - The PixiJS application
 * @param {import('../types.js').SoundElement[]} params.prevAudioTree - Previous audio tree
 * @param {import('../types.js').SoundElement[]} params.nextAudioTree - Next audio tree
 * @param {Object[]} [params.prevAudioEffects] - Previous audio effects
 * @param {Object[]} [params.nextAudioEffects] - Next audio effects
 * @param {import("./audio/audioPlugin.js").AudioPlugin[]} params.audioPlugins - Array of audio plugins
 * @param {Function} [params.eventHandler] - Route Graphics event handler
 */
export const renderAudio = ({
  app,
  prevAudioTree,
  nextAudioTree,
  prevAudioEffects = [],
  nextAudioEffects = [],
  audioPlugins,
  eventHandler,
}) => {
  normalizeAudioRenderState({
    audio: prevAudioTree,
    audioEffects: prevAudioEffects,
  });
  normalizeAudioRenderState({
    audio: nextAudioTree,
    audioEffects: nextAudioEffects,
  });

  if (typeof app.audioStage?.renderGraph === "function") {
    app.audioStage.renderGraph({
      prevAudio: filterGraphAudio(prevAudioTree),
      nextAudio: filterGraphAudio(nextAudioTree),
      prevAudioEffects,
      nextAudioEffects,
      eventHandler,
    });
    renderPluginDiff({
      app,
      prevAudioTree: filterPluginAudio(prevAudioTree),
      nextAudioTree: filterPluginAudio(nextAudioTree),
      audioPlugins,
    });
    return;
  }

  renderPluginDiff({
    app,
    prevAudioTree,
    nextAudioTree,
    audioPlugins,
  });
};
