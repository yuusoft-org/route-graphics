import {
  COMPOSITE_MODES,
  FILL_MODES,
  JS_TIMELINE_LIMITS,
  MAX_REPEAT_REFRESH_ITERATIONS,
  TIMELINE_SCHEMA,
  TIMELINE_TIME_UNIT,
} from "./constants.js";
import { normalizeEasing } from "./easing.js";
import { normalizeModifier } from "./modifiers.js";
import { validateTimelineValueType } from "./valueTypes.js";
import {
  assertFiniteNumber,
  assertKnownFields,
  assertNonEmptyString,
  assertPlainObject,
  assertSafeTime,
  assertSerializableData,
  isPlainObject,
} from "./validation.js";

const fillModes = new Set(FILL_MODES);
const compositeModes = new Set(COMPOSITE_MODES);
const staggerOrigins = new Set(["start", "center", "end", "edges", "random"]);
const valueTypes = new Set([
  "scalar",
  "vec2",
  "vec3",
  "vec4",
  "mat3",
  "mat4",
  "angleDegrees",
  "colorSrgb",
  "colorLinear",
  "integer",
  "boolean",
  "string",
  "discrete",
]);

const cloneData = (value) => {
  if (Array.isArray(value)) return value.map(cloneData);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneData(item)]),
    );
  }
  return Object.is(value, -0) ? 0 : value;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const assertSortedUniqueStrings = (values, path) => {
  if (!Array.isArray(values)) throw new Error(`${path} must be an array.`);
  const sorted = [...values].sort();
  if (
    values.some(
      (value, index) =>
        typeof value !== "string" ||
        value.length === 0 ||
        value !== sorted[index],
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`${path} must contain sorted unique non-empty strings.`);
  }
};

const validateTimingExpression = (value, path, depth = 0) => {
  if (Number.isSafeInteger(value)) {
    assertSafeTime(value, path);
    return;
  }
  if (depth > 32) throw new Error(`${path} exceeds timing-expression depth.`);
  assertPlainObject(value, path);
  assertNonEmptyString(value.kind, `${path}.kind`);

  switch (value.kind) {
    case "targetCount":
      assertKnownFields(value, new Set(["kind", "targets"]), path);
      assertNonEmptyString(value.targets, `${path}.targets`);
      return;
    case "staggerSpan":
      assertKnownFields(value, new Set(["kind", "targets", "stagger"]), path);
      assertNonEmptyString(value.targets, `${path}.targets`);
      assertPlainObject(value.stagger, `${path}.stagger`);
      return;
    case "childStart":
    case "childEnd":
      assertKnownFields(value, new Set(["kind", "child"]), path);
      assertNonEmptyString(value.child, `${path}.child`);
      return;
    case "scheduleEnd":
      assertKnownFields(value, new Set(["kind", "schedule"]), path);
      assertNonEmptyString(value.schedule, `${path}.schedule`);
      return;
    case "add":
    case "subtract":
    case "max":
      assertKnownFields(value, new Set(["kind", "values"]), path);
      if (!Array.isArray(value.values) || value.values.length === 0) {
        throw new Error(`${path}.values must be a non-empty array.`);
      }
      value.values.forEach((item, index) =>
        validateTimingExpression(item, `${path}.values[${index}]`, depth + 1),
      );
      return;
    case "ceilDivide":
      assertKnownFields(value, new Set(["kind", "value", "rate"]), path);
      validateTimingExpression(value.value, `${path}.value`, depth + 1);
      assertFiniteNumber(value.rate, `${path}.rate`);
      if (value.rate <= 0) throw new Error(`${path}.rate must be positive.`);
      return;
    case "multiply":
      assertKnownFields(value, new Set(["kind", "value", "factor"]), path);
      validateTimingExpression(value.value, `${path}.value`, depth + 1);
      if (!Number.isSafeInteger(value.factor) || value.factor < 0) {
        throw new Error(`${path}.factor must be a non-negative safe integer.`);
      }
      return;
    default:
      throw new Error(`${path}.kind "${value.kind}" is not supported.`);
  }
};

