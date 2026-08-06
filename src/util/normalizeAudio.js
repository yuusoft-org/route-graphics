import { SUPPORTED_EASING_NAMES } from "./animationTimeline.js";

const AUDIO_NODE_TYPES = new Set(["audio-channel", "sound"]);
const AUDIO_CHANNEL_INTERRUPTION_VALUES = new Set(["immediate", "loopEnd"]);
const AUDIO_PLAYBACK_OPERATIONS = new Set([
  "play",
  "pause",
  "resume",
  "stop",
  "seek",
]);
const AUDIO_CHANNEL_PLAYBACK_OPERATIONS = new Set(["pause", "resume"]);
const AUDIO_PLAYBACK_POSITION_OPERATIONS = new Set(["play", "seek"]);
const NO_AUDIO_PLAYBACK_POSITION_OPERATIONS = new Set();
const AUDIO_PLAYBACK_KEYS = new Set(["commandId", "operation", "positionMs"]);
const AUDIO_TRANSITION_TYPE = "audio-transition";
const AUDIO_EFFECT_TYPES = new Set([AUDIO_TRANSITION_TYPE]);
const AUDIO_EFFECT_KEYS = new Set(["id", "type", "targetId", "properties"]);
const AUDIO_TRANSITION_PHASES = new Set(["enter", "exit", "update"]);
const AUDIO_TRANSITION_PROPERTIES = new Set(["volume", "pan", "playbackRate"]);
const AUDIO_TRANSITION_PROPERTY_RANGES = {
  volume: { min: 0, max: 100 },
  pan: { min: -1, max: 1 },
  playbackRate: { min: 0 },
};
const AUDIO_EASINGS = new Set(SUPPORTED_EASING_NAMES);
const AUDIO_TRANSITION_PHASE_KEYS = new Set(["initialValue", "keyframes"]);
const AUDIO_TRANSITION_KEYFRAME_KEYS = new Set([
  "value",
  "startValue",
  "duration",
  "delay",
  "easing",
  "relative",
]);

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertRecord = (value, path) => {
  if (!isRecord(value)) {
    throw new Error(`Input error: ${path} must be an object.`);
  }
};

const assertNonEmptyRecord = (value, path) => {
  assertRecord(value, path);
  if (Object.keys(value).length === 0) {
    throw new Error(`Input error: ${path} must be a non-empty object.`);
  }
};

const assertNonEmptyString = (value, path) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Input error: ${path} must be a non-empty string.`);
  }
};

const assertNumber = (value, path, { min, max } = {}) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Input error: ${path} must be a number.`);
  }

  if (min !== undefined && value < min) {
    throw new Error(
      `Input error: ${path} must be greater than or equal to ${min}.`,
    );
  }

  if (max !== undefined && value > max) {
    throw new Error(
      `Input error: ${path} must be less than or equal to ${max}.`,
    );
  }
};

const assertFiniteNumber = (value, path, range) => {
  assertNumber(value, path);
  if (!Number.isFinite(value)) {
    throw new Error(`Input error: ${path} must be a finite number.`);
  }
  assertNumber(value, path, range);
};

const assertOptionalBoolean = (value, path) => {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`Input error: ${path} must be a boolean.`);
  }
};

const assertOptionalNumber = (value, path, range) => {
  if (value !== undefined && value !== null) {
    assertNumber(value, path, range);
  }
};

const normalizeVolumeValue = (value, path) => {
  if (value === undefined || value === null) {
    return 100;
  }

  assertNumber(value, path);
  return Math.max(0, Math.min(100, value));
};

const assertUniqueId = (ids, id, path) => {
  if (ids.has(id)) {
    throw new Error(
      `Input error: duplicate audio render-state id "${id}" at ${path}.`,
    );
  }
  ids.add(id);
};

