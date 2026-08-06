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
const AUDIO_TRANSITION_PHASES = new Set(["enter", "exit", "update"]);
const AUDIO_TRANSITION_PROPERTIES = new Set(["volume", "pan", "playbackRate"]);
const AUDIO_TRANSITION_PROPERTIES_BY_NODE_TYPE = {
  "audio-channel": new Set(["volume", "pan"]),
  sound: new Set(["volume", "pan", "playbackRate"]),
};
const AUDIO_TRANSITION_PROPERTY_RANGES = {
  volume: { min: 0, max: 100 },
  pan: { min: -1, max: 1 },
  playbackRate: { min: 0 },
};
const AUDIO_EASINGS = new Set(SUPPORTED_EASING_NAMES);
const AUDIO_TRANSITION_PHASE_KEYS = new Set(["initialValue", "keyframes"]);
const AUDIO_TRANSITION_KEYFRAME_KEYS = new Set([
  "value",
  "duration",
  "delay",
  "easing",
  "relative",
]);
const AUDIO_ANIMATION_TYPES = new Set(["transition", "update"]);
const AUDIO_ANIMATION_KEYS = new Set([
  "id",
  "occurrenceId",
  "type",
  "targetId",
  "prev",
  "next",
  "tween",
]);
const AUDIO_HANDOFF_SIDE_KEYS = new Set(["channel", "fade"]);
const AUDIO_UPDATE_PROPERTIES = new Set(["volume", "pan"]);
const AUDIO_MASTER_KEYS = new Set(["id", "volume", "muted"]);
const AUDIO_ANIMATION_CONTROL_KEYS = new Set(["commandId", "operation"]);

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

const assertOnlyKeys = (value, allowedKeys, path) => {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Input error: unsupported field "${key}" at ${path}.`);
    }
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

const validateSound = (
  node,
  path,
  ids,
  flattenedSounds,
  inlineTransitions,
  channelId = null,
) => {
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
    inlineTransitions.set(
      node.id,
      validateInlineAudioTransition(node.transition, `${path}.transition`, {
        nodeType: "sound",
        propertyValues: {
          volume,
          pan: node.pan ?? 0,
          playbackRate: node.playbackRate ?? 1,
        },
      }),
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
  inlineTransitions,
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
    inlineTransitions.set(
      node.id,
      validateInlineAudioTransition(node.transition, `${path}.transition`, {
        nodeType: "audio-channel",
        propertyValues: {
          volume,
          pan: node.pan ?? 0,
        },
      }),
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

    validateSound(
      child,
      childPath,
      ids,
      flattenedSounds,
      inlineTransitions,
      node.id,
    );
  }
};

const validateAudioNodes = (audio, ids) => {
  if (!Array.isArray(audio)) {
    throw new Error("Input error: `audio` must be an array.");
  }

  const flattenedChannels = [];
  const flattenedSounds = [];
  const inlineTransitions = new Map();
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
      validateChannel(
        node,
        path,
        ids,
        flattenedChannels,
        flattenedSounds,
        inlineTransitions,
      );
      builtinNodeIds.add(node.id);
      for (const sound of flattenedSounds) {
        if (sound.channelId === node.id) {
          builtinNodeIds.add(sound.id);
        }
      }
    } else {
      validateSound(node, path, ids, flattenedSounds, inlineTransitions);
      builtinNodeIds.add(node.id);
    }
  }

  return {
    channels: flattenedChannels,
    sounds: flattenedSounds,
    inlineTransitions,
    builtinNodeIds,
    builtinNodeTypes: new Map(
      [...flattenedChannels, ...flattenedSounds].map((node) => [
        node.id,
        node.type,
      ]),
    ),
  };
};

const validateTransitionPhase = (
  phase,
  path,
  propertyName,
  { finalValue } = {},
) => {
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

  if (finalValue !== undefined) {
    const finalKeyframe = phase.keyframes[phase.keyframes.length - 1];
    if (finalKeyframe.relative === true) {
      throw new Error(
        `Input error: ${path}.keyframes must end with an absolute value.`,
      );
    }
    if (finalKeyframe.value !== finalValue) {
      throw new Error(
        `Input error: ${path}.keyframes must end at the node's declared ${propertyName} value ${finalValue}.`,
      );
    }
  }
};

