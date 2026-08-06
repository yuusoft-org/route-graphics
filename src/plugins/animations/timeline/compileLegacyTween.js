import { canonicalizeData } from "./canonicalizeProgram.js";
import { getSemanticChannel, isSubjectRelativeProperty } from "./channels.js";
import { TIMELINE_SCHEMA, TIMELINE_TIME_UNIT } from "./constants.js";
import { normalizeEasing } from "./easing.js";
import { checkedTimeAdd, checkedTimeMultiply } from "./validation.js";
import { validateTimelineProgram } from "./validateProgram.js";

const constant = (value) => ({ kind: "constant", value });
const underlying = () => ({ kind: "underlying" });

const toSubjectCoordinate = (property, expression) => {
  if (!isSubjectRelativeProperty(property)) return expression;
  const axis = property === "translateX" ? "x" : "y";
  const dimension = property === "translateX" ? "width" : "height";
  return {
    kind: "add",
    left: { kind: "subjectBase", axis },
    right: {
      kind: "multiply",
      left: { kind: "subjectDimension", axis: dimension },
      right: expression,
    },
  };
};

const addRelativeValue = (property, expression) => ({
  kind: "add",
  left: underlying(),
  right: isSubjectRelativeProperty(property)
    ? {
        kind: "multiply",
        left: {
          kind: "subjectDimension",
          axis: property === "translateX" ? "width" : "height",
        },
        right: expression,
      }
    : expression,
});

const resolveFrameStart = (property, frame, currentExpression) => {
  if (frame.startValue === undefined) return currentExpression;
  const authored = constant(frame.startValue);
  return frame.relative
    ? addRelativeValue(property, authored)
    : toSubjectCoordinate(property, authored);
};

const toIterations = (playback = {}) => {
  if (playback.loop === true || playback.repeat === "infinite") return null;
  return (playback.repeat ?? 0) + 1;
};

const createEasingTable = () => {
  const idsByValue = new Map();
  const easings = {};
  const getId = (input) => {
    const descriptor = normalizeEasing(input);
    const key = canonicalizeData(descriptor);
    let id = idsByValue.get(key);
    if (id) return id;
    id = `ease-${idsByValue.size}`;
    idsByValue.set(key, id);
    easings[id] = descriptor;
    return id;
  };
  return { easings, getId };
};

const getSampleValue = (config) =>
  config.initialValue ??
  config.keyframes?.find(({ value }) => value !== undefined)?.value ??
  0;

/**
 * Compile an already-normalized legacy update animation into the portable,
 * renderer-neutral TimelineProgram contract.
 */