const validateTargetQuery = (query, path) => {
  assertPlainObject(query, path);
  assertNonEmptyString(query.kind, `${path}.kind`);

  switch (query.kind) {
    case "element":
      assertKnownFields(query, new Set(["kind", "elementId"]), path);
      assertNonEmptyString(query.elementId, `${path}.elementId`);
      break;
    case "elements":
      assertKnownFields(query, new Set(["kind", "elementIds"]), path);
      if (!Array.isArray(query.elementIds) || query.elementIds.length === 0) {
        throw new Error(`${path}.elementIds must be a non-empty array.`);
      }
      query.elementIds.forEach((id, index) =>
        assertNonEmptyString(id, `${path}.elementIds[${index}]`),
      );
      if (new Set(query.elementIds).size !== query.elementIds.length) {
        throw new Error(`${path}.elementIds must not contain duplicates.`);
      }
      break;
    case "textUnits":
      assertKnownFields(
        query,
        new Set([
          "kind",
          "elementId",
          "unit",
          "order",
          "allowEmpty",
          "segmentation",
        ]),
        path,
      );
      assertNonEmptyString(query.elementId, `${path}.elementId`);
      if (!new Set(["grapheme", "word", "line"]).has(query.unit)) {
        throw new Error(`${path}.unit is not supported.`);
      }
      if (!new Set(["logical", "visual"]).has(query.order)) {
        throw new Error(`${path}.order is not supported.`);
      }
      if (
        query.allowEmpty !== undefined &&
        typeof query.allowEmpty !== "boolean"
      ) {
        throw new Error(`${path}.allowEmpty must be a boolean.`);
      }
      assertPlainObject(query.segmentation, `${path}.segmentation`);
      assertKnownFields(
        query.segmentation,
        new Set(["standard", "version"]),
        `${path}.segmentation`,
      );
      if (
        query.segmentation.standard !== "unicode-uax29" ||
        query.segmentation.version !== "17.0.0"
      ) {
        throw new Error(
          `${path}.segmentation must declare unicode-uax29 version 17.0.0.`,
        );
      }
      break;
    case "union":
      assertKnownFields(query, new Set(["kind", "aliases"]), path);
      if (!Array.isArray(query.aliases) || query.aliases.length === 0) {
        throw new Error(`${path}.aliases must be a non-empty array.`);
      }
      query.aliases.forEach((alias, index) =>
        assertNonEmptyString(alias, `${path}.aliases[${index}]`),
      );
      if (new Set(query.aliases).size !== query.aliases.length) {
        throw new Error(`${path}.aliases must not contain duplicates.`);
      }
      break;
    case "transitionSurface":
      assertKnownFields(query, new Set(["kind", "surface"]), path);
      if (!new Set(["prev", "next"]).has(query.surface)) {
        throw new Error(`${path}.surface must be prev or next.`);
      }
      break;
    case "transitionMask":
    case "transitionCompositor":
      assertKnownFields(query, new Set(["kind"]), path);
      break;
    default:
      throw new Error(`${path}.kind "${query.kind}" is not supported.`);
  }
};

