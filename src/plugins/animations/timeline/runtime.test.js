import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import {
  applyModifiers,
  applyTimelineFrame,
  assertDisjointTimelineWriteSets,
  bindTimelineProgram,
  createTimelineFrameBuffer,
  calculateStaggerOffsets,
  compileLegacyTweenAnimation,
  compilePortableGsapAnimation,
  deriveRandomState,
  deterministicRandomUnit,
  evaluateExpression,
  evaluateTimelineInstance,
  evaluateTimelineInstanceInto,
  fnv1a64,
  randomStateHex,
  splitMix64,
} from "./index.js";
import {
  buildTimeline,
  getValueAtTime,
} from "../../../../spec/support/legacyAnimationTimeline.js";

const makeAdapter = (property, valueType = "scalar") => ({
  property,
  valueType,
  get: (target) => target[property],
  apply: (target, value) => {
    target[property] = value;
  },
});

const bindLegacy = (source, element, targetState) => {
  const animation = normalizeAnimations([source])[0];
  const program = compileLegacyTweenAnimation(animation);
  const registry = {
    "transform.x": makeAdapter("x"),
    "transform.y": makeAdapter("y"),
    "appearance.alpha": makeAdapter("alpha"),
  };
  return bindTimelineProgram(program, {
    capabilities: new Set(program.requirements),
    targetRegistry: {
      [source.targetId]: {
        handle: element,
        identity: source.targetId,
        subject: {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        },
        targetState,
      },
    },
    channelRegistry: registry,
  });
};

