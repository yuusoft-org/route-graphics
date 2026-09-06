import { JS_TIMELINE_LIMITS } from "./constants.js";

const getIterationDirection = (domain, iteration) => {
  if (domain.direction === "reverse") return "reverse";
  if (domain.direction === "alternate" && iteration % 2 === 1) return "reverse";
  return "forward";
};

const flipDirection = (direction) =>
  direction === "forward" ? "reverse" : "forward";

const combineDirection = (outer, inner) =>
  outer === "reverse" ? flipDirection(inner) : inner;

const getDomainPath = (instance, domainId) => {
  const path = [];
  let current = domainId;
  while (current !== null) {
    path.push(current);
    current = instance.domains[current].parent;
  }
  return path.reverse();
};

const liftOccurrences = (
  instance,
  domainId,
  localOccurrence,
  lowerRootTime,
  upperRootTime,
  forward,
  includeInitial,
  maximumDeliveries,
  { occurrenceFilter = () => true, stopAfterFirst = false } = {},
) => {
  const path = getDomainPath(instance, domainId);
  const occurrences = [];
  let stopped = false;
  const crossesRootTime = (time) =>
    forward
      ? (includeInitial && time === lowerRootTime) ||
        (time > lowerRootTime && time <= upperRootTime)
      : time >= lowerRootTime && time < upperRootTime;

  const visit = ({
    pathIndex,
    parentLower,
    parentUpper,
    parentToRoot,
    direction,
    iterationTuple,
  }) => {
    if (stopped) return;
    const domain = instance.domains[path[pathIndex]];
    const unbounded = domain.parent === null && instance.unboundedRoot;
    // An infinite descendant makes the root's cycle duration bookkeeping,
    // rather than a clipping boundary. Only the current crossing bounds it.
    const cycleDuration = unbounded ? Infinity : domain.cycleDuration;
    const occupiedCycle = domain.cycleDuration + domain.iterationGap;
    const scaledLower = (parentLower - domain.start) * domain.rate;
    const scaledUpper = (parentUpper - domain.start) * domain.rate;
    let firstIteration;
    let lastIteration;
    if (unbounded || occupiedCycle === 0) {
      firstIteration = 0;
      lastIteration = 0;
    } else {
      firstIteration = Math.max(
        0,
        Math.ceil((scaledLower - domain.cycleDuration) / occupiedCycle),
      );
      lastIteration = Math.floor(scaledUpper / occupiedCycle);
    }
    if (domain.iterations !== null) {
      lastIteration = Math.min(lastIteration, domain.iterations - 1);
    }
    if (lastIteration < firstIteration) return;

    const iterationsIncreaseInCrossingDirection =
      (direction === "forward") === forward;
    const firstVisitedIteration = iterationsIncreaseInCrossingDirection
      ? firstIteration
      : lastIteration;
    const finalVisitedIteration = iterationsIncreaseInCrossingDirection
      ? lastIteration
      : firstIteration;
    const iterationStep = iterationsIncreaseInCrossingDirection ? 1 : -1;
    for (
      let iteration = firstVisitedIteration;
      iterationsIncreaseInCrossingDirection
        ? iteration <= finalVisitedIteration
        : iteration >= finalVisitedIteration;
      iteration += iterationStep
    ) {
      const iterationOffset = iteration * occupiedCycle;
      const activeStart = domain.start + iterationOffset / domain.rate;
      const activeEnd =
        domain.start + (iterationOffset + cycleDuration) / domain.rate;
      const intersectionStart = Math.max(parentLower, activeStart);
      const intersectionEnd = Math.min(parentUpper, activeEnd);
      if (intersectionStart > intersectionEnd) continue;

      const iterationDirection = getIterationDirection(domain, iteration);
      const toParentTime = (localTime) => {
        const cycleTime =
          iterationDirection === "reverse"
            ? domain.cycleDuration - localTime
            : localTime;
        return domain.start + (iterationOffset + cycleTime) / domain.rate;
      };
      const toLocalTime = (parentTime) => {
        const cycleTime =
          (parentTime - domain.start) * domain.rate - iterationOffset;
        return iterationDirection === "reverse"
          ? domain.cycleDuration - cycleTime
          : cycleTime;
      };
      const firstLocal = toLocalTime(intersectionStart);
      const lastLocal = toLocalTime(intersectionEnd);
      const localLower = Math.max(0, Math.min(firstLocal, lastLocal));
      const localUpper = Math.min(
        cycleDuration,
        Math.max(firstLocal, lastLocal),
      );
      const toRoot = (localTime) => parentToRoot(toParentTime(localTime));
      const nextDirection = combineDirection(direction, iterationDirection);
      const nextTuple = [...iterationTuple, iteration];

      if (pathIndex < path.length - 1) {
        visit({
          pathIndex: pathIndex + 1,
          parentLower: localLower,
          parentUpper: localUpper,
          parentToRoot: toRoot,
          direction: nextDirection,
          iterationTuple: nextTuple,
        });
        if (stopped) return;
        continue;
      }

      if (
        localOccurrence.time < localLower ||
        localOccurrence.time > localUpper
      ) {
        continue;
      }
      const rootTime = toRoot(localOccurrence.time);
      if (!crossesRootTime(rootTime)) continue;
      const occurrence = {
        ...localOccurrence,
        time: rootTime,
        direction: combineDirection(nextDirection, localOccurrence.direction),
        iterationTuple: nextTuple,
      };
      if (!occurrenceFilter(occurrence)) continue;
      occurrences.push(occurrence);
      if (stopAfterFirst) {
        stopped = true;
        return;
      }
      if (occurrences.length > maximumDeliveries) {
        throw new Error(
          `Timeline event crossing exceeds the delivery limit ${maximumDeliveries}.`,
        );
      }
    }
  };

  visit({
    pathIndex: 0,
    parentLower: lowerRootTime,
    parentUpper: upperRootTime,
    parentToRoot: (time) => time,
    direction: "forward",
    iterationTuple: [],
  });
  return occurrences;
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
    includeInitial = false,
    maximumDeliveries = instance.limits?.eventDeliveriesPerOperation ??
      JS_TIMELINE_LIMITS.eventDeliveriesPerOperation,
  } = {},
) => {
  if (!Number.isSafeInteger(maximumDeliveries) || maximumDeliveries <= 0) {
    throw new Error(
      "Timeline event delivery limit must be a positive safe integer.",
    );
  }
  if (
    (previousTime === currentTime && !includeInitial) ||
    instance.events.length === 0
  ) {
    return [];
  }
  const forward = includeInitial || currentTime > previousTime;
  const lower = Math.min(previousTime, currentTime);
  const upper = Math.max(previousTime, currentTime);
  const candidates = [];
  const selectedOnce = new Set();

  for (const event of instance.events) {
    if (seek && (!replay || event.seekPolicy !== "crossed")) continue;
    if (event.occurrence === "once" && emittedOnce.has(event.id)) continue;
    const occurrences = liftOccurrences(
      instance,
      event.domain,
      {
        time: event.time,
        direction: "forward",
        iterationTuple: [],
      },
      lower,
      upper,
      forward,
      includeInitial,
      maximumDeliveries,
      {
        occurrenceFilter: (occurrence) =>
          directionAllowed(
            event.direction,
            forward
              ? occurrence.direction
              : flipDirection(occurrence.direction),
          ),
        stopAfterFirst: event.occurrence === "once",
      },
    );
    for (const occurrence of occurrences) {
      const actualDirection = forward
        ? occurrence.direction
        : flipDirection(occurrence.direction);
      const onceKey = event.id;
      const occurrenceKey = `${event.id}:${occurrence.iterationTuple.join(".")}:${actualDirection}`;
      if (
        event.occurrence === "once" &&
        (emittedOnce.has(onceKey) || selectedOnce.has(onceKey))
      ) {
        continue;
      }
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
      if (event.occurrence === "once") selectedOnce.add(onceKey);
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
