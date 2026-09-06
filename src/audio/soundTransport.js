import { AudioAsset } from "../AudioAsset.js";
import { normalizeVolume } from "../util/normalizeVolume.js";
import { getAudioContext, getAudioRuntime } from "../audioContext.js";
import {
  audioParamAutomation,
  getParamValue,
  toFiniteParamValue,
  getTimelineValueAtTime,
  integrateAudioParamValue,
  setParamNow,
  buildAudioTimeline,
  applyDeferredTimeline,
  getTimeToMediaProgressMs,
  integrateTimelineRange,
  getAudioParamValueAfterDelayMs,
  getAudioParamProgressAfterDelayMs,
  getAudioParamAutomationRemainingMs,
  applyVolume,
  applyPan,
  applyPlaybackRate,
  normalizePlaybackRateValue,
  captureActiveAudioParamAutomation,
  resumeAudioParamAutomation,
} from "./automation.js";

export const ROOT_CHANNEL_ID = "__route_graphics_audio_root__";
export const DIRECT_CHANNEL_ID = "__route_graphics_audio_direct__";
export const CONTROLLED_PROGRESS_INTERVAL_MS = 250;

export const getAudioNowMs = () => getAudioRuntime().nowMs();
export const scheduleTimeout = (callback, delayMs) =>
  getAudioRuntime().setTimeout(callback, delayMs);
export const cancelTimeout = (timeoutId) =>
  getAudioRuntime().clearTimeout(timeoutId);
export const scheduleInterval = (callback, intervalMs) =>
  getAudioRuntime().setInterval(callback, intervalMs);
export const cancelInterval = (intervalId) =>
  getAudioRuntime().clearInterval(intervalId);
export const scheduleMicrotask = (callback) =>
  getAudioRuntime().queueMicrotask(callback);

const isAudioDebugEnabled = () =>
  globalThis.window?.RTGL_AUDIO_DEBUG === true ||
  globalThis.window?.RTGL_VT_DEBUG === true;

export const debugAudio = (message, details = {}) => {
  if (!isAudioDebugEnabled()) {
    return;
  }

  console.log(`[AudioStage] ${message}`, details);
};

export const connect = (from, to) => {
  if (from && to && typeof from.connect === "function") {
    from.connect(to);
  }
};

export const disconnect = (node) => {
  if (node && typeof node.disconnect === "function") {
    node.disconnect();
  }
};

export const resumeAudioContext = (context = getAudioContext()) => {
  if (context.state === "suspended" && typeof context.resume === "function") {
    const previousState = context.state;
    debugAudio("resume requested", { state: previousState });

    return context
      .resume()
      .then(() => {
        debugAudio("resume resolved", {
          previousState,
          state: context.state,
        });
      })
      .catch((error) => {
        if (isAudioDebugEnabled()) {
          console.warn("[AudioStage] resume failed", {
            previousState,
            state: context.state,
            error,
          });
        }
      });
  }

  debugAudio("resume skipped", {
    state: context.state,
    canResume: typeof context.resume === "function",
  });
  return Promise.resolve();
};

const createGainNode = (value = 1) => {
  const context = getAudioContext();
  const node = context.createGain();
  setParamNow(node.gain, value, context);
  return node;
};

const createPannerNode = (pan = 0) => {
  const context = getAudioContext();
  if (typeof context.createStereoPanner !== "function") {
    return null;
  }

  const node = context.createStereoPanner();
  setParamNow(node.pan, pan, context);
  return node;
};

export const getVolumeValue = ({ volume }) => normalizeVolume(volume, 100);

export const getMuteValue = ({ muted }) => (muted ? 0 : 1);

export const hasSameSoundSourceIdentity = (previous, next) =>
  previous.src === next.src &&
  previous.startAt === next.startAt &&
  previous.endAt === next.endAt &&
  previous.startDelayMs === next.startDelayMs;

