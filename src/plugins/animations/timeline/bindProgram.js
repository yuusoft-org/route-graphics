import { getDomainParentDuration } from "./domains.js";
import { JS_TIMELINE_LIMITS, PORTABLE_V1_MINIMUM_LIMITS } from "./constants.js";
import { evaluateExpression } from "./expressions.js";
import { calculateStaggerOffsets } from "./stagger.js";
import { evaluateTimingExpression } from "./timing.js";
import { cloneTimelineValue, validateTimelineValueType } from "./valueTypes.js";
import { validateTimelineProgram } from "./validateProgram.js";
import { sampleBoundTrack } from "./evaluateInstance.js";

const getRegistryValue = (registry, id) =>
  registry instanceof Map ? registry.get(id) : registry?.[id];

const normalizeTarget = (value, fallbackIdentity) => {
  if (value === undefined || value === null) return null;
  if (value.handle !== undefined || value.identity !== undefined) {
    return {
      ...value,
      handle: value.handle ?? value,
      identity: String(value.identity ?? fallbackIdentity),
    };
  }
  return { handle: value, identity: String(fallbackIdentity) };
};

const defaultResolveQuery = (query, alias, context) => {
  switch (query.kind) {
    case "element": {
      const target = normalizeTarget(
        getRegistryValue(context.targetRegistry, query.elementId),
        query.elementId,
      );
      if (!target)
        throw new Error(
          `Target query "${alias}" cannot find "${query.elementId}".`,
        );
      return [target];
    }
    case "elements":
      return query.elementIds.map((id) => {
        const target = normalizeTarget(
          getRegistryValue(context.targetRegistry, id),
          id,
        );
        if (!target)
          throw new Error(`Target query "${alias}" cannot find "${id}".`);
        return target;
      });
    case "textUnits": {
      if (!context.resolveTextUnits) {
        throw new Error(
          `Target query "${alias}" requires text-unit capability.`,
        );
      }
      const values = context
        .resolveTextUnits(query)
        .map((value, index) =>
          normalizeTarget(value, `${query.elementId}:${query.unit}:${index}`),
        );
      if (values.length === 0 && !query.allowEmpty) {
        throw new Error(`Target query "${alias}" resolved no text units.`);
      }
      return values;
    }
    case "transitionSurface":
      return [
        normalizeTarget(
          getRegistryValue(context.transitionTargets, query.surface),
          `transition:${query.surface}`,
        ),
      ].filter(Boolean);
    case "transitionMask":
      return [
        normalizeTarget(
          getRegistryValue(context.transitionTargets, "mask"),
          "transition:mask",
        ),
      ].filter(Boolean);
    case "transitionCompositor":
      return [
        normalizeTarget(
          getRegistryValue(context.transitionTargets, "compositor"),
          "transition:compositor",
        ),
      ].filter(Boolean);
    case "union":
      throw new Error(
        `Target query "${alias}" union must be resolved after its aliases.`,
      );
  }
};

const resolveChannelBinding = (registry, target, channel) => {
  const binding =
    registry?.resolve?.(target, channel) ??
    registry?.resolveChannel?.(target, channel) ??
    getRegistryValue(registry, channel);
  if (!binding) {
    throw new Error(
      `Target "${target.identity}" does not support channel "${channel}".`,
    );
  }
  if (
    typeof binding.get !== "function" ||
    typeof binding.apply !== "function"
  ) {
    throw new Error(`Channel "${channel}" has an invalid adapter contract.`);
  }
  return binding;
};

const validateCapabilities = (program, capabilities) => {
  const supported =
    capabilities instanceof Set ? capabilities : new Set(capabilities ?? []);
  const missing = program.requirements.filter(
    (requirement) => !supported.has(requirement),
  );
  if (missing.length > 0) {
    throw new Error(
      `Timeline backend is missing capabilities: ${missing.join(", ")}.`,
    );
  }
};

