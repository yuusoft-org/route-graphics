const spec = globalThis.__RTGL_AVT_SPEC__;
const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertFiniteNumber = (value, path, { min, max, exclusiveMin } = {}) => {
  if (!Number.isFinite(value)) {
    throw new Error(`AVT ${path} must be a finite number.`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`AVT ${path} must be at least ${min}.`);
  }
  if (exclusiveMin !== undefined && value <= exclusiveMin) {
    throw new Error(`AVT ${path} must be greater than ${exclusiveMin}.`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`AVT ${path} must be at most ${max}.`);
  }
};

const encodeBase64 = (bytes) => {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
};

const writeText = (view, offset, value) => {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const createToneWav = ({
  frequency,
  endFrequency = frequency,
  durationMs = 1000,
  amplitude = 0.45,
  sampleRate,
}) => {
  assertFiniteNumber(frequency, "asset.frequency", { exclusiveMin: 0 });
  assertFiniteNumber(endFrequency, "asset.endFrequency", {
    exclusiveMin: 0,
  });
  assertFiniteNumber(durationMs, "asset.durationMs", { exclusiveMin: 0 });
  assertFiniteNumber(amplitude, "asset.amplitude", { min: 0, max: 1 });
  const frameCount = Math.ceil((durationMs / 1000) * sampleRate);
  const dataSize = frameCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const durationSeconds = durationMs / 1000;
  const sweepRate = (endFrequency - frequency) / durationSeconds;
  for (let frame = 0; frame < frameCount; frame++) {
    const time = frame / sampleRate;
    const phase =
      endFrequency === frequency
        ? (2 * Math.PI * frequency * frame) / sampleRate
        : 2 * Math.PI * (frequency * time + (sweepRate * time * time) / 2);
    const sample = Math.sin(phase);
    view.setInt16(44 + frame * 2, Math.round(sample * amplitude * 32767), true);
  }
  return buffer;
};

const createAudioAssets = (assets, sampleRate) => {
  if (!isRecord(assets)) {
    throw new Error("AVT assets must be an object.");
  }

  return Object.fromEntries(
    Object.entries(assets).map(([id, asset]) => {
      if (!isRecord(asset)) {
        throw new Error(`AVT asset "${id}" must be an object.`);
      }
      if (asset.generator !== "tone") {
        throw new Error(
          `AVT asset "${id}" has unsupported generator "${asset.generator}".`,
        );
      }
      return [
        id,
        {
          buffer: createToneWav({ ...asset, sampleRate }),
          type: "audio/wav",
        },
      ];
    }),
  );
};

const toCanonicalPcm16Wav = (audioBuffer) => {
  const channelCount = audioBuffer.numberOfChannels;
  const bytesPerFrame = channelCount * 2;
  const dataSize = audioBuffer.length * bytesPerFrame;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  );
  let offset = 44;
  for (let frame = 0; frame < audioBuffer.length; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      const value =
        sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      view.setInt16(offset, value, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
};

const summarizeSignal = (wav) => {
  let peak = 0;
  let squareSum = 0;
  let nonZeroSamples = 0;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const totalSamples = (wav.byteLength - 44) / 2;

  for (let offset = 44; offset < wav.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true) / 32768;
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    squareSum += sample * sample;
    if (sample !== 0) nonZeroSamples += 1;
  }

  return {
    peak,
    rms: Math.sqrt(squareSum / totalSamples),
    nonZeroSamples,
  };
};

const serializeError = (error) => ({
  name: error?.name ?? "Error",
  message: error?.message ?? String(error),
  stack: error?.stack,
});

const run = async () => {
  let app;
  let runtime;
  let resetAudioRuntime;

  try {
    if (!spec || typeof spec !== "object") {
      throw new Error("AVT spec was not provided.");
    }
    if (!Array.isArray(spec.states) || spec.states.length === 0) {
      throw new Error("AVT spec requires at least one state.");
    }
    if (
      spec.expectSilence !== undefined &&
      typeof spec.expectSilence !== "boolean"
    ) {
      throw new Error("AVT expectSilence must be a boolean when provided.");
    }
    for (const [index, entry] of spec.states.entries()) {
      if (!isRecord(entry) || !isRecord(entry.state)) {
        throw new Error(`AVT states[${index}] must contain a state object.`);
      }
      assertFiniteNumber(entry.atMs, `states[${index}].atMs`, { min: 0 });
      if (entry.atMs >= spec.durationMs) {
        throw new Error(
          `AVT states[${index}].atMs must be less than durationMs.`,
        );
      }
    }

    const routeGraphics = await import("/RouteGraphics.js");
    const {
      default: createRouteGraphics,
      configureAudioRuntime,
      createDeterministicAudioRuntime,
      soundPlugin,
    } = routeGraphics;
    resetAudioRuntime = routeGraphics.resetAudioRuntime;

    runtime = createDeterministicAudioRuntime({
      durationMs: spec.durationMs,
      sampleRate: spec.sampleRate,
      numberOfChannels: spec.numberOfChannels,
    });
    configureAudioRuntime(runtime);

    const events = [];
    app = createRouteGraphics();
    await app.init({
      width: 32,
      height: 32,
      backgroundColor: 0x000000,
      rendererPreference: "webgl",
      rendererFallback: true,
      plugins: { elements: [], animations: [], audio: [soundPlugin] },
      eventHandler: (name, payload) => events.push({ name, payload }),
    });
    await app.loadAssets(createAudioAssets(spec.assets, runtime.sampleRate));

    const states = [...spec.states].sort(
      (left, right) => left.atMs - right.atMs,
    );
    if (states[0].atMs !== 0) {
      throw new Error("AVT first state must start at atMs: 0.");
    }
    for (let index = 1; index < states.length; index++) {
      if (states[index - 1].atMs === states[index].atMs) {
        throw new Error("AVT state times must be unique.");
      }
    }
    app.render(states[0].state);
    for (const entry of states.slice(1)) {
      runtime.scheduleAt(entry.atMs, () => app.render(entry.state));
    }

    const rendered = await runtime.render();
    const wav = toCanonicalPcm16Wav(rendered);
    const signal = summarizeSignal(wav);
    if (spec.expectSilence === true && signal.nonZeroSamples !== 0) {
      throw new Error("AVT expected silence but rendered audible samples.");
    }
    if (spec.expectSilence !== true && signal.nonZeroSamples === 0) {
      throw new Error(
        "AVT rendered silence. Set expectSilence: true for an intentional silence fixture.",
      );
    }
    globalThis.__RTGL_AVT_RESULT__ = {
      ok: true,
      wavBase64: encodeBase64(wav),
      events,
      metadata: {
        sampleRate: rendered.sampleRate,
        numberOfChannels: rendered.numberOfChannels,
        frameCount: rendered.length,
        durationMs: (rendered.length / rendered.sampleRate) * 1000,
        byteLength: wav.byteLength,
        pendingTaskCount: runtime.getPendingTaskCount(),
        signal,
      },
    };
  } catch (error) {
    globalThis.__RTGL_AVT_RESULT__ = {
      ok: false,
      error: serializeError(error),
    };
  } finally {
    app?.destroy();
    runtime?.destroy();
    resetAudioRuntime?.();
  }
};

void run();
