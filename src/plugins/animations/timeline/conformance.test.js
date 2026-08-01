import { describe, expect, it } from "vitest";
import vectors from "../../../../conformance/timeline/v1/vectors.json";
import timelineSchema from "../../../../conformance/timeline/v1/timeline-program.schema.json";

import {
  applyModifiers,
  bindTimelineProgram,
  canonicalizeData,
  canonicalizeProgram,
  collectTimelineEventCrossings,
  createGsapTimelineEvaluator,
  deriveRandomState,
  deterministicRandomUnit,
  evaluateExpression,
  evaluateTimelineInstance,
  mapDomainTime,
  randomStateHex,
  sampleEasing,
  segmentPortableGraphemes,
  splitMix64,
  validateTimelineProgram,
} from "./index.js";
import {
  mapReferenceDomainTime,
  sampleReferenceProgram,
} from "../../../../conformance/timeline/v1/reference-evaluator.mjs";

const close = (actual, expected) => expect(actual).toBeCloseTo(expected, 12);

describe("route.timeline/v1 cross-language conformance package", () => {
  it("publishes a closed schema for every semantic program union", () => {
    expect(timelineSchema.properties).toMatchObject({
      targetQueries: { type: "object" },
      domains: { required: ["root"] },
      clipTemplates: { type: "array" },
      events: { type: "array" },
    });
    expect(Object.keys(timelineSchema.$defs)).toEqual(
      expect.arrayContaining([
        "timingExpression",
        "targetQuery",
        "stagger",
        "easing",
        "expression",
        "modifier",
        "sampler",
      ]),
    );
  });

  it("matches production and independent reference program samples", () => {
    for (const fixture of vectors.programCases) {
      const program = validateTimelineProgram(fixture.program);
      expect(canonicalizeProgram(program)).toBe(fixture.canonical);
      const target = structuredClone(fixture.mockBindings.targets.hero);
      const instance = bindTimelineProgram(program, {
        capabilities: new Set(program.requirements),
        targetRegistry: {
          hero: { handle: target, identity: "hero" },
        },
        channelRegistry: {
          resolve: (_target, channel) => {
            const property = fixture.mockBindings.channels[channel];
            return {
              property,
              get: (handle) => handle[property],
              apply: (handle, value) => {
                handle[property] = value;
              },
            };
          },
        },
      });
      const gsapEvaluator = createGsapTimelineEvaluator(instance);
      try {
        for (const sample of fixture.samples) {
          const production = Object.fromEntries(
            evaluateTimelineInstance(instance, sample.time).values.map(
              (entry) => [`hero/${entry.channel}`, entry.value],
            ),
          );
          const gsapProduction = Object.fromEntries(
            gsapEvaluator
              .evaluate(sample.time)
              .values.map((entry) => [`hero/${entry.channel}`, entry.value]),
          );
          const reference = sampleReferenceProgram(program, sample.time);
          for (const [key, expected] of Object.entries(sample.values)) {
            close(production[key], expected);
            expect(gsapProduction[key]).toBeCloseTo(expected, 8);
            close(reference[key], expected);
          }
        }
      } finally {
        gsapEvaluator.destroy();
      }
      for (const crossing of fixture.eventCrossings) {
        const events = collectTimelineEventCrossings(
          instance,
          crossing.from,
          crossing.to,
        );
        expect(
          events.map((event) => ({
            name: event.name,
            time: event.resolvedTime,
            direction: event.actualDirection,
            iterations: event.iterationTuple,
          })),
        ).toEqual(crossing.events);
      }
    }
  });

  it("matches domain, easing, expression, modifier, random, and text vectors", () => {
    for (const fixture of vectors.canonicalDataCases) {
      expect(canonicalizeData(fixture.value)).toBe(fixture.canonical);
    }
    for (const fixture of vectors.domainCases) {
      for (const sample of fixture.samples) {
        const { parentTime, ...expected } = sample;
        expect(mapDomainTime(fixture.domain, parentTime)).toMatchObject(
          expected,
        );
        expect(
          mapReferenceDomainTime(fixture.domain, parentTime),
        ).toMatchObject(expected);
      }
    }
    for (const fixture of vectors.easingCases) {
      for (const [input, expected] of fixture.samples) {
        close(sampleEasing(fixture.easing, input), expected);
      }
    }
    for (const fixture of vectors.expressionCases) {
      expect(evaluateExpression(fixture.expression, fixture.context)).toBe(
        fixture.result,
      );
    }
    for (const fixture of vectors.modifierCases) {
      expect(applyModifiers(fixture.input, fixture.modifiers)).toBe(
        fixture.result,
      );
    }
    for (const fixture of vectors.randomCases) {
      let state = deriveRandomState(fixture.seedParts);
      expect(randomStateHex(state)).toBe(fixture.initialState);
      fixture.outputs.forEach((expected, index) => {
        const mixed = splitMix64(state);
        state = mixed.state;
        expect(randomStateHex(mixed.state)).toBe(expected.state);
        expect(randomStateHex(mixed.output)).toBe(expected.bits);
        expect(deterministicRandomUnit(fixture.seedParts, index)).toBe(
          expected.unit,
        );
      });
    }
    for (const fixture of vectors.textSegmentationCases) {
      expect(
        segmentPortableGraphemes(fixture.text).map(({ start, end }) => ({
          start,
          end,
        })),
      ).toEqual(fixture.graphemes);
    }
  });
});