const normalizePlaybackCommand = (
  playback,
  path,
  {
    operations = AUDIO_PLAYBACK_OPERATIONS,
    operationList = "play, pause, resume, stop, seek",
    positionOperations = AUDIO_PLAYBACK_POSITION_OPERATIONS,
  } = {},
) => {
  assertRecord(playback, path);

  for (const key of Object.keys(playback)) {
    if (!AUDIO_PLAYBACK_KEYS.has(key)) {
      throw new Error(
        `Input error: unsupported playback field "${key}" at ${path}.`,
      );
    }
  }

  if (!Number.isSafeInteger(playback.commandId) || playback.commandId < 0) {
    throw new Error(
      `Input error: ${path}.commandId must be a non-negative safe integer.`,
    );
  }

  if (!operations.has(playback.operation)) {
    throw new Error(
      `Input error: ${path}.operation must be one of ${operationList}.`,
    );
  }

  const requiresPosition = positionOperations.has(playback.operation);
  if (requiresPosition) {
    if (
      typeof playback.positionMs !== "number" ||
      !Number.isFinite(playback.positionMs) ||
      playback.positionMs < 0
    ) {
      throw new Error(
        `Input error: ${path}.positionMs must be a finite non-negative number for ${playback.operation}.`,
      );
    }
  } else if (playback.positionMs !== undefined) {
    throw new Error(
      `Input error: ${path}.positionMs is not allowed for ${playback.operation}.`,
    );
  }

  return {
    commandId: playback.commandId,
    operation: playback.operation,
    ...(requiresPosition ? { positionMs: playback.positionMs } : {}),
  };
};

const validateSound = (node, path, ids, flattenedSounds, channelId = null) => {
  assertNonEmptyString(node.id, `${path}.id`);
  assertUniqueId(ids, node.id, `${path}.id`);
  assertNonEmptyString(node.src, `${path}.src`);

  if (node.delay !== undefined) {
    throw new Error(
      `Input error: ${path}.delay is not supported. Use ${path}.startDelayMs instead.`,
    );
  }

  const volume = normalizeVolumeValue(node.volume, `${path}.volume`);
  assertOptionalBoolean(node.muted, `${path}.muted`);
  assertOptionalNumber(node.pan, `${path}.pan`, { min: -1, max: 1 });
  assertOptionalBoolean(node.loop, `${path}.loop`);
  assertOptionalNumber(node.startDelayMs, `${path}.startDelayMs`, { min: 0 });
  assertOptionalNumber(node.playbackRate, `${path}.playbackRate`, { min: 0 });
  assertOptionalNumber(node.startAt, `${path}.startAt`, { min: 0 });
  assertOptionalNumber(node.endAt, `${path}.endAt`, { min: 0 });

  if (
    node.endAt !== undefined &&
    node.endAt !== null &&
    node.startAt !== undefined &&
    node.endAt < node.startAt
  ) {
    throw new Error(
      `Input error: ${path}.endAt must be greater than or equal to startAt.`,
    );
  }

  const playback =
    node.playback === undefined
      ? undefined
      : normalizePlaybackCommand(node.playback, `${path}.playback`);

  if (node.transition !== undefined) {
    throw new Error(
      `Input error: ${path}.transition is not supported. Use top-level audioEffects instead.`,
    );
  }

  flattenedSounds.push({
    id: node.id,
    type: "sound",
    src: node.src,
    volume,
    muted: node.muted ?? false,
    pan: node.pan ?? 0,
    loop: node.loop ?? false,
    startDelayMs: node.startDelayMs ?? 0,
    playbackRate: node.playbackRate ?? 1,
    startAt: node.startAt ?? 0,
    endAt: node.endAt ?? null,
    channelId,
    ...(playback ? { playback } : {}),
  });
};

