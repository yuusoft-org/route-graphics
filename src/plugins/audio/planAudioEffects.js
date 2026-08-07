const PHASES_BY_LIFECYCLE = {
  add: new Set(["enter"]),
  replay: new Set(["enter"]),
  remove: new Set(["exit"]),
  replace: new Set(["enter", "exit"]),
  update: new Set(["update"]),
};

const PROPERTY_DEFAULTS = {
  volume: 100,
  pan: 0,
  playbackRate: 1,
};

const PROPERTY_SUPPORT = {
  "audio-channel": new Set(["volume", "pan"]),
  sound: new Set(["volume", "pan", "playbackRate"]),
};

const canonicalize = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
};

const normalizeEffectForSignature = (effect) => ({
  type: effect.type,
  targetId: effect.targetId,
  properties: Object.fromEntries(
    Object.entries(effect.properties).map(([property, phases]) => [
      property,
      Object.fromEntries(
        Object.entries(phases).map(([phase, track]) => [
          phase,
          {
            ...(track.initialValue === undefined
              ? {}
              : { initialValue: track.initialValue }),
            keyframes: track.keyframes.map((keyframe) => ({
              ...(keyframe.startValue === undefined
                ? {}
                : { startValue: keyframe.startValue }),
              value: keyframe.value,
              duration: keyframe.duration,
              delay: keyframe.delay ?? 0,
              easing: keyframe.easing ?? "linear",
              relative: keyframe.relative ?? false,
            })),
          },
        ]),
      ),
    ]),
  ),
});

export const getAudioEffectSignature = (effect) =>
  JSON.stringify(canonicalize(normalizeEffectForSignature(effect)));

const hasSameSoundSourceIdentity = (previous, next) =>
  previous.src === next.src &&
  previous.startAt === next.startAt &&
  previous.endAt === next.endAt &&
  previous.startDelayMs === next.startDelayMs;

const isSameSourceTransportReplay = (previous, next) =>
  previous.type === "sound" &&
  next.type === "sound" &&
  previous.playback !== undefined &&
  next.playback?.operation === "play" &&
  next.playback.commandId > previous.playback.commandId;

const getNodeMaps = (state) => {
  const channels = new Map(state.channels.map((node) => [node.id, node]));
  const sounds = new Map(state.sounds.map((node) => [node.id, node]));
  return {
    channels,
    sounds,
    byId: new Map([...channels, ...sounds]),
  };
};

const getLifecycle = (prevNode, nextNode) => {
  if (!prevNode) return "add";
  if (!nextNode) return "remove";
  if (
    prevNode.type === "sound" &&
    !hasSameSoundSourceIdentity(prevNode, nextNode)
  ) {
    return "replace";
  }
  if (isSameSourceTransportReplay(prevNode, nextNode)) {
    return "replay";
  }
  return "update";
};

const getTargetType = ({ effect, prevNode, nextNode, ownedAudioEffects }) =>
  nextNode?.type ??
  prevNode?.type ??
  ownedAudioEffects.get(effect.id)?.targetType ??
  null;

const validatePropertiesForTarget = ({ effect, targetType, path }) => {
  const supported = PROPERTY_SUPPORT[targetType];
  if (!supported) {
    throw new Error(
      `Input error: ${path}.targetId "${effect.targetId}" does not resolve to an audio node.`,
    );
  }

  for (const property of Object.keys(effect.properties)) {
    if (!supported.has(property)) {
      throw new Error(
        `Input error: audio transition property "${property}" is not supported for target type "${targetType}" at ${path}.properties.`,
      );
    }
  }
};

