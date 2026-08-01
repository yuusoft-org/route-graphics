import { canonicalizeData } from "./canonicalizeProgram.js";
import { getSemanticChannel, isSubjectRelativeProperty } from "./channels.js";
import {
  PORTABLE_GSAP_PROFILE,
  TIMELINE_SCHEMA,
  TIMELINE_TIME_UNIT,
} from "./constants.js";
import { normalizeEasing } from "./easing.js";
import { normalizePortableGsap } from "./normalizePortableGsap.js";
import { calculateStaggerSpan } from "./stagger.js";
import { checkedTimeAdd, checkedTimeMultiply } from "./validation.js";
import { validateTimelineProgram } from "./validateProgram.js";

const constant = (value) => ({ kind: "constant", value });
const underlying = () => ({ kind: "underlying" });
const isTimeNumber = (value) => Number.isSafeInteger(value);

const timeAdd = (left, right, path = "schedule") => {
  if (left === "infinite" || right === "infinite") return "infinite";
  if (left === 0) return right;
  if (right === 0) return left;
  if (isTimeNumber(left) && isTimeNumber(right)) {
    const result = checkedTimeAdd(left, right, path);
    if (result < 0) throw new Error(`${path} resolves before time zero.`);
    return result;
  }
  if (isTimeNumber(right) && right < 0) return timeSubtract(left, -right, path);
  return { kind: "add", values: [left, right] };
};

const timeSubtract = (left, right, path = "schedule") => {
  if (left === "infinite") return "infinite";
  if (right === "infinite")
    throw new Error(`${path} subtracts an infinite time.`);
  if (right === 0) return left;
  if (isTimeNumber(left) && isTimeNumber(right)) {
    const result = left - right;
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new Error(`${path} resolves before time zero.`);
    }
    return result;
  }
  return { kind: "subtract", values: [left, right] };
};

const timeMax = (...values) => {
  if (values.includes("infinite")) return "infinite";
  const filtered = values.filter((value) => value !== undefined);
  if (filtered.every(isTimeNumber)) return Math.max(...filtered, 0);
  return { kind: "max", values: filtered };
};

const timeMultiply = (value, factor) => {
  if (value === "infinite") return "infinite";
  if (factor === 0 || value === 0) return 0;
  if (factor === 1) return value;
  if (isTimeNumber(value)) return checkedTimeMultiply(value, factor);
  return { kind: "multiply", value, factor };
};

const timeCeilDivide = (value, rate) => {
  if (value === "infinite") return "infinite";
  if (rate === 1) return value;
  if (isTimeNumber(value)) return Math.ceil(value / rate);
  return { kind: "ceilDivide", value, rate };
};

const occupiedDuration = (cycle, repeat, repeatDelay, speed) => {
  if (repeat === "infinite") return "infinite";
  const iterations = repeat + 1;
  return timeCeilDivide(
    timeAdd(
      timeMultiply(cycle, iterations),
      timeMultiply(repeatDelay, Math.max(iterations - 1, 0)),
    ),
    speed,
  );
};

const parsePortableColor = (value, path) => {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(value)) {
    throw new Error(`${path} must be a portable hexadecimal color.`);
  }
  const hex = value.slice(1);
  if (![3, 4, 6, 8].includes(hex.length)) {
    throw new Error(`${path} must use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`);
  }
  const expanded =
    hex.length <= 4
      ? [...hex].map((component) => component + component).join("")
      : hex;
  const withAlpha = expanded.length === 6 ? `${expanded}ff` : expanded;
  return [0, 2, 4, 6].map(
    (offset) => Number.parseInt(withAlpha.slice(offset, offset + 2), 16) / 255,
  );
};

const isExpressionValue = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  ["by", "random", "expr", "color"].some((field) =>
    Object.prototype.hasOwnProperty.call(value, field),
  );

