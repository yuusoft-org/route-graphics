import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import {
  applyModifier,
  bindTimelineProgram,
  calculateStaggerOffsets,
  compilePortableGsapAnimation,
  createGsapTimelineEvaluator,
  evaluateExpression,
  evaluateTimelineInstance,
} from "./index.js";

const compileUpdate = ({
  steps,
  defaults,
  targets,
  playback,
  id = "portable-contract",
} = {}) => {
  const animation = normalizeAnimations([
    {
      id,
      targetId: "hero",
      type: "update",
      ...(playback ? { playback } : {}),
      gsap: {
        profile: "portable-v1",
        ...(defaults ? { defaults } : {}),
        ...(targets ? { targets } : {}),
        steps,
      },
    },
  ])[0];
  return compilePortableGsapAnimation(animation, {
    sourcePath: "animations[0]",
  });
};

const bindOwner = (program, initial = {}) => {
  const handle = { ...initial };
  const target = {
    handle,
    identity: "hero",
    subject: { x: 3, y: 4, width: 20, height: 10 },
  };
  const instance = bindTimelineProgram(program, {
    capabilities: new Set(program.requirements),
    targetRegistry: { hero: target },
    channelRegistry: {
      resolve: (_target, channel) => ({
        property: channel,
        get: (value) => value[channel] ?? 0,
        apply: (value, next) => {
          value[channel] = next;
        },
      }),
    },
  });
  return { handle, instance };
};

const sampleChannel = (instance, time, channel = "transform.x") =>
  evaluateTimelineInstance(instance, time).values.find(
    (entry) => entry.channel === channel,
  )?.value;

const expectFramesClose = (actual, expected) => {
  expect(actual.values).toHaveLength(expected.values.length);
  actual.values.forEach((entry, index) => {
    const expectedEntry = expected.values[index];
    expect(entry.channel).toBe(expectedEntry.channel);
    if (Array.isArray(expectedEntry.value)) {
      expect(entry.value).toHaveLength(expectedEntry.value.length);
      entry.value.forEach((value, component) =>
        expect(value).toBeCloseTo(expectedEntry.value[component], 6),
      );
    } else if (typeof expectedEntry.value === "number") {
      expect(entry.value).toBeCloseTo(expectedEntry.value, 6);
    } else {
      expect(entry.value).toEqual(expectedEntry.value);
    }
  });
};

