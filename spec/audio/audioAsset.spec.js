import { afterEach, describe, expect, it, vi } from "vitest";

const originalAudioContext = window.AudioContext;
const originalWebkitAudioContext = window.webkitAudioContext;

const createOggVorbisBuffer = () => {
  return new Uint8Array([
    0x4f, 0x67, 0x67, 0x53, 0x00, 0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73,
  ]).buffer;
};

const createAudioContextMock = ({ decodeAudioData } = {}) => {
  const writtenChannels = [];
  const audioBuffer = {
    getChannelData: vi.fn((channelIndex) => {
      const channel = new Float32Array(2);
      writtenChannels[channelIndex] = channel;
      return channel;
    }),
  };
  const decodedBuffer = { decoded: true };
  const context = {
    createBuffer: vi.fn(() => audioBuffer),
    decodeAudioData:
      decodeAudioData ?? vi.fn(() => Promise.resolve(decodedBuffer)),
    writtenChannels,
  };

  const AudioContextMock = vi.fn(function AudioContextMock() {
    return context;
  });
  window.AudioContext = AudioContextMock;
  window.webkitAudioContext = undefined;

  return {
    AudioContextMock,
    audioBuffer,
    context,
    decodedBuffer,
  };
};

const mockAudioProbe = (supportValue) => {
  const originalCreateElement = document.createElement.bind(document);
  return vi
    .spyOn(document, "createElement")
    .mockImplementation((tagName, ...args) => {
      const element = originalCreateElement(tagName, ...args);
      if (tagName === "audio") {
        element.canPlayType = vi.fn(() => supportValue);
      }
      return element;
    });
};

const setupAudioAsset = async () => {
  vi.resetModules();

  const { context, decodedBuffer } = createAudioContextMock();

  const { AudioAsset } = await import("../../src/AudioAsset.js");

  return {
    AudioAsset,
    context,
    decodedBuffer,
  };
};