const flattenValues = (values, prefix = "") => {
  const result = {};
  const visit = (object, currentPrefix) => {
    for (const [key, value] of Object.entries(object)) {
      const path = currentPrefix ? `${currentPrefix}.${key}` : key;
      if (key === "filters" || key === "parameters") {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(`${path} must be an object.`);
        }
        visit(value, path);
      } else if (
        (currentPrefix.startsWith("filters.") ||
          currentPrefix === "filters" ||
          currentPrefix === "parameters") &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isExpressionValue(value)
      ) {
        visit(value, path);
      } else if (
        ["fill", "border"].includes(key) &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isExpressionValue(value)
      ) {
        visit(value, `rect.${key}`);
      } else if (
        key === "cornerRadius" &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isExpressionValue(value)
      ) {
        visit(value, "rect.cornerRadius");
      } else if (key === "cornerRadius" && !currentPrefix) {
        for (const corner of [
          "topLeft",
          "topRight",
          "bottomRight",
          "bottomLeft",
        ]) {
          result[`rect.cornerRadius.${corner}`] = value;
        }
      } else if (["width", "height"].includes(key) && !currentPrefix) {
        result[`rect.${key}`] = value;
      } else {
        result[path] = value;
      }
    }
  };
  visit(values, prefix);
  return result;
};

const createEasingTable = () => {
  const easings = {};
  const ids = new Map();
  const get = (raw) => {
    const descriptor = normalizeEasing(raw ?? "linear");
    const key = canonicalizeData(descriptor);
    if (ids.has(key)) return ids.get(key);
    const id = `ease-${ids.size}`;
    ids.set(key, id);
    easings[id] = descriptor;
    return id;
  };
  return { easings, get };
};

const normalizeTargetQueries = (animation) => {
  const queries = {};
  const kinds = new Map();
  if (animation.type === "update") {
    queries.self = { kind: "element", elementId: animation.targetId };
    kinds.set("self", "element");
  }
  for (const [alias, definition] of Object.entries(
    animation.gsap.targets ?? {},
  )) {
    if (definition.element !== undefined) {
      queries[alias] = { kind: "element", elementId: definition.element };
      kinds.set(alias, "element");
    } else if (definition.elements !== undefined) {
      queries[alias] = {
        kind: "elements",
        elementIds: [...definition.elements],
      };
      kinds.set(alias, "element");
    } else if (definition.textUnits !== undefined) {
      queries[alias] = {
        kind: "textUnits",
        elementId: definition.textUnits.elementId,
        unit: definition.textUnits.unit,
        order: definition.textUnits.order ?? "logical",
        allowEmpty: definition.textUnits.allowEmpty ?? false,
        segmentation: {
          standard: "unicode-uax29",
          version: "17.0.0",
        },
      };
      kinds.set(alias, "textUnits");
    } else if (definition.transitionSurface !== undefined) {
      queries[alias] = {
        kind: "transitionSurface",
        surface: definition.transitionSurface,
      };
      kinds.set(alias, "transitionSurface");
    } else if (definition.transitionMask !== undefined) {
      queries[alias] = { kind: "transitionMask" };
      kinds.set(alias, "transitionMask");
    } else {
      queries[alias] = { kind: "transitionCompositor" };
      kinds.set(alias, "transitionCompositor");
    }
  }
  return { queries, kinds };
};

const toPublicExpression = (value, { color = false, path }) => {
  if (color && typeof value === "string")
    return constant(parsePortableColor(value, path));
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    Array.isArray(value)
  ) {
    return constant(value);
  }
  if (value.by !== undefined) {
    return {
      kind: "relative",
      value: toPublicExpression(value.by, { color, path: `${path}.by` }),
    };
  }
  if (value.expr !== undefined) return value.expr;
  if (value.random !== undefined) {
    const random = value.random;
    if (random.choices !== undefined) {
      return {
        kind: "randomChoice",
        choices: color
          ? random.choices.map((choice, index) =>
              parsePortableColor(choice, `${path}.random.choices[${index}]`),
            )
          : [...random.choices],
        ...(random.seed === undefined ? {} : { seed: random.seed }),
      };
    }
    return {
      kind: "randomNumber",
      min: random.min,
      max: random.max,
      ...(random.step === undefined ? {} : { step: random.step }),
      ...(random.seed === undefined ? {} : { seed: random.seed }),
    };
  }
  if (value.color?.random !== undefined) {
    return toPublicExpression(
      { random: value.color.random },
      { color: true, path: `${path}.color` },
    );
  }
  throw new Error(`${path} is not a supported portable value.`);
};