describe("portable GSAP public authoring contract", () => {
  it.each([
    {
      name: "set",
      steps: [{ kind: "set", values: { x: 1 } }],
      expected: { duration: 0, clips: 1, starts: [0], events: 0 },
    },
    {
      name: "to",
      steps: [{ kind: "to", values: { x: 1 }, duration: 10 }],
      expected: { duration: 10, clips: 1, starts: [0], events: 0 },
    },
    {
      name: "from",
      steps: [{ kind: "from", values: { x: 1 }, duration: 10 }],
      expected: { duration: 10, clips: 1, starts: [0], events: 0 },
    },
    {
      name: "fromTo",
      steps: [{ kind: "fromTo", from: { x: 0 }, to: { x: 1 }, duration: 10 }],
      expected: { duration: 10, clips: 1, starts: [0], events: 0 },
    },
    {
      name: "keyframes",
      steps: [
        {
          kind: "keyframes",
          frames: [
            { values: { x: 1 }, duration: 4 },
            { values: { x: 2 }, delay: 1, duration: 5 },
          ],
        },
      ],
      expected: { duration: 10, clips: 2, starts: [0, 5], events: 0 },
    },
    {
      name: "sequence",
      steps: [
        {
          kind: "sequence",
          steps: [
            { kind: "to", values: { x: 1 }, duration: 4 },
            { kind: "to", values: { y: 2 }, duration: 6 },
          ],
        },
      ],
      expected: { duration: 10, clips: 2, starts: [0, 4], events: 0 },
    },
    {
      name: "parallel",
      steps: [
        {
          kind: "parallel",
          steps: [
            { kind: "to", values: { x: 1 }, duration: 4 },
            { kind: "to", values: { y: 2 }, duration: 6 },
          ],
        },
      ],
      expected: { duration: 6, clips: 2, starts: [0, 0], events: 0 },
    },
    {
      name: "wait",
      steps: [
        { kind: "wait", duration: 4 },
        { kind: "set", values: { x: 1 } },
      ],
      expected: { duration: 4, clips: 1, starts: [4], events: 0 },
    },
    {
      name: "mark",
      steps: [
        { kind: "mark", name: "cue" },
        { kind: "wait", duration: 5 },
        {
          kind: "set",
          values: { x: 1 },
          start: { anchor: "cue", offset: 2 },
        },
      ],
      expected: {
        duration: 5,
        clips: 1,
        starts: [2],
        events: 0,
        mark: 0,
      },
    },
    {
      name: "emit",
      steps: [{ kind: "emit", event: "ready", payload: { ok: true } }],
      expected: { duration: 0, clips: 0, starts: [], events: 1 },
    },
  ])("compiles the $name step", ({ steps, expected }) => {
    const program = compileUpdate({ steps });
    expect(program.duration).toBe(expected.duration);
    expect(program.clipTemplates).toHaveLength(expected.clips);
    expect(program.clipTemplates.map((clip) => clip.start)).toEqual(
      expected.starts,
    );
    expect(program.events).toHaveLength(expected.events);
    if (expected.mark !== undefined) {
      expect(program.debug.marks.cue).toBe(expected.mark);
    }
  });

  it.each([
    {
      name: "set",
      step: { kind: "set", values: { x: 10 } },
      times: [0, 5, 10],
      values: [10, 10, 10],
    },
    {
      name: "to",
      step: { kind: "to", values: { x: 10 }, duration: 10 },
      times: [0, 5, 10],
      values: [5, 7.5, 10],
    },
    {
      name: "from",
      step: { kind: "from", values: { x: 10 }, duration: 10 },
      times: [0, 5, 10],
      values: [10, 7.5, 5],
    },
    {
      name: "fromTo",
      step: {
        kind: "fromTo",
        from: { x: 0 },
        to: { x: 10 },
        duration: 10,
      },
      times: [0, 5, 10],
      values: [0, 5, 10],
    },
    {
      name: "keyframes",
      step: {
        kind: "keyframes",
        frames: [
          { values: { x: 10 }, duration: 10 },
          { values: { x: 20 }, duration: 10 },
        ],
      },
      times: [0, 5, 10, 15, 20],
      values: [5, 7.5, 10, 15, 20],
    },
  ])("evaluates $name endpoints and boundaries", ({ step, times, values }) => {
    const { instance } = bindOwner(compileUpdate({ steps: [step] }), {
      "transform.x": 5,
    });
    expect(times.map((time) => sampleChannel(instance, time))).toEqual(values);
  });

  it("resolves every structured start anchor, delay, and overlap form", () => {
    const anchored = compileUpdate({
      steps: [
        {
          kind: "parallel",
          steps: [
            { kind: "to", id: "first", values: { x: 1 }, duration: 100 },
            {
              kind: "to",
              values: { y: 1 },
              duration: 10,
              start: { anchor: "previous.start", offset: 10 },
            },
            {
              kind: "to",
              values: { alpha: 1 },
              duration: 10,
              start: { anchor: "first", edge: "end", offset: -5 },
            },
            {
              kind: "set",
              values: { scaleX: 1 },
              start: { anchor: "group.start", offset: 20 },
            },
            {
              kind: "set",
              values: { scaleY: 1 },
              start: { anchor: "timeline.start", offset: 30 },
            },
            {
              kind: "set",
              values: { rotation: 1 },
              start: { time: 40 },
              delay: 5,
            },
          ],
        },
      ],
    });
    expect(
      Object.fromEntries(
        anchored.clipTemplates.map((clip) => [clip.channel, clip.start]),
      ),
    ).toMatchObject({
      "transform.x": 0,
      "transform.y": 10,
      "appearance.alpha": 95,
      "transform.scale.x": 20,
      "transform.scale.y": 30,
      "transform.rotation.degrees": 45,
    });

    const overlapped = compileUpdate({
      steps: [
        { kind: "to", values: { x: 1 }, duration: 100 },
        { kind: "to", values: { y: 1 }, duration: 20, overlap: 30 },
      ],
    });
    expect(overlapped.clipTemplates.map((clip) => clip.start)).toEqual([0, 70]);
    expect(overlapped.duration).toBe(100);
  });

  it("inherits nested defaults and supports every overwrite mode", () => {
    const program = compileUpdate({
      defaults: { duration: 100, easing: "power2.out", overwrite: "auto" },
      steps: [
        {
          kind: "parallel",
          defaults: { duration: 20, easing: "linear", overwrite: "none" },
          steps: [
            { kind: "to", values: { x: 1 } },
            { kind: "to", values: { y: 1 }, overwrite: "all" },
            { kind: "to", values: { alpha: 1 }, overwrite: "error" },
            { kind: "to", values: { scaleX: 1 }, overwrite: "auto" },
          ],
        },
      ],
    });
    expect(program.duration).toBe(20);
    expect(program.clipTemplates.map((clip) => clip.overwrite)).toEqual([
      "none",
      "all",
      "error",
      "auto",
    ]);
    expect(
      program.clipTemplates.map((clip) => program.easings[clip.sampler.easing]),
    ).toEqual(Array(4).fill({ kind: "linear" }));
  });

  it.each(["to", "from", "fromTo", "keyframes", "sequence", "parallel"])(
    "applies repeat controls to %s",
    (kind) => {
      const valueStep =
        kind === "fromTo"
          ? { kind, from: { x: 0 }, to: { x: 10 }, duration: 10 }
          : kind === "keyframes"
            ? {
                kind,
                frames: [{ values: { x: 10 }, duration: 10 }],
              }
            : new Set(["sequence", "parallel"]).has(kind)
              ? {
                  kind,
                  steps: [{ kind: "to", values: { x: 10 }, duration: 10 }],
                }
              : { kind, values: { x: 10 }, duration: 10 };
      const program = compileUpdate({
        steps: [
          {
            ...valueStep,
            repeat: 1,
            repeatDelay: 2,
            yoyo: true,
            speed: 2,
          },
        ],
      });
      const domain = Object.values(program.domains).find(
        (candidate) => candidate.parent === "root",
      );
      expect(domain).toMatchObject({
        cycleDuration: 10,
        iterations: 2,
        iterationGap: 2,
        direction: "alternate",
        rate: 2,
      });
      expect(program.duration).toBe(11);
    },
  );

  it("maps animation playback speed, repeat delay, and yoyo on the root domain", () => {
    const program = compileUpdate({
      playback: { speed: 2, repeat: 1, repeatDelay: 20, yoyo: true },
      steps: [{ kind: "to", values: { x: 100 }, duration: 100 }],
    });
    expect(program.domains.root).toMatchObject({
      cycleDuration: 100,
      iterations: 2,
      iterationGap: 20,
      direction: "alternate",
      rate: 2,
    });
    expect(program.duration).toBe(110);
    const { instance } = bindOwner(program, { "transform.x": 0 });
    expect(sampleChannel(instance, 0)).toBe(0);
    expect(sampleChannel(instance, 50)).toBe(100);
    expect(sampleChannel(instance, 60)).toBe(100);
    expect(sampleChannel(instance, 110)).toBe(0);
  });

  it("compiles element, element-list, text-unit, union, and transition targets", () => {
    const update = compileUpdate({
      targets: {
        one: { element: "card-a" },
        many: { elements: ["card-b", "card-c"] },
        words: {
          textUnits: {
            elementId: "title",
            unit: "word",
            order: "visual",
            allowEmpty: true,
          },
        },
      },
      steps: [
        {
          kind: "parallel",
          steps: [
            { kind: "set", targets: ["one", "many"], values: { x: 1 } },
            { kind: "set", targets: "words", values: { alpha: 0 } },
          ],
        },
      ],
    });
    expect(update.targetQueries).toMatchObject({
      self: { kind: "element", elementId: "hero" },
      one: { kind: "element", elementId: "card-a" },
      many: { kind: "elements", elementIds: ["card-b", "card-c"] },
      words: {
        kind: "textUnits",
        elementId: "title",
        unit: "word",
        order: "visual",
        allowEmpty: true,
      },
      "__targets-0": { kind: "union", aliases: ["one", "many"] },
    });
    expect(update.requirements).toContain("target.textUnits.word.unicode17");

    const transition = compilePortableGsapAnimation({
      id: "transition-target-contract",
      targetId: "root",
      type: "transition",
      gsap: {
        profile: "portable-v1",
        targets: {
          previous: { transitionSurface: "prev" },
          next: { transitionSurface: "next" },
          mask: { transitionMask: true },
          compositor: { transitionCompositor: true },
        },
        steps: [
          {
            kind: "parallel",
            steps: [
              { kind: "set", targets: "previous", values: { alpha: 0 } },
              { kind: "set", targets: "next", values: { x: 10 } },
              { kind: "set", targets: "mask", values: { progress: 1 } },
              {
                kind: "set",
                targets: "compositor",
                values: { progress: 1, parameters: { warp: [1, 2] } },
              },
            ],
          },
        ],
      },
    });
    expect(transition.clipTemplates.map((clip) => clip.channel)).toEqual([
      "appearance.alpha",
      "transform.x",
      "transition.mask.progress",
      "transition.compositor.parameter.warp",
      "transition.compositor.progress",
    ]);
  });

  it("flattens every public Pixi value family into semantic channels", () => {
    const program = compileUpdate({
      steps: [
        {
          kind: "set",
          values: {
            x: 1,
            y: 2,
            scaleX: 1.1,
            scaleY: 1.2,
            rotation: 15,
            alpha: 0.5,
            blurX: 3,
            blurY: 4,
            width: 100,
            height: 50,
            fill: { color: "#369" },
            border: { width: 2, color: "#336699cc", alpha: 0.8 },
            cornerRadius: 6,
            filters: { glow: { strength: 1, offset: [2, 3] } },
          },
        },
      ],
    });
    const types = Object.fromEntries(
      program.clipTemplates.map((clip) => [clip.channel, clip.valueType]),
    );
    expect(types).toMatchObject({
      "transform.x": "scalar",
      "transform.y": "scalar",
      "transform.scale.x": "scalar",
      "transform.scale.y": "scalar",
      "transform.rotation.degrees": "angleDegrees",
      "appearance.alpha": "scalar",
      "effect.blur.x": "scalar",
      "effect.blur.y": "scalar",
      "geometry.rect.width": "scalar",
      "geometry.rect.height": "scalar",
      "geometry.rect.fill.color": "colorSrgb",
      "geometry.rect.border.width": "scalar",
      "geometry.rect.border.color": "colorSrgb",
      "geometry.rect.border.alpha": "scalar",
      "geometry.rect.cornerRadius.topLeft": "scalar",
      "geometry.rect.cornerRadius.topRight": "scalar",
      "geometry.rect.cornerRadius.bottomRight": "scalar",
      "geometry.rect.cornerRadius.bottomLeft": "scalar",
      "filter.glow.parameter.strength": "scalar",
      "filter.glow.parameter.offset": "vec2",
    });
  });

  it("compiles relative, random-number, random-choice, and advanced expression shorthands", () => {
    const program = compileUpdate({
      steps: [
        {
          kind: "to",
          duration: 10,
          values: {
            x: { by: 5 },
            y: { random: { min: -4, max: 4, step: 2, seed: "y" } },
            rotation: { random: { choices: [-15, 0, 15], seed: "turn" } },
            alpha: {
              expr: {
                kind: "divide",
                left: { kind: "targetIndex" },
                right: { kind: "targetCount" },
              },
            },
          },
        },
      ],
    });
    const expressions = Object.fromEntries(
      program.clipTemplates.map((clip) => [clip.channel, clip.sampler.to]),
    );
    expect(expressions).toMatchObject({
      "transform.x": {
        kind: "add",
        left: { kind: "underlying" },
        right: { kind: "constant", value: 5 },
      },
      "transform.y": {
        kind: "randomNumber",
        min: -4,
        max: 4,
        step: 2,
        seed: "y",
      },
      "transform.rotation.degrees": {
        kind: "randomChoice",
        choices: [-15, 0, 15],
        seed: "turn",
      },
      "appearance.alpha": {
        kind: "divide",
        left: { kind: "targetIndex" },
        right: { kind: "targetCount" },
      },
    });
  });

  it("resolves translate values from the subject origin and dimensions", () => {
    const program = compileUpdate({
      steps: [
        {
          kind: "fromTo",
          from: { translateX: 0.5, translateY: { by: 0.25 } },
          to: { translateX: 1, translateY: { by: 0.5 } },
          duration: 10,
        },
      ],
    });
    const { instance } = bindOwner(program, {
      "transform.x": 7,
      "transform.y": 9,
    });
    expect(sampleChannel(instance, 0, "transform.x")).toBe(13);
    expect(sampleChannel(instance, 10, "transform.x")).toBe(23);
    expect(sampleChannel(instance, 0, "transform.y")).toBe(11.5);
    expect(sampleChannel(instance, 10, "transform.y")).toBe(16.5);
  });

  it("compiles the documented deterministic fill-color choice form", () => {
    const program = compileUpdate({
      steps: [
        {
          kind: "set",
          values: {
            fill: {
              color: {
                random: {
                  choices: ["#ff0000", "#00ff00", "#0000ff"],
                  seed: "card-fill",
                },
              },
            },
          },
        },
      ],
    });
    expect(program.clipTemplates[0]).toMatchObject({
      channel: "geometry.rect.fill.color",
      valueType: "colorSrgb",
      sampler: {
        from: { kind: "underlying" },
        to: {
          kind: "randomChoice",
          choices: [
            [1, 0, 0, 1],
            [0, 1, 0, 1],
            [0, 0, 1, 1],
          ],
          seed: "card-fill",
        },
      },
    });
    const { instance } = bindOwner(program, {
      "geometry.rect.fill.color": [0, 0, 0, 1],
    });
    const segment = instance.tracks[0].segments[0];
    expect(segment.from).toEqual([0, 0, 0, 1]);
    expect(program.clipTemplates[0].sampler.to.choices).toContainEqual(
      segment.to,
    );
    expect(sampleChannel(instance, 0, "geometry.rect.fill.color")).toEqual(
      segment.to,
    );
    const evaluator = createGsapTimelineEvaluator(instance);
    expect(
      evaluator
        .evaluate(0)
        .values.find((entry) => entry.channel === "geometry.rect.fill.color")
        ?.value,
    ).toEqual(segment.to);
    evaluator.destroy();
  });

  it.each([
    ["forward", "once", "suppress"],
    ["reverse", "eachIteration", "crossed"],
    ["both", "eachIteration", "suppress"],
  ])(
    "compiles %s/%s/%s event delivery",
    (direction, occurrence, seekPolicy) => {
      const program = compileUpdate({
        steps: [
          {
            kind: "emit",
            event: "signal",
            payload: { direction },
            direction,
            occurrence,
            seekPolicy,
          },
        ],
      });
      expect(program.events[0]).toMatchObject({
        name: "signal",
        payload: { direction },
        direction,
        occurrence,
        seekPolicy,
      });
    },
  );

  it.each([
    {
      name: "wait outside sequence",
      steps: [{ kind: "parallel", steps: [{ kind: "wait", duration: 1 }] }],
      error: /wait is valid only in a sequence/,
    },
    {
      name: "duplicate target alias",
      steps: [{ kind: "set", targets: ["self", "self"], values: { x: 1 } }],
      error: /must not repeat an alias/,
    },
    {
      name: "ambiguous start",
      steps: [
        {
          kind: "set",
          values: { x: 1 },
          start: { time: 0, anchor: "group.start" },
        },
      ],
      error: /requires exactly one of time or anchor/,
    },
    {
      name: "unbounded repeat refresh",
      steps: [
        {
          kind: "to",
          values: { x: { by: 1 } },
          duration: 1,
          repeat: "infinite",
          repeatRefresh: true,
        },
      ],
      error: /repeatRefresh cannot be infinite/,
    },
    {
      name: "unknown target alias",
      steps: [{ kind: "set", targets: "missing", values: { x: 1 } }],
      error: /unknown alias "missing"/,
    },
  ])("rejects $name", ({ steps, error }) => {
    expect(() => compileUpdate({ steps })).toThrow(error);
  });
});

