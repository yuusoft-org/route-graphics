import { canonicalizeProgram } from "./canonicalizeProgram.js";
import { compileTransitionAnimation } from "./compileLegacyTransition.js";
import { compileLegacyTweenAnimation } from "./compileLegacyTween.js";
import { compilePortableGsapAnimation } from "./compilePortableGsap.js";

export const compileAnimationTimelineProgram = (animation, options) => {
  if (animation?.type === "update") {
    return animation.gsap
      ? compilePortableGsapAnimation(animation, options)
      : compileLegacyTweenAnimation(animation, options);
  }
  if (animation?.type === "transition") {
    return compileTransitionAnimation(animation, options);
  }
  throw new Error(
    "Timeline inspection requires an update or transition animation.",
  );
};

const toVisualization = (program) => ({
  timeUnit: program.timeUnit,
  duration: program.duration,
  marks: program.debug?.marks ?? {},
  domains: Object.entries(program.domains).map(([id, domain]) => ({
    id,
    parent: domain.parent,
    start: domain.start,
    cycleDuration: domain.cycleDuration,
    iterations: domain.iterations,
    iterationGap: domain.iterationGap,
    direction: domain.direction,
    rate: domain.rate,
  })),
  lanes: program.clipTemplates.map((clip) => ({
    id: clip.id,
    sourcePath: clip.sourcePath,
    targetQuery: clip.targets,
    channel: clip.channel,
    domain: clip.domain,
    start: clip.start,
    duration: clip.duration,
    priority: clip.priority,
    overwrite: clip.overwrite ?? "none",
  })),
  events: program.events.map((event) => ({
    id: event.id,
    sourcePath: event.sourcePath,
    domain: event.domain,
    time: event.time,
    name: event.name,
    direction: event.direction,
    occurrence: event.occurrence,
  })),
});

export const inspectTimelineProgram = (program) => ({
  schema: "route.timeline-inspection/v1",
  summary: {
    programId: program.programId,
    ownerId: program.ownerId,
    frontend: program.debug?.frontend ?? "unknown",
    profile: program.debug?.profile ?? null,
    duration: program.duration,
    timeUnit: program.timeUnit,
    targetQueryCount: Object.keys(program.targetQueries).length,
    domainCount: Object.keys(program.domains).length,
    clipCount: program.clipTemplates.length,
    eventCount: program.events.length,
  },
  requirements: [...program.requirements],
  targetQueries: program.targetQueries,
  semanticSignature: canonicalizeProgram(program),
  visualization: toVisualization(program),
  program,
});