const validateChannel = (
  node,
  path,
  ids,
  flattenedChannels,
  flattenedSounds,
) => {
  assertNonEmptyString(node.id, `${path}.id`);
  assertUniqueId(ids, node.id, `${path}.id`);

  const volume = normalizeVolumeValue(node.volume, `${path}.volume`);
  assertOptionalBoolean(node.muted, `${path}.muted`);
  assertOptionalNumber(node.pan, `${path}.pan`, { min: -1, max: 1 });
  assertOptionalBoolean(node.loop, `${path}.loop`);
  const interruption = node.interruption ?? "immediate";
  if (!AUDIO_CHANNEL_INTERRUPTION_VALUES.has(interruption)) {
    throw new Error(
      `Input error: ${path}.interruption must be one of immediate, loopEnd.`,
    );
  }

  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new Error(`Input error: ${path}.children must be an array.`);
  }

  const playback =
    node.playback === undefined
      ? undefined
      : normalizePlaybackCommand(node.playback, `${path}.playback`, {
          operations: AUDIO_CHANNEL_PLAYBACK_OPERATIONS,
          operationList: "pause, resume",
          positionOperations: NO_AUDIO_PLAYBACK_POSITION_OPERATIONS,
        });

  if (node.transition !== undefined) {
    throw new Error(
      `Input error: ${path}.transition is not supported. Use top-level audioEffects instead.`,
    );
  }

  flattenedChannels.push({
    id: node.id,
    type: "audio-channel",
    volume,
    muted: node.muted ?? false,
    pan: node.pan ?? 0,
    loop: node.loop ?? false,
    interruption,
    ...(playback ? { playback } : {}),
  });

  for (const [index, child] of (node.children ?? []).entries()) {
    const childPath = `${path}.children[${index}]`;
    assertRecord(child, childPath);

    if (child.type === "audio-channel") {
      throw new Error(
        `Input error: nested audio-channel nodes are not supported at ${childPath}.`,
      );
    }

    if (child.type !== "sound") {
      throw new Error(`Input error: ${childPath}.type must be "sound".`);
    }

    if (node.loop === true && child.loop === true) {
      throw new Error(
        `Input error: ${childPath}.loop cannot be true when ${path}.loop is true.`,
      );
    }

    if (node.loop === true && child.playback !== undefined) {
      throw new Error(
        `Input error: ${childPath}.playback is not allowed when ${path}.loop is true.`,
      );
    }

    if (playback && child.playback !== undefined) {
      throw new Error(
        `Input error: ${childPath}.playback is not allowed when ${path}.playback is present.`,
      );
    }

    validateSound(child, childPath, ids, flattenedSounds, node.id);
  }
};

const validateAudioNodes = (audio, ids) => {
  if (!Array.isArray(audio)) {
    throw new Error("Input error: `audio` must be an array.");
  }

  const flattenedChannels = [];
  const flattenedSounds = [];
  const builtinNodeIds = new Set();

  for (const [index, node] of audio.entries()) {
    const path = `audio[${index}]`;
    assertRecord(node, path);

    if (!AUDIO_NODE_TYPES.has(node.type)) {
      assertNonEmptyString(node.id, `${path}.id`);
      assertUniqueId(ids, node.id, `${path}.id`);
      continue;
    }

    if (node.type === "audio-channel") {
      validateChannel(node, path, ids, flattenedChannels, flattenedSounds);
      builtinNodeIds.add(node.id);
      for (const sound of flattenedSounds) {
        if (sound.channelId === node.id) {
          builtinNodeIds.add(sound.id);
        }
      }
    } else {
      validateSound(node, path, ids, flattenedSounds);
      builtinNodeIds.add(node.id);
    }
  }

  return {
    channels: flattenedChannels,
    sounds: flattenedSounds,
    builtinNodeIds,
    builtinNodeTypes: new Map(
      [...flattenedChannels, ...flattenedSounds].map((node) => [
        node.id,
        node.type,
      ]),
    ),
  };
};

const validateTransitionPhase = (phase, path, propertyName) => {
  assertRecord(phase, path);

  for (const key of Object.keys(phase)) {
    if (!AUDIO_TRANSITION_PHASE_KEYS.has(key)) {
      throw new Error(
        `Input error: unsupported audio transition field "${key}" at ${path}.`,
      );
    }
  }

  if (phase.initialValue !== undefined) {
    assertFiniteNumber(
      phase.initialValue,
      `${path}.initialValue`,
      AUDIO_TRANSITION_PROPERTY_RANGES[propertyName],
    );
  }

  if (!Array.isArray(phase.keyframes) || phase.keyframes.length === 0) {
    throw new Error(
      `Input error: ${path}.keyframes must be a non-empty array.`,
    );
  }

  for (const [index, keyframe] of phase.keyframes.entries()) {
    const keyframePath = `${path}.keyframes[${index}]`;
    assertRecord(keyframe, keyframePath);

    for (const key of Object.keys(keyframe)) {
      if (!AUDIO_TRANSITION_KEYFRAME_KEYS.has(key)) {
        throw new Error(
          `Input error: unsupported audio transition keyframe field "${key}" at ${keyframePath}.`,
        );
      }
    }

    if (keyframe.value === undefined) {
      throw new Error(`Input error: ${keyframePath}.value is required.`);
    }
    assertFiniteNumber(
      keyframe.value,
      `${keyframePath}.value`,
      keyframe.relative
        ? undefined
        : AUDIO_TRANSITION_PROPERTY_RANGES[propertyName],
    );

    if (keyframe.startValue !== undefined) {
      assertFiniteNumber(
        keyframe.startValue,
        `${keyframePath}.startValue`,
        keyframe.relative
          ? undefined
          : AUDIO_TRANSITION_PROPERTY_RANGES[propertyName],
      );
    }

    if (keyframe.duration === undefined) {
      throw new Error(`Input error: ${keyframePath}.duration is required.`);
    }
    assertFiniteNumber(keyframe.duration, `${keyframePath}.duration`, {
      min: 0,
    });

    if (keyframe.delay !== undefined) {
      assertFiniteNumber(keyframe.delay, `${keyframePath}.delay`, { min: 0 });
    }

    if (keyframe.easing !== undefined && !AUDIO_EASINGS.has(keyframe.easing)) {
      throw new Error(
        `Input error: ${keyframePath}.easing "${keyframe.easing}" is not supported.`,
      );
    }

    assertOptionalBoolean(keyframe.relative, `${keyframePath}.relative`);
  }
};

