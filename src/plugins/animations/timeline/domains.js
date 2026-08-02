import { DOMAIN_DIRECTIONS } from "./constants.js";
import {
  assertFiniteNumber,
  assertSafeTime,
  checkedTimeAdd,
  checkedTimeMultiply,
} from "./validation.js";

const directions = new Set(DOMAIN_DIRECTIONS);

export const validateDomain = (domain, path = "domain") => {
  assertSafeTime(domain.start, `${path}.start`);
  assertSafeTime(domain.cycleDuration, `${path}.cycleDuration`);
  assertSafeTime(domain.iterationGap ?? 0, `${path}.iterationGap`);
  assertFiniteNumber(domain.rate ?? 1, `${path}.rate`);
  if ((domain.rate ?? 1) <= 0) {
    throw new Error(`${path}.rate must be greater than zero.`);
  }
  if (!directions.has(domain.direction ?? "forward")) {
    throw new Error(`${path}.direction is not supported.`);
  }
  if (
    domain.iterations !== null &&
    (!Number.isSafeInteger(domain.iterations) || domain.iterations <= 0)
  ) {
    throw new Error(
      `${path}.iterations must be a positive safe integer or null.`,
    );
  }
  if (domain.iterations !== 1 && domain.cycleDuration === 0) {
    throw new Error(`${path} cannot repeat a zero-duration cycle.`);
  }
  return domain;
};

export const getDomainLocalDuration = (domain) => {
  validateDomain(domain);
  if (domain.iterations === null) return Infinity;
  const cycles = checkedTimeMultiply(
    domain.cycleDuration,
    domain.iterations,
    "domain.duration.cycles",
  );
  const gaps = checkedTimeMultiply(
    domain.iterationGap ?? 0,
    Math.max(domain.iterations - 1, 0),
    "domain.duration.gaps",
  );
  return checkedTimeAdd(cycles, gaps, "domain.duration");
};

export const getDomainParentDuration = (domain) => {
  const localDuration = getDomainLocalDuration(domain);
  if (localDuration === Infinity) return Infinity;
  const duration = Math.ceil(localDuration / (domain.rate ?? 1));
  if (!Number.isSafeInteger(duration)) {
    throw new Error("domain parent duration exceeds JSON-safe integer range.");
  }
  return duration;
};

const getIterationDirection = (direction, iteration) => {
  if (direction === "reverse") return "reverse";
  if (direction === "alternate" && iteration % 2 === 1) return "reverse";
  return "forward";
};

const getEndpoint = (direction, duration) =>
  direction === "reverse" ? 0 : duration;

export const mapDomainTime = (domain, parentTime) => {
  validateDomain(domain);
  assertFiniteNumber(parentTime, "parentTime");

  const rate = domain.rate ?? 1;
  const direction = domain.direction ?? "forward";
  const gap = domain.iterationGap ?? 0;
  const iterations = domain.iterations;
  const cycle = domain.cycleDuration;

  if (parentTime < domain.start) {
    const firstDirection = getIterationDirection(direction, 0);
    return {
      active: false,
      completed: false,
      iteration: 0,
      direction: firstDirection,
      inGap: false,
      localTime: firstDirection === "reverse" ? cycle : 0,
    };
  }

  const elapsed = (parentTime - domain.start) * rate;

  if (cycle === 0) {
    return {
      active: true,
      completed: true,
      iteration: 0,
      direction: getIterationDirection(direction, 0),
      inGap: false,
      localTime: 0,
    };
  }

  const localDuration = getDomainLocalDuration(domain);
  if (localDuration !== Infinity && elapsed >= localDuration) {
    const iteration = iterations - 1;
    const iterationDirection = getIterationDirection(direction, iteration);
    return {
      active: true,
      completed: true,
      iteration,
      direction: iterationDirection,
      inGap: false,
      localTime: getEndpoint(iterationDirection, cycle),
    };
  }

  const occupiedIteration = cycle + gap;
  const iteration = Math.floor(elapsed / occupiedIteration);
  const iterationTime = elapsed - iteration * occupiedIteration;
  const iterationDirection = getIterationDirection(direction, iteration);
  const inGap = iterationTime >= cycle;
  const forwardTime = inGap ? cycle : iterationTime;

  return {
    active: true,
    completed: false,
    iteration,
    direction: iterationDirection,
    inGap,
    localTime:
      iterationDirection === "reverse" ? cycle - forwardTime : forwardTime,
  };
};