const validateExpression = (
  expression,
  path,
  depth = 0,
  count = { value: 0 },
) => {
  count.value++;
  if (depth > 32 || count.value > 256) {
    throw new Error(`${path} exceeds expression complexity limits.`);
  }
  assertPlainObject(expression, path);
  assertNonEmptyString(expression.kind, `${path}.kind`);

  switch (expression.kind) {
    case "constant":
      assertKnownFields(expression, new Set(["kind", "value"]), path);
      assertSerializableData(expression.value, `${path}.value`);
      return;
    case "underlying":
    case "targetIndex":
    case "targetCount":
    case "iteration":
      assertKnownFields(expression, new Set(["kind"]), path);
      return;
    case "targetState":
      assertKnownFields(expression, new Set(["kind", "property"]), path);
      if (expression.property !== undefined) {
        assertNonEmptyString(expression.property, `${path}.property`);
      }
      return;
    case "subjectDimension":
    case "subjectBase":
      assertKnownFields(expression, new Set(["kind", "axis"]), path);
      if (!new Set(["x", "y", "width", "height"]).has(expression.axis)) {
        throw new Error(`${path}.axis is not supported.`);
      }
      return;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      assertKnownFields(expression, new Set(["kind", "left", "right"]), path);
      validateExpression(expression.left, `${path}.left`, depth + 1, count);
      validateExpression(expression.right, `${path}.right`, depth + 1, count);
      return;
    case "min":
    case "max":
      assertKnownFields(expression, new Set(["kind", "values"]), path);
      if (!Array.isArray(expression.values) || expression.values.length === 0) {
        throw new Error(`${path}.values must be a non-empty array.`);
      }
      expression.values.forEach((item, index) =>
        validateExpression(item, `${path}.values[${index}]`, depth + 1, count),
      );
      return;
    case "clamp":
      assertKnownFields(
        expression,
        new Set(["kind", "value", "min", "max"]),
        path,
      );
      for (const field of ["value", "min", "max"]) {
        validateExpression(
          expression[field],
          `${path}.${field}`,
          depth + 1,
          count,
        );
      }
      return;
    case "randomNumber":
      assertKnownFields(
        expression,
        new Set(["kind", "min", "max", "step", "seed"]),
        path,
      );
      assertFiniteNumber(expression.min, `${path}.min`);
      assertFiniteNumber(expression.max, `${path}.max`);
      if (expression.min > expression.max) {
        throw new Error(`${path}.min must not exceed max.`);
      }
      if (expression.step !== undefined) {
        assertFiniteNumber(expression.step, `${path}.step`);
        if (expression.step <= 0)
          throw new Error(`${path}.step must be positive.`);
      }
      if (expression.seed !== undefined) {
        assertNonEmptyString(expression.seed, `${path}.seed`);
      }
      return;
    case "randomChoice":
      assertKnownFields(expression, new Set(["kind", "choices", "seed"]), path);
      if (
        !Array.isArray(expression.choices) ||
        expression.choices.length === 0
      ) {
        throw new Error(`${path}.choices must be a non-empty array.`);
      }
      expression.choices.forEach((choice, index) =>
        assertSerializableData(choice, `${path}.choices[${index}]`),
      );
      if (expression.seed !== undefined) {
        assertNonEmptyString(expression.seed, `${path}.seed`);
      }
      return;
    default:
      throw new Error(`${path}.kind "${expression.kind}" is not supported.`);
  }
};

const numericValueTypes = new Set([
  "scalar",
  "integer",
  "angleDegrees",
  "vec2",
  "vec3",
  "vec4",
  "mat3",
  "mat4",
  "colorSrgb",
  "colorLinear",
]);

