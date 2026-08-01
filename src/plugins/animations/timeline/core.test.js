import { describe, expect, it } from "vitest";
import {
  canonicalizeData,
  canonicalizeProgram,
  bindTimelineProgram,
  checkedTimeAdd,
  evaluateTimelineInstance,
  getEasingCriticalProgresses,
  getDomainLocalDuration,
  getDomainParentDuration,
  interpolateTimelineValues,
  mapDomainTime,
  normalizeEasing,
  sampleDiscreteValue,
  sampleEasing,
  roundTimelineInteger,
  validateTimelineProgram,
} from "./index.js";
import {
  getEasingFunction,
  SUPPORTED_EASING_NAMES,
} from "../../../util/animationTimeline.js";

describe("timeline canonicalization", () => {
  it("sorts semantic object keys, normalizes negative zero, and omits debug", () => {
    const program = {
      schema: "route.timeline/v1",
      z: -0,
      nested: { z: 2, a: 1 },
      debug: { sourcePath: "animations[0]" },
    };

    expect(canonicalizeProgram(program)).toBe(
      '{"nested":{"a":1,"z":2},"schema":"route.timeline/v1","z":0}',
    );
  });

  it("rejects non-finite, cyclic, and lone-surrogate data", () => {
    expect(() => canonicalizeData({ value: Infinity })).toThrow(/finite/);

    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeData(cyclic)).toThrow(/cyclic/);
    expect(() => canonicalizeData({ value: "\ud800" })).toThrow(/surrogate/);
  });

  it("rejects checked time overflow", () => {
    expect(() => checkedTimeAdd(Number.MAX_SAFE_INTEGER, 1)).toThrow(
      /JSON-safe/,
    );
  });
});

describe("timeline values and easings", () => {
  it("interpolates scalar and fixed numeric shapes with exact endpoints", () => {
    expect(interpolateTimelineValues(10, 20, 0)).toBe(10);
    expect(interpolateTimelineValues(10, 20, 0.25)).toBe(12.5);
    expect(interpolateTimelineValues([0, 10], [10, 30], 0.5)).toEqual([5, 20]);
    expect(interpolateTimelineValues([0, 10], [10, 30], 1)).toEqual([10, 30]);
    expect(() => interpolateTimelineValues([0], [1, 2], 0.5)).toThrow(
      /matching numeric shapes/,
    );
  });

  it("switches discrete values only at the endpoint", () => {
    expect(sampleDiscreteValue("a", "b", 0.999)).toBe("a");
    expect(sampleDiscreteValue("a", "b", 1)).toBe("b");
  });

  it("rounds integer channels symmetrically at half values", () => {
    expect(roundTimelineInteger(1.5)).toBe(2);
    expect(roundTimelineInteger(-1.5)).toBe(-2);
    expect(roundTimelineInteger(-1.49)).toBe(-1);
  });

  it.each(SUPPORTED_EASING_NAMES)(
    "matches the legacy %s easing across dense samples",
    (name) => {
      const legacy = getEasingFunction(name);
      for (let index = 0; index <= 100; index++) {
        const progress = index / 100;
        expect(sampleEasing(name, progress)).toBeCloseTo(legacy(progress), 12);
      }
    },
  );

  it("normalizes GSAP power aliases and validates sampled curves", () => {
    expect(normalizeEasing("power2.out")).toEqual({
      kind: "power",
      exponent: 3,
      direction: "out",
    });
    expect(() =>
      normalizeEasing({
        kind: "sampled",
        samples: [
          [0, 0],
          [0.8, 1],
          [0.7, 1],
          [1, 1],
        ],
      }),
    ).toThrow(/strictly increasing/);
  });

  it("reports sampled knots and analytic easing extrema", () => {
    expect(
      getEasingCriticalProgresses({
        kind: "sampled",
        samples: [
          [0, 0],
          [0.1, 2],
          [0.25, 0.5],
          [1, 1],
        ],
      }),
    ).toEqual([0.1, 0.25]);

    for (const easing of [
      "easeInOutBack",
      "easeOutBounce",
      "easeOutElastic",
      { kind: "cubicBezier", points: [0.25, 2, 0.75, -1] },
    ]) {
      const critical = [0, ...getEasingCriticalProgresses(easing), 1].map(
        (progress) => sampleEasing(easing, progress),
      );
      const dense = Array.from({ length: 10_001 }, (_, index) =>
        sampleEasing(easing, index / 10_000),
      );
      expect(Math.min(...critical)).toBeLessThanOrEqual(
        Math.min(...dense) + 1e-4,
      );
      expect(Math.max(...critical)).toBeGreaterThanOrEqual(
        Math.max(...dense) - 1e-4,
      );
    }
  });
});