const resolveSchedules = (program, timingContext) => {
  const visiting = new Set();
  const resolveExpressionDependencies = (expression) => {
    if (!expression || typeof expression !== "object") return;
    if (expression.kind === "scheduleEnd") {
      resolveSchedule(expression.schedule);
      return;
    }
    for (const child of Object.values(expression)) {
      if (child && typeof child === "object") {
        resolveExpressionDependencies(child);
      }
    }
  };
  const resolveSchedule = (id) => {
    if (timingContext.scheduleEnds.has(id)) {
      return timingContext.scheduleEnds.get(id);
    }
    if (!Object.prototype.hasOwnProperty.call(program.schedules, id)) {
      throw new Error(`Schedule "${id}" is not defined.`);
    }
    if (visiting.has(id)) {
      throw new Error(`Schedule "${id}" contains a dependency cycle.`);
    }
    visiting.add(id);
    const schedule = program.schedules[id];
    const expression = typeof schedule === "number" ? schedule : schedule.end;
    resolveExpressionDependencies(expression);
    const value = evaluateTimingExpression(
      expression,
      timingContext,
      `schedules.${id}.end`,
    );
    timingContext.scheduleEnds.set(id, value);
    visiting.delete(id);
    return value;
  };
  for (const id of Object.keys(program.schedules)) {
    resolveSchedule(id);
  }
};

const getTrackKey = (target, channel) => `${target.identity}\u0000${channel}`;

const getIterationDirection = (domain, iteration) => {
  if (domain.direction === "reverse") return "reverse";
  if (domain.direction === "alternate" && iteration % 2 === 1) {
    return "reverse";
  }
  return "forward";
};

const getParentTimeForDomainLocal = (domain, localTime, iteration = 0) => {
  const direction = getIterationDirection(domain, iteration);
  const forwardTime =
    direction === "reverse" ? domain.cycleDuration - localTime : localTime;
  const iterationOffset =
    iteration * (domain.cycleDuration + domain.iterationGap);
  return domain.start + (iterationOffset + forwardTime) / domain.rate;
};

const getRootTimeForDomainLocal = (
  domains,
  domainId,
  localTime,
  occurrenceIterations = new Map(),
) => {
  let result = localTime;
  let currentId = domainId;
  while (currentId !== null) {
    const current = domains[currentId];
    result = getParentTimeForDomainLocal(
      current,
      result,
      occurrenceIterations.get(currentId) ?? 0,
    );
    currentId = current.parent;
  }
  return result;
};

const getClosestCommonDomain = (domains, leftDomainId, rightDomainId) => {
  const rightAncestors = new Set();
  let currentId = rightDomainId;
  while (currentId !== null) {
    rightAncestors.add(currentId);
    currentId = domains[currentId].parent;
  }
  currentId = leftDomainId;
  while (currentId !== null) {
    if (rightAncestors.has(currentId)) return currentId;
    currentId = domains[currentId].parent;
  }
  throw new Error("Timeline domains must share the root domain.");
};

const getTimeInAncestorDomain = (
  domains,
  domainId,
  localTime,
  ancestorDomainId,
) => {
  let result = localTime;
  let currentId = domainId;
  while (currentId !== ancestorDomainId) {
    const domain = domains[currentId];
    result = getParentTimeForDomainLocal(domain, result);
    currentId = domain.parent;
  }
  return result;
};

const getRefreshDomainId = (domains, domainId) => {
  let currentId = domainId;
  while (currentId !== null) {
    if (domains[currentId].refresh === "iteration") return currentId;
    currentId = domains[currentId].parent;
  }
  return null;
};

const intervalsOverlap = (leftStart, leftEnd, rightStart, rightEnd) => {
  if (leftStart === leftEnd) {
    return (
      leftStart === rightStart ||
      (leftStart > rightStart && leftStart < rightEnd)
    );
  }
  if (rightStart === rightEnd) {
    return (
      rightStart === leftStart ||
      (rightStart > leftStart && rightStart < leftEnd)
    );
  }
  return leftStart < rightEnd && rightStart < leftEnd;
};

