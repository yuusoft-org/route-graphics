import { describe, expect, it } from "vitest";
import { normalizeAudioRenderState } from "../../src/util/normalizeAudio.js";

const track = (value, overrides = {}) => ({
  keyframes: [{ value, duration: 100, ...overrides }],
});

const soundWithTransition = (transition, overrides = {}) => ({
  id: "bgm",
  type: "sound",
  src: "theme",
  volume: 80,
  pan: 0.25,
  playbackRate: 1.5,
  transition,
  ...overrides,
});

describe("inline audio transition normalization", () => {
  it("normalizes lifecycle-first channel and sound tracks into the shared internal map", () => {
    const channelEnter = track(60, { delay: 25 });
    const soundUpdate = track(0.25);
    const soundExit = track(0);

    const normalized = normalizeAudioRenderState({
      audio: [
        {
          id: "music",
          type: "audio-channel",
          volume: 60,
          transition: { enter: { volume: channelEnter } },
          children: [
            soundWithTransition({
              update: { pan: soundUpdate },
              exit: { playbackRate: soundExit },
            }),
          ],
        },
      ],
    });

    expect(normalized.transitions).toEqual(
      new Map([
        ["music", { volume: { enter: channelEnter } }],
        [
          "bgm",
          {
            pan: { update: soundUpdate },
            playbackRate: { exit: soundExit },
          },
        ],
      ]),
    );
    expect(normalized.channels[0]).not.toHaveProperty("transition");
    expect(normalized.sounds[0]).not.toHaveProperty("transition");
  });

  it("keeps legacy transitions normalized through the same map", () => {
    const enter = track(80);
    const normalized = normalizeAudioRenderState({
      audio: [soundWithTransition(undefined)],
      audioEffects: [
        {
          id: "legacy-fade",
          type: "audio-transition",
          targetId: "bgm",
          properties: { volume: { enter } },
        },
      ],
    });

    expect(normalized.transitions.get("bgm")).toEqual({
      volume: { enter },
    });
  });

  it("accepts signed relative deltas and delay on every lifecycle", () => {
    const normalized = normalizeAudioRenderState({
      audio: [
        soundWithTransition({
          enter: {
            volume: {
              initialValue: 0,
              keyframes: [
                { value: 120, duration: 25, relative: true, delay: 10 },
                { value: 80, duration: 25 },
              ],
            },
          },
          update: {
            pan: {
              keyframes: [
                { value: -10, duration: 10, relative: true },
                { value: 0.25, duration: 10 },
              ],
            },
          },
          exit: {
            playbackRate: {
              keyframes: [
                { value: -100, duration: 50, relative: true, delay: 20 },
              ],
            },
          },
        }),
      ],
    });

    expect(normalized.transitions.get("bgm")).toBeDefined();
  });

  it("allows exit tracks to end away from the node's declared value", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [
          soundWithTransition({
            exit: { volume: track(0) },
          }),
        ],
      }),
    ).not.toThrow();
  });

  it("accepts inline and legacy transitions when they target different nodes", () => {
    const normalized = normalizeAudioRenderState({
      audio: [
        soundWithTransition({ enter: { volume: track(80) } }),
        { id: "sfx", type: "sound", src: "click" },
      ],
      audioEffects: [
        {
          id: "legacy-sfx",
          type: "audio-transition",
          targetId: "sfx",
          properties: { volume: { exit: track(0) } },
        },
      ],
    });

    expect([...normalized.transitions.keys()]).toEqual(["sfx", "bgm"]);
  });

  it("rejects inline and legacy transitions targeting the same node", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [soundWithTransition({ enter: { volume: track(80) } })],
        audioEffects: [
          {
            id: "legacy-bgm",
            type: "audio-transition",
            targetId: "bgm",
            properties: { volume: { exit: track(0) } },
          },
        ],
      }),
    ).toThrow("cannot define both inline transition and legacy");
  });

  it.each([
    ["an empty transition", {}, "must be a non-empty object"],
    [
      "an unknown lifecycle",
      { pause: { volume: track(80) } },
      'unsupported inline audio transition phase "pause"',
    ],
    ["an empty lifecycle", { enter: {} }, "must be a non-empty object"],
    [
      "an unknown property",
      { enter: { pitch: track(80) } },
      'unsupported inline audio transition property "pitch"',
    ],
    [
      "an empty keyframe list",
      { enter: { volume: { keyframes: [] } } },
      "keyframes must be a non-empty array",
    ],
    [
      "an unknown track field",
      {
        enter: { volume: { keyframes: [{ value: 80, duration: 1 }], hold: 2 } },
      },
      'unsupported audio transition field "hold"',
    ],
    [
      "an unknown keyframe field",
      { enter: { volume: track(80, { offset: 1 }) } },
      'unsupported audio transition keyframe field "offset"',
    ],
    [
      "a missing keyframe value",
      { enter: { volume: { keyframes: [{ duration: 1 }] } } },
      "value is required",
    ],
    [
      "a missing keyframe duration",
      { enter: { volume: { keyframes: [{ value: 80 }] } } },
      "duration is required",
    ],
    [
      "a negative delay",
      { enter: { volume: track(80, { delay: -1 }) } },
      "must be greater than or equal to 0",
    ],
    [
      "a non-finite delay",
      { enter: { volume: track(80, { delay: Number.POSITIVE_INFINITY }) } },
      "must be a finite number",
    ],
    [
      "a non-finite duration",
      { enter: { volume: track(80, { duration: Number.NaN }) } },
      "must be a number",
    ],
    [
      "a non-finite value",
      { enter: { volume: track(Number.NEGATIVE_INFINITY) } },
      "must be a finite number",
    ],
    [
      "an unsupported easing",
      { enter: { volume: track(80, { easing: "smooth" }) } },
      'easing "smooth" is not supported',
    ],
    [
      "a non-boolean relative flag",
      { enter: { volume: track(80, { relative: 1 }) } },
      "relative must be a boolean",
    ],
    [
      "an out-of-range absolute volume",
      { enter: { volume: track(101) } },
      "must be less than or equal to 100",
    ],
    [
      "a relative final enter keyframe",
      { enter: { volume: track(80, { relative: true }) } },
      "must end with an absolute value",
    ],
    [
      "an enter endpoint that differs from the node value",
      { enter: { volume: track(40) } },
      "must end at the node's declared volume value 80",
    ],
    [
      "an update endpoint that differs from the node value",
      { update: { playbackRate: track(1) } },
      "must end at the node's declared playbackRate value 1.5",
    ],
  ])("rejects %s", (_name, transition, message) => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [soundWithTransition(transition)],
      }),
    ).toThrow(message);
  });

  it("rejects playback-rate automation on channels", () => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [
          {
            id: "music",
            type: "audio-channel",
            transition: { exit: { playbackRate: track(0) } },
          },
        ],
      }),
    ).toThrow('is not supported for node type "audio-channel"');
  });
});
