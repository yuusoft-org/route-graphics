import { PORTABLE_GSAP_PROFILE } from "./constants.js";
import { normalizeEasing } from "./easing.js";
import { normalizeModifier } from "./modifiers.js";
import {
  assertFiniteNumber,
  assertKnownFields,
  assertNonEmptyString,
  assertPlainObject,
  assertSignedSafeTime,
  assertSafeTime,
  assertSerializableData,
  isPlainObject,
} from "./validation.js";

const overwriteModes = new Set(["auto", "all", "none", "error"]);
const stepKinds = new Set([
  "set",
  "to",
  "from",
  "fromTo",
  "keyframes",
  "sequence",
  "parallel",
  "wait",
  "mark",
  "emit",
]);
const commonScheduleFields = ["kind", "id", "delay", "start", "overlap"];
const repeatFields = [
  "repeat",
  "repeatDelay",
  "yoyo",
  "repeatRefresh",
  "speed",
];
const valueActionFields = ["targets", "stagger", "overwrite", "modifiers"];
const tweenActionFields = ["duration", "easing", ...repeatFields];

const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    );
  }
  return Object.is(value, -0) ? 0 : value;
};

const validateRepeat = (value, path, { allow = true } = {}) => {
  const repeat = value.repeat ?? 0;
  if (!allow && repeat !== 0) throw new Error(`${path}.repeat is not valid.`);
  if (repeat !== "infinite" && (!Number.isSafeInteger(repeat) || repeat < 0)) {
    throw new Error(
      `${path}.repeat must be a non-negative safe integer or "infinite".`,
    );
  }
  if (value.repeatDelay !== undefined) {
    assertSafeTime(value.repeatDelay, `${path}.repeatDelay`);
  }
  if (value.yoyo !== undefined && typeof value.yoyo !== "boolean") {
    throw new Error(`${path}.yoyo must be a boolean.`);
  }
  if (
    value.repeatRefresh !== undefined &&
    typeof value.repeatRefresh !== "boolean"
  ) {
    throw new Error(`${path}.repeatRefresh must be a boolean.`);
  }
  if (value.speed !== undefined) {
    assertFiniteNumber(value.speed, `${path}.speed`);
    if (value.speed <= 0) throw new Error(`${path}.speed must be positive.`);
  }
  if (repeat === 0) {
    for (const field of ["repeatDelay", "yoyo", "repeatRefresh"]) {
      if (
        value[field] !== undefined &&
        value[field] !== 0 &&
        value[field] !== false
      ) {
        throw new Error(`${path}.${field} requires a non-zero repeat.`);
      }
    }
  }
  if (value.repeatRefresh === true) {
    if (repeat === "infinite") {
      throw new Error(`${path}.repeatRefresh cannot be infinite.`);
    }
    if (repeat + 1 > 10_000) {
      throw new Error(`${path}.repeatRefresh is limited to 10000 iterations.`);
    }
  }
};

const validateStart = (start, path) => {
  assertPlainObject(start, path);
  const hasTime = start.time !== undefined;
  const hasAnchor = start.anchor !== undefined;
  if (hasTime === hasAnchor) {
    throw new Error(`${path} requires exactly one of time or anchor.`);
  }
  if (hasTime) {
    assertKnownFields(start, new Set(["time"]), path);
    assertSafeTime(start.time, `${path}.time`);
    return;
  }
  assertKnownFields(start, new Set(["anchor", "edge", "offset"]), path);
  assertNonEmptyString(start.anchor, `${path}.anchor`);
  if (start.edge !== undefined && !new Set(["start", "end"]).has(start.edge)) {
    throw new Error(`${path}.edge must be start or end.`);
  }
  if (start.offset !== undefined) {
    assertSignedSafeTime(start.offset, `${path}.offset`);
  }
};