describe("AudioAsset", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "loads and unloads the alias %s",
    async (key) => {
      const { AudioAsset, context, decodedBuffer } = await setupAudioAsset();
      expect(AudioAsset.getAsset(key)).toBeUndefined();
      await expect(AudioAsset.load(key, new ArrayBuffer(8))).resolves.toBe(
        decodedBuffer,
      );
      expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(AudioAsset.getAsset(key)).toBe(decodedBuffer);
      expect(AudioAsset.unload(key)).toBe(true);
      expect(AudioAsset.getAsset(key)).toBeUndefined();
    },
  );

  afterEach(() => {
    window.AudioContext = originalAudioContext;
    window.webkitAudioContext = originalWebkitAudioContext;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("decodes and stores audio buffers during load", async () => {
    const { AudioAsset, context, decodedBuffer } = await setupAudioAsset();
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;

    await expect(AudioAsset.load("click", arrayBuffer)).resolves.toBe(
      decodedBuffer,
    );

    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    const decodedInput = context.decodeAudioData.mock.calls[0][0];
    expect(decodedInput).not.toBe(arrayBuffer);
    expect(new Uint8Array(decodedInput)).toEqual(new Uint8Array(arrayBuffer));
    expect(AudioAsset.getAsset("click")).toBe(decodedBuffer);
  });

  it("can reload a manager-owned buffer after decoders detach their input", async () => {
    vi.resetModules();

    const decodedBuffer = { decoded: true };
    const context = {
      decodeAudioData: vi.fn((decodeBuffer) => {
        structuredClone(decodeBuffer, { transfer: [decodeBuffer] });
        return Promise.resolve(decodedBuffer);
      }),
    };
    window.AudioContext = vi.fn(function AudioContextMock() {
      return context;
    });
    window.webkitAudioContext = undefined;
    const { AudioAsset } = await import("../../src/AudioAsset.js");
    const managerBuffer = new Uint8Array([1, 2, 3]).buffer;

    await AudioAsset.load("click", managerBuffer);
    expect(managerBuffer.byteLength).toBe(3);
    AudioAsset.unload("click");
    await AudioAsset.load("click", managerBuffer);

    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(managerBuffer.byteLength).toBe(3);
  });

  it("reuses an in-flight decode for duplicate load requests", async () => {
    vi.resetModules();

    let resolveDecode;
    const decodedBuffer = { decoded: true };
    const decodePromise = new Promise((resolve) => {
      resolveDecode = () => resolve(decodedBuffer);
    });
    const { context } = createAudioContextMock({
      decodeAudioData: vi.fn(() => decodePromise),
    });

    const { AudioAsset } = await import("../../src/AudioAsset.js");
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;
    const firstLoad = AudioAsset.load("click", arrayBuffer);
    const secondLoad = AudioAsset.load("click", arrayBuffer);

    expect(firstLoad).toBe(secondLoad);
    expect(AudioAsset.getAssetPromise("click")).toBe(firstLoad);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);

    resolveDecode();
    await expect(firstLoad).resolves.toBe(decodedBuffer);
    expect(AudioAsset.getAsset("click")).toBe(decodedBuffer);
    expect(AudioAsset.getAssetPromise("click")).toBeUndefined();
  });

  it("prepares the Vorbis fallback once and stores decoded PCM as an AudioBuffer", async () => {
    const decodeFile = vi.fn(async () => ({
      channelData: [new Float32Array([0.25, -0.5])],
      errors: [],
      sampleRate: 44100,
      samplesDecoded: 2,
    }));
    const reset = vi.fn(async () => {});
    const OggVorbisDecoder = vi.fn(function OggVorbisDecoder() {
      this.ready = Promise.resolve();
      this.decodeFile = decodeFile;
      this.reset = reset;
    });

    vi.doMock("@wasm-audio-decoders/ogg-vorbis", () => ({
      OggVorbisDecoder,
    }));

    mockAudioProbe("");
    const { audioBuffer, context } = createAudioContextMock({
      decodeAudioData: vi.fn(() =>
        Promise.reject(new Error("native decode failed")),
      ),
    });

    const { AudioAsset } = await import("../../src/AudioAsset.js");
    const buffer = createOggVorbisBuffer();
    const assetMap = {
      sfx: {
        buffer,
        type: "audio/ogg",
      },
    };

    await AudioAsset.prepareDecoders(assetMap);
    await AudioAsset.prepareDecoders(assetMap);
    await expect(AudioAsset.load("sfx", buffer, "audio/ogg")).resolves.toBe(
      audioBuffer,
    );

    expect(OggVorbisDecoder).toHaveBeenCalledTimes(1);
    expect(decodeFile).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(context.createBuffer).toHaveBeenCalledWith(1, 2, 44100);
    expect(context.writtenChannels[0]).toEqual(new Float32Array([0.25, -0.5]));
    expect(AudioAsset.getAsset("sfx")).toBe(audioBuffer);
  });

  it("does not instantiate a fallback decoder when native Ogg support is reported", async () => {
    const OggVorbisDecoder = vi.fn();
    vi.doMock("@wasm-audio-decoders/ogg-vorbis", () => ({
      OggVorbisDecoder,
    }));

    mockAudioProbe("probably");
    createAudioContextMock();

    const { AudioAsset } = await import("../../src/AudioAsset.js");

    await AudioAsset.prepareDecoders({
      sfx: {
        buffer: createOggVorbisBuffer(),
        type: "audio/ogg",
      },
    });

    expect(OggVorbisDecoder).not.toHaveBeenCalled();
  });

  it("reports an unsupported codec for an unrecognized Ogg stream", async () => {
    vi.resetModules();
    createAudioContextMock({
      decodeAudioData: vi.fn(() =>
        Promise.reject(new Error("native decode failed")),
      ),
    });
    const { AudioAsset } = await import("../../src/AudioAsset.js");
    const buffer = new Uint8Array([0x4f, 0x67, 0x67, 0x53]).buffer;

    await expect(
      AudioAsset.load("mystery", buffer, "audio/ogg"),
    ).rejects.toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          assetKey: "mystery",
          cause: 'Unsupported Ogg codec "unknown".',
        }),
      }),
    );
  });

  it("unloads decoded audio and permits the key to be loaded again", async () => {
    const { AudioAsset, context, decodedBuffer } = await setupAudioAsset();
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;

    await AudioAsset.load("click", arrayBuffer);

    expect(AudioAsset.unload("click")).toBe(true);
    expect(AudioAsset.getAsset("click")).toBeUndefined();
    expect(AudioAsset.unload("click")).toBe(false);

    await expect(AudioAsset.load("click", arrayBuffer)).resolves.toBe(
      decodedBuffer,
    );
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(AudioAsset.getAsset("click")).toBe(decodedBuffer);
  });

  it("does not repopulate the cache when an in-flight decode is unloaded", async () => {
    vi.resetModules();

    let resolveDecode;
    const decodedBuffer = { decoded: true };
    const context = {
      decodeAudioData: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveDecode = () => resolve(decodedBuffer);
          }),
      ),
    };
    window.AudioContext = vi.fn(function AudioContextMock() {
      return context;
    });
    window.webkitAudioContext = undefined;
    const { AudioAsset } = await import("../../src/AudioAsset.js");
    const loadPromise = AudioAsset.load(
      "voice-line",
      new Uint8Array([1, 2, 3]).buffer,
    );

    expect(AudioAsset.unload("voice-line")).toBe(true);
    resolveDecode();
    await expect(loadPromise).resolves.toBe(decodedBuffer);

    expect(AudioAsset.getAsset("voice-line")).toBeUndefined();
  });

  it("rejects decode failures with asset context and root cause", async () => {
    vi.resetModules();

    const context = {
      decodeAudioData: vi.fn(() =>
        Promise.reject(new Error("unsupported codec")),
      ),
    };
    window.AudioContext = vi.fn(function AudioContextMock() {
      return context;
    });
    window.webkitAudioContext = undefined;

    const { AudioAsset } = await import("../../src/AudioAsset.js");
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;

    let thrownError;
    try {
      await AudioAsset.load("voice-line", arrayBuffer);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError?.message).toBe(
      'Could not load audio "voice-line". Unsupported or damaged audio file.',
    );
    expect(thrownError?.details).toEqual(
      expect.objectContaining({
        assetKey: "voice-line",
        assetKind: "audio",
        phase: "decode",
        cause: "unsupported codec",
      }),
    );
  });
});
