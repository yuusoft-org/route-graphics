export const TIMELINE_SCHEMA = "route.timeline/v1";
export const TIMELINE_TIME_UNIT = "milliseconds";
export const PORTABLE_GSAP_PROFILE = "portable-v1";
export const MAX_SAFE_TIME_MS = Number.MAX_SAFE_INTEGER;
export const MAX_REPEAT_REFRESH_ITERATIONS = 10_000;

// A conforming portable-v1 backend may support more, but not less. The JS
// runtime deliberately leaves headroom above the portable floor while still
// rejecting accidental expansion before activation.
export const PORTABLE_V1_MINIMUM_LIMITS = Object.freeze({
  targetQueries: 256,
  domains: 256,
  clipTemplates: 4_096,
  events: 1_024,
  resolvedTargets: 4_096,
  boundTracks: 16_384,
  eventDeliveriesPerOperation: 10_000,
});

export const JS_TIMELINE_LIMITS = Object.freeze({
  targetQueries: 1_024,
  domains: 1_024,
  clipTemplates: 10_000,
  events: 10_000,
  resolvedTargets: 10_000,
  boundTracks: 100_000,
  eventDeliveriesPerOperation: 100_000,
});

export const FILL_MODES = Object.freeze([
  "none",
  "forwards",
  "backwards",
  "both",
]);

export const COMPOSITE_MODES = Object.freeze(["replace", "add", "multiply"]);

export const OVERWRITE_MODES = Object.freeze(["auto", "all", "none", "error"]);

export const DOMAIN_DIRECTIONS = Object.freeze([
  "forward",
  "reverse",
  "alternate",
]);
