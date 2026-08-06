import { AudioAsset } from "./AudioAsset.js";
import { getEasingFunction } from "./util/animationTimeline.js";
import { normalizeVolume } from "./util/normalizeVolume.js";
import { normalizeAudioRenderState } from "./util/normalizeAudio.js";
import { getAudioContext, getAudioRuntime } from "./audioContext.js";
import { planAudioEffects } from "./plugins/audio/planAudioEffects.js";

const ROOT_CHANNEL_ID = "__route_graphics_audio_root__";
const DIRECT_CHANNEL_ID = "__route_graphics_audio_direct__";
const AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS = 16;
const AUDIO_AUTOMATION_MAX_SAMPLES = 1024;
const CONTROLLED_PROGRESS_INTERVAL_MS = 250;
const audioParamAutomation = new WeakMap();

const getAudioNowMs = () => getAudioRuntime().nowMs();
const scheduleTimeout = (callback, delayMs) =>
  getAudioRuntime().setTimeout(callback, delayMs);
const cancelTimeout = (timeoutId) => getAudioRuntime().clearTimeout(timeoutId);
const scheduleInterval = (callback, intervalMs) =>
  getAudioRuntime().setInterval(callback, intervalMs);
const cancelInterval = (intervalId) =>
  getAudioRuntime().clearInterval(intervalId);
const scheduleMicrotask = (callback) =>
  getAudioRuntime().queueMicrotask(callback);

const isAudioDebugEnabled = () =>
  globalThis.window?.RTGL_AUDIO_DEBUG === true ||
  globalThis.window?.RTGL_VT_DEBUG === true;

const debugAudio = (message, details = {}) => {
  if (!isAudioDebugEnabled()) {
    return;
  }

  console.log(`[AudioStage] ${message}`, details);
};

const connect = (from, to) => {
  if (from && to && typeof from.connect === "function") {
    from.connect(to);
  }
};

const disconnect = (node) => {
  if (node && typeof node.disconnect === "function") {
    node.disconnect();
  }
};

const toFiniteParamValue = (value, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return fallback;
};

const getParamValue = (param, fallback = 0) =>
  toFiniteParamValue(param?.value, fallback);

const getTimelineValueAtTime = (timeline, elapsedMs) => {
  if (timeline.length === 0) return 0;

  const lastKeyframe = timeline[timeline.length - 1];
  if (elapsedMs >= lastKeyframe.time) return lastKeyframe.value;

  for (let index = 1; index < timeline.length; index++) {
    const start = timeline[index - 1];
    const end = timeline[index];
    if (elapsedMs >= end.time || end.time === start.time) continue;

    const progress = Math.max(
      0,
      Math.min(1, (elapsedMs - start.time) / (end.time - start.time)),
    );
    const easedProgress = getEasingFunction(end.easing)(progress);
    return start.value + (end.value - start.value) * easedProgress;
  }

  return lastKeyframe.value;
};

const getCurrentParamValue = (param, context = getAudioContext()) => {
  const automation = audioParamAutomation.get(param);
  if (!automation) return getParamValue(param);

  const elapsedMs = Math.max(
    0,
    (context.currentTime - automation.startTime) * 1000,
  );
  return automation.normalizeValue(
    getTimelineValueAtTime(automation.timeline, elapsedMs),
  );
};

const integrateAudioParamValue = (param, startTime, endTime) => {
  const durationSeconds = Math.max(0, endTime - startTime);
  if (durationSeconds === 0) {
    return 0;
  }

  const automation = audioParamAutomation.get(param);
  if (!automation) {
    return durationSeconds * Math.max(0, getParamValue(param, 1));
  }

  const durationMs = durationSeconds * 1000;
  const sampleCount = Math.min(
    AUDIO_AUTOMATION_MAX_SAMPLES,
    Math.max(1, Math.ceil(durationMs / AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS)),
  );
  const sampleDurationSeconds = durationSeconds / sampleCount;
  let integratedSeconds = 0;

  for (let sample = 0; sample < sampleCount; sample++) {
    const sampleTime = startTime + (sample + 0.5) * sampleDurationSeconds;
    const elapsedMs = Math.max(0, (sampleTime - automation.startTime) * 1000);
    const value = automation.normalizeValue(
      getTimelineValueAtTime(automation.timeline, elapsedMs),
    );
    integratedSeconds += Math.max(0, value) * sampleDurationSeconds;
  }

  return integratedSeconds;
};

const setParamAtTime = (param, value, time) => {
  if (typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, time);
  } else {
    param.value = value;
  }
};

const resumeAudioContext = (context = getAudioContext()) => {
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

const setParamNow = (param, value, context = getAudioContext()) => {
  if (!param) return;

  const now = context.currentTime;
  const nextValue = toFiniteParamValue(value, getParamValue(param));

  if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }
  setParamAtTime(param, nextValue, now);
  audioParamAutomation.set(param, {
    startTime: now,
    timeline: [{ time: 0, value: nextValue, easing: "linear" }],
    normalizeValue: (automationValue) => automationValue,
  });
};

const holdParamNow = (param, context = getAudioContext()) => {
  if (!param) return null;

  const now = context.currentTime;
  const currentValue = getCurrentParamValue(param, context);
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(now);
  } else if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }
  setParamAtTime(param, currentValue, now);
  audioParamAutomation.set(param, {
    startTime: now,
    timeline: [{ time: 0, value: currentValue, easing: "linear" }],
    normalizeValue: (value) => value,
  });
  return currentValue;
};

const buildAudioTimeline = ({
  transition,
  currentValue,
  normalizeTransitionValue,
  denormalizeParamValue,
}) => {
  const initialAuthoredValue =
    transition.initialValue === undefined
      ? denormalizeParamValue(currentValue)
      : transition.initialValue;
  const initialValue = normalizeTransitionValue(initialAuthoredValue);
  let authoredValue = denormalizeParamValue(initialValue);
  let elapsedMs = 0;
  const timeline = [
    {
      time: 0,
      value: initialValue,
      easing: "linear",
    },
  ];

  for (const keyframe of transition.keyframes) {
    const delayMs = Math.max(0, toFiniteParamValue(keyframe.delay, 0));
    if (delayMs > 0) {
      elapsedMs += delayMs;
      timeline.push({
        time: elapsedMs,
        value: timeline[timeline.length - 1].value,
        easing: "linear",
      });
    }

    if (keyframe.startValue !== undefined) {
      const startAuthoredValue = keyframe.relative
        ? authoredValue + keyframe.startValue
        : keyframe.startValue;
      const startValue = normalizeTransitionValue(startAuthoredValue);
      authoredValue = denormalizeParamValue(startValue);
      timeline.push({
        time: elapsedMs,
        value: startValue,
        easing: "linear",
      });
    }

    elapsedMs += Math.max(0, toFiniteParamValue(keyframe.duration, 0));
    const nextAuthoredValue = keyframe.relative
      ? authoredValue + keyframe.value
      : keyframe.value;
    const nextValue = normalizeTransitionValue(nextAuthoredValue);
    authoredValue = denormalizeParamValue(nextValue);
    timeline.push({
      time: elapsedMs,
      value: nextValue,
      easing: keyframe.easing ?? "linear",
    });
  }

  return timeline;
};

const scheduleTimelineSegment = ({
  param,
  start,
  end,
  startTime,
  normalizeValue,
}) => {
  const durationMs = end.time - start.time;
  const endTime = startTime + end.time / 1000;

  if (durationMs <= 0) {
    setParamAtTime(param, end.value, endTime);
    return;
  }

  if (typeof param.linearRampToValueAtTime !== "function") {
    setParamAtTime(param, end.value, endTime);
    return;
  }

  if (end.easing === "linear") {
    param.linearRampToValueAtTime(end.value, endTime);
    return;
  }

  const easing = getEasingFunction(end.easing);
  const sampleCount = Math.min(
    AUDIO_AUTOMATION_MAX_SAMPLES,
    Math.max(1, Math.ceil(durationMs / AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS)),
  );
  for (let sample = 1; sample <= sampleCount; sample++) {
    const progress = sample / sampleCount;
    const value = normalizeValue(
      start.value + (end.value - start.value) * easing(progress),
    );
    const time = startTime + (start.time + durationMs * progress) / 1000;
    param.linearRampToValueAtTime(value, time);
  }
};

const rampParam = ({
  param,
  transition,
  normalizeTransitionValue,
  denormalizeParamValue,
  normalizeParamValue,
  context = getAudioContext(),
}) => {
  if (!param) return 0;

  const now = context.currentTime;
  const currentValue = getCurrentParamValue(param, context);
  const timeline = buildAudioTimeline({
    transition,
    currentValue,
    normalizeTransitionValue,
    denormalizeParamValue,
  });
  const hasExplicitInitialValue = transition.initialValue !== undefined;

  if (
    !hasExplicitInitialValue &&
    typeof param.cancelAndHoldAtTime === "function"
  ) {
    param.cancelAndHoldAtTime(now);
  } else if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }

  setParamAtTime(param, timeline[0].value, now);
  for (let index = 1; index < timeline.length; index++) {
    scheduleTimelineSegment({
      param,
      start: timeline[index - 1],
      end: timeline[index],
      startTime: now,
      normalizeValue: normalizeParamValue,
    });
  }

  audioParamAutomation.set(param, {
    startTime: now,
    timeline,
    normalizeValue: normalizeParamValue,
  });

  return timeline[timeline.length - 1].time;
};

const applyDeferredTimeline = ({
  param,
  automation,
  normalizeParamValue,
  context = getAudioContext(),
}) => {
  if (!param || !automation) return 0;

  const now = context.currentTime;
  const elapsedMs = Math.max(0, (now - automation.startTime) * 1000);
  const { timeline } = automation;
  const currentValue = normalizeParamValue(
    getTimelineValueAtTime(timeline, elapsedMs),
  );

  if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(now);
  }
  setParamAtTime(param, currentValue, now);

  for (let index = 1; index < timeline.length; index++) {
    const start = timeline[index - 1];
    const end = timeline[index];
    if (end.time <= elapsedMs) continue;

    const durationMs = end.time - start.time;
    const endTime = automation.startTime + end.time / 1000;
    if (
      durationMs <= 0 ||
      typeof param.linearRampToValueAtTime !== "function"
    ) {
      setParamAtTime(param, end.value, endTime);
      continue;
    }

    if (end.easing === "linear") {
      param.linearRampToValueAtTime(end.value, endTime);
      continue;
    }

    const easing = getEasingFunction(end.easing);
    const sampleCount = Math.min(
      AUDIO_AUTOMATION_MAX_SAMPLES,
      Math.max(1, Math.ceil(durationMs / AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS)),
    );
    for (let sample = 1; sample <= sampleCount; sample++) {
      const progress = sample / sampleCount;
      const sampleElapsedMs = start.time + durationMs * progress;
      if (sampleElapsedMs <= elapsedMs) continue;
      const value = normalizeParamValue(
        start.value + (end.value - start.value) * easing(progress),
      );
      param.linearRampToValueAtTime(
        value,
        automation.startTime + sampleElapsedMs / 1000,
      );
    }
  }

  audioParamAutomation.set(param, automation);
  return Math.max(0, timeline[timeline.length - 1].time - elapsedMs);
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

