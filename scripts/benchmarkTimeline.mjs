import { performance } from "node:perf_hooks";

import {
  applyTimelineFrame,
  bindTimelineProgram,
  compilePortableGsapAnimation,
  createGsapTimelineEvaluator,
} from "../src/plugins/animations/timeline/index.js";

const targetCount = Number.parseInt(process.argv[2] ?? "2000", 10);
const sampleCount = Number.parseInt(process.argv[3] ?? "1000", 10);
if (
  !Number.isSafeInteger(targetCount) ||
  targetCount <= 0 ||
  !Number.isSafeInteger(sampleCount) ||
  sampleCount <= 0
) {
  throw new Error(
    "Usage: benchmarkTimeline.mjs [positive-target-count] [positive-sample-count]",
  );
}

const ids = Array.from({ length: targetCount }, (_, index) => `item-${index}`);
const targets = Object.fromEntries(ids.map((id) => [id, { x: 0, alpha: 1 }]));
const animation = {
  id: "timeline-benchmark",
  targetId: "root",
  type: "update",
  gsap: {
    profile: "portable-v1",
    targets: { items: { elements: ids } },
    steps: [
      { kind: "set", targets: "items", values: { alpha: 0 } },
      {
        kind: "to",
        targets: "items",
        values: { x: 100, alpha: 1 },
        duration: 1000,
        stagger: { amount: 500 },
      },
    ],
  },
};

const compileStart = performance.now();
const program = compilePortableGsapAnimation(animation);
const compileMS = performance.now() - compileStart;

const bindStart = performance.now();
const instance = bindTimelineProgram(program, {
  capabilities: new Set(program.requirements),
  targetRegistry: { root: { x: 0, alpha: 1 }, ...targets },
  channelRegistry: {
    resolve: (_target, channel) => {
      const property = channel === "transform.x" ? "x" : "alpha";
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
const bindMS = performance.now() - bindStart;

const initializeStart = performance.now();
const evaluator = createGsapTimelineEvaluator(instance);
evaluator.evaluate(0);
const initializeMS = performance.now() - initializeStart;

const sampleStart = performance.now();
for (let index = 0; index < sampleCount; index++) {
  const time = (index * 1543) % 1501;
  evaluator.evaluate(time);
}
const sampleMS = performance.now() - sampleStart;

const applyStart = performance.now();
applyTimelineFrame(evaluator.frame);
const applyMS = performance.now() - applyStart;
evaluator.destroy();

process.stdout.write(
  `${JSON.stringify(
    {
      schema: "route.timeline-benchmark/v1",
      targetCount,
      trackCount: instance.tracks.length,
      sampleCount,
      backend: evaluator.backend,
      backendVersion: evaluator.backendVersion,
      milliseconds: {
        compile: compileMS,
        bind: bindMS,
        initialize: initializeMS,
        sampleTotal: sampleMS,
        sampleAverage: sampleMS / sampleCount,
        apply: applyMS,
      },
      memoryBytes: process.memoryUsage().heapUsed,
    },
    null,
    2,
  )}\n`,
);