const expressionContainsKind = (expression, kind) => {
  if (!expression || typeof expression !== "object") return false;
  if (expression.kind === kind) return true;
  return Object.values(expression).some((value) =>
    Array.isArray(value)
      ? value.some((item) => expressionContainsKind(item, kind))
      : expressionContainsKind(value, kind),
  );
};

const evaluateClipValues = ({
  clip,
  expressionContext,
  underlying,
  iteration,
}) => {
  const context = { ...expressionContext, underlying, iteration };
  const path = clip.sourcePath ?? clip.id;
  const randomState = { counter: 0 };
  const from = evaluateExpression(
    clip.sampler.from,
    context,
    `${path}.from`,
    randomState,
  );
  const toContext =
    clip.sampler.to.kind === "underlying"
      ? context
      : { ...context, underlying: from };
  const to = evaluateExpression(
    clip.sampler.to,
    toContext,
    `${path}.to`,
    randomState,
  );
  validateTimelineValueType(from, clip.valueType, `${path}.from`);
  validateTimelineValueType(to, clip.valueType, `${path}.to`);
  return { from, to };
};

const configureTrackRefreshResolvers = (instance, track) => {
  const groups = new Map();
  for (const segment of track.segments) {
    if (!segment.refreshTemplate) continue;
    if (!groups.has(segment.refreshDomain)) {
      groups.set(segment.refreshDomain, []);
    }
    groups.get(segment.refreshDomain).push(segment);
  }

  for (const [refreshDomainId, segments] of groups) {
    const refreshDomain = instance.domains[refreshDomainId];
    const step = refreshDomain.direction === "alternate" ? 2 : 1;
    const terminalCache = new Map();
    const resolving = new Set();
    const getRefreshIteration = (iteration) =>
      refreshDomain.direction === "alternate"
        ? iteration - (iteration % 2)
        : iteration;

    const ensureIteration = (iteration) => {
      if (segments[0].refreshTemplate.valueCache.has(iteration)) return;
      if (resolving.has(iteration)) {
        throw new Error(
          `Repeat-refresh recurrence for track "${track.channel}" contains a cycle.`,
        );
      }
      resolving.add(iteration);
      const previousIteration = iteration - step;
      ensureIteration(previousIteration);
      const iterationBase = getTerminal(previousIteration);
      const occurrenceIterations = new Map([[refreshDomainId, iteration]]);

      for (const segment of segments) {
        const captureRootTime = getRootTimeForDomainLocal(
          instance.domains,
          segment.domain,
          segment.start,
          occurrenceIterations,
        );
        const underlying = sampleBoundTrack(instance, track, captureRootTime, {
          maximumPriority: segment.priority - 1,
          baseValue: iterationBase,
          // Capture the value immediately before this clip's overwrite takes
          // effect. Later binding already trimmed the earlier segment at this
          // exact boundary, but repeat-refresh must see its terminal value.
          ignoreTrimsAtOrAfterPriority: segment.priority,
        });
        const values = evaluateClipValues({
          clip: segment.refreshTemplate.clip,
          expressionContext: segment.refreshTemplate.expressionContext,
          underlying,
          iteration,
        });
        segment.refreshTemplate.valueCache.set(iteration, values);
      }
      resolving.delete(iteration);
    };

    const getTerminal = (iteration) => {
      if (terminalCache.has(iteration)) {
        return cloneTimelineValue(terminalCache.get(iteration));
      }
      ensureIteration(iteration);
      const previousIteration = iteration - step;
      const iterationBase =
        iteration === 0 ? track.baseValue : getTerminal(previousIteration);
      const terminalIteration =
        refreshDomain.direction === "alternate" ? iteration + 1 : iteration;
      const terminalDirection = getIterationDirection(
        refreshDomain,
        terminalIteration,
      );
      const terminalLocalTime =
        terminalDirection === "reverse" ? 0 : refreshDomain.cycleDuration;
      const occurrenceIterations = new Map([
        [refreshDomainId, terminalIteration],
      ]);
      const rootTime = getRootTimeForDomainLocal(
        instance.domains,
        refreshDomainId,
        terminalLocalTime,
        occurrenceIterations,
      );
      const domainCache = new Map([
        [
          refreshDomainId,
          {
            active: true,
            completed: true,
            iteration: terminalIteration,
            direction: terminalDirection,
            inGap: false,
            localTime: terminalLocalTime,
          },
        ],
      ]);
      const terminal = sampleBoundTrack(instance, track, rootTime, {
        baseValue: iterationBase,
        domainCache,
      });
      terminalCache.set(iteration, cloneTimelineValue(terminal));
      return cloneTimelineValue(terminal);
    };

    for (const segment of segments) {
      segment.resolveValues = (domainState) => {
        const iteration = getRefreshIteration(domainState.iteration);
        ensureIteration(iteration);
        return segment.refreshTemplate.valueCache.get(iteration);
      };
    }
  }
};