const validateTargetsValue = (targets, path) => {
  if (typeof targets === "string") {
    assertNonEmptyString(targets, path);
    return;
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(`${path} must be a target alias or non-empty alias array.`);
  }
  targets.forEach((alias, index) =>
    assertNonEmptyString(alias, `${path}[${index}]`),
  );
  if (new Set(targets).size !== targets.length) {
    throw new Error(`${path} must not repeat an alias.`);
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
    !Number.isInteger(stagger.from) &&
    !new Set(["start", "center", "end", "edges", "random"]).has(stagger.from)
  ) {
    throw new Error(`${path}.from is not supported.`);
  }
  if (typeof stagger.from === "number" && stagger.from < 0) {
    throw new Error(`${path}.from index must be non-negative.`);
  }
  if (stagger.easing !== undefined)
    normalizeEasing(stagger.easing, `${path}.easing`);
  if (stagger.grid !== undefined) {
    assertPlainObject(stagger.grid, `${path}.grid`);
    assertKnownFields(stagger.grid, new Set(["columns"]), `${path}.grid`);
    if (!Number.isInteger(stagger.grid.columns) || stagger.grid.columns <= 0) {
      throw new Error(`${path}.grid.columns must be a positive integer.`);
    }
  }
  if (stagger.axis !== undefined && !new Set(["x", "y"]).has(stagger.axis)) {
    throw new Error(`${path}.axis must be x or y.`);
  }
  if (stagger.axis !== undefined && stagger.grid === undefined) {
    throw new Error(`${path}.axis requires grid.`);
  }
};

const validateValues = (values, path) => {
  assertPlainObject(values, path);
  if (Object.keys(values).length === 0) {
    throw new Error(`${path} must define at least one channel.`);
  }
  assertSerializableData(values, path);
};

const validateModifiers = (modifiers, path) => {
  assertPlainObject(modifiers, path);
  if (Object.keys(modifiers).length === 0) {
    throw new Error(`${path} must define at least one channel.`);
  }
  for (const [property, pipeline] of Object.entries(modifiers)) {
    if (!Array.isArray(pipeline) || pipeline.length === 0) {
      throw new Error(`${path}.${property} must be a non-empty array.`);
    }
    pipeline.forEach((modifier, index) =>
      normalizeModifier(modifier, `${path}.${property}[${index}]`),
    );
  }
};

const validateDefaults = (defaults, path) => {
  assertPlainObject(defaults, path);
  assertKnownFields(
    defaults,
    new Set([
      "duration",
      "easing",
      "overwrite",
      "repeat",
      "repeatDelay",
      "yoyo",
      "repeatRefresh",
    ]),
    path,
  );
  if (defaults.duration !== undefined)
    assertSafeTime(defaults.duration, `${path}.duration`);
  if (defaults.easing !== undefined)
    normalizeEasing(defaults.easing, `${path}.easing`);
  if (
    defaults.overwrite !== undefined &&
    !overwriteModes.has(defaults.overwrite)
  ) {
    throw new Error(`${path}.overwrite is not supported.`);
  }
  validateRepeat(defaults, path);
};

const validateCommon = (step, path, placement) => {
  if (step.id !== undefined) assertNonEmptyString(step.id, `${path}.id`);
  if (step.delay !== undefined) assertSafeTime(step.delay, `${path}.delay`);
  if (step.overlap !== undefined) {
    assertSafeTime(step.overlap, `${path}.overlap`);
    if (placement !== "sequence") {
      throw new Error(`${path}.overlap is valid only inside a sequence.`);
    }
  }
  if (step.start !== undefined) validateStart(step.start, `${path}.start`);
  if (step.start !== undefined && step.overlap !== undefined) {
    throw new Error(`${path} cannot define both start and overlap.`);
  }
};

