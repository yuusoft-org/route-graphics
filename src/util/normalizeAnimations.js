import { SUPPORTED_EASING_NAMES } from "./animationTimeline.js";
import { normalizeShaderCompositor } from "../plugins/elements/util/shaderConfig.js";
import { Color } from "pixi.js";
import { normalizePortableGsap } from "../plugins/animations/timeline/normalizePortableGsap.js";

const ANIMATION_TYPES = new Set(["update", "transition"]);
const CONTINUITY_MODES = new Set(["render", "persistent"]);
const DEFAULT_PLAYBACK_CONTINUITY = "render";
const DEFAULT_PLAYBACK_SPEED = 1;
const DEFAULT_PLAYBACK_LOOP = false;
const DEFAULT_PLAYBACK_REPEAT = 0;
const DEFAULT_PLAYBACK_REPEAT_DELAY = 0;
const DEFAULT_PLAYBACK_YOYO = false;
const UPDATE_TWEEN_PROPERTIES = new Set([
  "alpha",
  "x",
  "y",
  "translateX",
  "translateY",
  "scaleX",
  "scaleY",
  "rotation",
  "blurX",
  "blurY",
]);
const TRANSITION_TWEEN_PROPERTIES = new Set([
  "x",
  "y",
  "translateX",
  "translateY",
  "alpha",
  "scaleX",
  "scaleY",
  "rotation",
]);
const MASK_KINDS = new Set(["single", "sequence"]);
const MASK_CHANNELS = new Set(["red", "green", "blue", "alpha"]);
const MASK_SEQUENCE_SAMPLE_MODES = new Set(["hold", "linear"]);
const SUPPORTED_EASINGS = new Set(SUPPORTED_EASING_NAMES);
const SHADER_PARAMETER_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const RECT_STYLE_TWEEN_FIELDS = new Set([
  "width",
  "height",
  "fill",
  "border",
  "cornerRadius",
]);

const assertPlainObject = (value, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
};

const assertString = (value, path) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
};

const assertKnownFields = (value, fields, path) => {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) {
      throw new Error(`${path}.${key} is not supported.`);
    }
  }
};

const assertNumber = (value, path) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${path} must be a number.`);
  }
};

const assertShaderTweenValue = (value, path) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }

  if (
    Array.isArray(value) &&
    [2, 3, 4, 9, 16].includes(value.length) &&
    value.every((component) => Number.isFinite(component))
  ) {
    return;
  }

  throw new Error(
    `${path} must be a finite number or a numeric array with length 2, 3, 4, 9, or 16.`,
  );
};

const assertShaderProgressValue = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
};

const assertPositiveFiniteNumber = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${path} must be a finite number greater than 0.`);
  }
};

const assertNonNegativeSafeIntegerMilliseconds = (value, path) => {
  if (value === undefined) {
    throw new Error(`${path} must be a number.`);
  }

  const isDirectLegacyTweenPath =
    /^animations\[\d+\]\.tween\.(?!filters\.)/.test(path);
  if (
    isDirectLegacyTweenPath &&
    path.endsWith(".delay") &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    value < 0
  ) {
    throw new Error(
      `${path} must be a finite number greater than or equal to 0.`,
    );
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new Error(
      `${path} must be a finite number greater than or equal to 0 and an integer number of milliseconds.`,
    );
  }
};

