import { describe, expect, it, vi } from "vitest";
import { renderAudio } from "../../src/plugins/audio/renderAudio.js";

describe("renderAudio", () => {
  it("uses AudioStage graph rendering when available", () => {
    const app = {
      audioStage: {
        renderGraph: vi.fn(),
      },
    };
    const eventHandler = vi.fn();
    const nextAudioTree = [
      {
        id: "music",
        type: "audio-channel",
        children: [{ id: "bgm", type: "sound", src: "theme" }],
      },
    ];
    const nextAudioEffects = [
      {
        id: "music-fade",
        type: "audio-transition",
        targetId: "music",
        properties: {
          volume: {
            enter: {
              initialValue: 0,
              keyframes: [{ value: 100, duration: 100, easing: "linear" }],
            },
          },
        },
      },
    ];

    renderAudio({
      app,
      prevAudioTree: [],
      nextAudioTree,
      prevAudioEffects: [],
      nextAudioEffects,
      audioPlugins: [],
      eventHandler,
    });

    expect(app.audioStage.renderGraph).toHaveBeenCalledWith({
      prevAudio: [],
      nextAudio: nextAudioTree,
      prevAudioEffects: [],
      nextAudioEffects,
      eventHandler,
    });
  });

  it("dispatches custom audio plugin nodes alongside graph audio", () => {
    const app = {
      audioStage: {
        renderGraph: vi.fn(),
      },
    };
    const customPlugin = {
      type: "custom-audio",
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const prevCustom = {
      id: "custom",
      type: "custom-audio",
      src: "custom-a",
      customValue: 1,
    };
    const nextCustom = {
      id: "custom",
      type: "custom-audio",
      src: "custom-a",
      customValue: 2,
    };
    const graphSound = { id: "sfx", type: "sound", src: "click" };

    renderAudio({
      app,
      prevAudioTree: [prevCustom],
      nextAudioTree: [nextCustom, graphSound],
      audioPlugins: [customPlugin],
    });

    expect(app.audioStage.renderGraph).toHaveBeenCalledWith({
      prevAudio: [],
      nextAudio: [graphSound],
      prevAudioEffects: [],
      nextAudioEffects: [],
    });
    expect(customPlugin.update).toHaveBeenCalledWith({
      app,
      prevElement: prevCustom,
      nextElement: nextCustom,
    });
  });

  it("validates audio state before rendering", () => {
    const app = {
      audioStage: {
        renderGraph: vi.fn(),
      },
    };

    expect(() =>
      renderAudio({
        app,
        prevAudioTree: [],
        nextAudioTree: [{ id: "sfx", type: "sound", src: "click", delay: 1 }],
        audioPlugins: [],
      }),
    ).toThrow("delay is not supported");

    expect(app.audioStage.renderGraph).not.toHaveBeenCalled();
  });
});
