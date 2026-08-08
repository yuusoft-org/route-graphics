import { describe, expect, it } from "vitest";
import { normalizeAudioRenderState } from "../../util/normalizeAudio.js";
import {
  getAudioEffectSignature,
  planAudioEffects,
} from "./planAudioEffects.js";

const sound = (src = "track-a", overrides = {}) => ({
  id: "bgm",
  type: "sound",
  src,
  volume: 80,
  ...overrides,
});

const effect = (id, properties) => ({
  id,
  type: "audio-transition",
  targetId: "bgm",
  properties,
});

const phase = (value, overrides = {}) => ({
  keyframes: [{ value, duration: 100, ...overrides }],
});

const state = (audio = [], audioEffects = []) =>
  normalizeAudioRenderState({ audio, audioEffects });

describe("planAudioEffects", () => {
  it("accepts one effect for both sides of a source replacement", () => {
    const handoff = effect("handoff:1", {
      volume: {
        exit: phase(0),
        enter: phase(80),
      },
    });

    const plan = planAudioEffects({
      prevState: state([sound("track-a")]),
      nextState: state([sound("track-b")], [handoff]),
    });

    expect(plan.accepted).toMatchObject([
      {
        effect: handoff,
        lifecycle: "replace",
        targetType: "sound",
      },
    ]);
    expect(plan.transitions.get("bgm")).toBe(handoff.properties);
  });

  it("continues an unchanged occurrence without accepting it again", () => {
    const enter = effect("enter:1", {
      volume: { enter: phase(80) },
    });

    const plan = planAudioEffects({
      prevState: state([], [enter]),
      nextState: state([], [enter]),
      ownedAudioEffects: new Map([
        [
          enter.id,
          {
            targetType: "sound",
            signature: getAudioEffectSignature(enter),
          },
        ],
      ]),
    });

    expect(plan.accepted).toEqual([]);
    expect(plan.continued).toHaveLength(1);
    expect(plan.transitions.size).toBe(0);
  });

  it("accepts a next-only owned effect again after an uncommitted attempt", () => {
    const enter = effect("enter:1", {
      volume: { enter: phase(80) },
    });
    const ownership = {
      effect: enter,
      targetType: "sound",
      signature: getAudioEffectSignature(enter),
    };

    const plan = planAudioEffects({
      prevState: state(),
      nextState: state([sound()], [enter]),
      ownedAudioEffects: new Map([[enter.id, ownership]]),
    });

    expect(plan.continued).toEqual([]);
    expect(plan.accepted).toMatchObject([
      {
        effect: enter,
        lifecycle: "add",
        targetType: "sound",
      },
    ]);
    expect(plan.superseded).toEqual([{ effect: enter, ownership }]);
  });

  it("rejects a continued detached effect without renderer ownership", () => {
    const exit = effect("exit:1", {
      volume: { exit: phase(0) },
    });

    expect(() =>
      planAudioEffects({
        prevState: state([], [exit]),
        nextState: state([], [exit]),
      }),
    ).toThrow("cannot continue without renderer ownership");
  });

  it("rejects a claimed continuation when the renderer never accepted it", () => {
    const update = effect("update:1", {
      volume: { update: phase(40) },
    });

    expect(() =>
      planAudioEffects({
        prevState: state([sound("track-a", { volume: 80 })], [update]),
        nextState: state([sound("track-a", { volume: 80 })], [update]),
      }),
    ).toThrow("cannot continue without renderer ownership");
  });

  it("classifies a new occurrence on the same target as supersession", () => {
    const first = effect("update:1", {
      volume: { update: phase(40) },
    });
    const second = effect("update:2", {
      volume: { update: phase(20) },
    });

    const plan = planAudioEffects({
      prevState: state([sound("track-a", { volume: 80 })], [first]),
      nextState: state([sound("track-a", { volume: 20 })], [second]),
    });

    expect(plan.accepted.map(({ effect: item }) => item.id)).toEqual([
      "update:2",
    ]);
    expect(plan.superseded.map(({ effect: item }) => item.id)).toEqual([
      "update:1",
    ]);
    expect(plan.settled).toEqual([]);
  });

  it("classifies a changed signature under the same ID as supersession", () => {
    const first = effect("update:1", {
      volume: { update: phase(40) },
    });
    const changed = effect("update:1", {
      volume: { update: phase(20) },
    });
    const ownership = {
      effect: first,
      signature: getAudioEffectSignature(first),
      targetType: "sound",
    };

    const plan = planAudioEffects({
      prevState: state([sound("track-a", { volume: 80 })], [first]),
      nextState: state([sound("track-a", { volume: 20 })], [changed]),
      ownedAudioEffects: new Map([[first.id, ownership]]),
    });

    expect(plan.accepted.map(({ effect: item }) => item)).toEqual([changed]);
    expect(plan.superseded).toEqual([{ effect: first, ownership }]);
  });

  it("treats startValue changes as effect supersession", () => {
    const first = effect("handoff:1", {
      volume: {
        exit: phase(0),
        enter: phase(80, { startValue: 0 }),
      },
    });
    const changed = effect("handoff:1", {
      volume: {
        exit: phase(0),
        enter: phase(80, { startValue: 20 }),
      },
    });
    const ownership = {
      effect: first,
      signature: getAudioEffectSignature(first),
      targetType: "sound",
    };

    const plan = planAudioEffects({
      prevState: state([sound("track-a")], [first]),
      nextState: state([sound("track-b")], [changed]),
      ownedAudioEffects: new Map([[first.id, ownership]]),
    });

    expect(getAudioEffectSignature(changed)).not.toBe(ownership.signature);
    expect(plan.accepted.map(({ effect: item }) => item)).toEqual([changed]);
    expect(plan.superseded).toEqual([{ effect: first, ownership }]);
  });

  it("accepts enter automation for a fresh same-source play occurrence", () => {
    const replay = effect("replay:2", {
      volume: { enter: phase(80, { startValue: 0 }) },
    });
    const playback = (commandId) => ({
      commandId,
      operation: "play",
      positionMs: 0,
    });

    const plan = planAudioEffects({
      prevState: state([sound("track-a", { playback: playback(1) })]),
      nextState: state([sound("track-a", { playback: playback(2) })], [replay]),
    });

    expect(plan.accepted).toMatchObject([
      {
        effect: replay,
        lifecycle: "replay",
        targetType: "sound",
      },
    ]);
  });

  it("classifies omission without replacement as settlement", () => {
    const update = effect("update:1", {
      volume: { update: phase(40) },
    });
    const plan = planAudioEffects({
      prevState: state([sound("track-a", { volume: 80 })], [update]),
      nextState: state([sound("track-a", { volume: 80 })]),
    });

    expect(plan.settled.map(({ effect: item }) => item.id)).toEqual([
      "update:1",
    ]);
  });

  it("rejects an unowned orphan effect from the previous state", () => {
    const orphan = effect("orphan:1", {
      volume: { exit: phase(0) },
    });

    expect(() =>
      planAudioEffects({
        prevState: state([], [orphan]),
        nextState: state(),
      }),
    ).toThrow(
      'previous audioEffects[0].targetId "bgm" does not resolve to an audio node or renderer ownership record',
    );
  });

  it("validates properties on unowned previous effects before settlement", () => {
    const invalid = effect("invalid-channel-exit:1", {
      playbackRate: { exit: phase(0) },
    });

    expect(() =>
      planAudioEffects({
        prevState: state(
          [{ id: "bgm", type: "audio-channel", children: [] }],
          [invalid],
        ),
        nextState: state(),
      }),
    ).toThrow(
      'audio transition property "playbackRate" is not supported for target type "audio-channel"',
    );
  });

  it("rejects phases that do not apply to the current edge", () => {
    const invalid = effect("bad-enter", {
      volume: { enter: phase(80) },
    });

    expect(() =>
      planAudioEffects({
        prevState: state([sound()]),
        nextState: state([sound()], [invalid]),
      }),
    ).toThrow("is not applicable to an audio update lifecycle");
  });

  it("requires enter and update endpoints to match declarative state", () => {
    const invalid = effect("bad-update", {
      volume: { update: phase(50) },
    });

    expect(() =>
      planAudioEffects({
        prevState: state([sound("track-a", { volume: 80 })]),
        nextState: state([sound("track-a", { volume: 40 })], [invalid]),
      }),
    ).toThrow("must end at the next audio node's declared volume value 40");
  });

  it("treats effect-list order and object key order as identity-neutral", () => {
    const first = effect("multi", {
      volume: { update: phase(40) },
      pan: { update: phase(1) },
    });
    const reordered = effect("multi", {
      pan: { update: phase(1) },
      volume: { update: phase(40) },
    });

    expect(getAudioEffectSignature(first)).toBe(
      getAudioEffectSignature(reordered),
    );
  });

  it("normalizes omitted keyframe defaults for occurrence continuity", () => {
    const omitted = effect("defaults", {
      volume: { enter: phase(80) },
    });
    const explicit = effect("defaults", {
      volume: {
        enter: phase(80, {
          delay: 0,
          easing: "linear",
          relative: false,
        }),
      },
    });

    expect(getAudioEffectSignature(omitted)).toBe(
      getAudioEffectSignature(explicit),
    );
  });
});