describe("timeline time domains", () => {
  const repeated = {
    start: 10,
    cycleDuration: 100,
    iterations: 3,
    iterationGap: 20,
    direction: "forward",
    rate: 1,
  };

  it("computes finite occupied and speed-projected duration", () => {
    expect(getDomainLocalDuration(repeated)).toBe(340);
    expect(getDomainParentDuration({ ...repeated, rate: 3 })).toBe(114);
  });

  it("maps before-start, cycle, gap, repeat boundary, and finite end", () => {
    expect(mapDomainTime(repeated, 5)).toMatchObject({
      active: false,
      localTime: 0,
    });
    expect(mapDomainTime(repeated, 60)).toMatchObject({
      iteration: 0,
      localTime: 50,
      inGap: false,
    });
    expect(mapDomainTime(repeated, 115)).toMatchObject({
      iteration: 0,
      localTime: 100,
      inGap: true,
    });
    expect(mapDomainTime(repeated, 130)).toMatchObject({
      iteration: 1,
      localTime: 0,
      inGap: false,
    });
    expect(mapDomainTime(repeated, 350)).toMatchObject({
      iteration: 2,
      localTime: 100,
      completed: true,
    });
  });

  it("maps alternate yoyo endpoints and infinite exact boundaries", () => {
    const alternate = { ...repeated, direction: "alternate" };
    expect(mapDomainTime(alternate, 130)).toMatchObject({
      iteration: 1,
      direction: "reverse",
      localTime: 100,
    });
    expect(mapDomainTime(alternate, 230)).toMatchObject({
      iteration: 1,
      direction: "reverse",
      localTime: 0,
      inGap: true,
    });

    const infinite = {
      ...repeated,
      start: 0,
      iterations: null,
      iterationGap: 0,
    };
    expect(mapDomainTime(infinite, 100)).toMatchObject({
      iteration: 1,
      localTime: 0,
      completed: false,
    });
  });

  it("rejects repeated zero-duration domains", () => {
    expect(() => mapDomainTime({ ...repeated, cycleDuration: 0 }, 0)).toThrow(
      /zero-duration/,
    );
  });
});