const validateAudioTransition = (effect, path) => {
  assertNonEmptyString(effect.targetId, `${path}.targetId`);

  assertNonEmptyRecord(effect.properties, `${path}.properties`);

  for (const [propertyName, propertyTransitions] of Object.entries(
    effect.properties,
  )) {
    if (!AUDIO_TRANSITION_PROPERTIES.has(propertyName)) {
      throw new Error(
        `Input error: unsupported audio transition property "${propertyName}" at ${path}.properties.`,
      );
    }

    assertNonEmptyRecord(
      propertyTransitions,
      `${path}.properties.${propertyName}`,
    );

    for (const [phaseName, phase] of Object.entries(propertyTransitions)) {
      if (!AUDIO_TRANSITION_PHASES.has(phaseName)) {
        throw new Error(
          `Input error: unsupported audio transition phase "${phaseName}" at ${path}.properties.${propertyName}.`,
        );
      }

      validateTransitionPhase(
        phase,
        `${path}.properties.${propertyName}.${phaseName}`,
        propertyName,
      );
    }
  }
};

const validateAudioEffects = (audioEffects, ids) => {
  if (!Array.isArray(audioEffects)) {
    throw new Error("Input error: `audioEffects` must be an array.");
  }

  const transitionTargetIds = new Set();
  const transitions = new Map();

  for (const [index, effect] of audioEffects.entries()) {
    const path = `audioEffects[${index}]`;
    assertRecord(effect, path);
    assertNonEmptyString(effect.id, `${path}.id`);
    assertUniqueId(ids, effect.id, `${path}.id`);

    for (const key of Object.keys(effect)) {
      if (!AUDIO_EFFECT_KEYS.has(key)) {
        throw new Error(
          `Input error: unsupported audio effect field "${key}" at ${path}.`,
        );
      }
    }

    if (!AUDIO_EFFECT_TYPES.has(effect.type)) {
      throw new Error(
        `Input error: unsupported audio effect type "${effect.type}" at ${path}.`,
      );
    }

    if (effect.type === AUDIO_TRANSITION_TYPE) {
      validateAudioTransition(effect, path);
      if (transitionTargetIds.has(effect.targetId)) {
        throw new Error(
          `Input error: duplicate audio-transition targetId "${effect.targetId}" at ${path}.targetId.`,
        );
      }
      transitionTargetIds.add(effect.targetId);
      transitions.set(effect.targetId, effect.properties);
    }
  }

  return transitions;
};

export const flattenAudioNodes = (audio = []) => {
  const ids = new Set();
  return validateAudioNodes(audio, ids);
};

export const normalizeAudioRenderState = ({
  audio = [],
  audioEffects = [],
} = {}) => {
  const ids = new Set();
  const flattened = validateAudioNodes(audio, ids);
  const transitions = validateAudioEffects(audioEffects, ids);

  return {
    audio,
    audioEffects,
    channels: flattened.channels,
    sounds: flattened.sounds,
    transitions,
    effectById: new Map(audioEffects.map((effect) => [effect.id, effect])),
  };
};

export const isGraphAudioNode = (node) => AUDIO_NODE_TYPES.has(node?.type);

export const filterGraphAudio = (audio = []) => audio.filter(isGraphAudioNode);

export const filterPluginAudio = (audio = []) =>
  audio.filter((node) => !isGraphAudioNode(node));