export const normalizeDirectVolume = (volume, fallback = 1) => {
  const parsedFallback = Number(fallback);
  const normalizedFallback = Number.isFinite(parsedFallback)
    ? parsedFallback
    : 1;
  const parsedVolume = Number(volume ?? normalizedFallback);
  const normalizedVolume = Number.isFinite(parsedVolume)
    ? parsedVolume
    : normalizedFallback;

  return (
    normalizeVolume(normalizedVolume * 100, normalizedFallback * 100) * 100
  );
};

export const getTransitionPhase = (effects = [], targetId, property, phase) => {
  if (effects instanceof Map) {
    return effects.get(targetId)?.[property]?.[phase] ?? null;
  }

  const transition = effects.find(
    (effect) =>
      effect.type === "audio-transition" && effect.targetId === targetId,
  );

  return transition?.properties?.[property]?.[phase] ?? null;
};

export const getRemainingIterationMediaSeconds = (
  sound,
  context = getAudioContext(),
) => {
  const source = sound.source;
  if (!source) {
    return null;
  }

  const configuredLoopEnd =
    sound.endAt === null || sound.endAt === undefined
      ? Number.NaN
      : toFiniteParamValue(sound.endAt, Number.NaN);
  const bufferDuration = toFiniteParamValue(
    source.buffer?.duration,
    Number.NaN,
  );
  const loopStart = Number.isFinite(configuredLoopEnd)
    ? toFiniteParamValue(sound.startAt, 0)
    : Math.max(0, toFiniteParamValue(source.loopStart, 0));
  const loopEnd = Number.isFinite(configuredLoopEnd)
    ? configuredLoopEnd
    : toFiniteParamValue(source.loopEnd, 0) > loopStart
      ? toFiniteParamValue(source.loopEnd, 0)
      : bufferDuration;
  const iterationDuration = loopEnd - loopStart;
  if (!Number.isFinite(iterationDuration) || iterationDuration < 0) {
    return null;
  }
  if (iterationDuration === 0) {
    return 0;
  }

  const startedAt = toFiniteParamValue(
    sound.sourceStartedAt,
    context.currentTime,
  );
  const progressedMediaSeconds = integrateAudioParamValue(
    source.playbackRate,
    startedAt,
    context.currentTime,
  );
  const startOffset = toFiniteParamValue(sound.sourceStartOffset, loopStart);
  const absoluteOffset = startOffset + progressedMediaSeconds;
  if (!source.loop) {
    return Math.max(0, loopEnd - Math.min(absoluteOffset, loopEnd));
  }

  const elapsedInIteration =
    (((absoluteOffset - loopStart) % iterationDuration) + iterationDuration) %
    iterationDuration;
  if (progressedMediaSeconds > 0 && elapsedInIteration === 0) {
    return 0;
  }
  return iterationDuration - elapsedInIteration;
};

export const getPlaybackRateAutomationValue = (
  sound,
  context = getAudioContext(),
) => {
  const automation = sound.playbackRateAutomation;
  if (!automation) {
    return normalizePlaybackRateValue(sound.playbackRate);
  }

  const elapsedMs = Math.max(
    0,
    (context.currentTime - automation.startTime) * 1000,
  );
  return normalizePlaybackRateValue(
    getTimelineValueAtTime(automation.timeline, elapsedMs),
  );
};

export const startPlaybackRateAutomation = ({
  sound,
  transition,
  currentValue,
}) => {
  if (!transition) {
    sound.playbackRateAutomation = null;
    return 0;
  }

  const context = getAudioContext();
  const timeline = buildAudioTimeline({
    transition,
    currentValue,
    normalizeTransitionValue: normalizePlaybackRateValue,
    denormalizeParamValue: (value) => value,
  });
  sound.playbackRateAutomation = {
    startTime: context.currentTime,
    timeline,
    normalizeValue: normalizePlaybackRateValue,
  };
  return timeline[timeline.length - 1].time;
};

