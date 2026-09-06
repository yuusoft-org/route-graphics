import {
  decodeOggToAudioBuffer,
  isOggAudioType,
  prepareOggDecoders,
} from "./audio/oggDecoderFallback.js";
import { getAudioContext } from "./audioContext.js";

const loadedAssets = Object.create(null);
const loadingAssets = Object.create(null);

const prepareDecoders = async (assetMap) => {
  await prepareOggDecoders(assetMap);
};
const getErrorMessage = (error) => {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
};

const createAudioDecodeError = (key, error) => {
  const rootCauseMessage = "Unsupported or damaged audio file.";
  const message = `Could not load audio "${key}". ${rootCauseMessage}`;
  const audioError = new Error(message, {
    cause: error,
  });

  audioError.userMessage = message;
  audioError.rootCauseMessage = rootCauseMessage;
  audioError.details = {
    assetKey: key,
    assetKind: "audio",
    phase: "decode",
    cause: getErrorMessage(error),
  };

  return audioError;
};

const decodeAudio = async ({ key, arrayBuffer, type, audioContext }) => {
  try {
    return await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } catch (nativeDecodeError) {
    if (!isOggAudioType(type)) {
      throw createAudioDecodeError(key, nativeDecodeError);
    }

    try {
      return await decodeOggToAudioBuffer({
        arrayBuffer,
        audioContext,
      });
    } catch (fallbackError) {
      throw createAudioDecodeError(key, fallbackError);
    }
  }
};

const load = (key, arrayBuffer, type) => {
  if (loadedAssets[key]) {
    return loadedAssets[key];
  }
  if (loadingAssets[key]) {
    return loadingAssets[key];
  }
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return;
  }

  const context = getAudioContext();
  const loadPromise = decodeAudio({
    key,
    arrayBuffer,
    type,
    audioContext: context,
  })
    .then((audioBuffer) => {
      if (loadingAssets[key] === loadPromise) {
        loadedAssets[key] = audioBuffer;
      }
      return audioBuffer;
    })
    .finally(() => {
      if (loadingAssets[key] === loadPromise) {
        delete loadingAssets[key];
      }
    });

  loadingAssets[key] = loadPromise;
  return loadPromise;
};

const getAsset = (url) => {
  const arrayBuffer = loadedAssets[url];
  return arrayBuffer;
};

const getAssetPromise = (url) => loadingAssets[url];

const unload = (key) => {
  const hadAsset = !!loadedAssets[key] || !!loadingAssets[key];
  delete loadedAssets[key];
  delete loadingAssets[key];
  return hadAsset;
};

export const AudioAsset = {
  prepareDecoders,
  load,
  getAsset,
  getAssetPromise,
  unload,
};