describe("TimelineProgram binder and pure evaluator", () => {
  it("rolls back a partially applied frame and closes batch hooks", () => {
    const first = { x: 1 };
    const second = { x: 2 };
    const calls = [];
    const group = {
      beforeApplyFrame: () => calls.push("open"),
      afterApplyFrame: () => calls.push("close"),
    };
    const frame = {
      values: [
        {
          target: first,
          value: 10,
          binding: {
            group,
            get: (target) => target.x,
            apply: (target, value) => {
              target.x = value;
            },
          },
        },
        {
          target: second,
          value: 20,
          binding: {
            group,
            get: (target) => target.x,
            apply: () => {
              throw new Error("adapter failed");
            },
          },
        },
      ],
    };

    expect(() => applyTimelineFrame(frame)).toThrow("adapter failed");
    expect(first.x).toBe(1);
    expect(second.x).toBe(2);
    expect(calls).toEqual(["open", "close"]);
  });

  it("closes every opened batch while preserving the frame failure", () => {
    const calls = [];
    const firstGroup = {
      beforeApplyFrame: () => calls.push("open:first"),
      afterApplyFrame: () => {
        calls.push("close:first");
        throw new Error("first close failed");
      },
    };
    const secondGroup = {
      beforeApplyFrame: () => calls.push("open:second"),
      afterApplyFrame: () => {
        calls.push("close:second");
        throw new Error("second close failed");
      },
    };
    const first = { x: 1 };
    const second = { x: 2 };
    const frame = {
      values: [
        {
          target: first,
          value: 10,
          binding: {
            group: firstGroup,
            get: (target) => target.x,
            apply: (target, value) => {
              target.x = value;
            },
          },
        },
        {
          target: second,
          value: 20,
          binding: {
            group: secondGroup,
            get: (target) => target.x,
            apply: () => {
              throw new Error("frame apply failed");
            },
          },
        },
      ],
    };

    expect(() => applyTimelineFrame(frame)).toThrow("frame apply failed");
    expect(first.x).toBe(1);
    expect(second.x).toBe(2);
    expect(calls).toEqual([
      "open:first",
      "open:second",
      "close:second",
      "close:first",
    ]);
  });

  it("closes every batch and reports the first close failure", () => {
    const calls = [];
    const makeGroup = (name) => ({
      afterApplyFrame: () => {
        calls.push(name);
        throw new Error(`${name} failed`);
      },
    });
    const frame = {
      values: ["first", "second"].map((name) => ({
        target: { x: 0 },
        value: 1,
        binding: {
          group: makeGroup(name),
          get: (target) => target.x,
          apply: (target, value) => {
            target.x = value;
          },
        },
      })),
    };

    expect(() => applyTimelineFrame(frame)).toThrow("second failed");
    expect(calls).toEqual(["second", "first"]);
  });

  it("reuses a frame buffer without changing out-of-order sampling results", () => {
    const instance = bindLegacy(
      {
        id: "buffered",
        targetId: "hero",
        type: "update",
        tween: {
          x: { keyframes: [{ value: 100, duration: 100, easing: "linear" }] },
        },
      },
      { x: 0, y: 0, width: 10, height: 10 },
    );
    const buffer = createTimelineFrameBuffer(instance);
    expect(evaluateTimelineInstanceInto(instance, 75, buffer)).toBe(buffer);
    expect(buffer.values[0].value).toBe(75);
    evaluateTimelineInstanceInto(instance, 25, buffer);
    expect(buffer.values[0].value).toBe(25);
    expect(() =>
      evaluateTimelineInstanceInto(instance, 0, {
        ...buffer,
        instanceId: "another-instance",
      }),
    ).toThrow(/does not belong/);
  });

  it("matches the legacy tween sampler densely, including holds and relative frames", () => {
    const source = {
      id: "move",
      targetId: "hero",
      type: "update",
      tween: {
        x: {
          initialValue: 10,
          keyframes: [
            { value: 20, delay: 10, duration: 100, easing: "easeOutQuad" },
            {
              value: 5,
              relative: true,
              delay: 20,
              duration: 50,
              easing: "easeInCubic",
            },
          ],
        },
        alpha: {
          keyframes: [{ value: 0.2, duration: 80, easing: "easeInOutSine" }],
        },
      },
    };
    const instance = bindLegacy(source, {
      x: 3,
      y: 4,
      alpha: 0.8,
      width: 200,
      height: 100,
    });
    const xLegacy = buildTimeline([{ value: 10 }, ...source.tween.x.keyframes]);
    const alphaLegacy = buildTimeline([
      { value: 0.8 },
      ...source.tween.alpha.keyframes,
    ]);

    for (let time = 0; time <= 200; time += 0.5) {
      const values = Object.fromEntries(
        evaluateTimelineInstance(instance, time).values.map((item) => [
          item.channel,
          item.value,
        ]),
      );
      expect(values["transform.x"]).toBeCloseTo(
        getValueAtTime(xLegacy, time),
        12,
      );
      expect(values["appearance.alpha"]).toBeCloseTo(
        getValueAtTime(alphaLegacy, time),
        12,
      );
    }
  });

  it("resolves auto and subject-relative translation at binding", () => {
    const element = { x: 100, y: 20, alpha: 1, width: 200, height: 50 };
    const instance = bindLegacy(
      {
        id: "auto",
        targetId: "hero",
        type: "update",
        tween: {
          translateX: { keyframes: [{ value: 0.5, duration: 100 }] },
          y: { auto: { duration: 100 } },
        },
      },
      element,
      { y: 70 },
    );
    const halfway = Object.fromEntries(
      evaluateTimelineInstance(instance, 50).values.map((item) => [
        item.channel,
        item.value,
      ]),
    );
    expect(halfway["transform.x"]).toBe(150);
    expect(halfway["transform.y"]).toBe(45);
  });

  it("maps root repeat, yoyo, delay, and speed without playback history", () => {
    const instance = bindLegacy(
      {
        id: "repeat",
        targetId: "hero",
        type: "update",
        playback: { repeat: 1, repeatDelay: 20, yoyo: true, speed: 2 },
        tween: { x: { keyframes: [{ value: 100, duration: 100 }] } },
      },
      { x: 0, width: 1, height: 1 },
    );
    const sample = (time) =>
      evaluateTimelineInstance(instance, time).values[0].value;
    expect(sample(25)).toBe(50);
    expect(sample(55)).toBe(100);
    expect(sample(60)).toBe(100);
    expect(sample(85)).toBe(50);
    expect(sample(110)).toBe(0);
    expect(instance.duration).toBe(110);
  });

  it("rejects cross-record concrete write-set conflicts", () => {
    const source = {
      id: "a",
      targetId: "hero",
      type: "update",
      tween: { x: { keyframes: [{ value: 1, duration: 10 }] } },
    };
    const first = bindLegacy(source, { x: 0, width: 1, height: 1 });
    const second = bindLegacy(
      { ...source, id: "b" },
      { x: 0, width: 1, height: 1 },
    );
    expect(() => assertDisjointTimelineWriteSets([first, second])).toThrow(
      /both write target.*transform.x/,
    );
  });

  it.each([
    ["auto", 87.5, 162.5],
    ["none", 87.5, 162.5],
  ])(
    "keeps %s overlap deterministic under out-of-order seeks",
    (overwrite, at75, at125) => {
      const program = compilePortableGsapAnimation({
        id: `overlap-${overwrite}`,
        targetId: "hero",
        type: "update",
        gsap: {
          profile: "portable-v1",
          defaults: { duration: 100 },
          steps: [
            { kind: "to", values: { x: 100 }, overwrite: "none" },
            {
              kind: "to",
              values: { x: 200 },
              start: { time: 50 },
              overwrite,
            },
          ],
        },
      });
      const target = { x: 0 };
      const instance = bindTimelineProgram(program, {
        capabilities: new Set(program.requirements),
        targetRegistry: { hero: { handle: target, identity: "hero" } },
        channelRegistry: { "transform.x": makeAdapter("x") },
      });
      const sample = (time) =>
        evaluateTimelineInstance(instance, time).values[0].value;
      expect(sample(125)).toBe(at125);
      expect(sample(75)).toBe(at75);
      expect(sample(125)).toBe(at125);
    },
  );

  it("applies overwrite all across channels and reports overwrite error paths", () => {
    const source = {
      id: "overwrite-all",
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        defaults: { duration: 100 },
        steps: [
          {
            kind: "parallel",
            steps: [
              { kind: "to", values: { x: 100 }, overwrite: "none" },
              { kind: "to", values: { y: 100 }, overwrite: "none" },
            ],
          },
          {
            kind: "to",
            values: { x: 200 },
            start: { time: 50 },
            overwrite: "all",
          },
        ],
      },
    };
    const target = { x: 0, y: 0 };
    const bind = (animation) => {
      const program = compilePortableGsapAnimation(animation);
      return bindTimelineProgram(program, {
        capabilities: new Set(program.requirements),
        targetRegistry: { hero: { handle: target, identity: "hero" } },
        channelRegistry: {
          "transform.x": makeAdapter("x"),
          "transform.y": makeAdapter("y"),
        },
      });
    };
    const instance = bind(source);
    const values = Object.fromEntries(
      evaluateTimelineInstance(instance, 75).values.map((item) => [
        item.channel,
        item.value,
      ]),
    );
    expect(values["transform.x"]).toBe(87.5);
    expect(values["transform.y"]).toBe(0);

    const errorSource = structuredClone(source);
    errorSource.id = "overwrite-error";
    errorSource.gsap.steps[1].overwrite = "error";
    expect(() => bind(errorSource)).toThrow(
      /steps\[1\].*steps\[0\].*transform\.x/,
    );
  });

  it("reapplies overwrite-trimmed keyframes on every repeated iteration", () => {
    const program = compilePortableGsapAnimation({
      id: "repeated-keyframes",
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        steps: [
          {
            kind: "keyframes",
            repeat: 1,
            frames: [
              { duration: 50, values: { x: 50 } },
              { duration: 50, values: { x: 100 } },
            ],
          },
        ],
      },
    });
    const target = { x: 0 };
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: { hero: { handle: target, identity: "hero" } },
      channelRegistry: { "transform.x": makeAdapter("x") },
    });
    const sample = (time) =>
      evaluateTimelineInstance(instance, time).values[0].value;

    expect(sample(25)).toBe(25);
    expect(sample(75)).toBe(75);
    expect(sample(125)).toBe(25);
    expect(sample(175)).toBe(75);
  });

  it.each([false, true])(
    "rejects overwrite error conflicts in later repeated occurrences with yoyo=%s",
    (yoyo) => {
      const source = {
        id: `repeated-overwrite-error-${yoyo}`,
        targetId: "hero",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { x: 100 },
              duration: 100,
              repeat: 1,
              yoyo,
            },
            {
              kind: "to",
              values: { x: 200 },
              duration: 50,
              start: { time: 150 },
              overwrite: "error",
            },
          ],
        },
      };
      const program = compilePortableGsapAnimation(source);

      expect(() =>
        bindTimelineProgram(program, {
          capabilities: new Set(program.requirements),
          targetRegistry: {
            hero: { handle: { x: 0 }, identity: "hero" },
          },
          channelRegistry: { "transform.x": makeAdapter("x") },
        }),
      ).toThrow(/steps\[1\].*steps\[0\].*transform\.x/);
    },
  );

  it.each([
    {
      name: "third occurrence after repeat delays",
      repeatedStep: {
        kind: "to",
        values: { x: 100 },
        duration: 50,
        repeat: 2,
        repeatDelay: 50,
      },
      conflictStart: 225,
    },
    {
      name: "speed-scaled second occurrence",
      repeatedStep: {
        kind: "to",
        values: { x: 100 },
        duration: 100,
        repeat: 1,
        speed: 2,
      },
      conflictStart: 75,
    },
    {
      name: "repeated containing sequence",
      repeatedStep: {
        kind: "sequence",
        repeat: 1,
        steps: [
          { kind: "to", values: { x: 100 }, duration: 50 },
          { kind: "wait", duration: 50 },
        ],
      },
      conflictStart: 125,
    },
    {
      name: "nested child and parent repeats",
      repeatedStep: {
        kind: "sequence",
        repeat: 1,
        steps: [
          {
            kind: "to",
            values: { x: 100 },
            duration: 25,
            repeat: 1,
            repeatDelay: 25,
          },
          { kind: "wait", duration: 25 },
        ],
      },
      conflictStart: 160,
    },
  ])(
    "rejects overwrite error conflicts in $name",
    ({ name, repeatedStep, conflictStart }) => {
      const program = compilePortableGsapAnimation({
        id: `occurrence-overwrite-${name.replaceAll(" ", "-")}`,
        targetId: "hero",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            repeatedStep,
            {
              kind: "to",
              values: { x: 200 },
              duration: 10,
              start: { time: conflictStart },
              overwrite: "error",
            },
          ],
        },
      });

      expect(() =>
        bindTimelineProgram(program, {
          capabilities: new Set(program.requirements),
          targetRegistry: {
            hero: { handle: { x: 0 }, identity: "hero" },
          },
          channelRegistry: { "transform.x": makeAdapter("x") },
        }),
      ).toThrow(/steps\[1\].*steps\[0\].*transform\.x/);
    },
  );

  it("fails closed when overwrite disjointness depends on an infinite domain", () => {
    const program = compilePortableGsapAnimation({
      id: "infinite-overwrite-error",
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
                values: { x: 100 },
                duration: 50,
                repeat: "infinite",
                repeatDelay: 50,
              },
              {
                kind: "to",
                values: { x: 200 },
                duration: 10,
                start: { time: 75 },
                overwrite: "error",
              },
            ],
          },
        ],
      },
    });

    expect(() =>
      bindTimelineProgram(program, {
        capabilities: new Set(program.requirements),
        targetRegistry: {
          hero: { handle: { x: 0 }, identity: "hero" },
        },
        channelRegistry: { "transform.x": makeAdapter("x") },
      }),
    ).toThrow(/cannot prove disjointness.*infinite/i);
  });

  it.each([
    ["exact occurrence boundary", 50],
    ["middle of repeat gap", 75],
  ])("allows overwrite error clips at a disjoint %s", (name, start) => {
    const program = compilePortableGsapAnimation({
      id: `repeat-gap-disjoint-${name.replaceAll(" ", "-")}`,
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        steps: [
          {
            kind: "to",
            values: { x: 10 },
            duration: 50,
            repeat: 1,
            repeatDelay: 50,
          },
          {
            kind: "to",
            values: { x: 20 },
            duration: name === "exact occurrence boundary" ? 50 : 25,
            start: { time: start },
            overwrite: "error",
          },
        ],
      },
    });

    expect(() =>
      bindTimelineProgram(program, {
        capabilities: new Set(program.requirements),
        targetRegistry: {
          hero: { handle: { x: 0 }, identity: "hero" },
        },
        channelRegistry: { "transform.x": makeAdapter("x") },
      }),
    ).not.toThrow();
  });

  it("inherits repeat-refresh through a speed domain", () => {
    const program = compilePortableGsapAnimation({
      id: "nested-refresh",
      targetId: "hero",
      type: "update",
      gsap: {
        profile: "portable-v1",
        steps: [
          {
            kind: "sequence",
            repeat: 1,
            repeatRefresh: true,
            steps: [
              {
                kind: "to",
                values: { x: { by: 10 } },
                duration: 100,
                speed: 2,
              },
            ],
          },
        ],
      },
    });
    const target = { x: 0 };
    const instance = bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: { hero: { handle: target, identity: "hero" } },
      channelRegistry: { "transform.x": makeAdapter("x") },
    });
    const sample = (time) =>
      evaluateTimelineInstance(instance, time).values[0].value;

    expect(sample(25)).toBe(5);
    expect(sample(50)).toBe(10);
    expect(sample(75)).toBe(15);
    expect(sample(100)).toBe(20);
  });
});

