import { describe, expect, it } from "vitest";
import { normalizeAudioRenderState } from "../../src/util/normalizeAudio.js";

const track = (value, overrides = {}) => ({
  keyframes: [{ value, duration: 100, ...overrides }],
});

const sound = (overrides = {}) => ({
  id: "bgm",
  type: "sound",
  src: "theme",
  volume: 80,
  pan: 0.25,
  playbackRate: 1.5,
  ...overrides,
});

const effect = (properties, overrides = {}) => ({
  id: "bgm-transition:1",
  type: "audio-transition",
  targetId: "bgm",
  properties,
  ...overrides,
});

describe("audio effect normalization", () => {
  it("normalizes canonical effects into lookup maps without merging them into audio nodes", () => {
    const transition = effect({
      volume: { enter: track(80) },
      pan: { update: track(0.25) },
      playbackRate: { exit: track(0) },
    });

    const normalized = normalizeAudioRenderState({
      audio: [sound()],
      audioEffects: [transition],
    });

    expect(normalized.transitions).toEqual(
      new Map([["bgm", transition.properties]]),
    );
    expect(normalized.effectById).toEqual(
      new Map([["bgm-transition:1", transition]]),
    );
    expect(normalized.sounds[0]).not.toHaveProperty("transition");
  });

  it("accepts signed relative start values, deltas, and delays in every phase", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [sound()],
        audioEffects: [
          effect({
            volume: {
              enter: {
                initialValue: 0,
                keyframes: [
                  {
                    startValue: -20,
                    value: 120,
                    duration: 25,
                    relative: true,
                    delay: 10,
                  },
                  { value: 80, duration: 25 },
                ],
              },
            },
            pan: {
              update: {
                keyframes: [
                  { value: -0.25, duration: 10, relative: true },
                  { value: 0.25, duration: 10 },
                ],
              },
            },
            playbackRate: {
              exit: {
                keyframes: [
                  { value: -1, duration: 50, relative: true, delay: 20 },
                ],
              },
            },
          }),
        ],
      }),
    ).not.toThrow();
  });

  it("allows exit tracks to end away from the declared node value", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [sound()],
        audioEffects: [effect({ volume: { exit: track(0) } })],
      }),
    ).not.toThrow();
  });

  it("rejects unknown fields on canonical effects", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [sound()],
        audioEffects: [
          effect({ volume: { enter: track(80) } }, { commandId: 1 }),
        ],
      }),
    ).toThrow('unsupported audio effect field "commandId"');
  });

  it.each([
    ["sound", [sound({ transition: { enter: { volume: track(80) } } })]],
    [
      "channel",
      [
        {
          id: "music",
          type: "audio-channel",
          transition: { exit: { volume: track(0) } },
        },
      ],
    ],
  ])("rejects the removed inline transition field on a %s", (_name, audio) => {
    expect(() => normalizeAudioRenderState({ audio })).toThrow(
      ".transition is not supported. Use top-level audioEffects instead",
    );
  });

  it.each([
    ["an empty property map", {}, "must be a non-empty object"],
    [
      "an unknown phase",
      { volume: { pause: track(80) } },
      'unsupported audio transition phase "pause"',
    ],
    ["an empty phase map", { volume: {} }, "must be a non-empty object"],
    [
      "an unknown property",
      { pitch: { enter: track(80) } },
      'unsupported audio transition property "pitch"',
    ],
    [
      "an empty keyframe list",
      { volume: { enter: { keyframes: [] } } },
      "keyframes must be a non-empty array",
    ],
    [
      "an unknown track field",
      { volume: { enter: { keyframes: [track(80).keyframes[0]], hold: 2 } } },
      'unsupported audio transition field "hold"',
    ],
    [
      "an unknown keyframe field",
      { volume: { enter: track(80, { offset: 1 }) } },
      'unsupported audio transition keyframe field "offset"',
    ],
    [
      "a missing keyframe value",
      { volume: { enter: { keyframes: [{ duration: 1 }] } } },
      "value is required",
    ],
    [
      "a missing keyframe duration",
      { volume: { enter: { keyframes: [{ value: 80 }] } } },
      "duration is required",
    ],
    [
      "a negative delay",
      { volume: { enter: track(80, { delay: -1 }) } },
      "must be greater than or equal to 0",
    ],
    [
      "a non-finite delay",
      { volume: { enter: track(80, { delay: Number.POSITIVE_INFINITY }) } },
      "must be a finite number",
    ],
    [
      "a non-finite duration",
      { volume: { enter: track(80, { duration: Number.NaN }) } },
      "must be a number",
    ],
    [
      "a non-finite value",
      { volume: { enter: track(Number.NEGATIVE_INFINITY) } },
      "must be a finite number",
    ],
    [
      "an unsupported easing",
      { volume: { enter: track(80, { easing: "smooth" }) } },
      'easing "smooth" is not supported',
    ],
    [
      "a non-boolean relative flag",
      { volume: { enter: track(80, { relative: 1 }) } },
      "relative must be a boolean",
    ],
    [
      "an out-of-range absolute volume",
      { volume: { enter: track(101) } },
      "must be less than or equal to 100",
    ],
    [
      "an out-of-range absolute volume start",
      { volume: { enter: track(80, { startValue: 101 }) } },
      "startValue must be less than or equal to 100",
    ],
  ])("rejects %s", (_name, properties, message) => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [sound()],
        audioEffects: [effect(properties)],
      }),
    ).toThrow(message);
  });
});