const normalizePlayback = (playback, path) => {
  assertPlainObject(playback, path);

  assertKnownFields(
    playback,
    new Set(["continuity", "speed", "loop", "repeat", "repeatDelay", "yoyo"]),
    path,
  );

  const continuity = playback.continuity ?? DEFAULT_PLAYBACK_CONTINUITY;
  if (!CONTINUITY_MODES.has(continuity)) {
    throw new Error(
      `${path}.continuity must be one of: ${Array.from(CONTINUITY_MODES).join(", ")}.`,
    );
  }

  const normalized = { continuity };

  if (playback.speed !== undefined) {
    assertPositiveFiniteNumber(playback.speed, `${path}.speed`);
    if (playback.speed !== DEFAULT_PLAYBACK_SPEED) {
      normalized.speed = playback.speed;
    }
  }

  if (playback.loop !== undefined && playback.repeat !== undefined) {
    throw new Error(`${path} cannot define both loop and repeat.`);
  }

  const loop = playback.loop ?? DEFAULT_PLAYBACK_LOOP;
  if (typeof loop !== "boolean") {
    throw new Error(`${path}.loop must be a boolean.`);
  }
  if (loop) {
    normalized.loop = true;
  }

  const repeat = playback.repeat ?? DEFAULT_PLAYBACK_REPEAT;
  if (repeat !== "infinite" && (!Number.isSafeInteger(repeat) || repeat < 0)) {
    throw new Error(
      `${path}.repeat must be a non-negative safe integer or "infinite".`,
    );
  }
  if (repeat !== DEFAULT_PLAYBACK_REPEAT) {
    normalized.repeat = repeat;
  }

  const repeatDelay = playback.repeatDelay ?? DEFAULT_PLAYBACK_REPEAT_DELAY;
  assertNonNegativeSafeIntegerMilliseconds(repeatDelay, `${path}.repeatDelay`);

  const yoyo = playback.yoyo ?? DEFAULT_PLAYBACK_YOYO;
  if (typeof yoyo !== "boolean") {
    throw new Error(`${path}.yoyo must be a boolean.`);
  }

  const isRepeating = loop || repeat === "infinite" || repeat > 0;
  if (!isRepeating && repeatDelay > 0) {
    throw new Error(`${path}.repeatDelay requires repeat or loop.`);
  }
  if (!isRepeating && yoyo) {
    throw new Error(`${path}.yoyo requires repeat or loop.`);
  }
  if (repeatDelay > 0) normalized.repeatDelay = repeatDelay;
  if (yoyo) normalized.yoyo = true;

  return normalized;
};

const normalizeAutoTween = (autoConfig, path) => {
  assertPlainObject(autoConfig, path);
  assertNonNegativeSafeIntegerMilliseconds(
    autoConfig.duration,
    `${path}.duration`,
  );

  if (autoConfig.delay !== undefined) {
    assertNonNegativeSafeIntegerMilliseconds(autoConfig.delay, `${path}.delay`);
  }

  if (
    autoConfig.easing !== undefined &&
    typeof autoConfig.easing !== "string"
  ) {
    throw new Error(`${path}.easing must be a string.`);
  }

  if (
    autoConfig.easing !== undefined &&
    !SUPPORTED_EASINGS.has(autoConfig.easing)
  ) {
    throw new Error(
      `${path}.easing must be one of: ${SUPPORTED_EASING_NAMES.join(", ")}.`,
    );
  }

  return {
    duration: autoConfig.duration,
    easing: autoConfig.easing ?? "linear",
    ...(autoConfig.delay > 0 ? { delay: autoConfig.delay } : {}),
  };
};

const normalizeKeyframes = (
  propertyConfig,
  path,
  assertValue = assertNumber,
  normalizeValue = (value) => (Array.isArray(value) ? [...value] : value),
) => {
  assertPlainObject(propertyConfig, path);

  const normalized = {};

  if (propertyConfig.initialValue !== undefined) {
    assertValue(propertyConfig.initialValue, `${path}.initialValue`);
    normalized.initialValue = normalizeValue(propertyConfig.initialValue);
  }

  if (
    !Array.isArray(propertyConfig.keyframes) ||
    propertyConfig.keyframes.length === 0
  ) {
    throw new Error(`${path}.keyframes must be a non-empty array.`);
  }

  normalized.keyframes = propertyConfig.keyframes.map((keyframe, index) => {
    const keyframePath = `${path}.keyframes[${index}]`;
    assertPlainObject(keyframe, keyframePath);
    assertValue(keyframe.value, `${keyframePath}.value`);
    assertNonNegativeSafeIntegerMilliseconds(
      keyframe.duration,
      `${keyframePath}.duration`,
    );

    if (keyframe.delay !== undefined) {
      assertNonNegativeSafeIntegerMilliseconds(
        keyframe.delay,
        `${keyframePath}.delay`,
      );
    }

    if (keyframe.easing !== undefined && typeof keyframe.easing !== "string") {
      throw new Error(`${keyframePath}.easing must be a string.`);
    }

    if (
      keyframe.easing !== undefined &&
      !SUPPORTED_EASINGS.has(keyframe.easing)
    ) {
      throw new Error(
        `${keyframePath}.easing must be one of: ${SUPPORTED_EASING_NAMES.join(", ")}.`,
      );
    }

    if (
      keyframe.relative !== undefined &&
      typeof keyframe.relative !== "boolean"
    ) {
      throw new Error(`${keyframePath}.relative must be a boolean.`);
    }

    return {
      value: normalizeValue(keyframe.value),
      duration: keyframe.duration,
      easing: keyframe.easing ?? "linear",
      ...(keyframe.delay > 0 ? { delay: keyframe.delay } : {}),
      ...(keyframe.relative !== undefined
        ? { relative: keyframe.relative }
        : {}),
    };
  });

  return normalized;
};