const validateExpressionStaticType = (expression, valueType, path) => {
  switch (expression.kind) {
    case "constant":
      validateTimelineValueType(expression.value, valueType, `${path}.value`);
      return;
    case "randomChoice":
      expression.choices.forEach((choice, index) =>
        validateTimelineValueType(
          choice,
          valueType,
          `${path}.choices[${index}]`,
        ),
      );
      return;
    case "randomNumber":
      if (!new Set(["scalar", "angleDegrees", "integer"]).has(valueType)) {
        throw new Error(`${path} randomNumber cannot produce ${valueType}.`);
      }
      if (
        valueType === "integer" &&
        (!Number.isSafeInteger(expression.min) ||
          !Number.isSafeInteger(expression.max) ||
          (expression.step !== undefined &&
            !Number.isSafeInteger(expression.step)))
      ) {
        throw new Error(`${path} must produce JSON-safe integers.`);
      }
      return;
    case "targetIndex":
    case "targetCount":
    case "iteration":
    case "subjectDimension":
    case "subjectBase":
      if (!new Set(["scalar", "integer", "angleDegrees"]).has(valueType)) {
        throw new Error(`${path} produces a scalar, not ${valueType}.`);
      }
      return;
    case "add":
    case "subtract":
      if (!numericValueTypes.has(valueType)) {
        throw new Error(`${path} requires a numeric result channel.`);
      }
      validateExpressionStaticType(expression.left, valueType, `${path}.left`);
      validateExpressionStaticType(
        expression.right,
        valueType,
        `${path}.right`,
      );
      return;
    case "min":
    case "max":
      if (!new Set(["scalar", "integer", "angleDegrees"]).has(valueType)) {
        throw new Error(`${path} produces a scalar, not ${valueType}.`);
      }
      expression.values.forEach((item, index) =>
        validateExpressionStaticType(
          item,
          "scalar",
          `${path}.values[${index}]`,
        ),
      );
      return;
    case "clamp":
      if (!new Set(["scalar", "integer", "angleDegrees"]).has(valueType)) {
        throw new Error(`${path} produces a scalar, not ${valueType}.`);
      }
      for (const field of ["value", "min", "max"]) {
        validateExpressionStaticType(
          expression[field],
          "scalar",
          `${path}.${field}`,
        );
      }
      return;
    case "multiply":
    case "divide":
      if (!numericValueTypes.has(valueType)) {
        throw new Error(`${path} requires a numeric result channel.`);
      }
      return;
    case "underlying":
    case "targetState":
      return;
  }
};

const validateDomainEntry = (domain, path) => {
  assertPlainObject(domain, path);
  assertKnownFields(
    domain,
    new Set([
      "parent",
      "start",
      "cycleDuration",
      "iterations",
      "iterationGap",
      "direction",
      "rate",
      "refresh",
    ]),
    path,
  );
  if (domain.parent !== null)
    assertNonEmptyString(domain.parent, `${path}.parent`);
  validateTimingExpression(domain.start, `${path}.start`);
  validateTimingExpression(domain.cycleDuration, `${path}.cycleDuration`);
  if (
    domain.iterations !== null &&
    (!Number.isSafeInteger(domain.iterations) || domain.iterations <= 0)
  ) {
    throw new Error(
      `${path}.iterations must be a positive safe integer or null.`,
    );
  }
  assertSafeTime(domain.iterationGap, `${path}.iterationGap`);
  assertFiniteNumber(domain.rate, `${path}.rate`);
  if (domain.rate <= 0) throw new Error(`${path}.rate must be positive.`);
  if (!new Set(["forward", "reverse", "alternate"]).has(domain.direction)) {
    throw new Error(`${path}.direction is not supported.`);
  }
  if (!new Set(["never", "iteration"]).has(domain.refresh)) {
    throw new Error(`${path}.refresh is not supported.`);
  }
  if (domain.refresh === "iteration") {
    if (domain.iterations === null) {
      throw new Error(`${path} cannot refresh an infinite domain.`);
    }
    if (domain.iterations > MAX_REPEAT_REFRESH_ITERATIONS) {
      throw new Error(
        `${path}.iterations exceeds the ${MAX_REPEAT_REFRESH_ITERATIONS} repeat-refresh limit.`,
      );
    }
  }
  if (
    Number.isSafeInteger(domain.cycleDuration) &&
    domain.iterations !== 1 &&
    domain.cycleDuration === 0
  ) {
    throw new Error(`${path} cannot repeat a zero-duration cycle.`);
  }
};