export const applySoundPlaybackRateTransition = ({
  sound,
  transition,
  currentValue,
  source = sound.source,
}) => {
  if (source) {
    const duration = applyPlaybackRate({
      source,
      targetValue: sound.playbackRate,
      transition,
    });
    sound.playbackRateAutomation = transition
      ? (audioParamAutomation.get(source.playbackRate) ?? null)
      : null;
    return duration;
  }

  return startPlaybackRateAutomation({
    sound,
    transition,
    currentValue:
      currentValue ?? getPlaybackRateAutomationValue(sound, getAudioContext()),
  });
};

export const applyPendingSoundEnterTransitions = (sound, source) => {
  const transitions = sound.pendingEnterTransitions;
  if (transitions?.volume) {
    applyVolume({
      gainNode: sound.gainNode,
      targetValue: getVolumeValue(sound),
      transition: transitions?.volume ?? null,
    });
  }
  if (transitions) {
    if (transitions.pan) {
      applyPan({
        pannerNode: sound.pannerNode,
        targetValue: sound.pan,
        transition: transitions.pan,
      });
    }
  }

  if (transitions?.playbackRate) {
    applyPlaybackRate({
      source,
      targetValue: sound.playbackRate ?? 1,
      transition: transitions.playbackRate,
    });
    sound.playbackRateAutomation =
      audioParamAutomation.get(source?.playbackRate) ?? null;
  } else if (sound.playbackRateAutomation) {
    applyDeferredTimeline({
      param: source?.playbackRate,
      automation: sound.playbackRateAutomation,
      normalizeParamValue: normalizePlaybackRateValue,
    });
  } else {
    applyPlaybackRate({
      source,
      targetValue: sound.playbackRate ?? 1,
      transition: null,
    });
  }
  return transitions;
};

export const consumePendingSoundEnterTransitions = (sound, transitions) => {
  if (sound.pendingEnterTransitions === transitions) {
    sound.pendingEnterTransitions = null;
  }
};

const getTransitionDurationMs = (transition) =>
  transition?.keyframes?.reduce(
    (duration, keyframe) =>
      duration +
      Math.max(0, toFiniteParamValue(keyframe.delay, 0)) +
      Math.max(0, toFiniteParamValue(keyframe.duration, 0)),
    0,
  ) ?? 0;

export const cancelSoundEndEffect = (sound) => {
  if (sound.endEffectTimeoutId === null) return;

  cancelTimeout(sound.endEffectTimeoutId);
  sound.endEffectTimeoutId = null;
};

export const hasSoundBoundaryEffects = (sound) =>
  sound.beginEffect !== null || sound.endEffect !== null;

const getSoundBoundaryEffectDurationMs = (effect) =>
  Math.max(0, ...Object.values(effect ?? {}).map(getTransitionDurationMs));

const rememberSoundBoundaryAutomation = (sound, property, param, phase) => {
  if (!param || !phase) return;

  const automation = audioParamAutomation.get(param);
  if (!automation) return;

  sound.boundaryAutomations[property] = {
    phase,
    param,
    automation,
  };
};

const applySoundBoundaryPropertyValue = (sound, property, source) => {
  if (property === "volume") {
    applyVolume({
      gainNode: sound.gainNode,
      targetValue: getVolumeValue(sound),
      transition: null,
    });
    return;
  }
  if (property === "pan") {
    applyPan({
      pannerNode: sound.pannerNode,
      targetValue: sound.pan,
      transition: null,
    });
    return;
  }
  if (property === "playbackRate") {
    applyPlaybackRate({
      source,
      targetValue: sound.playbackRate ?? 1,
      transition: null,
    });
    sound.playbackRateAutomation = null;
  }
};