const authoredExpression = (property, value, channelInfo, path) => {
  const parsed = toPublicExpression(value, {
    color: new Set(["colorSrgb", "colorLinear"]).has(channelInfo.valueType),
    path,
  });
  if (parsed.kind === "relative") {
    const delta = parsed.value;
    if (isSubjectRelativeProperty(property)) {
      const dimension = property === "translateX" ? "width" : "height";
      return {
        kind: "add",
        left: underlying(),
        right: {
          kind: "multiply",
          left: { kind: "subjectDimension", axis: dimension },
          right: delta,
        },
      };
    }
    return { kind: "add", left: underlying(), right: delta };
  }
  if (!isSubjectRelativeProperty(property)) return parsed;
  const axis = property === "translateX" ? "x" : "y";
  const dimension = property === "translateX" ? "width" : "height";
  return {
    kind: "add",
    left: { kind: "subjectBase", axis },
    right: {
      kind: "multiply",
      left: { kind: "subjectDimension", axis: dimension },
      right: parsed,
    },
  };
};

const sampleValueForChannel = (value) => {
  if (typeof value === "number" || Array.isArray(value)) return value;
  if (value?.by !== undefined) return sampleValueForChannel(value.by);
  if (value?.random?.choices?.length) return value.random.choices[0];
  if (value?.random !== undefined) return 0;
  if (value?.color?.random?.choices?.length) return [0, 0, 0, 1];
  return 0;
};

const getChannelForProperty = (property, targetKind, value, path) => {
  if (targetKind === "transitionMask") {
    if (property !== "progress")
      throw new Error(`${path} mask targets support only progress.`);
    return getSemanticChannel({
      property,
      transitionTarget: "mask",
      sampleValue: value,
    });
  }
  if (targetKind === "transitionCompositor") {
    if (property !== "progress" && !property.startsWith("parameters.")) {
      throw new Error(
        `${path} compositor targets support progress and parameters.*.`,
      );
    }
    return getSemanticChannel({
      property:
        property === "progress"
          ? "progress"
          : property.slice("parameters.".length),
      transitionTarget: "compositor",
      sampleValue: sampleValueForChannel(value),
    });
  }
  if (targetKind === "transitionSurface") {
    if (property.startsWith("filters.") || property.startsWith("rect.")) {
      throw new Error(
        `${path} transition surfaces do not support ${property}.`,
      );
    }
  }
  if (property.startsWith("filters.")) {
    const [, filterId, ...parameterParts] = property.split(".");
    if (!filterId || parameterParts.length === 0)
      throw new Error(`${path} is invalid.`);
    let parameter = parameterParts.join(".");
    if (
      parameter === "time" ||
      parameter === "uTime" ||
      parameter === "uProgress"
    ) {
      throw new Error(`${path} is read-only or reserved.`);
    }
    if (parameter === "progress") parameter = "uProgress";
    return getSemanticChannel({
      property: parameter,
      filterId,
      sampleValue: sampleValueForChannel(value),
    });
  }
  return getSemanticChannel({
    property,
    sampleValue: sampleValueForChannel(value),
  });
};

const normalizeDefaults = (parent, child) => ({
  ...parent,
  ...child,
});

