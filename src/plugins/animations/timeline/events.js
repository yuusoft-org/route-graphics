const getIterationDirection = (domain, iteration) => {
  if (domain.direction === "reverse") return "reverse";
  if (domain.direction === "alternate" && iteration % 2 === 1) return "reverse";
  return "forward";
};

const flipDirection = (direction) =>
  direction === "forward" ? "reverse" : "forward";

const combineDirection = (outer, inner) =>
  outer === "reverse" ? flipDirection(inner) : inner;

const liftOccurrences = (
  instance,
  domainId,
  localOccurrences,
  maximumRootTime,
  maximumDeliveries,
) => {
  const domain = instance.domains[domainId];
  const next = [];
  const occupiedCycle = domain.cycleDuration + domain.iterationGap;
  const maximumIterations =
    domain.iterations === null
      ? Math.max(
          0,
          Math.ceil(
            ((maximumRootTime - domain.start) * domain.rate +
              domain.cycleDuration) /
              Math.max(occupiedCycle, 1),
          ),
        )
      : domain.iterations;

  for (let iteration = 0; iteration < maximumIterations; iteration++) {
    const iterationDirection = getIterationDirection(domain, iteration);
    for (const occurrence of localOccurrences) {
      const cycleTime =
        iterationDirection === "reverse"
          ? domain.cycleDuration - occurrence.time
          : occurrence.time;
      const time =
        domain.start + (iteration * occupiedCycle + cycleTime) / domain.rate;
      if (time < 0 || time > maximumRootTime) continue;
      next.push({
        ...occurrence,
        time,
        direction: combineDirection(iterationDirection, occurrence.direction),
        iterationTuple: [iteration, ...occurrence.iterationTuple],
      });
      if (next.length > maximumDeliveries) {
        throw new Error(
          `Timeline event crossing exceeds the delivery limit ${maximumDeliveries}.`,
        );
      }
    }
  }
  return domain.parent === null
    ? next
    : liftOccurrences(
        instance,
        domain.parent,
        next,
        maximumRootTime,
        maximumDeliveries,
      );
};

const directionAllowed = (authored, actual) =>
  authored === "both" || authored === actual;

export const collectTimelineEventCrossings = (
  instance,
  previousTime,
  currentTime,
  {
    seek = false,
    replay = false,
    emittedOnce = new Set(),
    emittedOccurrences = new Set(),
    maximumDeliveries = instance.limits?.eventDeliveriesPerOperation ??
      JS_TIMELINE_LIMITS.eventDeliveriesPerOperation,
  } = {},
) => {
  if (!Number.isSafeInteger(maximumDeliveries) || maximumDeliveries <= 0) {
    throw new Error(
      "Timeline event delivery limit must be a positive safe integer.",
    );
  }
  if (previousTime === currentTime || instance.events.length === 0) return [];
  const forward = currentTime > previousTime;
  const lower = Math.min(previousTime, currentTime);
  const upper = Math.max(previousTime, currentTime);
  const candidates = [];

  for (const event of instance.events) {
    if (seek && (!replay || event.seekPolicy !== "crossed")) continue;
    const occurrences = liftOccurrences(
      instance,
      event.domain,
      [
        {
          time: event.time,
          direction: "forward",
          iterationTuple: [],
        },
      ],
      upper,
      maximumDeliveries,
    );
    for (const occurrence of occurrences) {
      const crossed = forward
        ? occurrence.time > lower && occurrence.time <= upper
        : occurrence.time >= lower && occurrence.time < upper;
      if (!crossed) continue;
      const actualDirection = forward
        ? occurrence.direction
        : flipDirection(occurrence.direction);
      if (!directionAllowed(event.direction, actualDirection)) continue;
      const onceKey = event.id;
      const occurrenceKey = `${event.id}:${occurrence.iterationTuple.join(".")}:${actualDirection}`;
      if (event.occurrence === "once" && emittedOnce.has(onceKey)) continue;
      if (
        event.occurrence === "eachIteration" &&
        emittedOccurrences.has(occurrenceKey)
      ) {
        continue;
      }
      candidates.push({
        ...event,
        resolvedTime: occurrence.time,
        actualDirection,
        iterationTuple: occurrence.iterationTuple,
        onceKey,
        occurrenceKey,
      });
      if (candidates.length > maximumDeliveries) {
        throw new Error(
          `Timeline event crossing exceeds the delivery limit ${maximumDeliveries}.`,
        );
      }
    }
  }

  candidates.sort((left, right) => {
    if (left.resolvedTime !== right.resolvedTime) {
      return forward
        ? left.resolvedTime - right.resolvedTime
        : right.resolvedTime - left.resolvedTime;
    }
    return (left.priority ?? 0) - (right.priority ?? 0);
  });
  return candidates;
};
import { JS_TIMELINE_LIMITS } from "./constants.js";