const validateStep = (step, path, placement, animationType) => {
  assertPlainObject(step, path);
  if (!stepKinds.has(step.kind)) {
    throw new Error(`${path}.kind is not supported.`);
  }
  validateCommon(step, path, placement);

  let fields;
  switch (step.kind) {
    case "set":
      fields = [...commonScheduleFields, ...valueActionFields, "values"];
      validateValues(step.values, `${path}.values`);
      break;
    case "to":
    case "from":
      fields = [
        ...commonScheduleFields,
        ...valueActionFields,
        ...tweenActionFields,
        "values",
      ];
      validateValues(step.values, `${path}.values`);
      break;
    case "fromTo":
      fields = [
        ...commonScheduleFields,
        ...valueActionFields,
        ...tweenActionFields,
        "from",
        "to",
      ];
      validateValues(step.from, `${path}.from`);
      validateValues(step.to, `${path}.to`);
      break;
    case "keyframes":
      fields = [
        ...commonScheduleFields,
        ...valueActionFields,
        ...tweenActionFields.filter((field) => field !== "duration"),
        "frames",
      ];
      if (!Array.isArray(step.frames) || step.frames.length === 0) {
        throw new Error(`${path}.frames must be a non-empty array.`);
      }
      step.frames.forEach((frame, index) => {
        const framePath = `${path}.frames[${index}]`;
        assertPlainObject(frame, framePath);
        assertKnownFields(
          frame,
          new Set(["values", "duration", "delay", "easing"]),
          framePath,
        );
        validateValues(frame.values, `${framePath}.values`);
        assertSafeTime(frame.duration, `${framePath}.duration`);
        if (frame.delay !== undefined)
          assertSafeTime(frame.delay, `${framePath}.delay`);
        if (frame.easing !== undefined)
          normalizeEasing(frame.easing, `${framePath}.easing`);
      });
      break;
    case "sequence":
    case "parallel":
      fields = [...commonScheduleFields, ...repeatFields, "steps", "defaults"];
      if (!Array.isArray(step.steps) || step.steps.length === 0) {
        throw new Error(`${path}.steps must be a non-empty array.`);
      }
      if (step.defaults !== undefined)
        validateDefaults(step.defaults, `${path}.defaults`);
      step.steps.forEach((child, index) =>
        validateStep(
          child,
          `${path}.steps[${index}]`,
          step.kind,
          animationType,
        ),
      );
      break;
    case "wait":
      fields = [...commonScheduleFields, "duration"];
      if (placement !== "sequence")
        throw new Error(`${path} wait is valid only in a sequence.`);
      assertSafeTime(step.duration, `${path}.duration`);
      break;
    case "mark":
      fields = [...commonScheduleFields, "name"];
      assertNonEmptyString(step.name, `${path}.name`);
      break;
    case "emit":
      fields = [
        ...commonScheduleFields,
        "event",
        "payload",
        "direction",
        "occurrence",
        "seekPolicy",
      ];
      assertNonEmptyString(step.event, `${path}.event`);
      assertSerializableData(step.payload ?? null, `${path}.payload`);
      if (
        step.direction !== undefined &&
        !new Set(["forward", "reverse", "both"]).has(step.direction)
      ) {
        throw new Error(`${path}.direction is not supported.`);
      }
      if (
        step.occurrence !== undefined &&
        !new Set(["once", "eachIteration"]).has(step.occurrence)
      ) {
        throw new Error(`${path}.occurrence is not supported.`);
      }
      if (
        step.seekPolicy !== undefined &&
        !new Set(["suppress", "crossed"]).has(step.seekPolicy)
      ) {
        throw new Error(`${path}.seekPolicy is not supported.`);
      }
      break;
  }
  assertKnownFields(step, new Set(fields), path);
  if (step.targets !== undefined)
    validateTargetsValue(step.targets, `${path}.targets`);
  else if (
    animationType === "transition" &&
    new Set(["set", "to", "from", "fromTo", "keyframes"]).has(step.kind)
  ) {
    throw new Error(
      `${path}.targets is required for transition value actions.`,
    );
  }
  if (step.stagger !== undefined)
    validateStagger(step.stagger, `${path}.stagger`);
  if (step.overwrite !== undefined && !overwriteModes.has(step.overwrite)) {
    throw new Error(`${path}.overwrite is not supported.`);
  }
  if (step.modifiers !== undefined)
    validateModifiers(step.modifiers, `${path}.modifiers`);
  if (step.duration !== undefined && !new Set(["wait"]).has(step.kind)) {
    assertSafeTime(step.duration, `${path}.duration`);
  }
  if (step.easing !== undefined) normalizeEasing(step.easing, `${path}.easing`);
  if (
    new Set(["to", "from", "fromTo", "sequence", "parallel", "keyframes"]).has(
      step.kind,
    )
  ) {
    validateRepeat(step, path);
  }
};

