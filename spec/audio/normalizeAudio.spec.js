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

describe("next-render audio animation normalization", () => {
  const previousChannel = {
    id: "music",
    type: "audio-channel",
    volume: 40,
    pan: -0.5,
    children: [{ id: "bgm", type: "sound", src: "old-theme" }],
  };
  const nextChannel = {
    id: "music",
    type: "audio-channel",
    volume: 80,
    pan: 0.5,
    children: [{ id: "bgm", type: "sound", src: "new-theme" }],
  };
  const transition = {
    id: "handoff-7",
    occurrenceId: "engine-1:g2:l4:bgm7",
    type: "transition",
    targetId: "music",
    prev: { channel: previousChannel, fade: track(0) },
    next: {
      channel: nextChannel,
      fade: { initialValue: 0, ...track(100) },
    },
  };

  it("normalizes immutable handoff snapshots, runtime masters, and settlement", () => {
    const normalized = normalizeAudioRenderState({
      audio: [nextChannel],
      audioAnimations: [transition],
      audioMasters: [{ id: "music", volume: 55, muted: true }],
      audioAnimationControl: { commandId: 8, operation: "settle" },
    });

    expect(normalized.audioAnimations[0]).toMatchObject({
      id: "handoff-7",
      occurrenceId: "engine-1:g2:l4:bgm7",
      type: "transition",
      targetId: "music",
    });
    expect(
      normalized.audioAnimations[0].prev.channel.children[0],
    ).toMatchObject({ id: "bgm", src: "old-theme", volume: 100 });
    expect(normalized.audioMasters).toEqual([
      { id: "music", volume: 55, muted: true },
    ]);
    expect(normalized.audioAnimationControl).toEqual({
      commandId: 8,
      operation: "settle",
    });
  });

  it("normalizes retained updates and requires the declared endpoint", () => {
    const normalized = normalizeAudioRenderState({
      audio: [{ ...previousChannel, volume: 20 }],
      audioAnimations: [
        {
          id: "update-2",
          occurrenceId: "engine-1:g2:l5:bgm8",
          type: "update",
          targetId: "music",
          tween: { volume: track(20) },
        },
      ],
    });

    expect(normalized.audioAnimations[0].tween.volume).toEqual(track(20));
    expect(() =>
      normalizeAudioRenderState({
        audio: [{ ...previousChannel, volume: 20 }],
        audioAnimations: [
          {
            id: "update-3",
            occurrenceId: "engine-1:g2:l5:bgm9",
            type: "update",
            targetId: "music",
            tween: { volume: track(10) },
          },
        ],
      }),
    ).toThrow("must end at the node's declared volume value 20");
  });

  it.each([
    [
      "a next snapshot that differs from the render graph",
      { ...transition, next: { ...transition.next, channel: previousChannel } },
      "next render-state channel snapshot",
    ],
    [
      "a previous fade that does not end at silence",
      { ...transition, prev: { ...transition.prev, fade: track(10) } },
      "prev.fade must end at 0",
    ],
    [
      "an incoming fade without an explicit silent start",
      {
        ...transition,
        next: { ...transition.next, fade: track(100) },
      },
      "next.fade.initialValue must be 0",
    ],
  ])("rejects %s", (_name, audioAnimation, message) => {
    expect(() =>
      normalizeAudioRenderState({
        audio: [nextChannel],
        audioAnimations: [audioAnimation],
      }),
    ).toThrow(message);
  });
});