describe("TimelineProgram validation", () => {
  const createProgram = () => ({
    schema: "route.timeline/v1",
    timeUnit: "milliseconds",
    programId: "move",
    ownerId: "hero",
    duration: 100,
    requirements: ["channel.transform2d", "target.element"],
    targetQueries: {
      self: { kind: "element", elementId: "hero" },
    },
    schedules: {},
    domains: {
      root: {
        parent: null,
        start: 0,
        cycleDuration: 100,
        iterations: 1,
        iterationGap: 0,
        direction: "forward",
        rate: 1,
        refresh: "never",
      },
    },
    easings: {
      linear: { kind: "linear" },
    },
    clipTemplates: [
      {
        id: "clip-0",
        sourcePath: "animations[0].tween.x.keyframes[0]",
        domain: "root",
        targets: "self",
        fanout: null,
        channel: "transform.x",
        valueType: "scalar",
        start: 0,
        duration: 100,
        sampler: {
          kind: "interpolate",
          from: { kind: "underlying" },
          to: { kind: "constant", value: 100 },
          easing: "linear",
        },
        modifiers: [],
        composite: "replace",
        priority: 0,
        fill: "forwards",
      },
    ],
    events: [],
    debug: { source: "test" },
  });
  const bindProgram = (source, target = { x: 0 }) => {
    const program = validateTimelineProgram(source);
    return bindTimelineProgram(program, {
      capabilities: new Set(program.requirements),
      targetRegistry: { hero: target },
      channelRegistry: {
        "transform.x": {
          get: (handle) => handle.x,
          apply: (handle, value) => {
            handle.x = value;
          },
        },
      },
    });
  };

  it("returns an immutable defensive program copy", () => {
    const source = createProgram();
    const program = validateTimelineProgram(source);

    source.clipTemplates[0].channel = "changed";
    expect(program.clipTemplates[0].channel).toBe("transform.x");
    expect(Object.isFrozen(program)).toBe(true);
    expect(Object.isFrozen(program.clipTemplates[0])).toBe(true);
  });

  it("rejects unknown fields and broken references", () => {
    expect(() =>
      validateTimelineProgram({ ...createProgram(), pixiTarget: {} }),
    ).toThrow(/pixiTarget is not supported/);

    const broken = createProgram();
    broken.clipTemplates[0].targets = "missing";
    expect(() => validateTimelineProgram(broken)).toThrow(/unknown query/);
  });

  it("rejects domain cycles and duplicate clip ids", () => {
    const cyclic = createProgram();
    cyclic.domains.root.parent = "child";
    cyclic.domains.child = {
      ...cyclic.domains.root,
      parent: "root",
    };
    expect(() => validateTimelineProgram(cyclic)).toThrow(/cycle/);

    const duplicated = createProgram();
    duplicated.clipTemplates.push({ ...duplicated.clipTemplates[0] });
    expect(() => validateTimelineProgram(duplicated)).toThrow(/duplicated/);
  });

  it("resolves forward schedule references independent of JSON key order", () => {
    const source = createProgram();
    source.schedules = {
      dependent: {
        end: {
          kind: "add",
          values: [{ kind: "scheduleEnd", schedule: "base" }, 5],
        },
      },
      base: 20,
    };
    source.clipTemplates[0].start = {
      kind: "scheduleEnd",
      schedule: "dependent",
    };

    expect(bindProgram(source).tracks[0].segments[0].start).toBe(25);
  });

  it("rejects unknown and cyclic schedule references explicitly", () => {
    const unknown = createProgram();
    unknown.schedules.a = {
      end: { kind: "scheduleEnd", schedule: "missing" },
    };
    expect(() => validateTimelineProgram(unknown)).toThrow(
      /unknown schedule "missing"/,
    );

    const cyclic = createProgram();
    cyclic.schedules = {
      a: { end: { kind: "scheduleEnd", schedule: "b" } },
      b: { end: { kind: "scheduleEnd", schedule: "a" } },
    };
    expect(() => validateTimelineProgram(cyclic)).toThrow(/schedule cycle/);
  });

  it("captures relative values at direction-mapped reverse-domain times", () => {
    const source = createProgram();
    source.domains.root.direction = "reverse";
    source.clipTemplates[0].fill = "both";
    source.clipTemplates.push({
      ...source.clipTemplates[0],
      id: "clip-1",
      sourcePath: "animations[0].timeline[1]",
      start: 20,
      duration: 10,
      sampler: {
        ...source.clipTemplates[0].sampler,
        from: { kind: "underlying" },
        to: {
          kind: "add",
          left: { kind: "underlying" },
          right: { kind: "constant", value: 10 },
        },
      },
      priority: 1,
      overwrite: "auto",
    });

    const track = bindProgram(source).tracks[0];
    const segment = track.segments[1];
    expect(segment.from).toBe(20);
    expect(segment.to).toBe(30);
    expect(segment.rootStart).toBe(70);
    expect(segment.rootEnd).toBe(80);
    expect(track.segments[0].trimAt).toBe(30);
  });

  it("uses distinct deterministic draws for fromTo endpoints", () => {
    const source = createProgram();
    source.clipTemplates[0].sampler.from = {
      kind: "randomNumber",
      min: 0,
      max: 100,
    };
    source.clipTemplates[0].sampler.to = {
      kind: "randomNumber",
      min: 0,
      max: 100,
    };

    const first = bindProgram(source).tracks[0].segments[0];
    const second = bindProgram(source).tracks[0].segments[0];
    expect(first.from).not.toBe(first.to);
    expect([first.from, first.to]).toEqual([second.from, second.to]);
  });

  it("chains repeatRefresh relatives from the prior track terminal", () => {
    const source = createProgram();
    source.duration = 200;
    source.domains.root = {
      ...source.domains.root,
      cycleDuration: 100,
      iterations: 2,
      refresh: "iteration",
    };
    source.domains["speed-first"] = {
      parent: "root",
      start: 0,
      cycleDuration: 100,
      iterations: 1,
      iterationGap: 0,
      direction: "forward",
      rate: 2,
      refresh: "never",
    };
    source.domains["speed-second"] = {
      ...source.domains["speed-first"],
      start: 50,
    };
    source.clipTemplates[0] = {
      ...source.clipTemplates[0],
      domain: "speed-first",
      duration: 100,
      sampler: {
        ...source.clipTemplates[0].sampler,
        from: { kind: "underlying" },
        to: {
          kind: "add",
          left: { kind: "underlying" },
          right: { kind: "constant", value: 10 },
        },
      },
    };
    source.clipTemplates.push({
      ...source.clipTemplates[0],
      id: "clip-1",
      sourcePath: "animations[0].timeline[1]",
      domain: "speed-second",
      start: 0,
      priority: 1,
    });
    const instance = bindProgram(source);

    expect(evaluateTimelineInstance(instance, 0).values[0].value).toBe(0);
    expect(evaluateTimelineInstance(instance, 50).values[0].value).toBe(10);
    expect(evaluateTimelineInstance(instance, 100).values[0].value).toBe(20);
    expect(evaluateTimelineInstance(instance, 150).values[0].value).toBe(30);
    expect(evaluateTimelineInstance(instance, 200).values[0].value).toBe(40);
  });

  it("rejects invalid root graphs, union references, and segmentation drift", () => {
    const extraRoot = createProgram();
    extraRoot.domains.detached = { ...extraRoot.domains.root };
    expect(() => validateTimelineProgram(extraRoot)).toThrow(
      /eventually reference root/,
    );

    const union = createProgram();
    union.targetQueries.group = { kind: "union", aliases: ["missing"] };
    expect(() => validateTimelineProgram(union)).toThrow(/unknown query/);

    const text = createProgram();
    text.targetQueries.self = {
      kind: "textUnits",
      elementId: "hero",
      unit: "grapheme",
      order: "logical",
      allowEmpty: false,
      segmentation: { standard: "unicode-uax29", version: "16.0.0" },
    };
    expect(() => validateTimelineProgram(text)).toThrow(/17\.0\.0/);
  });

  it("rejects invalid fanout, event priority, and unbounded refresh", () => {
    const fanout = createProgram();
    fanout.clipTemplates[0].fanout = {
      stagger: { each: 10, amount: 20 },
    };
    expect(() => validateTimelineProgram(fanout)).toThrow(/exactly one/);

    const refresh = createProgram();
    refresh.domains.root.refresh = "iteration";
    refresh.domains.root.iterations = null;
    expect(() => validateTimelineProgram(refresh)).toThrow(/infinite domain/);
  });

  it("rejects program and resolved-target resource expansion at their limits", () => {
    const oversizedProgram = createProgram();
    for (let index = 0; index < 1_024; index++) {
      oversizedProgram.targetQueries[`extra-${index}`] = {
        kind: "element",
        elementId: `extra-${index}`,
      };
    }
    expect(() => validateTimelineProgram(oversizedProgram)).toThrow(
      /targetQueries count 1025 exceeds/,
    );

    const ids = Array.from({ length: 4_096 }, (_, index) => `item-${index}`);
    const bindSource = createProgram();
    bindSource.targetQueries.group = { kind: "elements", elementIds: ids };
    bindSource.clipTemplates[0].targets = "group";
    const program = validateTimelineProgram(bindSource);
    const registry = {
      hero: { x: 0 },
      ...Object.fromEntries(ids.map((id) => [id, { x: 0 }])),
    };
    expect(() =>
      bindTimelineProgram(program, {
        capabilities: new Set(program.requirements),
        targetRegistry: registry,
        channelRegistry: {
          "transform.x": {
            get: (target) => target.x,
            apply: (target, value) => {
              target.x = value;
            },
          },
        },
        limits: { resolvedTargets: 4_096 },
      }),
    ).toThrow(/Resolved target count 4097 exceeds/);
  });
});