export const compileLegacyTweenAnimation = (
  animation,
  { sourcePath = "animation" } = {},
) => {
  if (!animation || animation.type !== "update") {
    throw new Error("Legacy tween compilation requires an update animation.");
  }
  if (!animation.tween && !animation.filterTweens) {
    throw new Error(`Animation "${animation.id}" has no legacy tween tracks.`);
  }

  const requirements = new Set(["target.element"]);
  const clips = [];
  const { easings, getId: getEasingId } = createEasingTable();
  let priority = 0;
  let cycleDuration = 0;

  const compileProperty = ({ property, config, filterId, propertyPath }) => {
    const channelInfo = getSemanticChannel({
      property,
      filterId,
      sampleValue: getSampleValue(config),
    });
    requirements.add(channelInfo.requirement);

    const initialExpression =
      config.initialValue === undefined
        ? isSubjectRelativeProperty(property)
          ? constant(0)
          : underlying()
        : constant(config.initialValue);
    let currentExpression = toSubjectCoordinate(property, initialExpression);
    let cursor = 0;

    clips.push({
      id: `clip-${clips.length}`,
      sourcePath: propertyPath,
      domain: "root",
      targets: "self",
      fanout: null,
      channel: channelInfo.channel,
      valueType: channelInfo.valueType,
      start: 0,
      duration: 0,
      sampler: {
        kind: "interpolate",
        from: currentExpression,
        to: currentExpression,
        easing: getEasingId("linear"),
      },
      modifiers: [],
      composite: "replace",
      priority: priority++,
      fill: "forwards",
    });

    if (config.auto) {
      cursor = checkedTimeAdd(
        cursor,
        config.auto.delay ?? 0,
        `${propertyPath}.auto.delay`,
      );
      const targetExpression = toSubjectCoordinate(property, {
        kind: "targetState",
        property,
      });
      clips.push({
        id: `clip-${clips.length}`,
        sourcePath: `${propertyPath}.auto`,
        domain: "root",
        targets: "self",
        fanout: null,
        channel: channelInfo.channel,
        valueType: channelInfo.valueType,
        start: cursor,
        duration: config.auto.duration,
        sampler: {
          kind: "interpolate",
          from: currentExpression,
          to: targetExpression,
          easing: getEasingId(config.auto.easing),
        },
        modifiers: [],
        composite: "replace",
        priority: priority++,
        fill: "forwards",
      });
      cursor = checkedTimeAdd(
        cursor,
        config.auto.duration,
        `${propertyPath}.auto.duration`,
      );
    } else {
      for (const [index, frame] of config.keyframes.entries()) {
        cursor = checkedTimeAdd(
          cursor,
          frame.delay ?? 0,
          `${propertyPath}.keyframes[${index}].delay`,
        );
        const startExpression = resolveFrameStart(
          property,
          frame,
          currentExpression,
        );
        const authored = constant(frame.value);
        const nextExpression = frame.relative
          ? addRelativeValue(property, authored)
          : toSubjectCoordinate(property, authored);
        clips.push({
          id: `clip-${clips.length}`,
          sourcePath: `${propertyPath}.keyframes[${index}]`,
          domain: "root",
          targets: "self",
          fanout: null,
          channel: channelInfo.channel,
          valueType: channelInfo.valueType,
          start: cursor,
          duration: frame.duration,
          sampler: {
            kind: "interpolate",
            from: startExpression,
            to: nextExpression,
            easing: getEasingId(frame.easing),
          },
          modifiers: [],
          composite: "replace",
          priority: priority++,
          fill: "forwards",
        });
        cursor = checkedTimeAdd(
          cursor,
          frame.duration,
          `${propertyPath}.keyframes[${index}].duration`,
        );
        currentExpression = frame.relative ? underlying() : nextExpression;
      }
    }

    cycleDuration = Math.max(cycleDuration, cursor);
  };

  for (const [property, config] of Object.entries(animation.tween ?? {})) {
    compileProperty({
      property,
      config,
      propertyPath: `${sourcePath}.tween.${property}`,
    });
  }
  for (const [filterId, tween] of Object.entries(
    animation.filterTweens ?? {},
  )) {
    for (const [property, config] of Object.entries(tween)) {
      compileProperty({
        property,
        config,
        filterId,
        propertyPath: `${sourcePath}.tween.filters.${filterId}.${property}`,
      });
    }
  }

  const iterations = toIterations(animation.playback);
  if (iterations !== 1 && cycleDuration === 0) {
    throw new Error(
      `Animation "${animation.id}" cannot repeat a zero-duration tween.`,
    );
  }
  const iterationGap = animation.playback?.repeatDelay ?? 0;
  const finiteLocalDuration =
    iterations === null
      ? null
      : checkedTimeAdd(
          checkedTimeMultiply(
            cycleDuration,
            iterations,
            `${sourcePath}.playback.duration`,
          ),
          checkedTimeMultiply(
            iterationGap,
            Math.max(iterations - 1, 0),
            `${sourcePath}.playback.repeatDelay`,
          ),
          `${sourcePath}.duration`,
        );
  const speed = animation.playback?.speed ?? 1;
  const duration =
    finiteLocalDuration === null
      ? "infinite"
      : Math.ceil(finiteLocalDuration / speed);

  return validateTimelineProgram({
    schema: TIMELINE_SCHEMA,
    timeUnit: TIMELINE_TIME_UNIT,
    programId: animation.id,
    ownerId: animation.targetId,
    duration,
    requirements: [...requirements].sort(),
    targetQueries: {
      self: { kind: "element", elementId: animation.targetId },
    },
    schedules: {},
    domains: {
      root: {
        parent: null,
        start: 0,
        cycleDuration,
        iterations,
        iterationGap,
        direction: animation.playback?.yoyo ? "alternate" : "forward",
        rate: speed,
        refresh: "never",
      },
    },
    easings,
    clipTemplates: clips,
    events: [],
    debug: { frontend: "tween", sourcePath },
  });
};