describe("portable deterministic helpers", () => {
  it("publishes stable FNV-1a and SplitMix64 vectors", () => {
    expect(randomStateHex(fnv1a64(new TextEncoder().encode("hello")))).toBe(
      "0xa430d84680aabd0b",
    );
    const mixed = splitMix64(0n);
    expect(randomStateHex(mixed.state)).toBe("0x9e3779b97f4a7c15");
    expect(randomStateHex(mixed.output)).toBe("0xe220a8397b1dcdaf");
    expect(randomStateHex(deriveRandomState(["a", "bc"]))).not.toBe(
      randomStateHex(deriveRandomState(["ab", "c"])),
    );
    expect(deterministicRandomUnit(["program", "target"], 2)).toBe(
      deterministicRandomUnit(["program", "target"], 2),
    );
  });

  it("evaluates typed math and deterministic random expressions", () => {
    const context = {
      programId: "p",
      sourcePath: "steps[0]",
      targetIdentity: "card-2",
      channel: "transform.x",
      targetIndex: 2,
      targetCount: 4,
      iteration: 0,
      underlying: 10,
      subject: { width: 200 },
    };
    expect(
      evaluateExpression(
        {
          kind: "add",
          left: { kind: "targetIndex" },
          right: { kind: "subjectDimension", axis: "width" },
        },
        context,
      ),
    ).toBe(202);
    const random = {
      kind: "randomNumber",
      min: -10,
      max: 10,
      step: 2,
      seed: "jitter",
    };
    expect(evaluateExpression(random, context)).toBe(
      evaluateExpression(random, context),
    );
  });

  it("assigns independent deterministic draws to random expression nodes", () => {
    const context = {
      programId: "p",
      sourcePath: "steps[0]",
      targetIdentity: "hero",
      channel: "transform.x",
      targetIndex: 0,
      targetCount: 1,
      iteration: 0,
      underlying: 0,
      subject: {},
    };
    const expression = {
      kind: "add",
      left: { kind: "randomNumber", min: 0, max: 1 },
      right: { kind: "randomNumber", min: 0, max: 1 },
    };
    const firstDraw = evaluateExpression(expression.left, context);
    const secondDraw = deterministicRandomUnit([
      context.programId,
      context.sourcePath,
      context.targetIdentity,
      context.channel,
      context.iteration,
      "",
      1,
    ]);
    const combined = evaluateExpression(expression, context);

    expect(secondDraw).not.toBe(firstDraw);
    expect(combined).toBeCloseTo(firstDraw + secondDraw, 15);
    expect(evaluateExpression(expression, context)).toBe(combined);
  });

  it("applies modifier pipelines in authored order", () => {
    expect(
      applyModifiers(17.6, [
        { kind: "snap", increment: 5 },
        { kind: "clamp", min: 0, max: 18 },
      ]),
    ).toBe(18);
    expect(
      applyModifiers(17.6, [
        { kind: "clamp", min: 0, max: 18 },
        { kind: "snap", increment: 5 },
      ]),
    ).toBe(20);
    expect(applyModifiers(-1, [{ kind: "wrap", min: 0, max: 10 }])).toBe(9);
    expect(applyModifiers(12, [{ kind: "wrapYoyo", min: 0, max: 10 }])).toBe(8);
  });

  it("calculates deterministic stagger offsets for all 1D origins", () => {
    expect(calculateStaggerOffsets(4, { each: 10, from: "start" })).toEqual([
      0, 10, 20, 30,
    ]);
    expect(calculateStaggerOffsets(4, { each: 10, from: "end" })).toEqual([
      30, 20, 10, 0,
    ]);
    expect(calculateStaggerOffsets(4, { amount: 100, from: "center" })).toEqual(
      [100, 0, 0, 100],
    );
    expect(calculateStaggerOffsets(5, { each: 10, from: "edges" })).toEqual([
      0, 10, 20, 10, 0,
    ]);
    expect(
      calculateStaggerOffsets(
        6,
        { amount: 50, from: "random" },
        { seedParts: ["x"] },
      ),
    ).toEqual(
      calculateStaggerOffsets(
        6,
        { amount: 50, from: "random" },
        { seedParts: ["x"] },
      ),
    );
  });
});