function validateInlineAudioTransition(
  transition,
  path,
  { nodeType, propertyValues },
) {
  assertNonEmptyRecord(transition, path);
  const normalizedProperties = {};

  for (const [phaseName, propertyTracks] of Object.entries(transition)) {
    if (!AUDIO_TRANSITION_PHASES.has(phaseName)) {
      throw new Error(
        `Input error: unsupported inline audio transition phase "${phaseName}" at ${path}.`,
      );
    }

    assertNonEmptyRecord(propertyTracks, `${path}.${phaseName}`);
    for (const [propertyName, track] of Object.entries(propertyTracks)) {
      if (!AUDIO_TRANSITION_PROPERTIES.has(propertyName)) {
        throw new Error(
          `Input error: unsupported inline audio transition property "${propertyName}" at ${path}.${phaseName}.`,
        );
      }
      if (
        !AUDIO_TRANSITION_PROPERTIES_BY_NODE_TYPE[nodeType].has(propertyName)
      ) {
        throw new Error(
          `Input error: inline audio transition property "${propertyName}" is not supported for node type "${nodeType}" at ${path}.${phaseName}.`,
        );
      }

      validateTransitionPhase(
        track,
        `${path}.${phaseName}.${propertyName}`,
        propertyName,
        phaseName === "enter" || phaseName === "update"
          ? { finalValue: propertyValues[propertyName] }
          : {},
      );
      normalizedProperties[propertyName] ??= {};
      normalizedProperties[propertyName][phaseName] = track;
    }
  }

  return normalizedProperties;
}