const validateStagger = (stagger, path) => {
  assertPlainObject(stagger, path);
  assertKnownFields(
    stagger,
    new Set(["each", "amount", "from", "easing", "grid", "axis"]),
    path,
  );
  if ((stagger.each === undefined) === (stagger.amount === undefined)) {
    throw new Error(`${path} requires exactly one of each or amount.`);
  }
  if (stagger.each !== undefined) assertSafeTime(stagger.each, `${path}.each`);
  if (stagger.amount !== undefined)
    assertSafeTime(stagger.amount, `${path}.amount`);
  if (
    stagger.from !== undefined &&
    !(Number.isSafeInteger(stagger.from) && stagger.from >= 0) &&
    !staggerOrigins.has(stagger.from)
  ) {
    throw new Error(`${path}.from is not supported.`);
  }
  if (stagger.easing !== undefined)
    normalizeEasing(stagger.easing, `${path}.easing`);
  if (stagger.grid !== undefined) {
    assertPlainObject(stagger.grid, `${path}.grid`);
    assertKnownFields(stagger.grid, new Set(["columns"]), `${path}.grid`);
    if (
      !Number.isSafeInteger(stagger.grid.columns) ||
      stagger.grid.columns <= 0
    ) {
      throw new Error(`${path}.grid.columns must be a positive safe integer.`);
    }
  }
  if (stagger.axis !== undefined && !new Set(["x", "y"]).has(stagger.axis)) {
    throw new Error(`${path}.axis must be x or y.`);
  }
  if (stagger.axis !== undefined && stagger.grid === undefined) {
    throw new Error(`${path}.axis requires grid.`);
  }
};

const validateClip = (clip, path, program) => {
  assertPlainObject(clip, path);
  assertKnownFields(
    clip,
    new Set([
      "id",
      "sourcePath",
      "domain",
      "targets",
      "fanout",
      "channel",
      "valueType",
      "start",
      "duration",
      "sampler",
      "modifiers",
      "composite",
      "priority",
      "fill",
      "overwrite",
    ]),
    path,
  );
  for (const field of ["id", "domain", "targets", "channel", "valueType"]) {
    assertNonEmptyString(clip[field], `${path}.${field}`);
  }
  if (!program.domains[clip.domain]) {
    throw new Error(
      `${path}.domain references unknown domain "${clip.domain}".`,
    );
  }
  if (!program.targetQueries[clip.targets]) {
    throw new Error(
      `${path}.targets references unknown query "${clip.targets}".`,
    );
  }
  if (clip.fanout !== null) {
    assertPlainObject(clip.fanout, `${path}.fanout`);
    assertKnownFields(clip.fanout, new Set(["stagger"]), `${path}.fanout`);
    validateStagger(clip.fanout.stagger, `${path}.fanout.stagger`);
  }
  if (!valueTypes.has(clip.valueType)) {
    throw new Error(`${path}.valueType is not supported.`);
  }
  validateTimingExpression(clip.start, `${path}.start`);
  validateTimingExpression(clip.duration, `${path}.duration`);
  assertPlainObject(clip.sampler, `${path}.sampler`);
  assertKnownFields(
    clip.sampler,
    new Set(["kind", "from", "to", "easing"]),
    `${path}.sampler`,
  );
  if (clip.sampler.kind !== "interpolate") {
    throw new Error(`${path}.sampler.kind is not supported.`);
  }
  validateExpression(clip.sampler.from, `${path}.sampler.from`);
  validateExpression(clip.sampler.to, `${path}.sampler.to`);
  validateExpressionStaticType(
    clip.sampler.from,
    clip.valueType,
    `${path}.sampler.from`,
  );
  validateExpressionStaticType(
    clip.sampler.to,
    clip.valueType,
    `${path}.sampler.to`,
  );
  assertNonEmptyString(clip.sampler.easing, `${path}.sampler.easing`);
  if (!program.easings[clip.sampler.easing]) {
    throw new Error(`${path}.sampler.easing references an unknown easing.`);
  }
  if (!Array.isArray(clip.modifiers)) {
    throw new Error(`${path}.modifiers must be an array.`);
  }
  clip.modifiers.forEach((modifier, index) =>
    normalizeModifier(modifier, `${path}.modifiers[${index}]`),
  );
  if (!compositeModes.has(clip.composite)) {
    throw new Error(`${path}.composite is not supported.`);
  }
  if (!Number.isSafeInteger(clip.priority) || clip.priority < 0) {
    throw new Error(`${path}.priority must be a non-negative safe integer.`);
  }
  if (!fillModes.has(clip.fill)) {
    throw new Error(`${path}.fill is not supported.`);
  }
  if (
    clip.overwrite !== undefined &&
    !new Set(["auto", "all", "none", "error"]).has(clip.overwrite)
  ) {
    throw new Error(`${path}.overwrite is not supported.`);
  }
};