const getVolumeValue = ({ volume }) => normalizeVolume(volume, 100);

const getMuteValue = ({ muted }) => (muted ? 0 : 1);

const hasSameSoundSourceIdentity = (previous, next) =>
  previous.src === next.src &&
  previous.startAt === next.startAt &&
  previous.endAt === next.endAt &&
  previous.startDelayMs === next.startDelayMs;

const normalizeDirectVolume = (volume, fallback = 1) => {
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

const getTransitionPhase = (effects = [], targetId, property, phase) => {
  if (effects instanceof Map) {
    return effects.get(targetId)?.[property]?.[phase] ?? null;
  }

  const transition = effects.find(
    (effect) =>
      effect.type === "audio-transition" && effect.targetId === targetId,
  );

  return transition?.properties?.[property]?.[phase] ?? null;
};

const getRemainingIterationMediaSeconds = (
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

const integrateTimelineRange = (timeline, startMs, endMs, normalizeValue) => {
  const durationMs = Math.max(0, endMs - startMs);
  if (durationMs === 0) return 0;

  const sampleCount = Math.min(
    AUDIO_AUTOMATION_MAX_SAMPLES,
    Math.max(1, Math.ceil(durationMs / AUDIO_AUTOMATION_SAMPLE_INTERVAL_MS)),
  );
  const sampleDurationMs = durationMs / sampleCount;
  let progressSeconds = 0;
  for (let sample = 0; sample < sampleCount; sample++) {
    const sampleTimeMs = startMs + (sample + 0.5) * sampleDurationMs;
    const rate = normalizeValue(getTimelineValueAtTime(timeline, sampleTimeMs));
    progressSeconds += Math.max(0, rate) * (sampleDurationMs / 1000);
  }
  return progressSeconds;
};

const getTimeToMediaProgressMs = (
  param,
  requiredProgressSeconds,
  context = getAudioContext(),
) => {
  if (requiredProgressSeconds <= 0) return 0;

  const automation = audioParamAutomation.get(param);
  if (!automation) {
    const rate = Math.max(0, getParamValue(param, 1));
    return rate > 0
      ? (requiredProgressSeconds / rate) * 1000
      : Number.POSITIVE_INFINITY;
  }

  const elapsedMs = Math.max(
    0,
    (context.currentTime - automation.startTime) * 1000,
  );
  const timelineEndMs =
    automation.timeline[automation.timeline.length - 1].time;
  const scheduledEndMs = Math.max(elapsedMs, timelineEndMs);
  const scheduledProgress = integrateTimelineRange(
    automation.timeline,
    elapsedMs,
    scheduledEndMs,
    automation.normalizeValue,
  );

  if (scheduledProgress >= requiredProgressSeconds) {
    let lowMs = elapsedMs;
    let highMs = scheduledEndMs;
    for (let iteration = 0; iteration < 48; iteration++) {
      const midpointMs = (lowMs + highMs) / 2;
      const progress = integrateTimelineRange(
        automation.timeline,
        elapsedMs,
        midpointMs,
        automation.normalizeValue,
      );
      if (progress >= requiredProgressSeconds) {
        highMs = midpointMs;
      } else {
        lowMs = midpointMs;
      }
    }
    return Math.max(0, highMs - elapsedMs);
  }

  const finalRate = Math.max(
    0,
    automation.normalizeValue(
      getTimelineValueAtTime(automation.timeline, timelineEndMs),
    ),
  );
  if (finalRate <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    Math.max(0, timelineEndMs - elapsedMs) +
    ((requiredProgressSeconds - scheduledProgress) / finalRate) * 1000
  );
};

const hasContinuingPlaybackProgress = (param) => {
  const automation = audioParamAutomation.get(param);
  if (!automation) {
    return getParamValue(param, 1) > 0;
  }

  const timelineEndMs =
    automation.timeline[automation.timeline.length - 1].time;
  const finalRate = automation.normalizeValue(
    getTimelineValueAtTime(automation.timeline, timelineEndMs),
  );
  return finalRate > 0;
};

const applyAudioParam = ({
  param,
  targetValue,
  transition,
  normalizeTargetValue = (value) => value,
  normalizeTransitionValue = normalizeTargetValue,
  denormalizeParamValue = (value) => value,
}) => {
  if (!param) return 0;

  const normalizedTargetValue = normalizeTargetValue(targetValue);

  if (!transition) {
    setParamNow(param, normalizedTargetValue);
    return 0;
  }

  return rampParam({
    param,
    transition,
    normalizeTransitionValue,
    denormalizeParamValue,
    normalizeParamValue: normalizeTargetValue,
  });
};

const applyVolume = ({ gainNode, targetValue, transition }) =>
  applyAudioParam({
    param: gainNode?.gain,
    targetValue,
    transition,
    normalizeTargetValue: (value) =>
      Math.max(0, Math.min(1, toFiniteParamValue(value, 1))),
    normalizeTransitionValue: (value) => normalizeVolume(value, 100),
    denormalizeParamValue: (value) => value * 100,
  });

const applyPan = ({ pannerNode, targetValue, transition }) =>
  applyAudioParam({
    param: pannerNode?.pan,
    targetValue,
    transition,
    normalizeTargetValue: (value) =>
      Math.max(-1, Math.min(1, toFiniteParamValue(value, 0))),
  });

const normalizePlaybackRateValue = (value) =>
  Math.max(0, toFiniteParamValue(value, 1));

const applyPlaybackRate = ({ source, targetValue, transition }) =>
  applyAudioParam({
    param: source?.playbackRate,
    targetValue,
    transition,
    normalizeTargetValue: normalizePlaybackRateValue,
  });

const getPlaybackRateAutomationValue = (sound, context = getAudioContext()) => {
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

const startPlaybackRateAutomation = ({ sound, transition, currentValue }) => {
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

const applySoundPlaybackRateTransition = ({
  sound,
  transition,
  currentValue,
}) => {
  if (sound.source) {
    const duration = applyPlaybackRate({
      source: sound.source,
      targetValue: sound.playbackRate,
      transition,
    });
    sound.playbackRateAutomation = transition
      ? (audioParamAutomation.get(sound.source.playbackRate) ?? null)
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

const applyPendingSoundEnterTransitions = (sound, source) => {
  const transitions = sound.pendingEnterTransitions;
  if (transitions) {
    if (transitions.volume) {
      applyVolume({
        gainNode: sound.gainNode,
        targetValue: getVolumeValue(sound),
        transition: transitions.volume,
      });
    }
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

const consumePendingSoundEnterTransitions = (sound, transitions) => {
  if (sound.pendingEnterTransitions === transitions) {
    sound.pendingEnterTransitions = null;
  }
};

const createChannelInstance = (channel, outputNode) => {
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
  };
};

const createSoundInstance = ({ sound, channelNode, internalId }) => {
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
    playbackRateAutomation: null,
    playbackPending: false,
    pendingTimeoutId: null,
    pendingDelayMs: 0,
    pendingStartOffset: null,
    delayDeadlineMs: null,
    channelPauseState: null,
    cleanupTimeoutId: null,
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

const createSourceForSound = (sound, startOffset = sound.startAt ?? 0) => {
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
  source.loop = sound.loop ?? false;

  connect(source, sound.gainNode);

  sound.sourceEnded = false;
  source.onended = () => {
    if (sound.source !== source) {
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
  const pendingEnterTransitions = applyPendingSoundEnterTransitions(
    sound,
    source,
  );
  consumePendingSoundEnterTransitions(sound, pendingEnterTransitions);
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

const playSound = (
  sound,
  { startOffset = sound.startAt ?? 0, startDelayMs = sound.startDelayMs } = {},
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
    sound.source = createSourceForSound(sound, startOffset);
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

const stopSource = (sound, delayMs = 0) => {
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

const cleanupSound = (sound) => {
  sound.onSourceEnded = null;
  sound.pendingEnterTransitions = null;
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

  stopSource(sound);
  disconnect(sound.source);
  disconnect(sound.gainNode);
  disconnect(sound.pannerNode);
  disconnect(sound.muteGainNode);
};

const cleanupChannel = (channel) => {
  if (channel.cleanupTimeoutId !== null) {
    cancelTimeout(channel.cleanupTimeoutId);
    channel.cleanupTimeoutId = null;
  }
  disconnect(channel.gainNode);
  disconnect(channel.pannerNode);
  disconnect(channel.muteGainNode);
};

const schedule = (callback, delayMs) => {
  if (delayMs <= 0) {
    callback();
    return null;
  }
  return scheduleTimeout(callback, delayMs);
};

/**
 * Creates an audio player instance.
 * Kept as a small compatibility wrapper for direct tests/integrations.
 *
 * @param {string} id
 * @param {Object} options
 * @param {string} options.url
 * @param {boolean} [options.loop=false]
 * @param {number} [options.volume=1.0]
 * @returns {Object} Audio player instance
 */
export const createAudioPlayer = (id, options) => {
  const sound = {
    id,
    src: options.url,
    loop: options.loop ?? false,
    volume: normalizeDirectVolume(options.volume),
  };
  const channel = createChannelInstance(
    { id: `${id}:channel`, volume: 100, muted: false, pan: 0 },
    getAudioContext().destination,
  );
  const instance = createSoundInstance({
    sound,
    channelNode: channel.gainNode,
    internalId: id,
  });

  const play = () => playSound(instance);
  const stop = () => cleanupSound(instance);
  const update = (newState) => {
    instance.src = newState.url ?? instance.src;
    instance.url = instance.src;
    instance.loop = newState.loop ?? instance.loop;
    if (newState.volume !== undefined) {
      const nextVolume = normalizeDirectVolume(newState.volume);
      instance.volume = nextVolume;
      setParamNow(instance.gainNode.gain, normalizeVolume(nextVolume, 100));
    }
  };

  return {
    play,
    stop,
    update,
    getId: () => instance.id,
    getUrl: () => instance.url,
    getLoop: () => instance.loop,
    getVolume: () => normalizeVolume(instance.volume, 100),
    setUrl: (url) => {
      instance.src = url;
      instance.url = url;
    },
    setLoop: (loop) => {
      instance.loop = loop;
      if (instance.source) instance.source.loop = loop;
    },
    setVolume: (volume) => {
      const nextVolume = normalizeDirectVolume(volume);
      instance.volume = nextVolume;
      setParamNow(instance.gainNode.gain, normalizeVolume(nextVolume, 100));
    },
    get id() {
      return instance.id;
    },
    get url() {
      return instance.url;
    },
    get loop() {
      return instance.loop;
    },
    get volume() {
      return normalizeVolume(instance.volume, 100);
    },
    gainNode: instance.gainNode,
  };
};

/**
 * Creates an audio stage instance.
 *
 * @returns {Object} Audio stage instance
 */
export const createAudioStage = () => {
  const channels = new Map();
  const sounds = new Map();
  const currentSoundKeyById = new Map();
  const directAudios = new Map();
  const ownedAudioEffects = new Map();
  const forgetOwnedSound = (instance) => {
    for (const ownership of ownedAudioEffects.values()) {
      ownership.soundInstances.delete(instance);
    }
  };
  const forgetOwnedChannel = (channel) => {
    for (const ownership of ownedAudioEffects.values()) {
      ownership.channelInstances.delete(channel);
    }
  };
  let soundGeneration = 0;
  let soundEventHandler;
  let destroyed = false;

  const isCurrentControlledInstance = (instance) =>
    !destroyed &&
    instance?.control &&
    !instance.control.eventsSuppressed &&
    !instance.control.detached &&
    sounds.get(instance.internalId) === instance &&
    currentSoundKeyById.get(instance.id) === instance.internalId;

  const getControlledPositionMs = (instance) => {
    const control = instance.control;
    if (
      !control ||
      control.status !== "playing" ||
      !instance.source ||
      control.sourceStartedAt === null ||
      control.durationMs === null
    ) {
      return Math.max(0, control?.cursorMs ?? 0);
    }

    const context = getAudioContext();
    const playedSeconds = integrateAudioParamValue(
      instance.source.playbackRate,
      control.sourceStartedAt,
      context.currentTime,
    );
    let positionMs = control.sourceCursorMs + playedSeconds * 1000;
    if (instance.loop && control.durationMs > 0) {
      positionMs %= control.durationMs;
    } else {
      positionMs = Math.min(positionMs, control.durationMs);
    }

    return Math.max(0, positionMs);
  };

  const captureControlledPosition = (instance) => {
    const control = instance.control;
    if (!control) return 0;

    const context = getAudioContext();
    control.cursorMs = getControlledPositionMs(instance);
    control.sourceCursorMs = control.cursorMs;
    control.sourceStartedAt = context.currentTime;
    instance.sourceStartOffset =
      Math.max(0, toFiniteParamValue(instance.startAt, 0)) +
      control.cursorMs / 1000;
    instance.sourceStartedAt = context.currentTime;
    return control.cursorMs;
  };

  const normalizeEventPosition = (value) =>
    Math.max(0, Math.round(toFiniteParamValue(value, 0)));

  const emitControlledEventNow = (
    instance,
    eventName,
    fields,
    commandId = instance.control?.commandId,
  ) => {
    if (
      !isCurrentControlledInstance(instance) ||
      instance.control.commandId !== commandId
    ) {
      return false;
    }

    soundEventHandler?.(eventName, {
      _event: {
        id: instance.id,
        commandId,
        ...fields,
      },
    });
    return true;
  };

  const queueControlledEvent = (
    instance,
    eventName,
    fields,
    commandId = instance.control?.commandId,
  ) => {
    scheduleMicrotask(() => {
      emitControlledEventNow(instance, eventName, fields, commandId);
    });
  };

  const getControlledEventPosition = (instance) =>
    normalizeEventPosition(getControlledPositionMs(instance));

  const queueControlledProgress = (instance) => {
    const control = instance.control;
    if (!control?.ready || control.durationMs === null) return;

    scheduleMicrotask(() => {
      if (!isCurrentControlledInstance(instance)) {
        return;
      }

      emitControlledEventNow(
        instance,
        "soundProgress",
        {
          positionMs: getControlledEventPosition(instance),
          durationMs: normalizeEventPosition(control.durationMs),
        },
        control.commandId,
      );
    });
  };

  const queueControlledError = (instance, errorCode) => {
    const control = instance.control;
    if (!control) return;

    control.lastErrorCode = errorCode;
    queueControlledEvent(
      instance,
      "soundError",
      { errorCode },
      control.commandId,
    );
  };

  const stopControlledProgress = (instance) => {
    const control = instance.control;
    if (!control || control.progressIntervalId === null) return;

    cancelInterval(control.progressIntervalId);
    control.progressIntervalId = null;
  };

  const startControlledProgress = (instance) => {
    const control = instance.control;
    stopControlledProgress(instance);
    if (!control || !instance.source || control.status !== "playing") {
      return;
    }

    control.progressIntervalId = scheduleInterval(() => {
      if (
        !isCurrentControlledInstance(instance) ||
        control.status !== "playing" ||
        !instance.source
      ) {
        stopControlledProgress(instance);
        return;
      }
      queueControlledProgress(instance);
    }, CONTROLLED_PROGRESS_INTERVAL_MS);
  };

  const getRemainingControlledDelayMs = (instance) => {
    const control = instance.control;
    if (!control) return 0;
    if (control.delayDeadlineMs === null) {
      return Math.max(0, control.remainingDelayMs);
    }

    return Math.max(0, control.delayDeadlineMs - getAudioNowMs());
  };

  const cancelControlledPendingStart = (
    instance,
    { preserveRemainingDelay = false } = {},
  ) => {
    const control = instance.control;
    if (!control) return;

    const remainingDelayMs = preserveRemainingDelay
      ? getRemainingControlledDelayMs(instance)
      : 0;
    instance.playRequestId = (instance.playRequestId ?? 0) + 1;
    instance.playbackPending = false;
    if (instance.pendingTimeoutId !== null) {
      cancelTimeout(instance.pendingTimeoutId);
      instance.pendingTimeoutId = null;
    }
    control.delayDeadlineMs = null;
    control.remainingDelayMs = remainingDelayMs;
  };

  const stopControlledSource = (instance) => {
    const control = instance.control;
    if (!control) return;

    stopControlledProgress(instance);
    control.sourceToken += 1;
    control.sourceStartedAt = null;
    const source = instance.source;
    instance.source = null;
    instance.sourceEnded = true;
    if (!source) return;

    source.onended = null;
    try {
      source.stop(getAudioContext().currentTime);
    } catch {
      // Stopping an already-stopped source is harmless.
    }
    disconnect(source);
  };

  const validateControlledSegment = (instance, audioBuffer) => {
    const decodedDuration = toFiniteParamValue(
      audioBuffer?.duration,
      Number.NaN,
    );
    const segmentStart = toFiniteParamValue(instance.startAt, Number.NaN);
    const segmentEnd =
      instance.endAt === null || instance.endAt === undefined
        ? decodedDuration
        : toFiniteParamValue(instance.endAt, Number.NaN);

    if (
      !Number.isFinite(decodedDuration) ||
      !Number.isFinite(segmentStart) ||
      !Number.isFinite(segmentEnd) ||
      segmentStart < 0 ||
      segmentStart >= decodedDuration ||
      segmentEnd <= segmentStart ||
      segmentEnd > decodedDuration
    ) {
      return null;
    }

    return (segmentEnd - segmentStart) * 1000;
  };

  const configureControlledLoop = (instance, source) => {
    const control = instance.control;
    source.loop = instance.loop ?? false;
    if (!source.loop || control.durationMs === null) {
      return;
    }

    source.loopStart = instance.startAt;
    source.loopEnd = instance.startAt + control.durationMs / 1000;
  };

  const resolvePendingControlledPosition = (instance) => {
    const control = instance.control;
    const pending = control?.pendingPosition;
    if (!control || !pending || control.durationMs === null) {
      return { invalidPosition: false, terminal: false };
    }

    const resolve = (candidate, reportInvalid) => {
      if (!candidate) {
        return { invalidPosition: false, terminal: false };
      }

      if (candidate.positionMs > control.durationMs) {
        if (candidate.fallback) {
          if (candidate.fallbackState) {
            control.status = candidate.fallbackState.status;
            control.cursorMs = candidate.fallbackState.cursorMs;
            control.pausedCursorRetained =
              candidate.fallbackState.pausedCursorRetained;
            control.remainingDelayMs = candidate.fallbackState.remainingDelayMs;
            control.deferredProgress = candidate.fallbackState.deferredProgress;
            instance.playbackPending = candidate.fallbackState.playbackPending;
          }
          const fallbackResult = resolve(candidate.fallback, false);
          return {
            ...fallbackResult,
            invalidPosition: reportInvalid,
          };
        }
        if (candidate.operation === "play") {
          control.status = "stopped";
          control.cursorMs = 0;
          control.remainingDelayMs = 0;
          control.pausedCursorRetained = false;
          instance.playbackPending = false;
        }
        return {
          invalidPosition: reportInvalid,
          terminal: false,
        };
      }

      if (candidate.operation === "seekNoop") {
        return { invalidPosition: false, terminal: false };
      }

      control.cursorMs = candidate.positionMs;
      if (candidate.positionMs === control.durationMs) {
        control.status = "ended";
        control.remainingDelayMs = 0;
        control.pausedCursorRetained = false;
        instance.playbackPending = false;
        return { invalidPosition: false, terminal: true };
      }

      return { invalidPosition: false, terminal: false };
    };

    const result = resolve(pending, true);
    control.pendingPosition = null;
    return result;
  };

  const createControlledSource = (instance) => {
    const control = instance.control;
    const context = getAudioContext();
    const source = context.createBufferSource();
    source.buffer = control.decodedBuffer;
    configureControlledLoop(instance, source);
    connect(source, instance.gainNode);

    const sourceToken = control.sourceToken + 1;
    control.sourceToken = sourceToken;
    instance.sourceEnded = false;
    source.onended = () => {
      if (instance.source !== source || control.sourceToken !== sourceToken) {
        return;
      }

      instance.sourceEnded = true;
      if (instance.finishing) {
        instance.onSourceEnded?.();
        return;
      }
      if (
        control.eventsSuppressed ||
        control.detached ||
        control.status !== "playing" ||
        instance.loop
      ) {
        return;
      }

      stopControlledProgress(instance);
      instance.source = null;
      disconnect(source);
      control.status = "ended";
      control.cursorMs = control.durationMs;
      control.sourceStartedAt = null;
      queueControlledEvent(
        instance,
        "soundComplete",
        {
          positionMs: normalizeEventPosition(control.durationMs),
          durationMs: normalizeEventPosition(control.durationMs),
        },
        control.commandId,
      );
    };

    const offsetSeconds = instance.startAt + control.cursorMs / 1000;
    const remainingSeconds = Math.max(
      0,
      (control.durationMs - control.cursorMs) / 1000,
    );
    const startTime = Math.max(0, toFiniteParamValue(context.currentTime, 0));
    instance.sourceStartedAt = startTime;
    instance.sourceStartOffset = offsetSeconds;
    control.sourceStartedAt = startTime;
    control.sourceCursorMs = control.cursorMs;

    try {
      if (
        source.loop &&
        instance.endAt !== null &&
        instance.endAt !== undefined
      ) {
        source.loopStart = instance.startAt;
        source.loopEnd = instance.endAt;
        source.start(startTime, offsetSeconds);
      } else if (!source.loop) {
        source.start(startTime, offsetSeconds, remainingSeconds);
      } else {
        source.start(startTime, offsetSeconds);
      }
    } catch (error) {
      source.onended = null;
      disconnect(source);
      throw error;
    }
    const pendingEnterTransitions = applyPendingSoundEnterTransitions(
      instance,
      source,
    );
    consumePendingSoundEnterTransitions(instance, pendingEnterTransitions);

    return source;
  };

  const failControlledPlayback = (instance, errorCode) => {
    const control = instance.control;
    cancelControlledPendingStart(instance);
    stopControlledSource(instance);
    control.status = "stopped";
    control.cursorMs = 0;
    control.pendingPosition = null;
    control.pausedCursorRetained = false;
    control.remainingDelayMs = 0;
    queueControlledError(instance, errorCode);
    if (instance.finishing) {
      instance.sourceEnded = true;
      instance.onSourceEnded?.();
    }
  };

  const startControlledPlayback = (instance, delayMs = 0) => {
    const control = instance.control;
    if (
      !control?.ready ||
      control.durationMs === null ||
      control.cursorMs >= control.durationMs
    ) {
      return;
    }

    cancelControlledPendingStart(instance);
    stopControlledSource(instance);
    control.status = "playing";
    control.remainingDelayMs = Math.max(0, delayMs);
    instance.sourceEnded = false;
    instance.playbackPending = true;
    const playRequestId = (instance.playRequestId ?? 0) + 1;
    instance.playRequestId = playRequestId;
    const context = getAudioContext();
    const needsResume =
      context.state === "suspended" && typeof context.resume === "function";

    const start = () => {
      if (
        instance.playRequestId !== playRequestId ||
        control.status !== "playing"
      ) {
        return;
      }

      instance.pendingTimeoutId = null;
      control.delayDeadlineMs = null;
      control.remainingDelayMs = 0;
      try {
        instance.source = createControlledSource(instance);
      } catch {
        failControlledPlayback(instance, "playback-failed");
        return;
      }
      instance.playbackPending = false;
      startControlledProgress(instance);
      if (instance.finishing) {
        instance.onFinishingSourceStarted?.();
      }
    };

    const scheduleStart = () => {
      if (
        instance.playRequestId !== playRequestId ||
        control.status !== "playing"
      ) {
        return;
      }

      if (control.remainingDelayMs > 0) {
        control.delayDeadlineMs = getAudioNowMs() + control.remainingDelayMs;
        instance.pendingTimeoutId = scheduleTimeout(
          start,
          control.remainingDelayMs,
        );
        return;
      }
      start();
    };

    const resumePromise = resumeAudioContext(context);
    if (needsResume) {
      void resumePromise.then(scheduleStart);
    } else {
      scheduleStart();
    }
  };

  const applyResolvedControlledState = (
    instance,
    { invalidPosition, terminal },
  ) => {
    const control = instance.control;
    if (invalidPosition) {
      queueControlledError(instance, "invalid-position");
      control.deferredProgress = false;
      if (control.status === "playing") {
        startControlledPlayback(instance, control.remainingDelayMs);
      }
      return;
    }
    if (terminal) {
      cancelControlledPendingStart(instance);
      stopControlledSource(instance);
      queueControlledProgress(instance);
      return;
    }

    if (control.status === "playing") {
      startControlledPlayback(instance, control.remainingDelayMs);
    }
    if (control.deferredProgress) {
      control.deferredProgress = false;
      queueControlledProgress(instance);
    }
  };

  const scheduleControlledReady = (instance) => {
    const control = instance.control;
    if (!control || control.readyTaskQueued || control.readyAnnounced) {
      return;
    }

    control.readyTaskQueued = true;
    scheduleMicrotask(() => {
      control.readyTaskQueued = false;
      if (
        !isCurrentControlledInstance(instance) ||
        !control.ready ||
        control.readyAnnounced
      ) {
        return;
      }

      const commandId = control.commandId;
      const resolution = resolvePendingControlledPosition(instance);
      const playRequestId = instance.playRequestId;
      control.readyAnnounced = true;
      try {
        emitControlledEventNow(
          instance,
          "soundReady",
          {
            positionMs: getControlledEventPosition(instance),
            durationMs: normalizeEventPosition(control.durationMs),
          },
          commandId,
        );
      } finally {
        if (isCurrentControlledInstance(instance)) {
          if (control.commandId === commandId) {
            applyResolvedControlledState(instance, resolution);
          } else if (
            control.status === "playing" &&
            !instance.source &&
            instance.pendingTimeoutId === null &&
            instance.playRequestId === playRequestId
          ) {
            startControlledPlayback(instance, control.remainingDelayMs);
          }
        }
      }
    });
  };

  const settleControlledDecode = (instance, decodeRequestId, audioBuffer) => {
    const control = instance.control;
    if (
      !control ||
      control.decodeRequestId !== decodeRequestId ||
      control.detached
    ) {
      return;
    }

    control.decodePending = false;
    const durationMs = validateControlledSegment(instance, audioBuffer);
    if (durationMs === null) {
      failControlledPlayback(instance, "invalid-segment");
      return;
    }

    control.decodedBuffer = audioBuffer;
    control.durationMs = durationMs;
    control.ready = true;
    control.lastErrorCode = null;

    if (control.eventsSuppressed && instance.finishing) {
      const resolution = resolvePendingControlledPosition(instance);
      if (resolution.invalidPosition || control.status !== "playing") {
        instance.sourceEnded = true;
        instance.onSourceEnded?.();
        return;
      }
      startControlledPlayback(instance, control.remainingDelayMs);
      return;
    }

    scheduleControlledReady(instance);
  };

  const beginControlledDecode = (instance) => {
    const control = instance.control;
    if (!control || control.decodePending || control.ready) return;

    const decodeRequestId = control.decodeRequestId + 1;
    control.decodeRequestId = decodeRequestId;
    control.decodePending = true;
    instance.playbackPending = control.status === "playing";
    const cachedBuffer = AudioAsset.getAsset(instance.src);
    if (cachedBuffer) {
      scheduleMicrotask(() => {
        settleControlledDecode(instance, decodeRequestId, cachedBuffer);
      });
      return;
    }

    const assetPromise = AudioAsset.getAssetPromise?.(instance.src);
    if (!assetPromise) {
      scheduleMicrotask(() => {
        if (control.decodeRequestId !== decodeRequestId) return;
        control.decodePending = false;
        failControlledPlayback(instance, "asset-unavailable");
      });
      return;
    }

    Promise.resolve(assetPromise).then(
      (audioBuffer) => {
        settleControlledDecode(instance, decodeRequestId, audioBuffer);
      },
      () => {
        if (control.decodeRequestId !== decodeRequestId) return;
        control.decodePending = false;
        failControlledPlayback(instance, "decode-failed");
      },
    );
  };

  const applyPendingControlledCommand = (instance, command) => {
    const control = instance.control;
    switch (command.operation) {
      case "play": {
        const fallback = control.pendingPosition;
        const fallbackState = fallback
          ? {
              status: control.status,
              cursorMs: control.cursorMs,
              pausedCursorRetained: control.pausedCursorRetained,
              remainingDelayMs: control.remainingDelayMs,
              deferredProgress: control.deferredProgress,
              playbackPending: instance.playbackPending,
            }
          : null;
        cancelControlledPendingStart(instance);
        stopControlledSource(instance);
        control.status = "playing";
        control.cursorMs = command.positionMs;
        control.pausedCursorRetained = false;
        control.remainingDelayMs = instance.startDelayMs;
        control.pendingPosition = {
          operation: "play",
          positionMs: command.positionMs,
          fallback,
          fallbackState,
        };
        control.deferredProgress = false;
        instance.playbackPending = true;
        break;
      }
      case "pause": {
        if (control.status !== "playing") {
          break;
        }
        cancelControlledPendingStart(instance, {
          preserveRemainingDelay: true,
        });
        control.status = "paused";
        control.pausedCursorRetained = true;
        control.deferredProgress = true;
        instance.playbackPending = false;
        break;
      }
      case "resume": {
        if (control.status !== "paused" || !control.pausedCursorRetained) {
          break;
        }
        control.status = "playing";
        control.pausedCursorRetained = false;
        instance.playbackPending = true;
        break;
      }
      case "stop": {
        const changed =
          control.status !== "stopped" ||
          control.cursorMs !== 0 ||
          instance.playbackPending;
        cancelControlledPendingStart(instance);
        stopControlledSource(instance);
        control.status = "stopped";
        control.cursorMs = 0;
        control.pausedCursorRetained = false;
        control.remainingDelayMs = 0;
        control.pendingPosition = null;
        control.deferredProgress ||= changed;
        instance.playbackPending = false;
        break;
      }
      case "seek": {
        const canSeek =
          control.status === "playing" || control.status === "paused";
        control.pendingPosition = {
          operation: canSeek ? "seek" : "seekNoop",
          positionMs: command.positionMs,
          fallback: canSeek ? control.pendingPosition : null,
        };
        control.deferredProgress = canSeek;
        break;
      }
    }
  };

  const applyReadyControlledCommand = (instance, command) => {
    const control = instance.control;
    const durationMs = control.durationMs;

    switch (command.operation) {
      case "play": {
        if (command.positionMs > durationMs) {
          queueControlledError(instance, "invalid-position");
          return;
        }

        cancelControlledPendingStart(instance);
        stopControlledSource(instance);
        control.pausedCursorRetained = false;
        control.cursorMs = command.positionMs;
        if (command.positionMs === durationMs) {
          control.status = "ended";
          control.remainingDelayMs = 0;
          queueControlledProgress(instance);
          return;
        }

        control.status = "playing";
        control.remainingDelayMs = instance.startDelayMs;
        startControlledPlayback(instance, instance.startDelayMs);
        return;
      }
      case "pause": {
        if (control.status !== "playing") {
          return;
        }

        if (instance.source) {
          captureControlledPosition(instance);
        }
        const remainingDelayMs = getRemainingControlledDelayMs(instance);
        cancelControlledPendingStart(instance, {
          preserveRemainingDelay: true,
        });
        stopControlledSource(instance);
        control.status = "paused";
        control.pausedCursorRetained = true;
        control.remainingDelayMs = remainingDelayMs;
        queueControlledProgress(instance);
        return;
      }
      case "resume": {
        if (
          control.status !== "paused" ||
          !control.pausedCursorRetained ||
          control.cursorMs >= durationMs
        ) {
          return;
        }

        control.status = "playing";
        control.pausedCursorRetained = false;
        startControlledPlayback(instance, control.remainingDelayMs);
        return;
      }
      case "stop": {
        const changed =
          control.status !== "stopped" ||
          control.cursorMs !== 0 ||
          instance.source !== null ||
          instance.playbackPending;
        if (!changed) return;

        cancelControlledPendingStart(instance);
        stopControlledSource(instance);
        control.status = "stopped";
        control.cursorMs = 0;
        control.pausedCursorRetained = false;
        control.remainingDelayMs = 0;
        queueControlledProgress(instance);
        return;
      }
      case "seek": {
        if (command.positionMs > durationMs) {
          queueControlledError(instance, "invalid-position");
          return;
        }
        if (control.status === "stopped" || control.status === "ended") {
          return;
        }
        if (command.positionMs === durationMs) {
          cancelControlledPendingStart(instance);
          stopControlledSource(instance);
          control.status = "ended";
          control.cursorMs = durationMs;
          control.pausedCursorRetained = false;
          control.remainingDelayMs = 0;
          queueControlledProgress(instance);
          return;
        }

        if (control.status === "paused") {
          control.cursorMs = command.positionMs;
          queueControlledProgress(instance);
          return;
        }

        if (!instance.source) {
          control.cursorMs = command.positionMs;
          queueControlledProgress(instance);
          return;
        }

        stopControlledSource(instance);
        control.cursorMs = command.positionMs;
        control.status = "playing";
        startControlledPlayback(instance, 0);
        queueControlledProgress(instance);
      }
    }
  };

  const acceptControlledCommand = (instance, command) => {
    const control = instance.control;
    if (!control || command.commandId <= control.commandId) {
      return false;
    }

    const isInitialCommand = control.commandId < 0;
    control.commandId = command.commandId;
    control.lastErrorCode = null;
    instance.playback = command;

    if (control.ready && control.readyAnnounced) {
      applyReadyControlledCommand(instance, command);
      return true;
    }

    applyPendingControlledCommand(instance, command);
    if (!control.ready && !control.decodePending) {
      if (isInitialCommand || command.operation === "play") {
        control.readyAnnounced = false;
        beginControlledDecode(instance);
      }
    } else if (control.ready) {
      scheduleControlledReady(instance);
    }
    return true;
  };

  const suppressControlledEvents = (instance) => {
    const control = instance?.control;
    if (!control) return;

    control.eventsSuppressed = true;
    stopControlledProgress(instance);
  };

  const getCurrentChannelSounds = (channelId) => {
    const channelSounds = [];
    for (const internalId of currentSoundKeyById.values()) {
      const sound = sounds.get(internalId);
      if (
        sound?.channelId === channelId &&
        !sound.finishing &&
        !channelSounds.includes(sound)
      ) {
        channelSounds.push(sound);
      }
    }
    return channelSounds;
  };

  const getRemainingLegacyDelayMs = (sound) => {
    if (sound.delayDeadlineMs === null) {
      return Math.max(0, sound.pendingDelayMs);
    }

    return Math.max(0, sound.delayDeadlineMs - getAudioNowMs());
  };

  const getLegacyPlaybackOffset = (sound, context = getAudioContext()) => {
    const source = sound.source;
    const segmentStart = Math.max(0, toFiniteParamValue(sound.startAt, 0));
    if (!source || sound.sourceStartedAt === null) {
      return Math.max(
        segmentStart,
        toFiniteParamValue(sound.sourceStartOffset, segmentStart),
      );
    }

    const startedAt = toFiniteParamValue(
      sound.sourceStartedAt,
      context.currentTime,
    );
    const elapsedSourceSeconds = integrateAudioParamValue(
      source.playbackRate,
      startedAt,
      context.currentTime,
    );
    const startOffset = toFiniteParamValue(
      sound.sourceStartOffset,
      segmentStart,
    );
    const configuredEnd =
      sound.endAt === null || sound.endAt === undefined
        ? Number.NaN
        : toFiniteParamValue(sound.endAt, Number.NaN);
    const bufferEnd = toFiniteParamValue(
      source.buffer?.duration,
      Number.POSITIVE_INFINITY,
    );
    const segmentEnd = Number.isFinite(configuredEnd)
      ? configuredEnd
      : bufferEnd;
    const absoluteOffset = startOffset + elapsedSourceSeconds;

    if (source.loop && Number.isFinite(segmentEnd)) {
      const loopStart = Math.max(0, toFiniteParamValue(source.loopStart, 0));
      const configuredLoopEnd = toFiniteParamValue(source.loopEnd, 0);
      const loopEnd =
        configuredLoopEnd > loopStart ? configuredLoopEnd : segmentEnd;
      const loopDuration = loopEnd - loopStart;
      if (loopDuration > 0) {
        const relativeOffset =
          (((absoluteOffset - loopStart) % loopDuration) + loopDuration) %
          loopDuration;
        return loopStart + relativeOffset;
      }
      return loopStart;
    }

    return Math.max(segmentStart, Math.min(absoluteOffset, segmentEnd));
  };

  const checkpointLegacyPlaybackOffset = (
    sound,
    context = getAudioContext(),
  ) => {
    sound.sourceStartOffset = getLegacyPlaybackOffset(sound, context);
    sound.sourceStartedAt = context.currentTime;
  };

  const stopLegacySourceForChannelPause = (sound) => {
    const source = sound.source;
    sound.playRequestId = (sound.playRequestId ?? 0) + 1;
    sound.playbackPending = false;
    sound.pendingDelayMs = 0;
    sound.pendingStartOffset = null;
    sound.delayDeadlineMs = null;
    if (sound.pendingTimeoutId !== null) {
      cancelTimeout(sound.pendingTimeoutId);
      sound.pendingTimeoutId = null;
    }
    if (!source) return;

    source.onended = null;
    sound.source = null;
    sound.sourceStartedAt = null;
    try {
      source.stop(getAudioContext().currentTime);
    } catch {
      // Stopping an already-stopped source is harmless while pausing.
    }
    disconnect(source);
  };

  const pauseSoundForChannel = (sound) => {
    if (sound.control || sound.channelPauseState) {
      return;
    }

    if (sound.playbackPending || sound.pendingTimeoutId !== null) {
      const remainingDelayMs = getRemainingLegacyDelayMs(sound);
      sound.channelPauseState = {
        kind: "pending",
        offset: sound.pendingStartOffset ?? sound.startAt,
        remainingDelayMs,
      };
      stopLegacySourceForChannelPause(sound);
      sound.sourceEnded = false;
      return;
    }

    if (sound.source && !sound.sourceEnded) {
      const offset = getLegacyPlaybackOffset(sound);
      sound.channelPauseState = {
        kind: "active",
        offset,
        remainingDelayMs: 0,
      };
      stopLegacySourceForChannelPause(sound);
      sound.sourceEnded = false;
      return;
    }

    sound.channelPauseState = { kind: "ended" };
  };

  const stageSoundForPausedChannel = (sound) => {
    sound.sourceEnded = false;
    sound.playbackPending = false;
    sound.pendingStartOffset = null;
    sound.channelPauseState = {
      kind: "pending",
      offset: sound.startAt,
      remainingDelayMs: sound.startDelayMs,
    };
  };

  const resumeSoundFromChannelPause = (sound) => {
    const pauseState = sound.channelPauseState;
    if (!pauseState) {
      return;
    }

    sound.channelPauseState = null;
    if (pauseState.kind === "ended") {
      return;
    }

    const segmentEnd =
      sound.endAt === null || sound.endAt === undefined
        ? Number.POSITIVE_INFINITY
        : sound.endAt;
    if (!sound.loop && pauseState.offset >= segmentEnd) {
      sound.sourceEnded = true;
      return;
    }

    playSound(sound, {
      startOffset: pauseState.offset,
      startDelayMs: pauseState.remainingDelayMs,
    });
  };

  const syncSoundWithChannelPlayback = (sound) => {
    if (sound.control) {
      return;
    }

    const channel = sound.channelId ? channels.get(sound.channelId) : null;
    if (channel?.control?.status === "paused") {
      if (
        !sound.source &&
        !sound.playbackPending &&
        !sound.channelPauseState &&
        !sound.sourceEnded
      ) {
        stageSoundForPausedChannel(sound);
      } else {
        pauseSoundForChannel(sound);
      }
      return;
    }

    resumeSoundFromChannelPause(sound);
  };

  const acceptChannelPlaybackCommand = (channel, command) => {
    const control = channel.control;
    if (!control || command.commandId <= control.commandId) {
      return false;
    }

    control.commandId = command.commandId;
    channel.playback = command;
    const nextStatus = command.operation === "pause" ? "paused" : "playing";
    if (nextStatus === control.status) {
      return true;
    }

    if (command.operation === "pause") {
      control.status = "paused";
      getCurrentChannelSounds(channel.id).forEach(pauseSoundForChannel);
      return true;
    }

    control.status = "playing";
    getCurrentChannelSounds(channel.id).forEach(resumeSoundFromChannelPause);
    return true;
  };

  const restartLoopingChannelIfComplete = (channelId) => {
    const channel = channels.get(channelId);
    if (!channel?.loop || channel.control?.status === "paused") {
      return;
    }

    const channelSounds = getCurrentChannelSounds(channelId);
    if (
      channelSounds.length === 0 ||
      channelSounds.some(
        (sound) =>
          sound.playbackPending ||
          sound.pendingTimeoutId !== null ||
          sound.sourceEnded !== true,
      )
    ) {
      return;
    }

    channelSounds.forEach((sound) => {
      playSound(sound);
    });
  };

  const bindChannelLoopCompletion = (sound) => {
    sound.onSourceEnded = sound.channelId
      ? () => restartLoopingChannelIfComplete(sound.channelId)
      : null;
  };

  const finishChannelLoop = (channelId) => {
    for (const sound of getCurrentChannelSounds(channelId)) {
      if (sound.channelPauseState?.kind === "pending") {
        sound.channelPauseState = { kind: "ended" };
        sound.sourceEnded = true;
        continue;
      }

      if (!sound.playbackPending) {
        continue;
      }

      sound.playRequestId = (sound.playRequestId ?? 0) + 1;
      sound.playbackPending = false;
      sound.pendingStartOffset = null;
      sound.sourceEnded = true;
      if (sound.pendingTimeoutId !== null) {
        cancelTimeout(sound.pendingTimeoutId);
        sound.pendingTimeoutId = null;
      }
    }
  };

  const ensureRootChannel = (id) => {
    const existing = channels.get(id);
    if (existing) return existing;

    const channel = createChannelInstance(
      { id, volume: 100, muted: false, pan: 0 },
      getAudioContext().destination,
    );
    channels.set(id, channel);
    return channel;
  };

  const ensureChannel = (channel, effects, phase) => {
    const existing = channels.get(channel.id);
    const volumeTransition = getTransitionPhase(
      effects,
      channel.id,
      "volume",
      phase,
    );
    const panTransition = getTransitionPhase(effects, channel.id, "pan", phase);

    if (
      existing &&
      (existing.cleanupTimeoutId !== null ||
        existing.deferredRemovalToken !== null)
    ) {
      const created = createChannelInstance(
        channel,
        getAudioContext().destination,
      );
      channels.set(channel.id, created);
      applyVolume({
        gainNode: created.gainNode,
        targetValue: getVolumeValue(channel),
        transition: volumeTransition,
      });
      applyPan({
        pannerNode: created.pannerNode,
        targetValue: channel.pan,
        transition: panTransition,
      });
      if (created.control) {
        acceptChannelPlaybackCommand(created, channel.playback);
      }
      return created;
    }

    if (existing) {
      existing.deferredRemovalToken = null;
      const currentVolumeValue = getVolumeValue(existing);
      const nextVolumeValue = getVolumeValue(channel);
      const volumeChanged = currentVolumeValue !== nextVolumeValue;
      const mutedChanged = existing.muted !== channel.muted;
      const panChanged = existing.pan !== (channel.pan ?? 0);
      const loopInterrupted = existing.loop && !channel.loop;

      existing.volume = channel.volume;
      existing.muted = channel.muted;
      existing.pan = channel.pan;
      existing.loop = channel.loop;
      existing.interruption = channel.interruption;

      if (loopInterrupted) {
        finishChannelLoop(channel.id);
      }
      if (existing.control) {
        acceptChannelPlaybackCommand(existing, channel.playback);
      }

      if (volumeChanged && volumeTransition) {
        applyVolume({
          gainNode: existing.gainNode,
          targetValue: nextVolumeValue,
          transition: volumeTransition,
        });
      } else if (volumeChanged) {
        applyVolume({
          gainNode: existing.gainNode,
          targetValue: nextVolumeValue,
          transition: null,
        });
      }

      if (panChanged) {
        applyPan({
          pannerNode: existing.pannerNode,
          targetValue: channel.pan,
          transition: panTransition,
        });
      }
      if (mutedChanged) {
        setParamNow(existing.muteGainNode.gain, getMuteValue(channel));
      }
      return existing;
    }

    const created = createChannelInstance(
      channel,
      getAudioContext().destination,
    );
    channels.set(channel.id, created);
    applyVolume({
      gainNode: created.gainNode,
      targetValue: getVolumeValue(channel),
      transition: volumeTransition,
    });
    applyPan({
      pannerNode: created.pannerNode,
      targetValue: channel.pan,
      transition: panTransition,
    });
    if (created.control) {
      acceptChannelPlaybackCommand(created, channel.playback);
    }
    return created;
  };

  const getParentChannelForSound = (sound) => {
    const parentChannel =
      sound.channelId !== null
        ? channels.get(sound.channelId)
        : ensureRootChannel(ROOT_CHANNEL_ID);

    if (!parentChannel) {
      throw new Error(
        `Input error: sound "${sound.id}" references missing channel.`,
      );
    }

    return parentChannel;
  };

  const connectSoundToChannel = (instance, channelNode) => {
    disconnect(instance.gainNode);
    disconnect(instance.pannerNode);
    disconnect(instance.muteGainNode);
    connect(instance.gainNode, instance.pannerNode ?? instance.muteGainNode);
    if (instance.pannerNode) {
      connect(instance.pannerNode, instance.muteGainNode);
    }
    connect(instance.muteGainNode, channelNode);
    instance.channelNode = channelNode;
  };

  const removeChannel = (channel, effects) => {
    if (
      !channel ||
      channel.id === ROOT_CHANNEL_ID ||
      channel.id === DIRECT_CHANNEL_ID
    ) {
      return 0;
    }

    const volumeTransition = getTransitionPhase(
      effects,
      channel.id,
      "volume",
      "exit",
    );
    const panTransition = getTransitionPhase(
      effects,
      channel.id,
      "pan",
      "exit",
    );
    const volumeDuration = applyVolume({
      gainNode: channel.gainNode,
      targetValue: getVolumeValue(channel),
      transition: volumeTransition,
    });
    const panDuration = applyPan({
      pannerNode: channel.pannerNode,
      targetValue: channel.pan,
      transition: panTransition,
    });

    return Math.max(volumeDuration, panDuration);
  };

  const addSoundInstance = ({ sound, effects, phase, internalId }) => {
    const parentChannel = getParentChannelForSound(sound);

    const instance = createSoundInstance({
      sound,
      channelNode: parentChannel.gainNode,
      internalId,
    });
    sounds.set(internalId, instance);
    currentSoundKeyById.set(sound.id, internalId);
    bindChannelLoopCompletion(instance);

    instance.pendingEnterTransitions = {
      volume: getTransitionPhase(effects, sound.id, "volume", phase),
      pan: getTransitionPhase(effects, sound.id, "pan", phase),
      playbackRate: getTransitionPhase(
        effects,
        sound.id,
        "playbackRate",
        phase,
      ),
    };
    if (instance.control) {
      acceptControlledCommand(instance, sound.playback);
    } else if (parentChannel.control?.status === "paused") {
      stageSoundForPausedChannel(instance);
    } else {
      playSound(instance);
    }
    return instance;
  };

  const applySoundExitTransitions = (instance, effects) => {
    instance.pendingEnterTransitions = null;
    const volumeTransition = getTransitionPhase(
      effects,
      instance.id,
      "volume",
      "exit",
    );
    const panTransition = getTransitionPhase(
      effects,
      instance.id,
      "pan",
      "exit",
    );
    const playbackRateTransition = getTransitionPhase(
      effects,
      instance.id,
      "playbackRate",
      "exit",
    );
    const volumeDuration = volumeTransition
      ? applyVolume({
          gainNode: instance.gainNode,
          targetValue: getVolumeValue(instance),
          transition: volumeTransition,
        })
      : 0;
    const panDuration = panTransition
      ? applyPan({
          pannerNode: instance.pannerNode,
          targetValue: instance.pan,
          transition: panTransition,
        })
      : 0;
    let playbackRateDuration = 0;
    if (playbackRateTransition) {
      playbackRateDuration = applySoundPlaybackRateTransition({
        sound: instance,
        transition: playbackRateTransition,
      });
    }

    return Math.max(volumeDuration, panDuration, playbackRateDuration);
  };

  const removeSoundInstance = (instance, effects, inheritedDuration = 0) => {
    if (!instance) return 0;

    const finishingCallbacks = [...instance.finishingCallbacks];
    instance.finishing = false;
    instance.pendingEnterTransitions = null;
    instance.finishingCallbacks.clear();
    instance.onSourceEnded = null;

    const volumeTransition = getTransitionPhase(
      effects,
      instance.id,
      "volume",
      "exit",
    );
    const panTransition = getTransitionPhase(
      effects,
      instance.id,
      "pan",
      "exit",
    );
    const playbackRateTransition = getTransitionPhase(
      effects,
      instance.id,
      "playbackRate",
      "exit",
    );
    const volumeDuration = applyVolume({
      gainNode: instance.gainNode,
      targetValue: getVolumeValue(instance),
      transition: volumeTransition,
    });
    const panDuration = applyPan({
      pannerNode: instance.pannerNode,
      targetValue: instance.pan,
      transition: panTransition,
    });
    const playbackRateDuration = applySoundPlaybackRateTransition({
      sound: instance,
      transition: playbackRateTransition,
    });
    const ownDuration = Math.max(
      volumeDuration,
      panDuration,
      playbackRateDuration,
    );
    const duration = Math.max(ownDuration, inheritedDuration);

    stopSource(instance, duration);
    instance.cleanupTimeoutId = schedule(() => {
      forgetOwnedSound(instance);
      cleanupSound(instance);
      sounds.delete(instance.internalId);
      finishingCallbacks.forEach((callback) => callback());
    }, duration);

    return duration;
  };

  const finishSoundInstance = (
    instance,
    onFinished,
    { effects = [], waitForPendingPlayback = false } = {},
  ) => {
    if (!instance) {
      return;
    }

    if (onFinished) {
      instance.finishingCallbacks.add(onFinished);
    }
    if (instance.finishing) {
      return;
    }

    instance.finishing = true;
    const transitionStartTime = getAudioContext().currentTime;
    const remainingMediaAtInterruption =
      getRemainingIterationMediaSeconds(instance);
    const exitDuration = applySoundExitTransitions(instance, effects);
    const exitDeadlineTime = transitionStartTime + exitDuration / 1000;
    instance.loop = false;
    let transitionComplete = exitDuration <= 0;
    let tailComplete = false;

    const cleanupFinishedSound = () => {
      if (!instance.finishing || !transitionComplete || !tailComplete) {
        return;
      }

      instance.finishing = false;
      instance.onSourceEnded = null;
      instance.onFinishingSourceStarted = null;
      const finishingCallbacks = [...instance.finishingCallbacks];
      instance.finishingCallbacks.clear();
      forgetOwnedSound(instance);
      cleanupSound(instance);
      if (sounds.get(instance.internalId) === instance) {
        sounds.delete(instance.internalId);
      }
      finishingCallbacks.forEach((callback) => callback());
    };
    const completeTailWithoutLoopEnd = () => {
      const remainingExitMs = Math.max(
        0,
        (exitDeadlineTime - getAudioContext().currentTime) * 1000,
      );
      stopSource(instance, remainingExitMs);
      tailComplete = true;
      cleanupFinishedSound();
    };
    const finishActiveSource = () => {
      instance.onFinishingSourceStarted = null;
      if (!instance.finishing) {
        return;
      }
      if (!instance.source || instance.sourceEnded) {
        tailComplete = true;
        cleanupFinishedSound();
        return;
      }

      const remainingMediaSeconds =
        remainingMediaAtInterruption ??
        getRemainingIterationMediaSeconds(instance);
      if (remainingMediaSeconds === null) {
        if (!hasContinuingPlaybackProgress(instance.source.playbackRate)) {
          completeTailWithoutLoopEnd();
          return;
        }
        instance.source.loop = false;
        return;
      }

      const loopEndDelayMs = getTimeToMediaProgressMs(
        instance.source.playbackRate,
        remainingMediaSeconds,
        getAudioContext(),
      );
      if (!Number.isFinite(loopEndDelayMs)) {
        completeTailWithoutLoopEnd();
        return;
      }

      instance.source.loop = false;
      try {
        const stopTime = getAudioContext().currentTime + loopEndDelayMs / 1000;
        instance.source.stop(Number(stopTime.toFixed(9)));
      } catch {
        tailComplete = true;
        cleanupFinishedSound();
      }
    };

    if (exitDuration > 0) {
      instance.cleanupTimeoutId = schedule(() => {
        transitionComplete = true;
        cleanupFinishedSound();
      }, exitDuration);
    }

    if (getAudioContext().state !== "running") {
      transitionComplete = true;
      tailComplete = true;
      cleanupFinishedSound();
      return;
    }

    instance.onSourceEnded = () => {
      tailComplete = true;
      cleanupFinishedSound();
    };
    if (
      waitForPendingPlayback &&
      (instance.playbackPending || instance.pendingTimeoutId !== null)
    ) {
      instance.onFinishingSourceStarted = finishActiveSource;
      return;
    }
    if (!instance.source || instance.sourceEnded) {
      tailComplete = true;
      cleanupFinishedSound();
      return;
    }

    finishActiveSource();
  };

  const updateSoundInstance = ({
    instance,
    sound,
    effects,
    replay = false,
  }) => {
    const currentVolumeValue = getVolumeValue(instance);
    const nextVolumeValue = getVolumeValue(sound);
    const volumeChanged = currentVolumeValue !== nextVolumeValue;
    const mutedChanged = instance.muted !== sound.muted;
    const panChanged = instance.pan !== sound.pan;
    const loopChanged = instance.loop !== sound.loop;
    const playbackRateChanged = instance.playbackRate !== sound.playbackRate;
    const startDelayChanged = instance.startDelayMs !== sound.startDelayMs;
    const sourceBeforeUpdate = instance.source;
    const currentPlaybackRateValue = instance.source
      ? getCurrentParamValue(instance.source.playbackRate, getAudioContext())
      : getPlaybackRateAutomationValue(instance, getAudioContext());

    if (volumeChanged && instance.pendingEnterTransitions) {
      instance.pendingEnterTransitions.volume = null;
    }
    if (panChanged && instance.pendingEnterTransitions) {
      instance.pendingEnterTransitions.pan = null;
    }
    if (playbackRateChanged && instance.pendingEnterTransitions) {
      instance.pendingEnterTransitions.playbackRate = null;
    }

    if (
      instance.control &&
      instance.source &&
      (loopChanged || playbackRateChanged)
    ) {
      captureControlledPosition(instance);
    }
    if (
      !instance.control &&
      (loopChanged || playbackRateChanged) &&
      instance.source &&
      !instance.sourceEnded &&
      !instance.playbackPending
    ) {
      checkpointLegacyPlaybackOffset(instance);
    }

    if (instance.channelId !== sound.channelId) {
      const parentChannel = getParentChannelForSound(sound);
      connectSoundToChannel(instance, parentChannel.gainNode);
    }

    instance.loop = sound.loop;
    instance.volume = sound.volume;
    instance.muted = sound.muted;
    instance.pan = sound.pan;
    instance.startDelayMs = sound.startDelayMs;
    instance.playbackRate = sound.playbackRate;
    instance.startAt = sound.startAt;
    instance.endAt = sound.endAt;
    instance.channelId = sound.channelId;
    bindChannelLoopCompletion(instance);

    if (instance.source && !instance.control) {
      instance.source.loop = sound.loop;
    }

    const volumeTransition = getTransitionPhase(
      effects,
      sound.id,
      "volume",
      "update",
    );
    if (volumeChanged && volumeTransition) {
      applyVolume({
        gainNode: instance.gainNode,
        targetValue: nextVolumeValue,
        transition: volumeTransition,
      });
    } else if (volumeChanged) {
      applyVolume({
        gainNode: instance.gainNode,
        targetValue: nextVolumeValue,
        transition: null,
      });
    }

    if (panChanged) {
      applyPan({
        pannerNode: instance.pannerNode,
        targetValue: sound.pan,
        transition: getTransitionPhase(effects, sound.id, "pan", "update"),
      });
    }

    if (mutedChanged) {
      setParamNow(instance.muteGainNode.gain, getMuteValue(sound));
    }

    if (playbackRateChanged) {
      const playbackRateTransition = getTransitionPhase(
        effects,
        sound.id,
        "playbackRate",
        "update",
      );
      if (instance.control && loopChanged && instance.source) {
        startPlaybackRateAutomation({
          sound: instance,
          transition: playbackRateTransition,
          currentValue: currentPlaybackRateValue,
        });
      } else if (instance.source) {
        applySoundPlaybackRateTransition({
          sound: instance,
          transition: playbackRateTransition,
        });
      } else {
        startPlaybackRateAutomation({
          sound: instance,
          transition: playbackRateTransition,
          currentValue: currentPlaybackRateValue,
        });
      }
    }

    if (
      !instance.control &&
      startDelayChanged &&
      instance.pendingTimeoutId !== null
    ) {
      playSound(instance);
    }

    if (instance.control) {
      if (replay) {
        instance.pendingEnterTransitions = {
          volume: getTransitionPhase(effects, sound.id, "volume", "enter"),
          pan: getTransitionPhase(effects, sound.id, "pan", "enter"),
          playbackRate: getTransitionPhase(
            effects,
            sound.id,
            "playbackRate",
            "enter",
          ),
        };
      }
      acceptControlledCommand(instance, sound.playback);
      if (
        loopChanged &&
        instance.source === sourceBeforeUpdate &&
        instance.control.status === "playing"
      ) {
        stopControlledSource(instance);
        startControlledPlayback(instance, 0);
      }
    } else {
      syncSoundWithChannelPlayback(instance);
    }
  };

  const holdSoundProperty = (instance, property) => {
    instance.pendingEnterTransitions ??= {};
    instance.pendingEnterTransitions[property] = null;

    if (property === "volume") {
      holdParamNow(instance.gainNode?.gain);
      return;
    }
    if (property === "pan") {
      holdParamNow(instance.pannerNode?.pan);
      return;
    }
    if (property !== "playbackRate") return;

    if (instance.source) {
      holdParamNow(instance.source.playbackRate);
      instance.playbackRateAutomation =
        audioParamAutomation.get(instance.source.playbackRate) ?? null;
      return;
    }

    const currentValue = getPlaybackRateAutomationValue(instance);
    instance.playbackRateAutomation = {
      startTime: getAudioContext().currentTime,
      timeline: [{ time: 0, value: currentValue, easing: "linear" }],
      normalizeValue: normalizePlaybackRateValue,
    };
  };

  const settleSoundProperty = (instance, node, property) => {
    if (instance.pendingEnterTransitions) {
      instance.pendingEnterTransitions[property] = null;
    }

    if (property === "volume") {
      applyVolume({
        gainNode: instance.gainNode,
        targetValue: getVolumeValue(node ?? instance),
        transition: null,
      });
      return;
    }
    if (property === "pan") {
      applyPan({
        pannerNode: instance.pannerNode,
        targetValue: node?.pan ?? instance.pan,
        transition: null,
      });
      return;
    }
    if (property === "playbackRate") {
      instance.playbackRateAutomation = null;
      if (instance.source) {
        applyPlaybackRate({
          source: instance.source,
          targetValue: node?.playbackRate ?? instance.playbackRate,
          transition: null,
        });
      }
    }
  };

  const holdChannelProperty = (channel, property) => {
    if (property === "volume") {
      holdParamNow(channel.gainNode?.gain);
    } else if (property === "pan") {
      holdParamNow(channel.pannerNode?.pan);
    }
  };

  const settleChannelProperty = (channel, node, property) => {
    if (property === "volume") {
      applyVolume({
        gainNode: channel.gainNode,
        targetValue: getVolumeValue(node ?? channel),
        transition: null,
      });
    } else if (property === "pan") {
      applyPan({
        pannerNode: channel.pannerNode,
        targetValue: node?.pan ?? channel.pan,
        transition: null,
      });
    }
  };

  const releaseEffectOwnership = (
    ownership,
    { nextNode = null, claimedProperties = new Set() } = {},
  ) => {
    if (!ownership) return;

    const properties = new Set(Object.keys(ownership.effect.properties));
    for (const instance of ownership.soundInstances) {
      const isCurrent =
        sounds.get(instance.internalId) === instance &&
        currentSoundKeyById.get(instance.id) === instance.internalId;
      if (!isCurrent) {
        removeSoundInstance(instance, [], 0);
        continue;
      }

      for (const property of properties) {
        if (claimedProperties.has(property)) {
          holdSoundProperty(instance, property);
        } else {
          settleSoundProperty(instance, nextNode, property);
        }
      }
    }

    for (const channel of ownership.channelInstances) {
      const isCurrent = channels.get(channel.id) === channel;
      if (!isCurrent) {
        cleanupChannel(channel);
        continue;
      }

      for (const property of properties) {
        if (claimedProperties.has(property)) {
          holdChannelProperty(channel, property);
        } else {
          settleChannelProperty(channel, nextNode, property);
        }
      }
    }
  };

  const prepareEffectOwnership = (effectPlan) => {
    for (const { effect, ownership } of effectPlan.superseded) {
      const accepted = effectPlan.accepted.find(
        (entry) => entry.effect.targetId === effect.targetId,
      );
      releaseEffectOwnership(ownership, {
        nextNode: accepted?.nextNode ?? null,
        claimedProperties: new Set(
          Object.keys(accepted?.effect.properties ?? {}),
        ),
      });
      ownedAudioEffects.delete(effect.id);
    }

    for (const { effect, ownership } of effectPlan.settled) {
      releaseEffectOwnership(ownership, {
        nextNode: effectPlan.nextNodes.byId.get(effect.targetId) ?? null,
      });
      ownedAudioEffects.delete(effect.id);
    }

    const acceptedByTarget = new Map();
    for (const entry of effectPlan.accepted) {
      const ownership = {
        effect: entry.effect,
        signature: entry.signature,
        targetId: entry.effect.targetId,
        targetType: entry.targetType,
        soundInstances: new Set(),
        channelInstances: new Set(),
      };
      ownedAudioEffects.set(entry.effect.id, ownership);
      acceptedByTarget.set(entry.effect.targetId, ownership);
    }
    return acceptedByTarget;
  };

  const validateGraphTransition = ({
    prevAudio = [],
    nextAudio = [],
    prevAudioEffects = [],
    nextAudioEffects = [],
  } = {}) => {
    const prev = normalizeAudioRenderState({
      audio: prevAudio,
      audioEffects: prevAudioEffects,
    });
    const next = normalizeAudioRenderState({
      audio: nextAudio,
      audioEffects: nextAudioEffects,
    });
    const effectPlan = planAudioEffects({
      prevState: prev,
      nextState: next,
      ownedAudioEffects,
    });

    const prevChannelById = new Map(
      prev.channels.map((channel) => [channel.id, channel]),
    );
    const nextChannelById = new Map(
      next.channels.map((channel) => [channel.id, channel]),
    );
    const prevSoundById = new Map(
      prev.sounds.map((sound) => [sound.id, sound]),
    );
    const nextSoundById = new Map(
      next.sounds.map((sound) => [sound.id, sound]),
    );

    for (const id of prevChannelById.keys()) {
      if (nextSoundById.has(id)) {
        throw new Error(
          `Input error: audio node "${id}" cannot change type from "audio-channel" to "sound" between render states.`,
        );
      }
    }
    for (const id of prevSoundById.keys()) {
      if (nextChannelById.has(id)) {
        throw new Error(
          `Input error: audio node "${id}" cannot change type from "sound" to "audio-channel" between render states.`,
        );
      }
    }

    for (const [id, prevChannel] of prevChannelById) {
      const nextChannel = nextChannelById.get(id);
      if (!nextChannel) continue;

      const wasControlled = prevChannel.playback !== undefined;
      const isControlled = nextChannel.playback !== undefined;
      if (wasControlled !== isControlled) {
        throw new Error(
          `Input error: audio-channel "${id}" cannot change command-controlled playback mode while retained.`,
        );
      }
    }

    for (const [id, prevSound] of prevSoundById) {
      const nextSound = nextSoundById.get(id);
      if (!nextSound) continue;

      const wasControlled = prevSound.playback !== undefined;
      const isControlled = nextSound.playback !== undefined;
      if (wasControlled !== isControlled) {
        throw new Error(
          `Input error: sound "${id}" cannot change command-controlled playback mode while retained.`,
        );
      }

      if (isControlled && !hasSameSoundSourceIdentity(prevSound, nextSound)) {
        const currentKey = currentSoundKeyById.get(id);
        const currentInstance = currentKey ? sounds.get(currentKey) : null;
        const acceptedCommandId =
          currentInstance?.control?.commandId ?? prevSound.playback.commandId;
        if (
          nextSound.playback.operation !== "play" ||
          nextSound.playback.commandId <= acceptedCommandId
        ) {
          throw new Error(
            `Input error: command-controlled sound "${id}" must change source identity with a higher play command.`,
          );
        }
      }
    }

    return {
      prev,
      next,
      effectPlan,
      prevChannelById,
      nextChannelById,
      prevSoundById,
      nextSoundById,
    };
  };

  const renderGraph = ({
    prevAudio = [],
    nextAudio = [],
    prevAudioEffects = [],
    nextAudioEffects = [],
    eventHandler = soundEventHandler,
  } = {}) => {
    const {
      next,
      effectPlan,
      prevChannelById,
      nextChannelById,
      prevSoundById,
      nextSoundById,
    } = validateGraphTransition({
      prevAudio,
      nextAudio,
      prevAudioEffects,
      nextAudioEffects,
    });
    soundEventHandler = eventHandler;

    ensureRootChannel(ROOT_CHANNEL_ID);
    const acceptedTransitions = effectPlan.transitions;
    const replayTargets = new Set(
      effectPlan.accepted
        .filter(({ lifecycle }) => lifecycle === "replay")
        .map(({ effect }) => effect.targetId),
    );
    const acceptedOwnershipByTarget = prepareEffectOwnership(effectPlan);
    const ownSound = (targetId, instance) => {
      if (instance) {
        acceptedOwnershipByTarget.get(targetId)?.soundInstances.add(instance);
      }
    };
    const ownChannel = (targetId, channel) => {
      if (channel) {
        acceptedOwnershipByTarget.get(targetId)?.channelInstances.add(channel);
      }
    };

    const removedChannels = new Map();
    const channelCleanupDurations = new Map();
    const deferredChannelCleanup = new Map();
    const tryCleanupDeferredChannel = (entry) => {
      if (
        entry.registeringSounds ||
        !entry.transitionComplete ||
        entry.soundIds.size > 0 ||
        entry.channel.deferredRemovalToken !== entry.token
      ) {
        return;
      }

      forgetOwnedChannel(entry.channel);
      cleanupChannel(entry.channel);
      if (channels.get(entry.channel.id) === entry.channel) {
        channels.delete(entry.channel.id);
      }
      entry.channel.deferredRemovalToken = null;
    };
    const finishSoundForDeferredChannel = (instance, entry, effects = []) => {
      if (!instance || !entry) {
        return;
      }

      entry.soundIds.add(instance.internalId);
      finishSoundInstance(
        instance,
        () => {
          entry.soundIds.delete(instance.internalId);
          tryCleanupDeferredChannel(entry);
        },
        { effects, waitForPendingPlayback: true },
      );
    };

    for (const [id, prevChannel] of prevChannelById) {
      if (!nextChannelById.has(id)) {
        const channel = channels.get(id);
        ownChannel(id, channel);
        const duration = removeChannel(channel, acceptedTransitions);
        channelCleanupDurations.set(id, duration);
        if (prevChannel.interruption === "loopEnd" && channel) {
          channel.loop = false;
          const token = {};
          channel.deferredRemovalToken = token;
          const entry = {
            channel,
            token,
            registeringSounds: true,
            transitionComplete: duration <= 0,
            soundIds: new Set(),
          };
          deferredChannelCleanup.set(id, entry);
          for (const instance of sounds.values()) {
            if (
              instance.channelNode === channel.gainNode &&
              instance.finishing
            ) {
              finishSoundForDeferredChannel(instance, entry);
            }
          }
          if (duration > 0) {
            schedule(() => {
              entry.transitionComplete = true;
              tryCleanupDeferredChannel(entry);
            }, duration);
          }
        } else {
          removedChannels.set(id, channel);
        }
      }
    }

    for (const [id, nextChannel] of nextChannelById) {
      const channel = ensureChannel(
        nextChannel,
        acceptedTransitions,
        prevChannelById.has(id) ? "update" : "enter",
      );
      ownChannel(id, channel);
    }

    for (const [id, prevSound] of prevSoundById) {
      const nextSound = nextSoundById.get(id);
      const currentKey = currentSoundKeyById.get(id);
      const instance = currentKey ? sounds.get(currentKey) : null;
      const inheritedDuration = prevSound.channelId
        ? (channelCleanupDurations.get(prevSound.channelId) ?? 0)
        : 0;
      const finishAtLoopEnd =
        prevSound.channelId !== null &&
        prevChannelById.get(prevSound.channelId)?.interruption === "loopEnd";
      const finishPreviousSound = () => {
        ownSound(id, instance);
        ownSound(prevSound.channelId, instance);
        suppressControlledEvents(instance);
        if (!finishAtLoopEnd) {
          return removeSoundInstance(
            instance,
            acceptedTransitions,
            inheritedDuration,
          );
        }

        const deferredCleanup = deferredChannelCleanup.get(prevSound.channelId);
        if (deferredCleanup) {
          finishSoundForDeferredChannel(
            instance,
            deferredCleanup,
            acceptedTransitions,
          );
        } else {
          finishSoundInstance(instance, undefined, {
            effects: acceptedTransitions,
            waitForPendingPlayback: true,
          });
        }
        return 0;
      };

      if (!nextSound) {
        const duration = finishPreviousSound();
        if (prevSound.channelId) {
          channelCleanupDurations.set(
            prevSound.channelId,
            Math.max(
              channelCleanupDurations.get(prevSound.channelId) ?? 0,
              duration,
            ),
          );
        }
        currentSoundKeyById.delete(id);
        continue;
      }

      if (!hasSameSoundSourceIdentity(prevSound, nextSound)) {
        const duration = finishPreviousSound();
        if (prevSound.channelId) {
          channelCleanupDurations.set(
            prevSound.channelId,
            Math.max(
              channelCleanupDurations.get(prevSound.channelId) ?? 0,
              duration,
            ),
          );
        }
        const incoming = addSoundInstance({
          sound: nextSound,
          effects: acceptedTransitions,
          phase: "enter",
          internalId: `render:${id}:${++soundGeneration}`,
        });
        ownSound(id, incoming);
      }
    }

    for (const [id, nextSound] of nextSoundById) {
      if (!prevSoundById.has(id)) {
        const added = addSoundInstance({
          sound: nextSound,
          effects: acceptedTransitions,
          phase: "enter",
          internalId: `render:${id}:${++soundGeneration}`,
        });
        ownSound(id, added);
        continue;
      }

      const prevSound = prevSoundById.get(id);
      if (!hasSameSoundSourceIdentity(prevSound, nextSound)) {
        continue;
      }

      const currentKey = currentSoundKeyById.get(id);
      const instance = currentKey ? sounds.get(currentKey) : null;
      if (instance) {
        updateSoundInstance({
          instance,
          sound: nextSound,
          effects: acceptedTransitions,
          replay: replayTargets.has(id),
        });
        ownSound(id, instance);
      }
    }

    for (const entry of deferredChannelCleanup.values()) {
      entry.registeringSounds = false;
      tryCleanupDeferredChannel(entry);
    }

    for (const [id, channel] of removedChannels) {
      if (!channel) continue;
      const duration = channelCleanupDurations.get(id) ?? 0;
      channel.cleanupTimeoutId = schedule(() => {
        forgetOwnedChannel(channel);
        cleanupChannel(channel);
        if (channels.get(id) === channel) {
          channels.delete(id);
        }
      }, duration);
    }

    for (const channel of next.channels) {
      restartLoopingChannelIfComplete(channel.id);
    }
  };

  const add = (element) => {
    const existingInstance = sounds.get(`direct:${element.id}`);
    if (existingInstance?.finishing) {
      removeSoundInstance(existingInstance, [], 0);
    }

    const audio = {
      id: element.id,
      type: "sound",
      src: element.url ?? element.src,
      loop: element.loop ?? false,
      volume: normalizeDirectVolume(element.volume),
      muted: element.muted ?? false,
      pan: toFiniteParamValue(element.pan, 0),
      startDelayMs: Math.max(0, toFiniteParamValue(element.startDelayMs, 0)),
      playbackRate: toFiniteParamValue(element.playbackRate, 1),
      startAt: Math.max(0, toFiniteParamValue(element.startAt, 0)),
      endAt:
        element.endAt !== undefined && element.endAt !== null
          ? Math.max(0, toFiniteParamValue(element.endAt, 0))
          : null,
    };

    directAudios.set(element.id, audio);
    debugAudio("direct add", {
      id: audio.id,
      src: audio.src,
      loop: audio.loop,
      volume: audio.volume,
      muted: audio.muted,
      pan: audio.pan,
    });
  };

  const remove = (id) => {
    const internalId = `direct:${id}`;
    const instance = sounds.get(internalId);
    debugAudio("direct remove", {
      id,
      hadAudio: directAudios.has(id),
      hadInstance: Boolean(instance),
    });
    directAudios.delete(id);
    currentSoundKeyById.delete(id);
    if (instance) {
      removeSoundInstance(instance, [], 0);
    }
  };

  const finish = (id) => {
    const internalId = `direct:${id}`;
    const instance = sounds.get(internalId);
    debugAudio("direct finish", {
      id,
      hadAudio: directAudios.has(id),
      hadInstance: Boolean(instance),
    });
    directAudios.delete(id);
    currentSoundKeyById.delete(id);
    finishSoundInstance(instance);
  };

  const getById = (id) => directAudios.get(id);

  const resume = () => resumeAudioContext(getAudioContext());

  const tick = () => {
    const channel = ensureRootChannel(DIRECT_CHANNEL_ID);
    for (const audio of directAudios.values()) {
      const internalId = `direct:${audio.id}`;
      const instance = sounds.get(internalId);
      if (!instance) {
        const directSound = { ...audio, channelId: DIRECT_CHANNEL_ID };
        addSoundInstance({
          sound: directSound,
          effects: [],
          phase: "enter",
          internalId,
        });
        continue;
      }

      if (instance.src !== audio.src) {
        removeSoundInstance(instance, [], 0);
        const directSound = { ...audio, channelId: DIRECT_CHANNEL_ID };
        addSoundInstance({
          sound: directSound,
          effects: [],
          phase: "enter",
          internalId,
        });
        continue;
      }

      updateSoundInstance({
        instance,
        sound: { ...audio, channelId: DIRECT_CHANNEL_ID },
        effects: [],
      });
    }

    for (const [internalId, instance] of sounds) {
      if (
        internalId.startsWith("direct:") &&
        !directAudios.has(instance.id) &&
        !instance.finishing
      ) {
        removeSoundInstance(instance, [], 0);
        currentSoundKeyById.delete(instance.id);
      }
    }

    return channel;
  };

  const destroy = () => {
    destroyed = true;
    soundEventHandler = undefined;
    for (const sound of sounds.values()) {
      cleanupSound(sound);
    }
    for (const channel of channels.values()) {
      cleanupChannel(channel);
    }

    sounds.clear();
    currentSoundKeyById.clear();
    channels.clear();
    directAudios.clear();
    ownedAudioEffects.clear();
  };

  return {
    add,
    remove,
    finish,
    getById,
    resume,
    tick,
    validateGraphTransition,
    renderGraph,
    destroy,
    _inspect: () => ({
      channels,
      sounds,
      currentSoundKeyById,
      directAudios,
      ownedAudioEffects,
    }),
  };
};

export const AudioStage = createAudioStage;