/** Compile normalized portable GSAP-shaped data into TimelineProgram. */
export const compilePortableGsapAnimation = (
  rawAnimation,
  { sourcePath = "animation" } = {},
) => {
  if (!rawAnimation?.gsap)
    throw new Error("GSAP compilation requires animation.gsap.");
  const animation = {
    ...rawAnimation,
    gsap: normalizePortableGsap(
      rawAnimation.gsap,
      `${sourcePath}.gsap`,
      rawAnimation.type,
    ),
  };
  if (animation.gsap.profile !== PORTABLE_GSAP_PROFILE) {
    throw new Error("Unsupported portable GSAP profile.");
  }

  const { queries: targetQueries, kinds: targetKinds } =
    normalizeTargetQueries(animation);
  const { easings, get: getEasingId } = createEasingTable();
  const requirements = new Set();
  const domains = {};
  const clipTemplates = [];
  const events = [];
  const marks = {};
  const actionQueries = new Map();
  let priority = 0;
  let domainCounter = 0;

  for (const query of Object.values(targetQueries)) {
    if (query.kind === "element" || query.kind === "elements")
      requirements.add("target.element");
    if (query.kind === "textUnits") {
      requirements.add(`target.textUnits.${query.unit}.unicode17`);
    }
    if (query.kind.startsWith("transition"))
      requirements.add(`target.${query.kind}`);
  }

  const getActionQuery = (rawTargets, path) => {
    const aliases =
      rawTargets === undefined
        ? ["self"]
        : Array.isArray(rawTargets)
          ? rawTargets
          : [rawTargets];
    for (const alias of aliases) {
      if (!targetQueries[alias])
        throw new Error(`${path}.targets references unknown alias "${alias}".`);
    }
    if (aliases.length === 1) return aliases[0];
    const key = aliases.join("\u0000");
    if (actionQueries.has(key)) return actionQueries.get(key);
    const alias = `__targets-${actionQueries.size}`;
    targetQueries[alias] = { kind: "union", aliases: [...aliases] };
    const kinds = new Set(aliases.map((item) => targetKinds.get(item)));
    if (
      kinds.size > 1 &&
      [...kinds].some((kind) => kind.startsWith("transition"))
    ) {
      throw new Error(`${path}.targets cannot mix transition target kinds.`);
    }
    targetKinds.set(alias, kinds.size === 1 ? [...kinds][0] : "element");
    actionQueries.set(key, alias);
    return alias;
  };

  const getStaticTargetCount = (alias, seen = new Set()) => {
    if (seen.has(alias)) return null;
    seen.add(alias);
    const query = targetQueries[alias];
    if (query.kind === "element") return 1;
    if (query.kind === "elements") return query.elementIds.length;
    if (query.kind === "union") {
      let total = 0;
      for (const child of query.aliases) {
        const count = getStaticTargetCount(child, seen);
        if (count === null) return null;
        total += count;
      }
      return total;
    }
    if (query.kind.startsWith("transition")) return 1;
    return null;
  };

  const addDomain = ({
    parent,
    start,
    cycleDuration,
    repeat,
    repeatDelay,
    yoyo,
    speed,
    refresh,
  }) => {
    const id = `domain-${domainCounter++}`;
    domains[id] = {
      parent,
      start,
      cycleDuration,
      iterations: repeat === "infinite" ? null : repeat + 1,
      iterationGap: repeatDelay,
      direction: yoyo ? "alternate" : "forward",
      rate: speed,
      refresh: refresh ? "iteration" : "never",
    };
    return id;
  };

  const effective = (step, defaults, field, fallback) =>
    step[field] ?? defaults[field] ?? fallback;

  const compileValueClips = ({
    action,
    valuesFrom,
    valuesTo,
    targetAlias,
    targetKind,
    domain,
    start,
    duration,
    easing,
    fill = "forwards",
    path,
    stagger,
    overwrite,
    modifiers,
  }) => {
    const fromEntries = valuesFrom ? flattenValues(valuesFrom) : {};
    const toEntries = valuesTo ? flattenValues(valuesTo) : {};
    const fromKeys = Object.keys(fromEntries).sort();
    const toKeys = Object.keys(toEntries).sort();
    if (
      action === "fromTo" &&
      canonicalizeData(fromKeys) !== canonicalizeData(toKeys)
    ) {
      throw new Error(
        `${path}.from and ${path}.to must define identical channel sets.`,
      );
    }
    const properties = action === "from" ? fromKeys : toKeys;
    if (
      (properties.includes("x") && properties.includes("translateX")) ||
      (properties.includes("y") && properties.includes("translateY"))
    ) {
      throw new Error(`${path} cannot combine x/translateX or y/translateY.`);
    }
    const flatModifiers = modifiers ? flattenValues(modifiers) : {};
    for (const property of properties) {
      const authored =
        action === "from" ? fromEntries[property] : toEntries[property];
      const channelInfo = getChannelForProperty(
        property,
        targetKind,
        authored,
        `${path}.${property}`,
      );
      requirements.add(channelInfo.requirement);
      const authoredFrom = fromEntries[property];
      const authoredTo = toEntries[property];
      let fromExpression;
      let toExpression;
      if (action === "set") {
        toExpression = authoredExpression(
          property,
          authoredTo,
          channelInfo,
          `${path}.values.${property}`,
        );
        fromExpression = toExpression;
      } else if (action === "to" || action === "keyframes") {
        fromExpression = underlying();
        toExpression = authoredExpression(
          property,
          authoredTo,
          channelInfo,
          `${path}.${property}`,
        );
      } else if (action === "from") {
        fromExpression = authoredExpression(
          property,
          authoredFrom,
          channelInfo,
          `${path}.${property}`,
        );
        toExpression = underlying();
      } else {
        fromExpression = authoredExpression(
          property,
          authoredFrom,
          channelInfo,
          `${path}.from.${property}`,
        );
        toExpression = authoredExpression(
          property,
          authoredTo,
          channelInfo,
          `${path}.to.${property}`,
        );
      }
      clipTemplates.push({
        id: `clip-${clipTemplates.length}`,
        sourcePath: path,
        domain,
        targets: targetAlias,
        fanout: stagger ? { stagger } : null,
        channel: channelInfo.channel,
        valueType: channelInfo.valueType,
        start,
        duration,
        sampler: {
          kind: "interpolate",
          from: fromExpression,
          to: toExpression,
          easing: getEasingId(easing),
        },
        modifiers: flatModifiers[property] ?? [],
        composite: "replace",
        overwrite,
        priority: priority++,
        fill,
      });
    }
  };

  const resolveStart = ({
    step,
    mode,
    origin,
    cursor,
    previous,
    anchors,
    path,
  }) => {
    let start = mode === "parallel" ? origin : cursor;
    if (step.overlap !== undefined) {
      if (!previous)
        throw new Error(`${path}.overlap requires a previous sibling.`);
      start = timeSubtract(previous.end, step.overlap, `${path}.overlap`);
    } else if (step.start !== undefined) {
      if (step.start.time !== undefined)
        start = timeAdd(origin, step.start.time, `${path}.start`);
      else {
        const anchorName = step.start.anchor;
        let anchor;
        if (anchorName === "group.start")
          anchor = { start: origin, end: origin, mark: true };
        else if (anchorName === "timeline.start") {
          if (origin !== 0)
            throw new Error(
              `${path}.start timeline.start cannot cross a transformed domain.`,
            );
          anchor = { start: 0, end: 0, mark: true };
        } else if (
          anchorName === "previous.start" ||
          anchorName === "previous.end"
        ) {
          if (!previous)
            throw new Error(
              `${path}.start ${anchorName} requires a previous sibling.`,
            );
          anchor = previous;
        } else anchor = anchors.get(anchorName);
        if (!anchor)
          throw new Error(
            `${path}.start references unknown or forward anchor "${anchorName}".`,
          );
        const edge = anchorName.endsWith(".end")
          ? "end"
          : (step.start.edge ?? "start");
        if (anchor.mark && edge === "end")
          throw new Error(`${path}.start cannot use the end edge of a mark.`);
        start = anchor[edge];
        const offset = step.start.offset ?? 0;
        start =
          offset < 0
            ? timeSubtract(start, -offset, `${path}.start.offset`)
            : timeAdd(start, offset, `${path}.start.offset`);
      }
    }
    return timeAdd(start, step.delay ?? 0, `${path}.delay`);
  };

  const getRepeatConfig = (step, defaults) => ({
    repeat: effective(step, defaults, "repeat", 0),
    repeatDelay: effective(step, defaults, "repeatDelay", 0),
    yoyo: effective(step, defaults, "yoyo", false),
    speed: step.speed ?? 1,
    refresh: effective(step, defaults, "repeatRefresh", false),
  });

  const needsDomain = (config) =>
    config.repeat !== 0 || config.speed !== 1 || config.refresh;

  const compileAction = (
    step,
    scheduledStart,
    parentDomain,
    defaults,
    path,
  ) => {
    const targetAlias = getActionQuery(step.targets, path);
    const targetKind = targetKinds.get(targetAlias);
    const staticTargetCount = getStaticTargetCount(targetAlias);
    const staggerSpan = step.stagger
      ? staticTargetCount === null
        ? { kind: "staggerSpan", targets: targetAlias, stagger: step.stagger }
        : calculateStaggerSpan(staticTargetCount, step.stagger, {
            seedParts: [animation.id, path],
          })
      : 0;
    let contentDuration;
    if (step.kind === "set") contentDuration = staggerSpan;
    else if (step.kind === "keyframes") {
      contentDuration = step.frames.reduce(
        (sum, frame) => timeAdd(timeAdd(sum, frame.delay ?? 0), frame.duration),
        0,
      );
      contentDuration = timeAdd(contentDuration, staggerSpan);
    } else {
      const duration = effective(step, defaults, "duration", undefined);
      if (duration === undefined)
        throw new Error(
          `${path}.duration is required directly or through defaults.`,
        );
      contentDuration = timeAdd(duration, staggerSpan);
    }
    const repeatConfig = getRepeatConfig(step, defaults);
    const transformed = needsDomain(repeatConfig);
    const actionDomain = transformed
      ? addDomain({
          parent: parentDomain,
          start: scheduledStart,
          cycleDuration: contentDuration,
          ...repeatConfig,
        })
      : parentDomain;
    const actionStart = transformed ? 0 : scheduledStart;
    const overwrite = effective(step, defaults, "overwrite", "auto");
    const easing = effective(step, defaults, "easing", "linear");

    if (step.kind === "set") {
      compileValueClips({
        action: "set",
        valuesTo: step.values,
        targetAlias,
        targetKind,
        domain: actionDomain,
        start: actionStart,
        duration: 0,
        easing: "linear",
        path,
        stagger: step.stagger,
        overwrite,
        modifiers: step.modifiers,
      });
    } else if (step.kind === "keyframes") {
      let frameCursor = 0;
      for (const [index, frame] of step.frames.entries()) {
        frameCursor = timeAdd(frameCursor, frame.delay ?? 0);
        compileValueClips({
          action: "keyframes",
          valuesTo: frame.values,
          targetAlias,
          targetKind,
          domain: actionDomain,
          start: timeAdd(actionStart, frameCursor),
          duration: frame.duration,
          easing: frame.easing ?? easing,
          path: `${path}.frames[${index}]`,
          stagger: step.stagger,
          overwrite,
          modifiers: step.modifiers,
        });
        frameCursor = timeAdd(frameCursor, frame.duration);
      }
    } else {
      const duration = effective(step, defaults, "duration", undefined);
      compileValueClips({
        action: step.kind,
        valuesFrom:
          step.kind === "fromTo"
            ? step.from
            : step.kind === "from"
              ? step.values
              : undefined,
        valuesTo:
          step.kind === "fromTo"
            ? step.to
            : step.kind === "to"
              ? step.values
              : undefined,
        targetAlias,
        targetKind,
        domain: actionDomain,
        start: actionStart,
        duration,
        easing,
        path,
        stagger: step.stagger,
        overwrite,
        modifiers: step.modifiers,
      });
    }
    return transformed
      ? occupiedDuration(
          contentDuration,
          repeatConfig.repeat,
          repeatConfig.repeatDelay,
          repeatConfig.speed,
        )
      : contentDuration;
  };

  const compileSteps = ({ steps, mode, domain, origin, defaults, path }) => {
    let cursor = origin;
    let end = origin;
    let finiteEnd = origin;
    let previous = null;
    const anchors = new Map();
    for (const [index, step] of steps.entries()) {
      const stepPath = `${path}[${index}]`;
      if (mode === "sequence" && cursor === "infinite") {
        throw new Error(
          `${stepPath} is unreachable because the previous sequence child is infinite.`,
        );
      }
      const scheduledStart = resolveStart({
        step,
        mode,
        origin,
        cursor,
        previous,
        anchors,
        path: stepPath,
      });
      let duration = 0;
      let markName = null;
      if (
        new Set(["set", "to", "from", "fromTo", "keyframes"]).has(step.kind)
      ) {
        duration = compileAction(
          step,
          scheduledStart,
          domain,
          defaults,
          stepPath,
        );
      } else if (step.kind === "wait") duration = step.duration;
      else if (step.kind === "mark") {
        markName = step.name;
        marks[step.name] = scheduledStart;
      } else if (step.kind === "emit") {
        events.push({
          id: `event-${events.length}`,
          domain,
          time: scheduledStart,
          name: step.event,
          payload: step.payload ?? null,
          direction: step.direction ?? "forward",
          occurrence: step.occurrence ?? "eachIteration",
          seekPolicy: step.seekPolicy ?? "suppress",
          priority: priority++,
        });
      } else {
        const repeatConfig = getRepeatConfig(step, defaults);
        const transformed = needsDomain(repeatConfig);
        const groupDomain = transformed
          ? addDomain({
              parent: domain,
              start: scheduledStart,
              cycleDuration: 0,
              ...repeatConfig,
            })
          : domain;
        const childOrigin = transformed ? 0 : scheduledStart;
        const childDefaults = normalizeDefaults(defaults, step.defaults);
        const child = compileSteps({
          steps: step.steps,
          mode: step.kind,
          domain: groupDomain,
          origin: childOrigin,
          defaults: childDefaults,
          path: `${stepPath}.steps`,
        });
        const childDuration = timeSubtract(
          child.end,
          childOrigin,
          `${stepPath}.duration`,
        );
        if (transformed) {
          if (childDuration === "infinite") {
            throw new Error(
              `${stepPath} cannot apply repeat or speed around an already-infinite child.`,
            );
          }
          domains[groupDomain].cycleDuration = childDuration;
          duration = occupiedDuration(
            childDuration,
            repeatConfig.repeat,
            repeatConfig.repeatDelay,
            repeatConfig.speed,
          );
        } else duration = childDuration;
      }

      const stepEnd = timeAdd(scheduledStart, duration, `${stepPath}.end`);
      const descriptor = {
        start: scheduledStart,
        end: stepEnd,
        mark: step.kind === "mark",
      };
      for (const name of [step.id, markName].filter(Boolean)) {
        if (anchors.has(name))
          throw new Error(
            `${stepPath} duplicates anchor "${name}" in this group.`,
          );
        anchors.set(name, descriptor);
      }
      previous = descriptor;
      end = timeMax(end, stepEnd);
      if (stepEnd !== "infinite") finiteEnd = timeMax(finiteEnd, stepEnd);
      else if (scheduledStart !== "infinite") {
        finiteEnd = timeMax(finiteEnd, scheduledStart);
      }
      if (mode === "sequence") cursor = timeMax(cursor, stepEnd);
    }
    return { end, finiteEnd, anchors };
  };

  domains.root = {
    parent: null,
    start: 0,
    cycleDuration: 0,
    iterations: 1,
    iterationGap: 0,
    direction: "forward",
    rate: animation.playback?.speed ?? 1,
    refresh: "never",
  };
  const result = compileSteps({
    steps: animation.gsap.steps,
    mode: "sequence",
    domain: "root",
    origin: 0,
    defaults: animation.gsap.defaults ?? {},
    path: `${sourcePath}.gsap.steps`,
  });
  const cycleDuration = result.end;
  const hasInfiniteChild = cycleDuration === "infinite";
  domains.root.cycleDuration = hasInfiniteChild
    ? result.finiteEnd
    : cycleDuration;
  const rootRepeat =
    animation.playback?.loop === true ||
    animation.playback?.repeat === "infinite"
      ? "infinite"
      : (animation.playback?.repeat ?? 0);
  domains.root.iterations = rootRepeat === "infinite" ? null : rootRepeat + 1;
  domains.root.iterationGap = animation.playback?.repeatDelay ?? 0;
  domains.root.direction = animation.playback?.yoyo ? "alternate" : "forward";

  if (hasInfiniteChild && rootRepeat !== 0) {
    throw new Error(
      `${sourcePath}.playback cannot repeat a timeline that already contains an infinite child.`,
    );
  }

  if (clipTemplates.length === 0 && events.length === 0) {
    throw new Error(
      `${sourcePath}.gsap must compile at least one value clip or event.`,
    );
  }
  if (rootRepeat !== 0 && cycleDuration === 0) {
    throw new Error(
      `${sourcePath}.gsap cannot repeat a zero-duration timeline.`,
    );
  }
  const rootDuration = hasInfiniteChild
    ? "infinite"
    : occupiedDuration(
        cycleDuration,
        rootRepeat,
        domains.root.iterationGap,
        domains.root.rate,
      );
  const duration =
    rootDuration === "infinite"
      ? "infinite"
      : isTimeNumber(rootDuration)
        ? rootDuration
        : "binding";

  return validateTimelineProgram({
    schema: TIMELINE_SCHEMA,
    timeUnit: TIMELINE_TIME_UNIT,
    programId: animation.id,
    ownerId: animation.targetId,
    duration,
    requirements: [...requirements].sort(),
    targetQueries,
    schedules: {},
    domains,
    easings,
    clipTemplates,
    events,
    debug: {
      frontend: "gsap",
      profile: PORTABLE_GSAP_PROFILE,
      marks,
      sourcePath,
    },
  });
};