describe("portable GSAP expression, modifier, and stagger contract", () => {
  const expressionContext = {
    programId: "expression-contract",
    sourcePath: "steps[0]",
    targetIdentity: "hero",
    channel: "transform.x",
    property: "x",
    targetIndex: 2,
    targetCount: 4,
    iteration: 3,
    underlying: 10,
    targetState: { x: 42 },
    subject: { x: 3, width: 20 },
  };

  it.each([
    ["constant", { kind: "constant", value: [1, 2] }, [1, 2]],
    ["underlying", { kind: "underlying" }, 10],
    ["targetState", { kind: "targetState" }, 42],
    ["subjectBase", { kind: "subjectBase", axis: "x" }, 3],
    ["subjectDimension", { kind: "subjectDimension", axis: "width" }, 20],
    ["targetIndex", { kind: "targetIndex" }, 2],
    ["targetCount", { kind: "targetCount" }, 4],
    ["iteration", { kind: "iteration" }, 3],
    [
      "add",
      {
        kind: "add",
        left: { kind: "constant", value: [1, 2] },
        right: { kind: "constant", value: [3, 4] },
      },
      [4, 6],
    ],
    [
      "subtract",
      {
        kind: "subtract",
        left: { kind: "constant", value: [5, 8] },
        right: { kind: "constant", value: [2, 3] },
      },
      [3, 5],
    ],
    [
      "multiply",
      {
        kind: "multiply",
        left: { kind: "constant", value: [1, 2] },
        right: { kind: "constant", value: 2 },
      },
      [2, 4],
    ],
    [
      "divide",
      {
        kind: "divide",
        left: { kind: "constant", value: [6, 9] },
        right: { kind: "constant", value: 3 },
      },
      [2, 3],
    ],
    [
      "min",
      {
        kind: "min",
        values: [
          { kind: "constant", value: 3 },
          { kind: "constant", value: 1 },
        ],
      },
      1,
    ],
    [
      "max",
      {
        kind: "max",
        values: [
          { kind: "constant", value: 3 },
          { kind: "constant", value: 1 },
        ],
      },
      3,
    ],
    [
      "clamp",
      {
        kind: "clamp",
        value: { kind: "constant", value: 7 },
        min: { kind: "constant", value: 0 },
        max: { kind: "constant", value: 5 },
      },
      5,
    ],
  ])("evaluates the %s expression", (_name, expression, expected) => {
    expect(evaluateExpression(expression, expressionContext)).toEqual(expected);
  });

  it("keeps randomNumber and randomChoice deterministic and bounded", () => {
    const number = {
      kind: "randomNumber",
      min: -4,
      max: 4,
      step: 2,
      seed: "number",
    };
    const choice = {
      kind: "randomChoice",
      choices: ["a", "b", "c"],
      seed: "choice",
    };
    const firstNumber = evaluateExpression(number, expressionContext);
    const firstChoice = evaluateExpression(choice, expressionContext);
    expect([-4, -2, 0, 2, 4]).toContain(firstNumber);
    expect(choice.choices).toContain(firstChoice);
    expect(evaluateExpression(number, expressionContext)).toBe(firstNumber);
    expect(evaluateExpression(choice, expressionContext)).toBe(firstChoice);
  });

  it.each([
    ["snap increment", -2.5, { kind: "snap", increment: 5 }, -5],
    ["snap values", 6, { kind: "snap", values: [0, 10, 20] }, 10],
    ["round", 1.236, { kind: "round", precision: 2 }, 1.24],
    ["clamp", 12, { kind: "clamp", min: 0, max: 10 }, 10],
    ["wrap", -1, { kind: "wrap", min: 0, max: 10 }, 9],
    ["wrapYoyo", 12, { kind: "wrapYoyo", min: 0, max: 10 }, 8],
  ])("applies the %s modifier", (_name, input, modifier, expected) => {
    expect(applyModifier(input, modifier)).toBe(expected);
  });

  it("calculates indexed, grid, axis, edge, and eased staggers", () => {
    expect(calculateStaggerOffsets(5, { each: 10, from: 2 })).toEqual([
      20, 10, 0, 10, 20,
    ]);
    expect(
      calculateStaggerOffsets(6, {
        each: 10,
        from: "start",
        grid: { columns: 3 },
      }),
    ).toEqual([0, 40, 160, 40, 80, 200]);
    expect(
      calculateStaggerOffsets(6, {
        each: 10,
        from: "center",
        grid: { columns: 3 },
        axis: "x",
      }),
    ).toEqual([20, 0, 20, 20, 0, 20]);
    expect(
      calculateStaggerOffsets(9, {
        amount: 90,
        from: "edges",
        grid: { columns: 3 },
      }),
    ).toEqual([0, 0, 0, 0, 90, 0, 0, 0, 0]);
    expect(
      calculateStaggerOffsets(3, {
        amount: 100,
        from: "start",
        easing: { kind: "power", exponent: 2, direction: "in" },
      }),
    ).toEqual([0, 25, 100]);
    expect(() => calculateStaggerOffsets(3, { each: 10, from: 3 })).toThrow(
      /outside the target list/,
    );
  });
});