export const settleSoundBoundaryPhase = (
  sound,
  phase,
  { beforePlaybackRate } = {},
) => {
  const settledProperties = new Set();
  for (const [property, record] of Object.entries(sound.boundaryAutomations)) {
    if (record.phase !== phase) continue;

    if (audioParamAutomation.get(record.param) === record.automation) {
      if (property === "playbackRate") {
        beforePlaybackRate?.();
      }
      applySoundBoundaryPropertyValue(sound, property, sound.source);
      settledProperties.add(property);
    }
    delete sound.boundaryAutomations[property];
  }

  const pauseState = sound.channelPauseState?.boundaryAutomationState;
  if (!pauseState) return;

  for (const property of ["volume", "pan", "playbackRate"]) {
    if (pauseState[property]?.phase !== phase) continue;

    if (!settledProperties.has(property)) {
      applySoundBoundaryPropertyValue(sound, property, sound.source);
    }
    pauseState[property] = null;
  }
  if (!Object.values(pauseState).some(Boolean)) {
    sound.channelPauseState.boundaryAutomationState = null;
  }
};

const getSoundEndEffectDelayMs = ({
  sound,
  source,
  mediaDuration,
  context = getAudioContext(),
}) => {
  const effectDurationMs = getSoundBoundaryEffectDurationMs(sound.endEffect);
  const playbackRateTransition = sound.endEffect?.playbackRate;
  if (!playbackRateTransition) {
    const iterationDurationMs = getTimeToMediaProgressMs(
      source.playbackRate,
      mediaDuration,
      context,
    );
    return Number.isFinite(iterationDurationMs)
      ? Math.max(0, iterationDurationMs - effectDurationMs)
      : null;
  }

  const getProgressThroughEffect = (delayMs) => {
    const currentValue = normalizePlaybackRateValue(
      getAudioParamValueAfterDelayMs(source.playbackRate, delayMs, context),
    );
    const timeline = buildAudioTimeline({
      transition: playbackRateTransition,
      currentValue,
      normalizeTransitionValue: normalizePlaybackRateValue,
      denormalizeParamValue: (value) => value,
    });
    return integrateTimelineRange(
      timeline,
      0,
      effectDurationMs,
      normalizePlaybackRateValue,
    );
  };
  const getTotalProgress = (delayMs) =>
    getAudioParamProgressAfterDelayMs(source.playbackRate, delayMs, context) +
    getProgressThroughEffect(delayMs);

  if (getTotalProgress(0) >= mediaDuration) {
    return 0;
  }

  let highMs = getTimeToMediaProgressMs(
    source.playbackRate,
    mediaDuration,
    context,
  );
  if (!Number.isFinite(highMs)) {
    highMs = getAudioParamAutomationRemainingMs(source.playbackRate, context);
    if (getTotalProgress(highMs) < mediaDuration) {
      return 0;
    }
  }

  let lowMs = 0;
  for (let iteration = 0; iteration < 48; iteration++) {
    const midpointMs = (lowMs + highMs) / 2;
    if (getTotalProgress(midpointMs) >= mediaDuration) {
      highMs = midpointMs;
    } else {
      lowMs = midpointMs;
    }
  }
  return Math.max(0, highMs);
};

export const captureSoundBoundaryPauseState = (
  sound,
  context = getAudioContext(),
) => {
  const properties = new Set([
    ...Object.keys(sound.beginEffect ?? {}),
    ...Object.keys(sound.endEffect ?? {}),
  ]);
  if (properties.size === 0) return null;

  const captureProperty = (property, param, hold = false) => {
    const snapshot = captureActiveAudioParamAutomation(param, {
      hold,
      context,
    });
    if (!snapshot) return null;

    const record = sound.boundaryAutomations[property];
    return {
      ...snapshot,
      phase: record?.automation === snapshot.automation ? record.phase : null,
    };
  };
  const state = {
    volume: properties.has("volume")
      ? captureProperty("volume", sound.gainNode?.gain, true)
      : null,
    pan: properties.has("pan")
      ? captureProperty("pan", sound.pannerNode?.pan, true)
      : null,
    playbackRate: properties.has("playbackRate")
      ? captureProperty("playbackRate", sound.source?.playbackRate)
      : null,
  };
  return Object.values(state).some(Boolean) ? state : null;
};