const validateEvent = (event, path, program) => {
  assertPlainObject(event, path);
  assertKnownFields(
    event,
    new Set([
      "id",
      "domain",
      "time",
      "name",
      "payload",
      "direction",
      "occurrence",
      "seekPolicy",
      "priority",
    ]),
    path,
  );
  for (const field of ["id", "domain", "name"]) {
    assertNonEmptyString(event[field], `${path}.${field}`);
  }
  if (!program.domains[event.domain]) {
    throw new Error(`${path}.domain references an unknown domain.`);
  }
  validateTimingExpression(event.time, `${path}.time`);
  assertSerializableData(event.payload ?? null, `${path}.payload`);
  if (!new Set(["forward", "reverse", "both"]).has(event.direction)) {
    throw new Error(`${path}.direction is not supported.`);
  }
  if (!new Set(["once", "eachIteration"]).has(event.occurrence)) {
    throw new Error(`${path}.occurrence is not supported.`);
  }
  if (!new Set(["suppress", "crossed"]).has(event.seekPolicy)) {
    throw new Error(`${path}.seekPolicy is not supported.`);
  }
  if (!Number.isSafeInteger(event.priority) || event.priority < 0) {
    throw new Error(`${path}.priority must be a non-negative safe integer.`);
  }
};

const assertUniqueIds = (entries, path) => {
  const ids = new Set();
  entries.forEach((entry, index) => {
    if (ids.has(entry.id)) {
      throw new Error(`${path}[${index}].id "${entry.id}" is duplicated.`);
    }
    ids.add(entry.id);
  });
};

const validateReferences = (program) => {
  if (!program.domains.root) {
    throw new Error("program.domains.root is required.");
  }
  for (const [id, domain] of Object.entries(program.domains)) {
    if (id !== "root" && domain.parent === null) {
      throw new Error(`domains.${id}.parent must eventually reference root.`);
    }
    if (domain.parent !== null && !program.domains[domain.parent]) {
      throw new Error(`domains.${id}.parent references an unknown domain.`);
    }

    const seen = new Set([id]);
    let parent = domain.parent;
    while (parent !== null) {
      if (seen.has(parent)) throw new Error(`domains.${id} contains a cycle.`);
      seen.add(parent);
      parent = program.domains[parent]?.parent ?? null;
    }
    if (id !== "root" && !seen.has("root")) {
      throw new Error(`domains.${id}.parent must eventually reference root.`);
    }
  }
  if (program.domains.root.parent !== null) {
    throw new Error("program.domains.root.parent must be null.");
  }

  const visiting = new Set();
  const visited = new Set();
  const visitQuery = (alias) => {
    if (visited.has(alias)) return;
    if (visiting.has(alias)) {
      throw new Error(`targetQueries.${alias} contains a union cycle.`);
    }
    visiting.add(alias);
    const query = program.targetQueries[alias];
    if (query.kind === "union") {
      for (const child of query.aliases) {
        if (!program.targetQueries[child]) {
          throw new Error(
            `targetQueries.${alias}.aliases references unknown query "${child}".`,
          );
        }
        visitQuery(child);
      }
    }
    visiting.delete(alias);
    visited.add(alias);
  };
  for (const alias of Object.keys(program.targetQueries)) {
    visitQuery(alias);
  }
};