const normalizeShaderTweenMap = (tween, path) => {
  assertPlainObject(tween, path);
  const entries = Object.entries(tween);
  if (entries.length === 0) {
    throw new Error(`${path} must define at least one parameter.`);
  }

  return Object.fromEntries(
    entries.map(([parameter, config]) => {
      if (parameter === "uTime" || parameter === "time") {
        throw new Error(
          `${path}.${parameter} is read-only. Animate a custom parameter instead.`,
        );
      }
      if (parameter === "uProgress") {
        throw new Error(
          `${path}.uProgress is no longer supported. Use ${path}.progress.`,
        );
      }
      if (
        parameter !== "progress" &&
        !SHADER_PARAMETER_PATTERN.test(parameter)
      ) {
        throw new Error(
          `${path}.${parameter} must be progress or match ${SHADER_PARAMETER_PATTERN.source}.`,
        );
      }

      return [
        parameter === "progress" ? "uProgress" : parameter,
        normalizeKeyframes(
          config,
          `${path}.${parameter}`,
          parameter === "progress"
            ? assertShaderProgressValue
            : assertShaderTweenValue,
        ),
      ];
    }),
  );
};

const normalizeUpdatePropertyConfig = (propertyConfig, path) => {
  assertPlainObject(propertyConfig, path);

  const hasKeyframes = propertyConfig.keyframes !== undefined;
  const hasAuto = propertyConfig.auto !== undefined;

  if (hasKeyframes && hasAuto) {
    throw new Error(`${path} cannot define both keyframes and auto.`);
  }

  if (!hasKeyframes && !hasAuto) {
    throw new Error(`${path} must define keyframes or auto.`);
  }

  if (hasAuto) {
    if (propertyConfig.initialValue !== undefined) {
      throw new Error(
        `${path}.initialValue is not valid when auto is defined.`,
      );
    }

    return {
      auto: normalizeAutoTween(propertyConfig.auto, `${path}.auto`),
    };
  }

  return normalizeKeyframes(propertyConfig, path);
};