export const resumeSoundBoundaryPauseState = (
  sound,
  state,
  context = getAudioContext(),
) => {
  if (!state) return;

  const volumeAutomation = resumeAudioParamAutomation(
    sound.gainNode?.gain,
    state.volume,
    context,
  );
  if (volumeAutomation && state.volume.phase) {
    rememberSoundBoundaryAutomation(
      sound,
      "volume",
      sound.gainNode.gain,
      state.volume.phase,
    );
  }
  const panAutomation = resumeAudioParamAutomation(
    sound.pannerNode?.pan,
    state.pan,
    context,
  );
  if (panAutomation && state.pan.phase) {
    rememberSoundBoundaryAutomation(
      sound,
      "pan",
      sound.pannerNode.pan,
      state.pan.phase,
    );
  }
  if (state.playbackRate) {
    sound.playbackRateAutomation = {
      ...state.playbackRate.automation,
      startTime: context.currentTime - state.playbackRate.elapsedMs / 1000,
    };
    sound.pendingBoundaryPlaybackRatePhase = state.playbackRate.phase;
  }
};

const resetSoundBoundaryProperties = (sound, source) => {
  sound.endEffectActive = false;
  sound.boundaryAutomations = {};
  sound.pendingBoundaryPlaybackRatePhase = null;
  const properties = new Set([
    ...Object.keys(sound.beginEffect ?? {}),
    ...Object.keys(sound.endEffect ?? {}),
  ]);
  if (properties.has("volume")) {
    applyVolume({
      gainNode: sound.gainNode,
      targetValue: getVolumeValue(sound),
      transition: null,
    });
  }
  if (properties.has("pan")) {
    applyPan({
      pannerNode: sound.pannerNode,
      targetValue: sound.pan,
      transition: null,
    });
  }
  if (properties.has("playbackRate")) {
    applyPlaybackRate({
      source,
      targetValue: sound.playbackRate ?? 1,
      transition: null,
    });
    sound.playbackRateAutomation = null;
  }
};

const applySoundBoundaryEffect = ({
  sound,
  source,
  effect,
  phase,
  blocked = {},
}) => {
  if (!effect) return 0;
  const blockedProperties = blocked ?? {};
  const durations = [];
  if (effect.volume && !blockedProperties.volume) {
    durations.push(
      applyVolume({
        gainNode: sound.gainNode,
        targetValue: getVolumeValue(sound),
        transition: effect.volume,
      }),
    );
    rememberSoundBoundaryAutomation(
      sound,
      "volume",
      sound.gainNode?.gain,
      phase,
    );
  }
  if (effect.pan && !blockedProperties.pan) {
    durations.push(
      applyPan({
        pannerNode: sound.pannerNode,
        targetValue: sound.pan,
        transition: effect.pan,
      }),
    );
    rememberSoundBoundaryAutomation(sound, "pan", sound.pannerNode?.pan, phase);
  }
  if (effect.playbackRate && !blockedProperties.playbackRate) {
    durations.push(
      applySoundPlaybackRateTransition({
        sound,
        source,
        transition: effect.playbackRate,
      }),
    );
    rememberSoundBoundaryAutomation(
      sound,
      "playbackRate",
      source?.playbackRate,
      phase,
    );
  }
  return Math.max(0, ...durations);
};

export const scheduleSoundEndEffect = ({ sound, source, mediaDuration }) => {
  if (sound.endEffectActive) return;

  cancelSoundEndEffect(sound);
  if (!sound.endEffect || mediaDuration === undefined) return;

  const delayMs = getSoundEndEffectDelayMs({
    sound,
    source,
    mediaDuration,
  });
  if (delayMs === null) return;

  sound.endEffectTimeoutId = scheduleTimeout(() => {
    sound.endEffectTimeoutId = null;
    if (sound.source !== source || sound.finishing) return;

    sound.endEffectActive = true;
    applySoundBoundaryEffect({
      sound,
      source,
      effect: sound.endEffect,
      phase: "end",
    });
  }, delayMs);
};