const validateAcceptedEffect = ({
  effect,
  index,
  prevNode,
  nextNode,
  targetType,
}) => {
  const path = `audioEffects[${index}]`;
  validatePropertiesForTarget({ effect, targetType, path });

  const lifecycle = getLifecycle(prevNode, nextNode);
  const allowedPhases = PHASES_BY_LIFECYCLE[lifecycle];
  let applicableTrackCount = 0;

  for (const [property, phases] of Object.entries(effect.properties)) {
    for (const [phase, track] of Object.entries(phases)) {
      if (!allowedPhases.has(phase)) {
        throw new Error(
          `Input error: ${path}.properties.${property}.${phase} is not applicable to an audio ${lifecycle} lifecycle.`,
        );
      }
      applicableTrackCount += 1;

      if (phase !== "enter" && phase !== "update") {
        continue;
      }

      const finalKeyframe = track.keyframes.at(-1);
      const targetValue = nextNode[property] ?? PROPERTY_DEFAULTS[property];
      if (finalKeyframe.relative === true) {
        throw new Error(
          `Input error: ${path}.properties.${property}.${phase}.keyframes must end with an absolute value.`,
        );
      }
      if (finalKeyframe.value !== targetValue) {
        throw new Error(
          `Input error: ${path}.properties.${property}.${phase}.keyframes must end at the next audio node's declared ${property} value ${targetValue}.`,
        );
      }

      if (phase === "update") {
        const previousValue = prevNode[property] ?? PROPERTY_DEFAULTS[property];
        if (previousValue === targetValue) {
          throw new Error(
            `Input error: ${path}.properties.${property}.update requires the declared ${property} value to change.`,
          );
        }
      }
    }
  }

  if (applicableTrackCount === 0) {
    throw new Error(
      `Input error: ${path} does not define automation for the current audio lifecycle.`,
    );
  }

  return lifecycle;
};

export const planAudioEffects = ({
  prevState,
  nextState,
  ownedAudioEffects = new Map(),
}) => {
  const prevNodes = getNodeMaps(prevState);
  const nextNodes = getNodeMaps(nextState);
  const prevEffects = prevState.audioEffects ?? [];
  const nextEffects = nextState.audioEffects ?? [];
  const prevById = new Map(prevEffects.map((effect) => [effect.id, effect]));
  const nextIndexById = new Map(
    nextEffects.map((effect, index) => [effect.id, index]),
  );
  const continued = [];
  const accepted = [];

  for (const effect of nextEffects) {
    const ownership = ownedAudioEffects.get(effect.id);
    const previous = prevById.get(effect.id);
    const signature = getAudioEffectSignature(effect);
    const previousSignature = previous
      ? getAudioEffectSignature(previous)
      : null;
    const prevNode = prevNodes.byId.get(effect.targetId);
    const nextNode = nextNodes.byId.get(effect.targetId);
    const targetType = getTargetType({
      effect,
      prevNode,
      nextNode,
      ownedAudioEffects,
    });

    if (previousSignature === signature && ownership?.signature === signature) {
      if (!targetType) {
        throw new Error(
          `Input error: continued audio effect "${effect.id}" has no public target or renderer ownership record.`,
        );
      }
      validatePropertiesForTarget({
        effect,
        targetType,
        path: `audioEffects[${nextIndexById.get(effect.id)}]`,
      });
      continued.push({ effect, signature, targetType });
      continue;
    }

    if (!ownership && previous && previousSignature === signature) {
      throw new Error(
        `Input error: audio effect "${effect.id}" cannot continue without renderer ownership.`,
      );
    }

    if (!prevNode && !nextNode) {
      throw new Error(
        `Input error: audioEffects[${nextIndexById.get(effect.id)}].targetId "${effect.targetId}" does not resolve to an audio node.`,
      );
    }
    if (prevNode && nextNode && prevNode.type !== nextNode.type) {
      throw new Error(
        `Input error: audio node "${effect.targetId}" cannot change type from "${prevNode.type}" to "${nextNode.type}" between render states.`,
      );
    }

    const lifecycle = validateAcceptedEffect({
      effect,
      index: nextIndexById.get(effect.id),
      prevNode,
      nextNode,
      targetType,
    });
    accepted.push({
      effect,
      signature,
      targetType,
      lifecycle,
      prevNode,
      nextNode,
    });
  }

  const continuedIds = new Set(continued.map(({ effect }) => effect.id));
  const acceptedTargets = new Map(
    accepted.map((entry) => [entry.effect.targetId, entry]),
  );
  const superseded = [];
  const settled = [];

  const previousOccurrences = new Map(prevById);
  for (const [id, ownership] of ownedAudioEffects) {
    if (ownership.effect) {
      previousOccurrences.set(id, ownership.effect);
    }
  }

  for (const effect of previousOccurrences.values()) {
    if (continuedIds.has(effect.id)) continue;

    const entry = {
      effect,
      ownership: ownedAudioEffects.get(effect.id) ?? null,
    };
    if (acceptedTargets.has(effect.targetId)) {
      superseded.push(entry);
    } else {
      settled.push(entry);
    }
  }

  return {
    accepted,
    continued,
    superseded,
    settled,
    transitions: new Map(
      accepted.map(({ effect }) => [effect.targetId, effect.properties]),
    ),
    prevNodes,
    nextNodes,
  };
};