const normalizeColorValue = (value, path) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty color string.`);
  }

  try {
    return new Color(value).toArray();
  } catch {
    throw new Error(`${path} must be a valid color.`);
  }
};

const normalizeColorPropertyConfig = (propertyConfig, path) => {
  assertPlainObject(propertyConfig, path);

  if (propertyConfig.auto !== undefined) {
    return normalizeUpdatePropertyConfig(propertyConfig, path);
  }

  for (const [index, keyframe] of (propertyConfig.keyframes ?? []).entries()) {
    if (keyframe?.relative === true) {
      throw new Error(
        `${path}.keyframes[${index}].relative is not supported for colors.`,
      );
    }
  }

  return normalizeKeyframes(
    propertyConfig,
    path,
    (value, valuePath) => {
      normalizeColorValue(value, valuePath);
    },
    normalizeColorValue,
  );
};

const normalizeRectPointTween = (point, path, prefix) => {
  assertPlainObject(point, path);
  assertKnownFields(point, new Set(["x", "y"]), path);
  const entries = Object.entries(point);
  if (entries.length === 0) {
    throw new Error(`${path} must define x or y.`);
  }
  return Object.fromEntries(
    entries.map(([axis, config]) => [
      `${prefix}.${axis}`,
      normalizeUpdatePropertyConfig(config, `${path}.${axis}`),
    ]),
  );
};

const normalizeRectFillStopsTween = (stops, path) => {
  if (!Array.isArray(stops) || stops.length === 0) {
    throw new Error(`${path} must be a non-empty array.`);
  }

  const indices = new Set();
  return Object.assign(
    {},
    ...stops.map((stop, itemIndex) => {
      const itemPath = `${path}[${itemIndex}]`;
      assertPlainObject(stop, itemPath);
      assertKnownFields(stop, new Set(["index", "offset", "color"]), itemPath);
      if (!Number.isInteger(stop.index) || stop.index < 0) {
        throw new Error(`${itemPath}.index must be a non-negative integer.`);
      }
      if (indices.has(stop.index)) {
        throw new Error(`${path} cannot target stop ${stop.index} twice.`);
      }
      indices.add(stop.index);
      if (stop.offset === undefined && stop.color === undefined) {
        throw new Error(`${itemPath} must define offset or color.`);
      }

      return {
        ...(stop.offset === undefined
          ? {}
          : {
              [`rect.fill.stops.${stop.index}.offset`]:
                normalizeUpdatePropertyConfig(
                  stop.offset,
                  `${itemPath}.offset`,
                ),
            }),
        ...(stop.color === undefined
          ? {}
          : {
              [`rect.fill.stops.${stop.index}.color`]:
                normalizeColorPropertyConfig(stop.color, `${itemPath}.color`),
            }),
      };
    }),
  );
};

const normalizeRectFillTween = (fill, path) => {
  assertPlainObject(fill, path);
  assertKnownFields(
    fill,
    new Set([
      "color",
      "start",
      "end",
      "innerCenter",
      "innerRadius",
      "outerCenter",
      "outerRadius",
      "stops",
      "scale",
      "rotation",
    ]),
    path,
  );
  if (Object.keys(fill).length === 0) {
    throw new Error(`${path} must define at least one property.`);
  }

  return {
    ...(fill.color === undefined
      ? {}
      : {
          "rect.fill.color": normalizeColorPropertyConfig(
            fill.color,
            `${path}.color`,
          ),
        }),
    ...(fill.start === undefined
      ? {}
      : normalizeRectPointTween(
          fill.start,
          `${path}.start`,
          "rect.fill.start",
        )),
    ...(fill.end === undefined
      ? {}
      : normalizeRectPointTween(fill.end, `${path}.end`, "rect.fill.end")),
    ...(fill.innerCenter === undefined
      ? {}
      : normalizeRectPointTween(
          fill.innerCenter,
          `${path}.innerCenter`,
          "rect.fill.innerCenter",
        )),
    ...(fill.outerCenter === undefined
      ? {}
      : normalizeRectPointTween(
          fill.outerCenter,
          `${path}.outerCenter`,
          "rect.fill.outerCenter",
        )),
    ...Object.fromEntries(
      ["innerRadius", "outerRadius", "scale", "rotation"]
        .filter((property) => fill[property] !== undefined)
        .map((property) => [
          `rect.fill.${property}`,
          normalizeUpdatePropertyConfig(fill[property], `${path}.${property}`),
        ]),
    ),
    ...(fill.stops === undefined
      ? {}
      : normalizeRectFillStopsTween(fill.stops, `${path}.stops`)),
  };
};

const normalizeRectBorderTween = (border, path) => {
  assertPlainObject(border, path);
  assertKnownFields(border, new Set(["width", "color", "alpha"]), path);
  const entries = Object.entries(border);
  if (entries.length === 0) {
    throw new Error(`${path} must define width, color, or alpha.`);
  }

  return Object.fromEntries(
    entries.map(([property, config]) => [
      `rect.border.${property}`,
      property === "color"
        ? normalizeColorPropertyConfig(config, `${path}.${property}`)
        : normalizeUpdatePropertyConfig(config, `${path}.${property}`),
    ]),
  );
};

const normalizeRectCornerRadiusTween = (cornerRadius, path) => {
  assertPlainObject(cornerRadius, path);
  const isUniformTimeline =
    cornerRadius.keyframes !== undefined || cornerRadius.auto !== undefined;
  const cornerNames = ["topLeft", "topRight", "bottomRight", "bottomLeft"];

  if (isUniformTimeline) {
    assertKnownFields(
      cornerRadius,
      new Set(["initialValue", "keyframes", "auto"]),
      path,
    );
    const normalized = normalizeUpdatePropertyConfig(cornerRadius, path);
    return Object.fromEntries(
      cornerNames.map((corner) => [`rect.cornerRadius.${corner}`, normalized]),
    );
  }

  assertKnownFields(cornerRadius, new Set(cornerNames), path);
  const entries = Object.entries(cornerRadius);
  if (entries.length === 0) {
    throw new Error(`${path} must define at least one corner.`);
  }
  return Object.fromEntries(
    entries.map(([corner, config]) => [
      `rect.cornerRadius.${corner}`,
      normalizeUpdatePropertyConfig(config, `${path}.${corner}`),
    ]),
  );
};

const normalizeRectStyleTween = (rectTween, path) => {
  const normalized = {};
  if (rectTween.width !== undefined) {
    normalized["rect.width"] = normalizeUpdatePropertyConfig(
      rectTween.width,
      `${path}.width`,
    );
  }
  if (rectTween.height !== undefined) {
    normalized["rect.height"] = normalizeUpdatePropertyConfig(
      rectTween.height,
      `${path}.height`,
    );
  }
  if (rectTween.fill !== undefined) {
    Object.assign(
      normalized,
      normalizeRectFillTween(rectTween.fill, `${path}.fill`),
    );
  }
  if (rectTween.border !== undefined) {
    Object.assign(
      normalized,
      normalizeRectBorderTween(rectTween.border, `${path}.border`),
    );
  }
  if (rectTween.cornerRadius !== undefined) {
    Object.assign(
      normalized,
      normalizeRectCornerRadiusTween(
        rectTween.cornerRadius,
        `${path}.cornerRadius`,
      ),
    );
  }
  return normalized;
};

const normalizeTweenMap = (
  tween,
  path,
  allowedProperties,
  propertyNormalizer = normalizeKeyframes,
) => {
  assertPlainObject(tween, path);

  if (tween.x !== undefined && tween.translateX !== undefined) {
    throw new Error(`${path} cannot define both x and translateX.`);
  }

  if (tween.y !== undefined && tween.translateY !== undefined) {
    throw new Error(`${path} cannot define both y and translateY.`);
  }

  const normalizedEntries = Object.entries(tween).map(([property, config]) => {
    if (!allowedProperties.has(property)) {
      throw new Error(
        `${path}.${property} is not a supported animation property.`,
      );
    }

    return [property, propertyNormalizer(config, `${path}.${property}`)];
  });

  if (normalizedEntries.length === 0) {
    throw new Error(`${path} must define at least one property.`);
  }

  return Object.fromEntries(normalizedEntries);
};

const normalizeFilterTweens = (filters, path) => {
  assertPlainObject(filters, path);
  const entries = Object.entries(filters);
  if (entries.length === 0) {
    throw new Error(`${path} must target at least one filter.`);
  }

  return Object.fromEntries(
    entries.map(([filterId, tween]) => {
      assertString(filterId, `${path} filter id`);
      return [filterId, normalizeShaderTweenMap(tween, `${path}.${filterId}`)];
    }),
  );
};

const normalizeUpdateTween = (tween, path) => {
  assertPlainObject(tween, path);

  const { filters, ...nonFilterTween } = tween;
  const rectTween = Object.fromEntries(
    Object.entries(nonFilterTween).filter(([property]) =>
      RECT_STYLE_TWEEN_FIELDS.has(property),
    ),
  );
  const elementTween = Object.fromEntries(
    Object.entries(nonFilterTween).filter(
      ([property]) => !RECT_STYLE_TWEEN_FIELDS.has(property),
    ),
  );
  const normalized = {};

  if (Object.keys(elementTween).length > 0) {
    normalized.tween = normalizeTweenMap(
      elementTween,
      path,
      UPDATE_TWEEN_PROPERTIES,
      normalizeUpdatePropertyConfig,
    );
  }
  if (Object.keys(rectTween).length > 0) {
    normalized.tween = {
      ...normalized.tween,
      ...normalizeRectStyleTween(rectTween, path),
    };
  }

  if (filters !== undefined) {
    normalized.filterTweens = normalizeFilterTweens(filters, `${path}.filters`);
  }

  if (normalized.tween === undefined && normalized.filterTweens === undefined) {
    throw new Error(`${path} must define an element property or filters.`);
  }

  return normalized;
};

const normalizeSequenceFrame = (frame, path) => {
  assertPlainObject(frame, path);
  assertString(frame.texture, `${path}.texture`);
  assertNumber(frame.at, `${path}.at`);

  if (frame.at < 0 || frame.at > 1) {
    throw new Error(`${path}.at must be between 0 and 1.`);
  }

  return {
    at: frame.at,
    texture: frame.texture,
  };
};

const normalizeSequenceFrames = (frames, path) => {
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new Error(`${path} must be an array with at least two frames.`);
  }

  const normalized = frames.map((frame, index) =>
    normalizeSequenceFrame(frame, `${path}[${index}]`),
  );

  if (normalized[0].at !== 0) {
    throw new Error(`${path}[0].at must be 0.`);
  }

  const lastIndex = normalized.length - 1;
  if (normalized[lastIndex].at !== 1) {
    throw new Error(`${path}[${lastIndex}].at must be 1.`);
  }

  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index].at <= normalized[index - 1].at) {
      throw new Error(`${path} must be sorted by ascending unique at values.`);
    }
  }

  return normalized;
};

const normalizeMask = (mask, path) => {
  assertPlainObject(mask, path);

  if (!MASK_KINDS.has(mask.kind)) {
    throw new Error(
      `${path}.kind must be one of: ${Array.from(MASK_KINDS).join(", ")}.`,
    );
  }

  const normalized = {
    kind: mask.kind,
  };

  if (mask.channel !== undefined) {
    if (!MASK_CHANNELS.has(mask.channel)) {
      throw new Error(
        `${path}.channel must be one of: ${Array.from(MASK_CHANNELS).join(", ")}.`,
      );
    }
    normalized.channel = mask.channel;
  }

  if (mask.softness !== undefined) {
    assertNumber(mask.softness, `${path}.softness`);
    normalized.softness = mask.softness;
  }

  if (mask.invert !== undefined) {
    if (typeof mask.invert !== "boolean") {
      throw new Error(`${path}.invert must be a boolean.`);
    }
    normalized.invert = mask.invert;
  }

  if (mask.progress !== undefined) {
    normalized.progress = normalizeKeyframes(mask.progress, `${path}.progress`);
  }

  if (mask.kind === "single") {
    if (mask.frames !== undefined) {
      throw new Error(`${path}.frames is only valid for sequence masks.`);
    }
    if (mask.sample !== undefined) {
      throw new Error(`${path}.sample is only valid for sequence masks.`);
    }
    if (mask.items !== undefined) {
      throw new Error(`${path}.items is not supported.`);
    }
    if (mask.combine !== undefined) {
      throw new Error(`${path}.combine is not supported.`);
    }
    assertString(mask.texture, `${path}.texture`);
    normalized.texture = mask.texture;
  }

  if (mask.kind === "sequence") {
    if (mask.texture !== undefined) {
      throw new Error(
        `${path}.texture is not valid for sequence masks. Use ${path}.frames[].texture instead.`,
      );
    }
    if (mask.items !== undefined) {
      throw new Error(`${path}.items is not supported.`);
    }
    if (mask.combine !== undefined) {
      throw new Error(`${path}.combine is not supported.`);
    }
    if (mask.textures !== undefined) {
      throw new Error(
        `${path}.textures is no longer supported. Use ${path}.frames with texture and at entries instead.`,
      );
    }
    if (mask.softness !== undefined) {
      throw new Error(
        `${path}.softness is not valid for sequence masks. Author feathering into ${path}.frames[].texture instead.`,
      );
    }

    normalized.frames = normalizeSequenceFrames(mask.frames, `${path}.frames`);

    if (mask.sample !== undefined) {
      assertString(mask.sample, `${path}.sample`);
      if (!MASK_SEQUENCE_SAMPLE_MODES.has(mask.sample)) {
        throw new Error(
          `${path}.sample must be one of: ${Array.from(MASK_SEQUENCE_SAMPLE_MODES).join(", ")}.`,
        );
      }
    }

    normalized.sample = mask.sample ?? "hold";
  }

  if (!normalized.progress) {
    normalized.progress = {
      initialValue: 0,
      keyframes: [{ duration: 0, value: 1, easing: "linear" }],
    };
  }

  return normalized;
};

const normalizeReplaceSide = (side, path) => {
  assertPlainObject(side, path);

  if (side.mask !== undefined) {
    throw new Error(`${path}.mask is not valid. Define mask on ${path}.`);
  }

  const normalized = {};

  if (side.tween !== undefined) {
    normalized.tween = normalizeTweenMap(
      side.tween,
      `${path}.tween`,
      TRANSITION_TWEEN_PROPERTIES,
    );
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error(`${path} must define tween.`);
  }

  return normalized;
};

const normalizeReplacePayload = (animation, path) => {
  const normalized = {};

  if (animation.prev !== undefined) {
    normalized.prev = normalizeReplaceSide(animation.prev, `${path}.prev`);
  }

  if (animation.next !== undefined) {
    normalized.next = normalizeReplaceSide(animation.next, `${path}.next`);
  }

  if (animation.mask !== undefined) {
    normalized.mask = normalizeMask(animation.mask, `${path}.mask`);
  }

  if (animation.compositor !== undefined) {
    normalized.compositor = normalizeShaderCompositor(
      animation.compositor,
      `${path}.compositor`,
    );
    if (animation.compositor.tween === undefined) {
      throw new Error(
        `${path}.compositor.tween.progress is required when compositor is defined.`,
      );
    }
    normalized.compositor.tween = normalizeShaderTweenMap(
      animation.compositor.tween,
      `${path}.compositor.tween`,
    );
    if (normalized.compositor.tween.uProgress === undefined) {
      throw new Error(
        `${path}.compositor.tween.progress is required when compositor is defined.`,
      );
    }
  }

  if (
    normalized.prev === undefined &&
    normalized.next === undefined &&
    normalized.mask === undefined &&
    normalized.compositor === undefined
  ) {
    throw new Error(`${path} must define prev, next, mask, or compositor.`);
  }

  return normalized;
};

const assertLegacyFieldAbsent = (value, path, message) => {
  if (value !== undefined) {
    throw new Error(`${path} ${message}`);
  }
};

export const normalizeAnimations = (animations = []) => {
  if (!Array.isArray(animations)) {
    throw new Error("Input error: `animations` must be an array.");
  }

  const normalized = animations.map((animation, index) => {
    const path = `animations[${index}]`;
    assertPlainObject(animation, path);
    assertString(animation.id, `${path}.id`);
    assertString(animation.targetId, `${path}.targetId`);
    assertString(animation.type, `${path}.type`);

    if (!ANIMATION_TYPES.has(animation.type)) {
      throw new Error(
        `${path}.type must be one of: ${Array.from(ANIMATION_TYPES).join(", ")}.`,
      );
    }

    const normalizedAnimation = {
      id: animation.id,
      targetId: animation.targetId,
      type: animation.type,
    };

    if (animation.complete !== undefined) {
      assertPlainObject(animation.complete, `${path}.complete`);
      normalizedAnimation.complete = animation.complete;
    }

    if (animation.playback !== undefined) {
      normalizedAnimation.playback = normalizePlayback(
        animation.playback,
        `${path}.playback`,
      );
    }

    const loopsForever = normalizedAnimation.playback?.loop === true;
    const repeatsForever = normalizedAnimation.playback?.repeat === "infinite";
    if (loopsForever || repeatsForever) {
      if (animation.type !== "update") {
        if (loopsForever) {
          throw new Error(
            `${path}.playback.loop is only supported for type "update".`,
          );
        }
        throw new Error(
          `${path}.playback infinite repetition is only supported for type "update".`,
        );
      }
      if (normalizedAnimation.complete !== undefined) {
        if (loopsForever) {
          throw new Error(
            `${path}.complete is not allowed when playback.loop is true because a loop never completes.`,
          );
        }
        throw new Error(
          `${path}.complete is not allowed when playback repeats infinitely because it never completes.`,
        );
      }
    }

    assertLegacyFieldAbsent(
      animation.operation,
      `${path}.operation`,
      "is no longer supported. Use `type: update | transition` instead.",
    );
    assertLegacyFieldAbsent(
      animation.properties,
      `${path}.properties`,
      "is no longer supported. Use `tween` instead.",
    );
    assertLegacyFieldAbsent(
      animation.subjects,
      `${path}.subjects`,
      "is no longer supported. Use `prev` / `next` instead.",
    );
    assertLegacyFieldAbsent(
      animation.shader,
      `${path}.shader`,
      "is no longer supported. Use `tween.filters.<filterId>` for element filters or `compositor.tween` for a transition compositor.",
    );

    if (animation.type === "update") {
      if (animation.tween !== undefined && animation.gsap !== undefined) {
        throw new Error(`${path} cannot define both tween and gsap.`);
      }

      if (animation.tween !== undefined) {
        Object.assign(
          normalizedAnimation,
          normalizeUpdateTween(animation.tween, `${path}.tween`),
        );
      }

      if (animation.gsap !== undefined) {
        normalizedAnimation.gsap = normalizePortableGsap(
          animation.gsap,
          `${path}.gsap`,
          "update",
        );
      }

      if (
        normalizedAnimation.tween === undefined &&
        normalizedAnimation.filterTweens === undefined &&
        normalizedAnimation.gsap === undefined
      ) {
        throw new Error(
          `${path} must define exactly one of tween or gsap for an update animation.`,
        );
      }

      if (animation.replace !== undefined) {
        throw new Error(
          `${path}.replace is no longer supported. Define \`prev\`, \`next\`, or \`mask\` directly on the animation.`,
        );
      }

      if (animation.prev !== undefined) {
        throw new Error(
          `${path}.prev is only valid for transition animations.`,
        );
      }

      if (animation.next !== undefined) {
        throw new Error(
          `${path}.next is only valid for transition animations.`,
        );
      }

      if (animation.mask !== undefined) {
        throw new Error(
          `${path}.mask is only valid for transition animations.`,
        );
      }

      if (animation.compositor !== undefined) {
        throw new Error(
          `${path}.compositor is only valid for transition animations.`,
        );
      }

      return normalizedAnimation;
    }

    if (animation.tween !== undefined) {
      throw new Error(`${path}.tween is not valid for transition animations.`);
    }

    if (animation.gsap !== undefined) {
      if (animation.prev !== undefined || animation.next !== undefined) {
        throw new Error(
          `${path} orchestrated gsap transitions cannot define prev.tween or next.tween.`,
        );
      }
      normalizedAnimation.gsap = normalizePortableGsap(
        animation.gsap,
        `${path}.gsap`,
        "transition",
      );

      if (animation.mask !== undefined) {
        if (animation.mask.progress !== undefined) {
          throw new Error(
            `${path}.mask.progress cannot be mixed with top-level gsap. Animate the transitionMask target instead.`,
          );
        }
        normalizedAnimation.mask = normalizeMask(
          animation.mask,
          `${path}.mask`,
        );
        delete normalizedAnimation.mask.progress;
      }

      if (animation.compositor !== undefined) {
        if (animation.compositor.tween !== undefined) {
          throw new Error(
            `${path}.compositor.tween cannot be mixed with top-level gsap. Animate the transitionCompositor target instead.`,
          );
        }
        normalizedAnimation.compositor = normalizeShaderCompositor(
          animation.compositor,
          `${path}.compositor`,
        );
      }

      return normalizedAnimation;
    }

    if (animation.replace !== undefined) {
      throw new Error(
        `${path}.replace is no longer supported. Define \`prev\`, \`next\`, or \`mask\` directly on the animation.`,
      );
    }

    const normalizedReplace = normalizeReplacePayload(animation, path);
    if (normalizedReplace.prev !== undefined) {
      normalizedAnimation.prev = normalizedReplace.prev;
    }
    if (normalizedReplace.next !== undefined) {
      normalizedAnimation.next = normalizedReplace.next;
    }
    if (normalizedReplace.mask !== undefined) {
      normalizedAnimation.mask = normalizedReplace.mask;
    }
    if (normalizedReplace.compositor !== undefined) {
      normalizedAnimation.compositor = normalizedReplace.compositor;
    }

    return normalizedAnimation;
  });

  const animationIds = new Map();
  const transitionTargets = new Map();

  for (const [index, animation] of normalized.entries()) {
    const priorIdIndex = animationIds.get(animation.id);
    if (priorIdIndex !== undefined) {
      throw new Error(
        `animations[${index}].id duplicates animations[${priorIdIndex}].id "${animation.id}". Animation ids must be unique within one state.`,
      );
    }
    animationIds.set(animation.id, index);

    if (animation.type !== "transition") {
      continue;
    }

    const priorTransitionIndex = transitionTargets.get(animation.targetId);
    if (priorTransitionIndex !== undefined) {
      throw new Error(
        `animations[${index}] defines a second transition for target "${animation.targetId}"; animations[${priorTransitionIndex}] already owns that transition target.`,
      );
    }
    transitionTargets.set(animation.targetId, index);
  }

  const targetKinds = new Map();

  for (const animation of normalized) {
    const kinds = targetKinds.get(animation.targetId) ?? new Set();
    kinds.add(animation.type);
    targetKinds.set(animation.targetId, kinds);
  }

  for (const [targetId, kinds] of targetKinds) {
    if (kinds.has("transition") && kinds.size > 1) {
      throw new Error(
        `Animations targeting "${targetId}" cannot mix update and transition types in the same state.`,
      );
    }
  }

  const shaderAnimationChannels = new Set();

  for (const animation of normalized) {
    if (animation.type !== "update") {
      continue;
    }

    for (const [filterId, tween] of Object.entries(
      animation.filterTweens ?? {},
    )) {
      for (const parameter of Object.keys(tween)) {
        const channel = JSON.stringify([
          animation.targetId,
          filterId,
          parameter,
        ]);
        if (shaderAnimationChannels.has(channel)) {
          const authoredParameter =
            parameter === "uProgress" ? "progress" : parameter;
          throw new Error(
            `Animations targeting shader filter "${filterId}" on "${animation.targetId}" cannot both animate parameter "${authoredParameter}".`,
          );
        }
        shaderAnimationChannels.add(channel);
      }
    }
  }

  return normalized;
};

export default normalizeAnimations;