export const createChannelInstance = (channel, outputNode) => {
  const gainNode = createGainNode(getVolumeValue(channel));
  const pannerNode = createPannerNode(channel.pan ?? 0);
  const muteGainNode = createGainNode(getMuteValue(channel));

  connect(gainNode, pannerNode ?? muteGainNode);
  if (pannerNode) connect(pannerNode, muteGainNode);
  connect(muteGainNode, outputNode);

  return {
    id: channel.id,
    gainNode,
    pannerNode,
    muteGainNode,
    volume: channel.volume ?? 100,
    muted: channel.muted ?? false,
    pan: channel.pan ?? 0,
    loop: channel.loop ?? false,
    interruption: channel.interruption ?? "immediate",
    playback: channel.playback ?? null,
    control: channel.playback
      ? {
          commandId: -1,
          status: "playing",
        }
      : null,
    outputNode,
    cleanupTimeoutId: null,
    deferredRemovalToken: null,
    detached: false,
    cleanedUp: false,
  };
};

export const createSoundInstance = ({ sound, channelNode, internalId }) => {
  const gainNode = createGainNode(getVolumeValue(sound));
  const pannerNode = createPannerNode(sound.pan ?? 0);
  const muteGainNode = createGainNode(getMuteValue(sound));

  connect(gainNode, pannerNode ?? muteGainNode);
  if (pannerNode) connect(pannerNode, muteGainNode);
  connect(muteGainNode, channelNode);

  return {
    internalId,
    id: sound.id,
    src: sound.src,
    url: sound.src,
    loop: sound.loop ?? false,
    volume: sound.volume ?? 100,
    muted: sound.muted ?? false,
    pan: sound.pan ?? 0,
    startDelayMs: sound.startDelayMs ?? 0,
    playbackRate: sound.playbackRate ?? 1,
    startAt: sound.startAt ?? 0,
    endAt: sound.endAt ?? null,
    channelId: sound.channelId ?? null,
    channelNode,
    gainNode,
    pannerNode,
    muteGainNode,
    source: null,
    sourceStartedAt: null,
    sourceStartOffset: sound.startAt ?? 0,
    sourceEnded: false,
    onSourceEnded: null,
    onFinishingSourceStarted: null,
    finishing: false,
    finishingCallbacks: new Set(),
    pendingEnterTransitions: null,
    beginEffect: sound.beginEffect ?? null,
    endEffect: sound.endEffect ?? null,
    endEffectTimeoutId: null,
    endEffectActive: false,
    boundaryAutomations: {},
    pendingBoundaryPlaybackRatePhase: null,
    boundaryEndScheduleInvalidated: false,
    playbackRateAutomation: null,
    playbackPending: false,
    pendingTimeoutId: null,
    pendingDelayMs: 0,
    pendingStartOffset: null,
    delayDeadlineMs: null,
    channelPauseState: null,
    cleanupTimeoutId: null,
    cleanupDeadlineTime: null,
    ownExitDeadlineTime: null,
    playRequestId: 0,
    playback: sound.playback ?? null,
    control: sound.playback
      ? {
          commandId: -1,
          status: "stopped",
          cursorMs: 0,
          durationMs: null,
          decodedBuffer: null,
          ready: false,
          readyAnnounced: false,
          readyTaskQueued: false,
          decodeRequestId: 0,
          decodePending: false,
          pendingPosition: null,
          deferredProgress: false,
          pausedCursorRetained: false,
          remainingDelayMs: 0,
          delayDeadlineMs: null,
          progressIntervalId: null,
          sourceToken: 0,
          sourceCursorMs: 0,
          sourceStartedAt: null,
          eventsSuppressed: false,
          detached: false,
          lastErrorCode: null,
        }
      : null,
  };
};

