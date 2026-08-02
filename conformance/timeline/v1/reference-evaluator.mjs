const directionForIteration = (domain, iteration) =>
  domain.direction === "reverse" ||
  (domain.direction === "alternate" && iteration % 2 === 1)
    ? "reverse"
    : "forward";

export const mapReferenceDomainTime = (domain, parentTime) => {
  if (parentTime < domain.start) {
    const direction = directionForIteration(domain, 0);
    return {
      active: false,
      completed: false,
      iteration: 0,
      direction,
      inGap: false,
      localTime: direction === "reverse" ? domain.cycleDuration : 0,
    };
  }
  const elapsed = (parentTime - domain.start) * domain.rate;
  const occupied = domain.cycleDuration + domain.iterationGap;
  const total =
    domain.iterations === null
      ? Infinity
      : domain.cycleDuration * domain.iterations +
        domain.iterationGap * Math.max(domain.iterations - 1, 0);
  if (elapsed >= total) {
    const iteration = domain.iterations - 1;
    const direction = directionForIteration(domain, iteration);
    return {
      active: true,
      completed: true,
      iteration,
      direction,
      inGap: false,
      localTime: direction === "reverse" ? 0 : domain.cycleDuration,
    };
  }
  const iteration = Math.floor(elapsed / occupied);
  const iterationTime = elapsed - iteration * occupied;
  const direction = directionForIteration(domain, iteration);
  const inGap = iterationTime >= domain.cycleDuration;
  const forwardTime = inGap ? domain.cycleDuration : iterationTime;
  return {
    active: true,
    completed: false,
    iteration,
    direction,
    inGap,
    localTime:
      direction === "reverse"
        ? domain.cycleDuration - forwardTime
        : forwardTime,
  };
};

const evaluateConstant = (expression) => {
  if (expression.kind !== "constant") {
    throw new Error(
      "The independent reference subset accepts constant endpoints only.",
    );
  }
  return expression.value;
};

export const sampleReferenceProgram = (program, time) => {
  const domain = mapReferenceDomainTime(
    program.domains.root,
    Math.max(time, 0),
  );
  const values = {};
  for (const clip of [...program.clipTemplates].sort(
    (left, right) => left.priority - right.priority,
  )) {
    if (!domain.active) continue;
    const from = evaluateConstant(clip.sampler.from);
    const to = evaluateConstant(clip.sampler.to);
    const local = domain.localTime;
    let value;
    if (local < clip.start) continue;
    if (clip.duration === 0 || local >= clip.start + clip.duration) value = to;
    else value = from + (to - from) * ((local - clip.start) / clip.duration);
    values[`${program.ownerId}/${clip.channel}`] = value;
  }
  return values;
};