describe("portable GSAP compiled-plan parity", () => {
  it.each([
    {
      name: "value actions and keyframes",
      steps: [
        { kind: "set", values: { alpha: 0.25 } },
        { kind: "to", values: { x: 20 }, duration: 20 },
        { kind: "from", values: { y: 20 }, duration: 20 },
        {
          kind: "fromTo",
          from: { scaleX: 0.5 },
          to: { scaleX: 1.5 },
          duration: 20,
        },
        {
          kind: "keyframes",
          frames: [
            { values: { rotation: 30 }, duration: 10 },
            { values: { rotation: -10 }, duration: 10 },
          ],
        },
      ],
    },
    {
      name: "groups, waits, overlap, and structured starts",
      steps: [
        {
          kind: "parallel",
          steps: [
            { kind: "to", id: "move", values: { x: 30 }, duration: 30 },
            { kind: "to", values: { y: 20 }, duration: 15, delay: 5 },
          ],
        },
        { kind: "wait", duration: 5 },
        { kind: "to", values: { alpha: 1 }, duration: 10, overlap: 5 },
      ],
    },
    {
      name: "repeat, yoyo, easing, relative values, and modifiers",
      steps: [
        {
          kind: "to",
          values: { x: { by: 25 } },
          duration: 40,
          repeat: 2,
          repeatDelay: 5,
          yoyo: true,
          easing: { kind: "back", direction: "out", overshoot: 2 },
          modifiers: {
            x: [
              { kind: "snap", increment: 0.25 },
              { kind: "clamp", min: -100, max: 100 },
            ],
          },
        },
      ],
    },
  ])("matches real GSAP for $name", ({ steps }) => {
    const program = compileUpdate({ steps, id: `parity-${steps[0].kind}` });
    const { instance } = bindOwner(program, {
      "transform.x": 5,
      "transform.y": 7,
      "appearance.alpha": 0.5,
      "transform.scale.x": 1,
      "transform.rotation.degrees": 0,
    });
    const evaluator = createGsapTimelineEvaluator(instance);
    const duration = Number(instance.duration);
    for (let time = 0; time <= duration; time += 0.5) {
      expectFramesClose(
        evaluator.evaluate(time),
        evaluateTimelineInstance(instance, time),
      );
    }
    evaluator.destroy();
  });
});