const createSourceForSound = (
  sound,
  startOffset = sound.startAt ?? 0,
  { iterationStart = true } = {},
) => {
  const context = getAudioContext();
  const audioBuffer = AudioAsset.getAsset(sound.src);
  debugAudio("asset lookup", {
    id: sound.id,
    src: sound.src,
    found: Boolean(audioBuffer),
    duration: audioBuffer?.duration ?? null,
    contextState: context.state,
  });
  if (!audioBuffer) {
    console.warn("AudioStage: asset not found", sound.src);
    return null;
  }

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.loop = (sound.loop ?? false) && !hasSoundBoundaryEffects(sound);

  connect(source, sound.gainNode);

  sound.sourceEnded = false;
  source.onended = () => {
    if (sound.source !== source) {
      return;
    }

    cancelSoundEndEffect(sound);
    if (sound.loop && hasSoundBoundaryEffects(sound) && !sound.finishing) {
      sound.sourceEnded = true;
      playSound(sound, {
        startOffset: sound.startAt ?? 0,
        startDelayMs: 0,
      });
      return;
    }

    sound.sourceEnded = true;
    sound.onSourceEnded?.();
  };

  const offset = startOffset;
  const duration =
    sound.endAt !== null && sound.endAt !== undefined
      ? Math.max(sound.endAt - offset, 0)
      : undefined;
  const startTime = Math.max(0, toFiniteParamValue(context.currentTime, 0));
  sound.sourceStartedAt = startTime;
  sound.sourceStartOffset = offset;

  if (source.loop && sound.endAt !== null && sound.endAt !== undefined) {
    source.loopStart = sound.startAt ?? 0;
    source.loopEnd = sound.endAt;
    source.start(startTime, offset);
  } else if (duration !== undefined) {
    source.start(startTime, offset, duration);
  } else {
    source.start(startTime, offset);
  }
  if (iterationStart) {
    resetSoundBoundaryProperties(sound, source);
  }
  const pendingEnterTransitions = applyPendingSoundEnterTransitions(
    sound,
    source,
  );
  if (!iterationStart && sound.pendingBoundaryPlaybackRatePhase) {
    rememberSoundBoundaryAutomation(
      sound,
      "playbackRate",
      source.playbackRate,
      sound.pendingBoundaryPlaybackRatePhase,
    );
    sound.pendingBoundaryPlaybackRatePhase = null;
  }
  if (iterationStart) {
    applySoundBoundaryEffect({
      sound,
      source,
      effect: sound.beginEffect,
      phase: "begin",
      blocked: pendingEnterTransitions,
    });
  }
  consumePendingSoundEnterTransitions(sound, pendingEnterTransitions);
  const mediaDuration =
    duration ??
    (Number.isFinite(audioBuffer.duration)
      ? Math.max(audioBuffer.duration - offset, 0)
      : undefined);
  scheduleSoundEndEffect({ sound, source, mediaDuration });
  debugAudio("source started", {
    id: sound.id,
    src: sound.src,
    loop: source.loop,
    startTime,
    offset,
    duration: duration ?? null,
    playbackRate: sound.playbackRate,
    gain: getParamValue(sound.gainNode?.gain, null),
    contextState: context.state,
  });

  return source;
};