/** Bind a TimelineProgram without mutating renderer state. */
export const bindTimelineProgram = (rawProgram, context) => {
  const program = validateTimelineProgram(rawProgram);
  validateCapabilities(program, context.capabilities);
  const limits = { ...JS_TIMELINE_LIMITS, ...context.limits };
  for (const [name, minimum] of Object.entries(PORTABLE_V1_MINIMUM_LIMITS)) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < minimum) {
      throw new Error(`Timeline limit "${name}" must be at least ${minimum}.`);
    }
  }

  const resolvedTargets = new Map();
  const resolveAlias = (alias, stack = new Set()) => {
    if (resolvedTargets.has(alias)) return resolvedTargets.get(alias);
    if (stack.has(alias))
      throw new Error(`Target query "${alias}" contains a union cycle.`);
    const query = program.targetQueries[alias];
    if (!query)
      throw new Error(`Target query alias "${alias}" is not defined.`);
    stack.add(alias);
    if (query.kind === "union") {
      const targets = query.aliases.flatMap((childAlias) =>
        resolveAlias(childAlias, stack),
      );
      const identities = targets.map(({ identity }) => identity);
      if (new Set(identities).size !== identities.length) {
        throw new Error(
          `Target query "${alias}" resolves duplicate identities.`,
        );
      }
      resolvedTargets.set(alias, targets);
      stack.delete(alias);
      return targets;
    }
    const targets = context.resolveTargetQuery
      ? context.resolveTargetQuery(query, alias)
      : defaultResolveQuery(query, alias, context);
    if (!Array.isArray(targets)) {
      throw new Error(`Target query "${alias}" did not return an array.`);
    }
    const normalized = targets.map((target, index) =>
      normalizeTarget(target, `${alias}:${index}`),
    );
    const identities = normalized.map(({ identity }) => identity);
    if (new Set(identities).size !== identities.length) {
      throw new Error(`Target query "${alias}" returned duplicate identities.`);
    }
    resolvedTargets.set(alias, normalized);
    stack.delete(alias);
    return normalized;
  };
  for (const alias of Object.keys(program.targetQueries)) {
    resolveAlias(alias);
  }
  const uniqueTargetIdentities = new Set(
    [...resolvedTargets.values()].flatMap((targets) =>
      targets.map((target) => target.identity),
    ),
  );
  if (uniqueTargetIdentities.size > limits.resolvedTargets) {
    throw new Error(
      `Resolved target count ${uniqueTargetIdentities.size} exceeds the runtime limit ${limits.resolvedTargets}.`,
    );
  }

  const timingContext = {
    programId: program.programId,
    targetCounts: new Map(
      [...resolvedTargets].map(([alias, targets]) => [alias, targets.length]),
    ),
    childStarts: new Map(),
    childEnds: new Map(),
    scheduleEnds: new Map(),
  };
  resolveSchedules(program, timingContext);

  const domains = Object.fromEntries(
    Object.entries(program.domains).map(([id, domain]) => [
      id,
      {
        ...domain,
        start: evaluateTimingExpression(
          domain.start,
          timingContext,
          `domains.${id}.start`,
        ),
        cycleDuration: evaluateTimingExpression(
          domain.cycleDuration,
          timingContext,
          `domains.${id}.cycleDuration`,
        ),
      },
    ]),
  );
  for (const [id, domain] of Object.entries(domains)) {
    if (domain.iterations !== 1 && domain.cycleDuration === 0) {
      throw new Error(`Domain "${id}" cannot repeat a zero-duration cycle.`);
    }
  }

  const instance = {
    instanceId: `${program.programId}@${context.activationOrdinal ?? 0}`,
    programId: program.programId,
    ownerId: program.ownerId,
    program,
    domains,
    duration:
      program.duration === "infinite"
        ? Infinity
        : getDomainParentDuration(domains.root),
    unboundedRoot:
      program.duration === "infinite" && domains.root.iterations === 1,
    tracks: [],
    events: [],
    resolvedTargets,
    limits: Object.freeze({ ...limits }),
  };
  const tracks = new Map();

  for (const clip of [...program.clipTemplates].sort(
    (left, right) => left.priority - right.priority,
  )) {
    const targets = resolvedTargets.get(clip.targets);
    const offsets = clip.fanout?.stagger
      ? calculateStaggerOffsets(targets.length, clip.fanout.stagger, {
          seedParts: [program.programId, clip.id],
        })
      : targets.map(() => 0);
    const baseStart = evaluateTimingExpression(
      clip.start,
      timingContext,
      `${clip.sourcePath ?? clip.id}.start`,
    );
    const duration = evaluateTimingExpression(
      clip.duration,
      timingContext,
      `${clip.sourcePath ?? clip.id}.duration`,
    );

    targets.forEach((target, targetIndex) => {
      const binding = resolveChannelBinding(
        context.channelRegistry,
        target,
        clip.channel,
      );
      if (binding.valueType && binding.valueType !== clip.valueType) {
        throw new Error(
          `Channel "${clip.channel}" on "${target.identity}" is ${binding.valueType}, not ${clip.valueType}.`,
        );
      }
      const key = getTrackKey(target, clip.channel);
      let track = tracks.get(key);
      if (!track) {
        if (instance.tracks.length >= limits.boundTracks) {
          throw new Error(
            `Bound track count exceeds the runtime limit ${limits.boundTracks}.`,
          );
        }
        const baseValue = binding.get(target.handle, target);
        track = {
          target,
          channel: clip.channel,
          binding,
          baseValue: cloneTimelineValue(baseValue),
          segments: [],
        };
        tracks.set(key, track);
        instance.tracks.push(track);
      }
      const start = baseStart + offsets[targetIndex];
      const captureRootTime = getRootTimeForDomainLocal(
        domains,
        clip.domain,
        start,
      );
      const mappedRootEnd = getRootTimeForDomainLocal(
        domains,
        clip.domain,
        start + duration,
      );
      const rootStart = Math.min(captureRootTime, mappedRootEnd);
      const rootEnd = Math.max(captureRootTime, mappedRootEnd);
      const physicalStartLocal =
        captureRootTime <= mappedRootEnd ? start : start + duration;
      const capturedUnderlying = sampleBoundTrack(
        instance,
        track,
        captureRootTime,
        {
          maximumPriority: clip.priority - 1,
        },
      );

      const overwrite = clip.overwrite ?? "none";
      const earlierTracks =
        overwrite === "all"
          ? instance.tracks.filter(
              (candidate) => candidate.target.identity === target.identity,
            )
          : [track];
      if (overwrite === "error") {
        for (const candidate of earlierTracks) {
          for (const segment of candidate.segments) {
            if (
              intervalsOverlap(
                segment.rootStart,
                segment.rootEnd,
                rootStart,
                rootEnd,
              )
            ) {
              throw new Error(
                `${clip.sourcePath ?? clip.id} conflicts with ${segment.sourcePath ?? segment.id} on target "${target.identity}" channel "${candidate.channel}".`,
              );
            }
          }
        }
      } else if (overwrite === "auto" || overwrite === "all") {
        for (const candidate of earlierTracks) {
          for (const segment of candidate.segments) {
            if (
              segment.priority < clip.priority &&
              (segment.trimRootAt === undefined ||
                rootStart < segment.trimRootAt)
            ) {
              const trimDomain = getClosestCommonDomain(
                domains,
                segment.domain,
                clip.domain,
              );
              segment.trimRootAt = rootStart;
              segment.trimDomain = trimDomain;
              segment.trimmedByPriority = clip.priority;
              segment.trimAt = getTimeInAncestorDomain(
                domains,
                clip.domain,
                physicalStartLocal,
                trimDomain,
              );
            }
          }
        }
      }
      const expressionContext = {
        programId: program.programId,
        sourcePath: clip.sourcePath ?? clip.id,
        targetIdentity: target.identity,
        channel: clip.channel,
        property: binding.property,
        targetIndex,
        targetCount: targets.length,
        iteration: 0,
        subject: target.subject ?? context.getSubject?.(target) ?? {},
        targetState:
          target.targetState ??
          getRegistryValue(context.targetStates, target.identity) ??
          context.getTargetState?.(target),
        underlying: capturedUnderlying,
      };
      const { from, to } = evaluateClipValues({
        clip,
        expressionContext,
        underlying: capturedUnderlying,
        iteration: 0,
      });
      if (
        clip.modifiers.length > 0 &&
        !new Set(["scalar", "angleDegrees", "integer"]).has(clip.valueType)
      ) {
        throw new Error(
          `${clip.sourcePath ?? clip.id} modifiers require a scalar, angle, or integer channel.`,
        );
      }
      const refreshDomainId = getRefreshDomainId(domains, clip.domain);
      const refreshDomain =
        refreshDomainId === null ? null : domains[refreshDomainId];
      const usesIteration =
        expressionContainsKind(clip.sampler.from, "iteration") ||
        expressionContainsKind(clip.sampler.to, "iteration");
      if (usesIteration && refreshDomain === null) {
        throw new Error(
          `${clip.sourcePath ?? clip.id} uses iteration outside repeatRefresh.`,
        );
      }
      track.segments.push({
        id: `${clip.id}@${targetIndex}`,
        sourcePath: clip.sourcePath,
        domain: clip.domain,
        start,
        duration,
        from,
        to,
        easing: program.easings[clip.sampler.easing],
        modifiers: clip.modifiers,
        composite: clip.composite,
        priority: clip.priority,
        fill: clip.fill,
        valueType: clip.valueType,
        rootStart,
        rootEnd,
        ...(refreshDomain
          ? {
              refreshDomain: refreshDomainId,
              refreshTemplate: {
                clip,
                expressionContext,
                valueCache: new Map([[0, { from, to }]]),
              },
            }
          : {}),
      });
    });
  }

  for (const track of instance.tracks) {
    track.segments.sort((left, right) => left.priority - right.priority);
    configureTrackRefreshResolvers(instance, track);
  }
  instance.events = program.events.map((event) => ({
    ...event,
    time: evaluateTimingExpression(
      event.time,
      timingContext,
      `${event.id}.time`,
    ),
  }));
  instance.writeSet = new Set(
    instance.tracks.map((track) => getTrackKey(track.target, track.channel)),
  );
  return instance;
};

export const assertDisjointTimelineWriteSets = (instances) => {
  const ownerByWrite = new Map();
  for (const instance of instances) {
    for (const track of instance.tracks) {
      const key = getTrackKey(track.target, track.channel);
      const previous = ownerByWrite.get(key);
      if (previous) {
        throw new Error(
          `Animations "${previous.programId}" and "${instance.programId}" both write target "${track.target.identity}" channel "${track.channel}".`,
        );
      }
      ownerByWrite.set(key, instance);
    }
  }
};