const assertWithinLimit = (value, limit, path) => {
  if (value > limit) {
    throw new Error(
      `${path} count ${value} exceeds the JS runtime limit ${limit}.`,
    );
  }
};

export const validateTimelineProgram = (program, { freeze = true } = {}) => {
  assertPlainObject(program, "program");
  assertKnownFields(
    program,
    new Set([
      "schema",
      "timeUnit",
      "programId",
      "ownerId",
      "duration",
      "requirements",
      "targetQueries",
      "schedules",
      "domains",
      "easings",
      "clipTemplates",
      "events",
      "debug",
    ]),
    "program",
  );
  if (program.schema !== TIMELINE_SCHEMA) {
    throw new Error(`program.schema must be "${TIMELINE_SCHEMA}".`);
  }
  if (program.timeUnit !== TIMELINE_TIME_UNIT) {
    throw new Error(`program.timeUnit must be "${TIMELINE_TIME_UNIT}".`);
  }
  assertNonEmptyString(program.programId, "program.programId");
  assertNonEmptyString(program.ownerId, "program.ownerId");
  if (!new Set(["binding", "infinite"]).has(program.duration)) {
    assertSafeTime(program.duration, "program.duration");
  }
  assertSortedUniqueStrings(program.requirements, "program.requirements");

  for (const field of ["targetQueries", "schedules", "domains", "easings"]) {
    assertPlainObject(program[field], `program.${field}`);
  }
  assertWithinLimit(
    Object.keys(program.targetQueries).length,
    JS_TIMELINE_LIMITS.targetQueries,
    "program.targetQueries",
  );
  assertWithinLimit(
    Object.keys(program.domains).length,
    JS_TIMELINE_LIMITS.domains,
    "program.domains",
  );
  for (const [alias, query] of Object.entries(program.targetQueries)) {
    assertNonEmptyString(alias, "program target alias");
    validateTargetQuery(query, `program.targetQueries.${alias}`);
  }
  for (const [id, schedule] of Object.entries(program.schedules)) {
    assertNonEmptyString(id, "program schedule id");
    if (Number.isSafeInteger(schedule))
      validateTimingExpression(schedule, `program.schedules.${id}`);
    else {
      assertPlainObject(schedule, `program.schedules.${id}`);
      assertKnownFields(schedule, new Set(["end"]), `program.schedules.${id}`);
      validateTimingExpression(schedule.end, `program.schedules.${id}.end`);
    }
  }
  for (const [id, domain] of Object.entries(program.domains)) {
    assertNonEmptyString(id, "program domain id");
    validateDomainEntry(domain, `program.domains.${id}`);
  }
  for (const [id, easing] of Object.entries(program.easings)) {
    assertNonEmptyString(id, "program easing id");
    normalizeEasing(easing, `program.easings.${id}`);
  }

  if (!Array.isArray(program.clipTemplates)) {
    throw new Error("program.clipTemplates must be an array.");
  }
  if (!Array.isArray(program.events)) {
    throw new Error("program.events must be an array.");
  }
  assertWithinLimit(
    program.clipTemplates.length,
    JS_TIMELINE_LIMITS.clipTemplates,
    "program.clipTemplates",
  );
  assertWithinLimit(
    program.events.length,
    JS_TIMELINE_LIMITS.events,
    "program.events",
  );
  assertUniqueIds(program.clipTemplates, "program.clipTemplates");
  assertUniqueIds(program.events, "program.events");
  program.clipTemplates.forEach((clip, index) =>
    validateClip(clip, `program.clipTemplates[${index}]`, program),
  );
  program.events.forEach((event, index) =>
    validateEvent(event, `program.events[${index}]`, program),
  );
  if (program.debug !== undefined) {
    assertSerializableData(program.debug, "program.debug");
  }
  validateReferences(program);

  const result = cloneData(program);
  return freeze ? deepFreeze(result) : result;
};