export const playSound = (
  sound,
  {
    startOffset = sound.startAt ?? 0,
    startDelayMs = sound.startDelayMs,
    iterationStart = true,
  } = {},
) => {
  if (sound.pendingTimeoutId !== null) {
    cancelTimeout(sound.pendingTimeoutId);
    sound.pendingTimeoutId = null;
  }
  sound.delayDeadlineMs = null;
  sound.pendingDelayMs = Math.max(0, startDelayMs ?? 0);
  sound.pendingStartOffset = startOffset;
  sound.channelPauseState = null;

  const context = getAudioContext();
  const playRequestId = (sound.playRequestId ?? 0) + 1;
  sound.playRequestId = playRequestId;
  sound.sourceEnded = false;
  sound.playbackPending = true;
  debugAudio("play requested", {
    id: sound.id,
    src: sound.src,
    loop: sound.loop,
    volume: sound.volume,
    muted: sound.muted,
    startDelayMs: sound.pendingDelayMs,
    startOffset,
    contextState: context.state,
  });
  const needsResume =
    context.state === "suspended" && typeof context.resume === "function";

  const start = () => {
    if (sound.playRequestId !== playRequestId) {
      return;
    }

    sound.pendingTimeoutId = null;
    sound.delayDeadlineMs = null;
    sound.pendingDelayMs = 0;
    const previousSource = sound.source;
    sound.source = createSourceForSound(sound, startOffset, {
      iterationStart,
    });
    sound.playbackPending = false;
    sound.pendingStartOffset = null;
    if (previousSource && previousSource !== sound.source) {
      disconnect(previousSource);
    }
    if (!sound.source && sound.finishing) {
      sound.sourceEnded = true;
      sound.onSourceEnded?.();
    } else if (sound.source && sound.finishing) {
      sound.onFinishingSourceStarted?.();
    }
  };

  const scheduleStart = () => {
    if (sound.playRequestId !== playRequestId) {
      return;
    }

    if (sound.pendingDelayMs > 0) {
      sound.delayDeadlineMs = getAudioNowMs() + sound.pendingDelayMs;
      sound.pendingTimeoutId = scheduleTimeout(start, sound.pendingDelayMs);
      return;
    }

    start();
  };

  const resumePromise = resumeAudioContext(context);
  if (needsResume) {
    void resumePromise.then(scheduleStart);
    return;
  }

  scheduleStart();
};

export const stopSource = (sound, delayMs = 0) => {
  cancelSoundEndEffect(sound);
  sound.playRequestId = (sound.playRequestId ?? 0) + 1;
  sound.playbackPending = false;
  sound.pendingDelayMs = 0;
  sound.pendingStartOffset = null;
  sound.delayDeadlineMs = null;

  if (sound.pendingTimeoutId !== null) {
    cancelTimeout(sound.pendingTimeoutId);
    sound.pendingTimeoutId = null;
  }

  if (!sound.source) return;

  const context = getAudioContext();
  try {
    sound.source.stop(context.currentTime + delayMs / 1000);
  } catch {
    // Stopping an already-stopped source is harmless for cleanup.
  }
};

export const cleanupSound = (sound) => {
  cancelSoundEndEffect(sound);
  sound.onSourceEnded = null;
  sound.pendingEnterTransitions = null;
  sound.beginEffect = null;
  sound.endEffect = null;
  sound.endEffectActive = false;
  sound.boundaryAutomations = {};
  sound.pendingBoundaryPlaybackRatePhase = null;
  sound.boundaryEndScheduleInvalidated = false;
  sound.playbackRateAutomation = null;

  if (sound.control) {
    sound.control.decodeRequestId += 1;
    sound.control.sourceToken += 1;
    sound.control.eventsSuppressed = true;
    sound.control.detached = true;
    if (sound.control.progressIntervalId !== null) {
      cancelInterval(sound.control.progressIntervalId);
      sound.control.progressIntervalId = null;
    }
  }

  if (sound.pendingTimeoutId !== null) {
    cancelTimeout(sound.pendingTimeoutId);
    sound.pendingTimeoutId = null;
  }
  if (sound.cleanupTimeoutId !== null) {
    cancelTimeout(sound.cleanupTimeoutId);
    sound.cleanupTimeoutId = null;
  }
  sound.cleanupDeadlineTime = null;
  sound.ownExitDeadlineTime = null;

  stopSource(sound);
  disconnect(sound.source);
  disconnect(sound.gainNode);
  disconnect(sound.pannerNode);
  disconnect(sound.muteGainNode);
};

export const cleanupChannel = (channel) => {
  if (channel.cleanedUp) return;

  if (channel.cleanupTimeoutId !== null) {
    cancelTimeout(channel.cleanupTimeoutId);
    channel.cleanupTimeoutId = null;
  }
  channel.deferredRemovalToken = null;
  channel.cleanedUp = true;
  disconnect(channel.gainNode);
  disconnect(channel.pannerNode);
  disconnect(channel.muteGainNode);
};

export const schedule = (callback, delayMs) => {
  if (delayMs <= 0) {
    callback();
    return null;
  }
  return scheduleTimeout(callback, delayMs);
};
