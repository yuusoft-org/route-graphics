import { describe, expect, it } from "vitest";
import {
  flattenAudioNodes,
  normalizeAudioRenderState,
} from "../../src/util/normalizeAudio.js";

describe("normalizeAudioRenderState", () => {
  it("flattens channels and flat sounds", () => {
    const result = flattenAudioNodes([
      {
        id: "music",
        type: "audio-channel",
        volume: 80,
        children: [
          {
            id: "bgm",
            type: "sound",
            src: "theme",
            volume: 50,
          },
        ],
      },
      {
        id: "click",
        type: "sound",
        src: "click-sfx",
      },
    ]);

    expect(result.channels).toEqual([
      {
        id: "music",
        type: "audio-channel",
        volume: 80,
        muted: false,
        pan: 0,
        loop: false,
        interruption: "immediate",
      },
    ]);
    expect(result.sounds).toEqual([
      {
        id: "bgm",
        type: "sound",
        src: "theme",
        volume: 50,
        muted: false,
        pan: 0,
        loop: false,
        startDelayMs: 0,
        playbackRate: 1,
        startAt: 0,
        endAt: null,
        channelId: "music",
      },
      {
        id: "click",
        type: "sound",
        src: "click-sfx",
        volume: 100,
        muted: false,
        pan: 0,
        loop: false,
        startDelayMs: 0,
        playbackRate: 1,
        startAt: 0,
        endAt: null,
        channelId: null,
      },
    ]);
  });

  it("clamps audio node volumes and defaults omitted volumes to 100", () => {
    const result = flattenAudioNodes([
      {
        id: "music",
        type: "audio-channel",
        volume: 500,
        children: [
          {
            id: "bgm",
            type: "sound",
            src: "theme",
            volume: -10,
          },
        ],
      },
      {
        id: "click",
        type: "sound",
        src: "click-sfx",
      },
    ]);

    expect(result.channels[0].volume).toBe(100);
    expect(result.sounds[0].volume).toBe(0);
    expect(result.sounds[1].volume).toBe(100);
  });

  it("still rejects non-number audio node volumes", () => {
    expect(() =>
      flattenAudioNodes([
        {
          id: "sfx",
          type: "sound",
          src: "click-sfx",
          volume: "100",
        },
      ]),
    ).toThrow("audio[0].volume must be a number");
  });

  it("normalizes channel loop and rejects incompatible child loops", () => {
    const result = flattenAudioNodes([
      {
        id: "music",
        type: "audio-channel",
        loop: true,
        children: [{ id: "intro", type: "sound", src: "intro" }],
      },
    ]);

    expect(result.channels[0].loop).toBe(true);

    expect(() =>
      flattenAudioNodes([
        {
          id: "music",
          type: "audio-channel",
          loop: true,
          children: [{ id: "intro", type: "sound", src: "intro", loop: true }],
        },
      ]),
    ).toThrow(
      "audio[0].children[0].loop cannot be true when audio[0].loop is true",
    );

    expect(() =>
      flattenAudioNodes([{ id: "music", type: "audio-channel", loop: "yes" }]),
    ).toThrow("audio[0].loop must be a boolean");
  });

  it("normalizes channel interruption behavior", () => {
    const result = flattenAudioNodes([
      {
        id: "music",
        type: "audio-channel",
        interruption: "loopEnd",
      },
    ]);

    expect(result.channels[0].interruption).toBe("loopEnd");
    expect(() =>
      flattenAudioNodes([
        {
          id: "music",
          type: "audio-channel",
          interruption: "later",
        },
      ]),
    ).toThrow("audio[0].interruption must be one of immediate, loopEnd");
  });

  it("normalizes strict playback commands", () => {
    const result = flattenAudioNodes([
      {
        id: "music",
        type: "sound",
        src: "theme",
        playback: {
          commandId: 42,
          operation: "play",
          positionMs: 1200,
        },
      },
      {
        id: "ambience",
        type: "sound",
        src: "rain",
        playback: {
          commandId: 43,
          operation: "pause",
        },
      },
    ]);

    expect(result.sounds[0].playback).toEqual({
      commandId: 42,
      operation: "play",
      positionMs: 1200,
    });
    expect(result.sounds[1].playback).toEqual({
      commandId: 43,
      operation: "pause",
    });
  });

  it.each([
    [
      { commandId: -1, operation: "play", positionMs: 0 },
      "commandId must be a non-negative safe integer",
    ],
    [
      { commandId: Number.MAX_SAFE_INTEGER + 1, operation: "pause" },
      "commandId must be a non-negative safe integer",
    ],
    [
      { commandId: 1, operation: "rewind" },
      "operation must be one of play, pause, resume, stop, seek",
    ],
    [
      { commandId: 1, operation: "play" },
      "positionMs must be a finite non-negative number for play",
    ],
    [
      { commandId: 1, operation: "seek", positionMs: Number.POSITIVE_INFINITY },
      "positionMs must be a finite non-negative number for seek",
    ],
    [
      { commandId: 1, operation: "pause", positionMs: 0 },
      "positionMs is not allowed for pause",
    ],
    [
      { commandId: 1, operation: "stop", status: "stopped" },
      'unsupported playback field "status"',
    ],
  ])("rejects invalid playback command %#", (playback, message) => {
    expect(() =>
      flattenAudioNodes([
        {
          id: "music",
          type: "sound",
          src: "theme",
          playback,
        },
      ]),
    ).toThrow(message);
  });

  it("rejects command-controlled children in looping channels", () => {
    expect(() =>
      flattenAudioNodes([
        {
          id: "music",
          type: "audio-channel",
          loop: true,
          children: [
            {
              id: "track",
              type: "sound",
              src: "theme",
              playback: {
                commandId: 1,
                operation: "play",
                positionMs: 0,
              },
            },
          ],
        },
      ]),
    ).toThrow(
      "audio[0].children[0].playback is not allowed when audio[0].loop is true",
    );
  });

  it("rejects duplicate IDs across nodes and effects", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [{ id: "music", type: "audio-channel" }],
        audioEffects: [
          {
            id: "music",
            type: "audio-transition",
            targetId: "music",
            properties: {
              volume: {
                update: {
                  keyframes: [{ value: 50, duration: 100 }],
                },
              },
            },
          },
        ],
      }),
    ).toThrow('duplicate audio render-state id "music"');
  });

  it("rejects multiple audio transitions targeting the same node", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [{ id: "music", type: "audio-channel" }],
        audioEffects: [
          {
            id: "music-fade-a",
            type: "audio-transition",
            targetId: "music",
            properties: {
              volume: {
                update: {
                  keyframes: [{ value: 50, duration: 100 }],
                },
              },
            },
          },
          {
            id: "music-fade-b",
            type: "audio-transition",
            targetId: "music",
            properties: {
              volume: {
                exit: {
                  keyframes: [{ value: 0, duration: 200 }],
                },
              },
            },
          },
        ],
      }),
    ).toThrow('duplicate audio-transition targetId "music"');
  });

  it("preserves top-level custom audio plugin nodes", () => {
    const result = normalizeAudioRenderState({
      audio: [
        { id: "custom-1", type: "custom-audio", customValue: 1 },
        { id: "sfx", type: "sound", src: "click" },
      ],
    });

    expect(result.audio).toEqual([
      { id: "custom-1", type: "custom-audio", customValue: 1 },
      { id: "sfx", type: "sound", src: "click" },
    ]);
    expect(result.sounds).toHaveLength(1);
  });

  it("still rejects duplicate custom audio plugin node IDs", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [
          { id: "custom-1", type: "custom-audio" },
          { id: "custom-1", type: "sound", src: "click" },
        ],
      }),
    ).toThrow('duplicate audio render-state id "custom-1"');
  });

  it("rejects nested channels and non-sound channel children", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [
          {
            id: "music",
            type: "audio-channel",
            children: [{ id: "nested", type: "audio-channel" }],
          },
        ],
      }),
    ).toThrow("nested audio-channel nodes are not supported");

    expect(() =>
      normalizeAudioRenderState({
        audio: [
          {
            id: "music",
            type: "audio-channel",
            children: [{ id: "effect", type: "audioFilter" }],
          },
        ],
      }),
    ).toThrow('audio[0].children[0].type must be "sound"');
  });

  it("rejects removed legacy sound.delay", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [
          {
            id: "sfx",
            type: "sound",
            src: "click",
            delay: 100,
          },
        ],
      }),
    ).toThrow("audio[0].delay is not supported");
  });

  it("rejects the non-canonical audioTransition effect type", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [{ id: "music", type: "audio-channel" }],
        audioEffects: [
          {
            id: "fade",
            type: "audioTransition",
            targetId: "music",
            properties: {
              volume: {
                update: {
                  keyframes: [{ value: 50, duration: 100 }],
                },
              },
            },
          },
        ],
      }),
    ).toThrow('unsupported audio effect type "audioTransition"');
  });

  it("validates audio transitions strictly", () => {
    const audio = [{ id: "music", type: "audio-channel" }];

    expect(() =>
      normalizeAudioRenderState({
        audio,
        audioEffects: [
          {
            id: "fade",
            type: "audio-transition",
            targetId: "missing",
            properties: {
              volume: {
                update: {
                  keyframes: [{ value: 50, duration: 100 }],
                },
              },
            },
          },
        ],
      }),
    ).toThrow('targetId "missing" does not resolve');

    expect(() =>
      normalizeAudioRenderState({
        audio,
        audioEffects: [
          {
            id: "fade",
            type: "audio-transition",
            targetId: "music",
            properties: {
              volume: {
                update: {},
              },
            },
          },
        ],
      }),
    ).toThrow(
      "audioEffects[0].properties.volume.update.keyframes must be a non-empty array",
    );

    expect(() =>
      normalizeAudioRenderState({
        audio,
        audioEffects: [
          {
            id: "fade",
            type: "audio-transition",
            targetId: "music",
            properties: {
              playbackRate: {
                update: {
                  keyframes: [{ value: 2, duration: 100 }],
                },
              },
            },
          },
        ],
      }),
    ).toThrow(
      'audio transition property "playbackRate" is not supported for target type "audio-channel"',
    );

    expect(() =>
      normalizeAudioRenderState({
        audio,
        audioEffects: [
          {
            id: "fade",
            type: "audio-transition",
            targetId: "music",
            properties: {
              volume: {
                enter: { from: 0, duration: 100, easing: "linear" },
              },
            },
          },
        ],
      }),
    ).toThrow('unsupported audio transition field "from"');

    expect(() =>
      normalizeAudioRenderState({
        audio,
        audioEffects: [
          {
            id: "fade",
            type: "audio-transition",
            targetId: "music",
            properties: {
              volume: {
                update: {
                  keyframes: [
                    { value: 50, duration: 100, easing: "unknownEase" },
                  ],
                },
              },
            },
          },
        ],
      }),
    ).toThrow('keyframes[0].easing "unknownEase" is not supported');
  });

  it("rejects empty audio transition property maps", () => {
    const audio = [{ id: "music", type: "audio-channel" }];

    expect(() =>
      normalizeAudioRenderState({
        audio,
        audioEffects: [
          {
            id: "empty-properties",
            type: "audio-transition",
            targetId: "music",
            properties: {},
          },
        ],
      }),
    ).toThrow("audioEffects[0].properties must be a non-empty object");

    expect(() =>
      normalizeAudioRenderState({
        audio,
        audioEffects: [
          {
            id: "empty-lifecycle",
            type: "audio-transition",
            targetId: "music",
            properties: { volume: {} },
          },
        ],
      }),
    ).toThrow("audioEffects[0].properties.volume must be a non-empty object");
  });

  it("accepts pan and sound playback-rate transitions", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [
          { id: "music", type: "audio-channel" },
          { id: "bgm", type: "sound", src: "theme" },
        ],
        audioEffects: [
          {
            id: "music-pan",
            type: "audio-transition",
            targetId: "music",
            properties: {
              pan: {
                enter: {
                  initialValue: -1,
                  keyframes: [
                    { value: 0, duration: 100, easing: "easeInOutSine" },
                  ],
                },
              },
            },
          },
          {
            id: "bgm-controls",
            type: "audio-transition",
            targetId: "bgm",
            properties: {
              pan: {
                exit: {
                  keyframes: [{ value: 1, duration: 100 }],
                },
              },
              playbackRate: {
                update: {
                  keyframes: [
                    { value: 0.5, duration: 100, relative: true },
                    { value: 1, duration: 100 },
                  ],
                },
              },
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("validates pan and playback-rate transition ranges", () => {
    const sound = [{ id: "bgm", type: "sound", src: "theme" }];

    expect(() =>
      normalizeAudioRenderState({
        audio: sound,
        audioEffects: [
          {
            id: "bad-pan",
            type: "audio-transition",
            targetId: "bgm",
            properties: {
              pan: {
                enter: {
                  initialValue: -2,
                  keyframes: [{ value: 0, duration: 100 }],
                },
              },
            },
          },
        ],
      }),
    ).toThrow(
      "properties.pan.enter.initialValue must be greater than or equal to -1",
    );

    expect(() =>
      normalizeAudioRenderState({
        audio: sound,
        audioEffects: [
          {
            id: "bad-rate",
            type: "audio-transition",
            targetId: "bgm",
            properties: {
              playbackRate: {
                exit: {
                  keyframes: [{ value: -1, duration: 100 }],
                },
              },
            },
          },
        ],
      }),
    ).toThrow(
      "properties.playbackRate.exit.keyframes[0].value must be greater than or equal to 0",
    );
  });
});