const validateAudioTransition = (effect, path, nodeTypes) => {
  assertNonEmptyString(effect.targetId, `${path}.targetId`);
  const targetType = nodeTypes.get(effect.targetId);
  if (!targetType) {
    throw new Error(
      `Input error: ${path}.targetId "${effect.targetId}" does not resolve to an audio node.`,
    );
  }

  assertNonEmptyRecord(effect.properties, `${path}.properties`);

  for (const [propertyName, propertyTransitions] of Object.entries(
    effect.properties,
  )) {
    if (!AUDIO_TRANSITION_PROPERTIES.has(propertyName)) {
      throw new Error(
        `Input error: unsupported audio transition property "${propertyName}" at ${path}.properties.`,
      );
    }

    if (
      !AUDIO_TRANSITION_PROPERTIES_BY_NODE_TYPE[targetType].has(propertyName)
    ) {
      throw new Error(
        `Input error: audio transition property "${propertyName}" is not supported for target type "${targetType}" at ${path}.properties.`,
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

const validateAudioEffects = (audioEffects, ids, nodeTypes) => {
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

    if (!AUDIO_EFFECT_TYPES.has(effect.type)) {
      throw new Error(
        `Input error: unsupported audio effect type "${effect.type}" at ${path}.`,
      );
    }

    if (effect.type === AUDIO_TRANSITION_TYPE) {
      validateAudioTransition(effect, path, nodeTypes);
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

const withoutChannelId = ({ channelId: _channelId, ...sound }) => sound;

const toChannelSnapshot = (channel, sounds) => ({
  ...channel,
  children: sounds
    .filter((sound) => sound.channelId === channel.id)
    .map(withoutChannelId),
});

const normalizeChannelSnapshot = (value, path) => {
  assertRecord(value, path);
  if (value.type !== "audio-channel") {
    throw new Error(`Input error: ${path}.type must be "audio-channel".`);
  }

  const normalized = validateAudioNodes([value], new Set());
  if (normalized.channels.length !== 1) {
    throw new Error(`Input error: ${path} must contain one audio channel.`);
  }
  return toChannelSnapshot(normalized.channels[0], normalized.sounds);
};

const getChannelSnapshot = (normalizedAudio, targetId) => {
  const channel = normalizedAudio.channels.find(({ id }) => id === targetId);
  return channel
    ? toChannelSnapshot(channel, normalizedAudio.sounds)
    : undefined;
};

const stableValueKey = (value) => JSON.stringify(value);

const validateHandoffSide = (side, path, expectedChannel, phaseName) => {
  assertNonEmptyRecord(side, path);
  assertOnlyKeys(side, AUDIO_HANDOFF_SIDE_KEYS, path);
  if (side.channel === undefined) {
    throw new Error(`Input error: ${path}.channel is required.`);
  }

  const channel = normalizeChannelSnapshot(side.channel, `${path}.channel`);
  if (stableValueKey(channel) !== stableValueKey(expectedChannel)) {
    throw new Error(
      `Input error: ${path}.channel must match the ${phaseName} render-state channel snapshot.`,
    );
  }

  if (side.fade !== undefined) {
    validateTransitionPhase(side.fade, `${path}.fade`, "volume");
    const finalKeyframe = side.fade.keyframes.at(-1);
    const requiredFinalValue = phaseName === "previous" ? 0 : 100;
    if (
      finalKeyframe.relative === true ||
      finalKeyframe.value !== requiredFinalValue
    ) {
      throw new Error(
        `Input error: ${path}.fade must end at ${requiredFinalValue}.`,
      );
    }
    if (phaseName === "next" && side.fade.initialValue !== 0) {
      throw new Error(`Input error: ${path}.fade.initialValue must be 0.`);
    }
  }

  return {
    channel,
    ...(side.fade === undefined ? {} : { fade: structuredClone(side.fade) }),
  };
};

const hasSameSourceTopology = (previous, next) => {
  if (!previous || !next || previous.children.length !== next.children.length) {
    return false;
  }
  return previous.children.every((sound, index) => {
    const nextSound = next.children[index];
    return (
      sound.id === nextSound.id &&
      sound.src === nextSound.src &&
      sound.startAt === nextSound.startAt &&
      sound.endAt === nextSound.endAt &&
      sound.startDelayMs === nextSound.startDelayMs
    );
  });
};

const normalizeAudioAnimations = ({
  audioAnimations,
  nextAudio,
  occupiedTransitionTargetIds,
}) => {
  if (!Array.isArray(audioAnimations)) {
    throw new Error("Input error: `audioAnimations` must be an array.");
  }

  const ids = new Set();
  const occurrenceIds = new Set();
  const targetIds = new Set();
  return audioAnimations.map((animation, index) => {
    const path = `audioAnimations[${index}]`;
    assertNonEmptyRecord(animation, path);
    assertOnlyKeys(animation, AUDIO_ANIMATION_KEYS, path);
    assertNonEmptyString(animation.id, `${path}.id`);
    assertUniqueId(ids, animation.id, `${path}.id`);
    assertNonEmptyString(animation.occurrenceId, `${path}.occurrenceId`);
    assertUniqueId(
      occurrenceIds,
      animation.occurrenceId,
      `${path}.occurrenceId`,
    );
    if (!AUDIO_ANIMATION_TYPES.has(animation.type)) {
      throw new Error(
        `Input error: ${path}.type must be one of transition, update.`,
      );
    }
    assertNonEmptyString(animation.targetId, `${path}.targetId`);
    if (targetIds.has(animation.targetId)) {
      throw new Error(
        `Input error: duplicate audio animation targetId "${animation.targetId}" at ${path}.targetId.`,
      );
    }
    targetIds.add(animation.targetId);
    if (occupiedTransitionTargetIds.has(animation.targetId)) {
      throw new Error(
        `Input error: audio animation target "${animation.targetId}" cannot also define inline or legacy audio transitions.`,
      );
    }

    const nextChannel = getChannelSnapshot(nextAudio, animation.targetId);
    const normalized = {
      id: animation.id,
      occurrenceId: animation.occurrenceId,
      type: animation.type,
      targetId: animation.targetId,
    };

    if (animation.type === "transition") {
      if (animation.tween !== undefined) {
        throw new Error(
          `Input error: ${path}.tween is not valid for transition audio animations.`,
        );
      }
      if (animation.prev === undefined && animation.next === undefined) {
        throw new Error(
          `Input error: ${path} requires prev or next for a transition.`,
        );
      }
      if ((animation.next === undefined) !== (nextChannel === undefined)) {
        throw new Error(
          `Input error: ${path}.next must match next target presence.`,
        );
      }
      if (animation.prev !== undefined) {
        const previousChannel = normalizeChannelSnapshot(
          animation.prev.channel,
          `${path}.prev.channel`,
        );
        normalized.prev = validateHandoffSide(
          animation.prev,
          `${path}.prev`,
          previousChannel,
          "previous",
        );
      }
      if (animation.next !== undefined) {
        normalized.next = validateHandoffSide(
          animation.next,
          `${path}.next`,
          nextChannel,
          "next",
        );
      }
      if (
        normalized.prev?.channel &&
        nextChannel &&
        hasSameSourceTopology(normalized.prev.channel, nextChannel)
      ) {
        throw new Error(
          `Input error: ${path} transition requires a source or topology change.`,
        );
      }
      return normalized;
    }

    if (animation.prev !== undefined || animation.next !== undefined) {
      throw new Error(
        `Input error: ${path}.prev and ${path}.next are not valid for update audio animations.`,
      );
    }
    if (!nextChannel) {
      throw new Error(
        `Input error: ${path} update requires a retained audio channel.`,
      );
    }
    assertNonEmptyRecord(animation.tween, `${path}.tween`);
    const tween = {};
    for (const [propertyName, phase] of Object.entries(animation.tween)) {
      if (!AUDIO_UPDATE_PROPERTIES.has(propertyName)) {
        throw new Error(
          `Input error: unsupported audio update property "${propertyName}" at ${path}.tween.`,
        );
      }
      validateTransitionPhase(
        phase,
        `${path}.tween.${propertyName}`,
        propertyName,
        { finalValue: nextChannel[propertyName] },
      );
      tween[propertyName] = structuredClone(phase);
    }
    normalized.tween = tween;
    return normalized;
  });
};

const normalizeAudioMasters = (audioMasters = []) => {
  if (!Array.isArray(audioMasters)) {
    throw new Error("Input error: `audioMasters` must be an array.");
  }
  const ids = new Set();
  return audioMasters.map((master, index) => {
    const path = `audioMasters[${index}]`;
    assertNonEmptyRecord(master, path);
    assertOnlyKeys(master, AUDIO_MASTER_KEYS, path);
    assertNonEmptyString(master.id, `${path}.id`);
    assertUniqueId(ids, master.id, `${path}.id`);
    const volume = normalizeVolumeValue(master.volume, `${path}.volume`);
    assertOptionalBoolean(master.muted, `${path}.muted`);
    return { id: master.id, volume, muted: master.muted ?? false };
  });
};

const normalizeAudioAnimationControl = (control) => {
  if (control === undefined) return undefined;
  const path = "audioAnimationControl";
  assertNonEmptyRecord(control, path);
  assertOnlyKeys(control, AUDIO_ANIMATION_CONTROL_KEYS, path);
  if (!Number.isSafeInteger(control.commandId) || control.commandId < 0) {
    throw new Error(
      `Input error: ${path}.commandId must be a non-negative safe integer.`,
    );
  }
  if (control.operation !== "settle") {
    throw new Error(`Input error: ${path}.operation must be "settle".`);
  }
  return { commandId: control.commandId, operation: control.operation };
};

export const flattenAudioNodes = (audio = []) => {
  const ids = new Set();
  return validateAudioNodes(audio, ids);
};

export const normalizeAudioRenderState = ({
  audio = [],
  audioEffects = [],
  audioAnimations = [],
  audioMasters = [],
  audioAnimationControl,
} = {}) => {
  const ids = new Set();
  const flattened = validateAudioNodes(audio, ids);
  const transitions = validateAudioEffects(
    audioEffects,
    ids,
    flattened.builtinNodeTypes,
  );

  for (const [targetId, properties] of flattened.inlineTransitions) {
    if (transitions.has(targetId)) {
      throw new Error(
        `Input error: audio node "${targetId}" cannot define both inline transition and legacy audio-transition input.`,
      );
    }
    transitions.set(targetId, properties);
  }

  const normalizedAnimations = normalizeAudioAnimations({
    audioAnimations,
    nextAudio: flattened,
    occupiedTransitionTargetIds: new Set(transitions.keys()),
  });

  return {
    audio,
    audioEffects,
    audioAnimations: normalizedAnimations,
    audioMasters: normalizeAudioMasters(audioMasters),
    audioAnimationControl: normalizeAudioAnimationControl(
      audioAnimationControl,
    ),
    channels: flattened.channels,
    sounds: flattened.sounds,
    transitions,
  };
};

export const isGraphAudioNode = (node) => AUDIO_NODE_TYPES.has(node?.type);

export const filterGraphAudio = (audio = []) => audio.filter(isGraphAudioNode);

export const filterPluginAudio = (audio = []) =>
  audio.filter((node) => !isGraphAudioNode(node));