const validateTarget = (target, path, animationType) => {
  assertPlainObject(target, path);
  const fields = Object.keys(target);
  if (fields.length !== 1)
    throw new Error(`${path} must define one target kind.`);
  const kind = fields[0];
  if (kind === "element") {
    if (animationType !== "update")
      throw new Error(`${path}.element is update-only.`);
    assertNonEmptyString(target.element, `${path}.element`);
  } else if (kind === "elements") {
    if (animationType !== "update")
      throw new Error(`${path}.elements is update-only.`);
    if (!Array.isArray(target.elements) || target.elements.length === 0) {
      throw new Error(`${path}.elements must be a non-empty array.`);
    }
    target.elements.forEach((id, index) =>
      assertNonEmptyString(id, `${path}.elements[${index}]`),
    );
    if (new Set(target.elements).size !== target.elements.length) {
      throw new Error(`${path}.elements must not contain duplicates.`);
    }
  } else if (kind === "textUnits") {
    if (animationType !== "update")
      throw new Error(`${path}.textUnits is update-only.`);
    const query = target.textUnits;
    assertPlainObject(query, `${path}.textUnits`);
    assertKnownFields(
      query,
      new Set(["elementId", "unit", "order", "allowEmpty"]),
      `${path}.textUnits`,
    );
    assertNonEmptyString(query.elementId, `${path}.textUnits.elementId`);
    if (!new Set(["grapheme", "word", "line"]).has(query.unit))
      throw new Error(`${path}.textUnits.unit is unsupported.`);
    if (
      query.order !== undefined &&
      !new Set(["logical", "visual"]).has(query.order)
    )
      throw new Error(`${path}.textUnits.order is unsupported.`);
    if (query.allowEmpty !== undefined && typeof query.allowEmpty !== "boolean")
      throw new Error(`${path}.textUnits.allowEmpty must be boolean.`);
  } else if (kind === "transitionSurface") {
    if (
      animationType !== "transition" ||
      !new Set(["prev", "next"]).has(target.transitionSurface)
    ) {
      throw new Error(
        `${path}.transitionSurface must be prev or next on a transition.`,
      );
    }
  } else if (kind === "transitionMask") {
    const selector = target.transitionMask;
    if (
      animationType !== "transition" ||
      (selector !== true && (!Number.isSafeInteger(selector) || selector < 0))
    ) {
      throw new Error(
        `${path}.transitionMask must be true or a non-negative mask index on a transition.`,
      );
    }
  } else if (kind === "transitionCompositor") {
    if (
      animationType !== "transition" ||
      target.transitionCompositor !== true
    ) {
      throw new Error(
        `${path}.transitionCompositor must be true on a transition.`,
      );
    }
  } else throw new Error(`${path}.${kind} is not a supported target kind.`);
};

export const normalizePortableGsap = (gsap, path, animationType) => {
  assertPlainObject(gsap, path);
  assertKnownFields(
    gsap,
    new Set(["profile", "defaults", "targets", "steps"]),
    path,
  );
  if (gsap.profile !== PORTABLE_GSAP_PROFILE) {
    throw new Error(`${path}.profile must be "${PORTABLE_GSAP_PROFILE}".`);
  }
  if (gsap.defaults !== undefined)
    validateDefaults(gsap.defaults, `${path}.defaults`);
  if (gsap.targets !== undefined) {
    assertPlainObject(gsap.targets, `${path}.targets`);
    for (const [alias, target] of Object.entries(gsap.targets)) {
      assertNonEmptyString(alias, `${path} target alias`);
      if (alias === "self")
        throw new Error(`${path}.targets.self is reserved.`);
      validateTarget(target, `${path}.targets.${alias}`, animationType);
    }
  }
  if (!Array.isArray(gsap.steps) || gsap.steps.length === 0) {
    throw new Error(`${path}.steps must be a non-empty array.`);
  }
  gsap.steps.forEach((step, index) =>
    validateStep(step, `${path}.steps[${index}]`, "sequence", animationType),
  );
  return clone(gsap);
};
