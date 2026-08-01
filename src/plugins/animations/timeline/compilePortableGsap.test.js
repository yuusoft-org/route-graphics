import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import {
  bindTimelineProgram,
  compilePortableGsapAnimation,
  evaluateTimelineInstance,
} from "./index.js";

const compile = (source) => {
  const animation = normalizeAnimations([source])[0];
  return compilePortableGsapAnimation(animation, {
    sourcePath: "animations[0]",
  });
};

const createAdapter = (property, valueType = "scalar") => ({
  property,
  valueType,
  get: (target) => target[property],
  apply: (target, value) => {
    target[property] = value;
  },
});

describe("portable GSAP frontend compiler", () => {
  it("rejects statically invalid channel expressions before binding", () => {
    expect(() =>
      compile({
        id: "invalid-static-type",
        targetId: "missing-renderer-target",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { x: "not-a-number" },
              duration: 10,
            },
          ],
        },
      }),
    ).toThrow(/must be a finite number/);
  });

  it("compiles set/to/from/fromTo, defaults, filters, and sequential timing", () => {
    const program = compile({
      id: "hero-entrance",
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        defaults: { duration: 100, easing: "power2.out", overwrite: "auto" },
        steps: [
          {
            kind: "set",
            values: { alpha: 0, filters: { glow: { strength: 0 } } },
          },
          { kind: "to", values: { x: 100, alpha: 1 } },
          { kind: "from", values: { y: 30 }, duration: 50 },
          {
            kind: "fromTo",
            from: { scaleX: 0.8 },
            to: { scaleX: 1 },
            duration: 40,
          },
        ],
      },
    });

    expect(program.duration).toBe(190);
    expect(program.clipTemplates.map(({ start }) => start)).toEqual([
      0, 0, 0, 0, 100, 150,
    ]);
    expect(program.clipTemplates[1].channel).toBe(
      "filter.glow.parameter.strength",
    );
    expect(
      program.clipTemplates.every(({ overwrite }) => overwrite === "auto"),
    ).toBe(true);
    expect(Object.values(program.easings)).toContainEqual({
      kind: "power",
      exponent: 3,
      direction: "out",
    });
  });

  it("schedules nested parallel, overlap, marks, and anchors readably", () => {
    const program = compile({
      id: "schedule",
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        steps: [
          {
            kind: "parallel",
            id: "entrance",
            steps: [
              { kind: "to", values: { x: 100 }, duration: 200 },
              { kind: "to", values: { alpha: 1 }, duration: 100 },
            ],
          },
          { kind: "mark", name: "after-entrance" },
          {
            kind: "to",
            values: { y: 50 },
            duration: 100,
            start: { anchor: "after-entrance", offset: 20 },
          },
          { kind: "to", values: { rotation: 10 }, duration: 80, overlap: 30 },
        ],
      },
    });

    const starts = Object.fromEntries(
      program.clipTemplates.map((clip) => [clip.channel, clip.start]),
    );
    expect(starts).toMatchObject({
      "transform.x": 0,
      "appearance.alpha": 0,
      "transform.y": 220,
      "transform.rotation.degrees": 290,
    });
    expect(program.duration).toBe(370);
    expect(program.debug.marks["after-entrance"]).toBe(200);
  });

  it("binds multi-target stagger, expressions, relative values, and modifiers", () => {
    const program = compile({
      id: "cards",
      targetId: "root",
      type: "update",
      gsap: {
        profile: "portable-v1",
        targets: { cards: { elements: ["a", "b", "c"] } },
        steps: [
          {
            kind: "to",
            targets: "cards",
            duration: 100,
            stagger: { each: 20, from: "start" },
            values: {
              x: {
                expr: {
                  kind: "multiply",
                  left: { kind: "targetIndex" },
                  right: { kind: "constant", value: 10 },
                },
              },
              y: { by: 20 },
            },
            modifiers: { x: [{ kind: "snap", increment: 5 }] },
          },
        ],
      },
    });
    expect(program.duration).toBe(140);
    const targets = Object.fromEntries(
      ["root", "a", "b", "c"].map((id) => [
        id,
        {
          handle: { x: 0, y: 5 },
          identity: id,
          subject: { x: 0, y: 5, width: 10, height: 10 },
        },
      ]),
    );
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: targets,
      channelRegistry: {
        "transform.x": createAdapter("x"),
        "transform.y": createAdapter("y"),
      },
    });
    expect(instance.duration).toBe(140);
    const valuesAt120 = evaluateTimelineInstance(instance, 120).values;
    const values = Object.fromEntries(
      valuesAt120.map((value) => [
        `${value.targetIdentity}:${value.channel}`,
        value.value,
      ]),
    );
    expect(values["a:transform.x"]).toBe(0);
    expect(values["b:transform.x"]).toBe(10);
    expect(values["c:transform.x"]).toBe(15);
    expect(values["c:transform.y"]).toBe(21);
  });

  it("compiles keyframes, local repeat/yoyo/speed domains, and named events", () => {
    const program = compile({
      id: "pulse",
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        steps: [
          {
            kind: "keyframes",
            repeat: 1,
            repeatDelay: 20,
            yoyo: true,
            speed: 2,
            frames: [
              { duration: 50, values: { alpha: 0.5 } },
              { delay: 10, duration: 40, values: { alpha: 1 } },
            ],
          },
          { kind: "emit", event: "ready", payload: { ok: true } },
        ],
      },
    });
    expect(program.duration).toBe(110);
    expect(program.events).toMatchObject([
      {
        time: 110,
        name: "ready",
        direction: "forward",
        occurrence: "eachIteration",
        seekPolicy: "suppress",
      },
    ]);
    expect(Object.values(program.domains)).toContainEqual(
      expect.objectContaining({
        cycleDuration: 100,
        iterations: 2,
        iterationGap: 20,
        direction: "alternate",
        rate: 2,
      }),
    );
  });

  it("refreshes relative and iteration expressions deterministically", () => {
    const program = compile({
      id: "refresh",
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        steps: [
          {
            kind: "to",
            values: { x: { by: 10 } },
            duration: 100,
            repeat: 2,
            repeatRefresh: true,
          },
        ],
      },
    });
    const target = { x: 0 };
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: { hero: { handle: target, identity: "hero" } },
      channelRegistry: { "transform.x": createAdapter("x") },
    });
    const sample = (time) =>
      evaluateTimelineInstance(instance, time).values[0].value;
    expect(sample(50)).toBe(5);
    expect(sample(100)).toBe(10);
    expect(sample(150)).toBe(15);
    expect(sample(250)).toBe(25);
    expect(sample(300)).toBe(30);
  });

  it("compiles orchestrated transition synthetic channels", () => {
    const program = compile({
      id: "handoff",
      targetId: "root",
      type: "transition",
      mask: { kind: "single", texture: "mask.png" },
      compositor: {
        type: "shader",
        source: {
          webgl: { fragment: "void main() {}" },
          webgpu: {
            source:
              "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(); } @fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(); }",
          },
        },
      },
      gsap: {
        profile: "portable-v1",
        targets: {
          previous: { transitionSurface: "prev" },
          reveal: { transitionMask: true },
          effect: { transitionCompositor: true },
        },
        steps: [
          {
            kind: "parallel",
            steps: [
              {
                kind: "to",
                targets: "previous",
                values: { alpha: 0 },
                duration: 100,
              },
              {
                kind: "fromTo",
                targets: "reveal",
                from: { progress: 0 },
                to: { progress: 1 },
                duration: 100,
              },
              {
                kind: "fromTo",
                targets: "effect",
                from: { progress: 0 },
                to: { progress: 1 },
                duration: 100,
              },
            ],
          },
        ],
      },
    });
    expect(program.duration).toBe(100);
    expect(program.clipTemplates.map(({ channel }) => channel)).toEqual([
      "appearance.alpha",
      "transition.mask.progress",
      "transition.compositor.progress",
    ]);
  });

  it("rejects mixed frontends, unknown anchors, and missing durations", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "mixed",
          targetId: "hero",
          type: "update",
          tween: { x: { keyframes: [{ value: 1, duration: 1 }] } },
          gsap: {
            profile: "portable-v1",
            steps: [{ kind: "set", values: { x: 0 } }],
          },
        },
      ]),
    ).toThrow(/both tween and gsap/);
    expect(() =>
      compile({
        id: "missing",
        targetId: "hero",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [{ kind: "to", values: { x: 1 } }],
        },
      }),
    ).toThrow(/duration is required/);
    expect(() =>
      compile({
        id: "anchor",
        targetId: "hero",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { x: 1 },
              duration: 1,
              start: { anchor: "later" },
            },
            { kind: "mark", name: "later" },
          ],
        },
      }),
    ).toThrow(/unknown or forward anchor/);
  });

  it("supports infinite child actions and rejects unreachable sequence siblings", () => {
    const program = compile({
      id: "nested-loop",
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        steps: [
          {
            kind: "parallel",
            steps: [
              {
                kind: "to",
                values: { x: 10 },
                duration: 100,
                repeat: "infinite",
              },
              { kind: "to", values: { y: 20 }, duration: 50 },
            ],
          },
        ],
      },
    });
    const target = { x: 0, y: 0 };
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: { hero: { handle: target, identity: "hero" } },
      channelRegistry: {
        "transform.x": createAdapter("x"),
        "transform.y": createAdapter("y"),
      },
    });
    const sample = (time) =>
      Object.fromEntries(
        evaluateTimelineInstance(instance, time).values.map((item) => [
          item.channel,
          item.value,
        ]),
      );
    expect(program.duration).toBe("infinite");
    expect(sample(250)).toMatchObject({
      "transform.x": 5,
      "transform.y": 20,
    });

    expect(() =>
      compile({
        id: "unreachable",
        targetId: "hero",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { x: 10 },
              duration: 100,
              repeat: "infinite",
            },
            { kind: "set", values: { y: 1 } },
          ],
        },
      }),
    ).toThrow(/unreachable/);
  });
});
