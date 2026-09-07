import {
  Application,
  Assets,
  Graphics,
  Texture,
  Rectangle,
  VideoSource,
  detectVideoAlphaMode,
} from "pixi.js";
import "./renderer/pixi/cspCompatibility.js";
import {
  sharedTextureAssetOwners,
  sharedTextureAliasOwners,
  sharedUrlTextureAssetOwners,
  sharedPendingTextureLoads,
  sharedAudioAssetOwners,
  retainSharedOwnership,
  retainSharedAsset,
  releaseSharedAsset,
  trackPendingLoad,
} from "./assets/sharedAssetOwnership.js";
import { createAudioStage } from "./AudioStage.js";
import parseElements from "./plugins/elements/parseElements.js";
import { AudioAsset } from "./AudioAsset.js";
import { renderElements } from "./plugins/elements/renderElements.js";
import { renderAudio } from "./plugins/audio/renderAudio.js";
import { clearPendingSounds } from "./plugins/audio/sound/addSound.js";
import { createParserPlugin } from "./plugins/elements/parserPlugin.js";
import { createKeyboardManager } from "./util/keyboardManager.js";
import { createAnimationBus } from "./plugins/animations/animationBus.js";
import { createCompletionTracker } from "./util/completionTracker.js";
import { normalizeRenderState } from "./util/normalizeRenderState.js";
import { isDeepEqual } from "./util/isDeepEqual.js";
import { createInputDomBridge } from "./util/inputDomBridge.js";
import { buildAnimationContinuityPlan } from "./plugins/animations/planAnimations.js";
import { cleanupParticlesInTree } from "./plugins/elements/particles/particleRuntime.js";
import {
  captureManagedVideoSpriteSizes,
  clearManagedVideoSprites,
  restoreManagedVideoSpriteSizes,
} from "./plugins/elements/video/managedVideoTextureSizing.js";
import { hitTestElementBounds as hitTestElementBoundsInTree } from "./util/hitTestElementBounds.js";
import { setShaderTimeInTree } from "./plugins/elements/util/shaderFilterEffect.js";
import { validateShaderAnimationBindings } from "./plugins/elements/util/shaderStateValidation.js";
import { validateShaderProgramsForRenderer } from "./renderer/pixi/shaderProgramValidation.js";
import { createLayoutReport } from "./util/layoutReport.js";

/**
 * @typedef {import('./types.js').RouteGraphicsInitOptions} RouteGraphicsInitOptions
 * @typedef {import('./types.js').RouteGraphicsState} RouteGraphicsState
 * @typedef {import('./types.js').RouteGraphicsPlugins} RouteGraphicsPlugins
 * @typedef {import('./types.js').BaseElement} BaseElement
 */

/**
 * @typedef {Object} ApplicationWithAudioStageOptions
 * @property {ReturnType<typeof createAudioStage>} audioStage
 * @property {ReturnType<typeof createInputDomBridge>} [inputDomBridge]
 * @typedef {Application & ApplicationWithAudioStageOptions} ApplicationWithAudioStage
 */

const createRouteGraphics = () => {
  const VIDEO_TEXTURE_UPDATE_FPS = 30;

  const isRenderableVideoFrameReady = (video) => {
    const haveCurrentData = window.HTMLMediaElement?.HAVE_CURRENT_DATA ?? 2;

    return (
      video.readyState >= haveCurrentData &&
      video.videoWidth > 0 &&
      video.videoHeight > 0
    );
  };

  const getVideoTextureDimension = (value) =>
    Number.isFinite(value) && value > 0 ? value : 1;

  const hasVideoDimensions = (video) =>
    video.videoWidth > 0 && video.videoHeight > 0;

  const syncVideoTextureSourceSize = (source, video) => {
    if (
      source.width === video.videoWidth &&
      source.height === video.videoHeight
    ) {
      return;
    }

    const spriteSizes = captureManagedVideoSpriteSizes(source);

    source.resize?.(video.videoWidth, video.videoHeight);
    restoreManagedVideoSpriteSizes(spriteSizes);
  };

  const createVideoTextureSource = (video, alphaMode) =>
    new VideoSource({
      resource: video,
      width: getVideoTextureDimension(video.videoWidth),
      height: getVideoTextureDimension(video.videoHeight),
      autoLoad: false,
      autoPlay: false,
      alphaMode,
      crossorigin: "anonymous",
      muted: false,
      playsinline: true,
    });

  const configureManagedVideoTextureUpdates = (texture) => {
    const source = texture?.source;
    const video = source?.resource;

    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    if (source.__routeGraphicsVideoTextureRuntime) {
      return;
    }

    let frameId;
    let videoFrameCallbackId;
    let lastUpdateTime = 0;
    let hasUploadedVideoFrame = false;
    const frameIntervalMS = 1000 / VIDEO_TEXTURE_UPDATE_FPS;

    const updateSource = ({ force = false } = {}) => {
      if (
        source.destroyed ||
        (force
          ? !hasVideoDimensions(video)
          : !isRenderableVideoFrameReady(video))
      ) {
        return false;
      }

      // A metadata-only upload can leave placeholder GPU storage behind. Once
      // a decoded frame is presented, allocate it again at the real dimensions.
      if (force && !hasUploadedVideoFrame) {
        source.unload();
        hasUploadedVideoFrame = true;
      }

      syncVideoTextureSourceSize(source, video);
      source.update();
      return true;
    };

    const cancelFrame = () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
        frameId = undefined;
      }
    };

    const cancelVideoFrameCallback = () => {
      if (
        videoFrameCallbackId !== undefined &&
        typeof video.cancelVideoFrameCallback === "function"
      ) {
        video.cancelVideoFrameCallback(videoFrameCallbackId);
      }

      videoFrameCallbackId = undefined;
    };

    const updateSourceFromVideoFrame = () => {
      updateSource({ force: true });
    };

    const scheduleVideoFrameCallback = () => {
      if (
        videoFrameCallbackId !== undefined ||
        typeof video.requestVideoFrameCallback !== "function"
      ) {
        return false;
      }

      videoFrameCallbackId = video.requestVideoFrameCallback(() => {
        videoFrameCallbackId = undefined;
        updateSourceFromVideoFrame();

        if (!video.paused && !video.ended && !source.destroyed) {
          scheduleVideoFrameCallback();
        }
      });

      return true;
    };

    const updateSourceFromMediaEvent = () => {
      updateSource();
    };

    const stop = () => {
      cancelFrame();
      cancelVideoFrameCallback();
      updateSource();
    };

    const tick = (time) => {
      frameId = undefined;
      if (video.paused || video.ended || source.destroyed) {
        return;
      }

      if (time - lastUpdateTime >= frameIntervalMS) {
        lastUpdateTime = time;
        updateSource();
      }

      frameId = window.requestAnimationFrame(tick);
    };

    const start = () => {
      updateSource();

      if (scheduleVideoFrameCallback()) {
        return;
      }

      if (frameId === undefined) {
        lastUpdateTime = 0;
        frameId = window.requestAnimationFrame(tick);
      }
    };

    const cleanup = () => {
      cancelFrame();
      cancelVideoFrameCallback();
      video.removeEventListener("play", start);
      video.removeEventListener("playing", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("ended", stop);
      video.removeEventListener("loadeddata", updateSourceFromMediaEvent);
      video.removeEventListener("canplay", updateSourceFromMediaEvent);
      video.removeEventListener("canplaythrough", updateSourceFromMediaEvent);
      video.removeEventListener("seeked", updateSourceFromMediaEvent);
      video.removeEventListener("timeupdate", updateSourceFromMediaEvent);
      clearManagedVideoSprites(source);
      source.__routeGraphicsVideoTextureRuntime = undefined;
    };

    video.addEventListener("play", start);
    video.addEventListener("playing", start);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);
    video.addEventListener("loadeddata", updateSourceFromMediaEvent);
    video.addEventListener("canplay", updateSourceFromMediaEvent);
    video.addEventListener("canplaythrough", updateSourceFromMediaEvent);
    video.addEventListener("seeked", updateSourceFromMediaEvent);
    video.addEventListener("timeupdate", updateSourceFromMediaEvent);
    source.once("destroy", cleanup);
    texture.once("destroy", cleanup);

    source.__routeGraphicsVideoTextureRuntime = {
      cleanup,
      requestUpdate: updateSource,
    };
    updateSource();
  };

  const assertAnimationPlaybackMode = (mode) => {
    if (mode !== "auto" && mode !== "manual") {
      throw new Error(
        `Invalid animation playback mode "${mode}". Expected "auto" or "manual".`,
      );
    }
  };

  const assertRendererPreference = (preference) => {
    if (preference !== "webgl" && preference !== "webgpu") {
      throw new Error(
        `Invalid renderer preference "${preference}". Expected "webgl" or "webgpu".`,
      );
    }
  };

  /**
   * @type {ApplicationWithAudioStage}
   */
  let app;

  /**
   * @type {AudioStage}
   */
  const audioStage = createAudioStage();

  let needsReconciliation = false;
  /**
   * @type {RouteGraphicsState}
   */
  let state = {
    elements: [],
    animations: [],
    audio: [],
    audioEffects: [],
  };

  /**
   * @type {Function}
   */
  let eventHandler;

  /**
   * @type {RouteGraphicsPlugins & { parsers: Function[] }}
   */
  let plugins = {
    elements: [],
    audio: [],
    parsers: [],
  };

  /**
   * @type {ReturnType<typeof createKeyboardManager>}
   */
  let keyboardManager;

  /**
   * @type {ReturnType<typeof createAnimationBus>}
   */
  let animationBus;

  /**
   * @type {ReturnType<typeof createCompletionTracker>}
   */
  let completionTracker;

  /**
   * @type {Function|undefined}
   */
  let onFirstRenderCallback;

  /**
   * @type {boolean}
   */
  let hasRenderedOnce = false;

  /**
   * @type {AbortController|undefined}
   */
  let renderAbortController;

  /**
   * @type {Function|undefined}
   */
  let debugAnimationListener;

  /**
   * Drives animation updates and presents the current frame.
   * @type {Function|undefined}
   */
  let frameTickerListener;

  /**
   * @type {"auto" | "manual"}
   */
  let animationPlaybackMode = "auto";

  /**
   * @type {number | null}
   */
  let animationPlaybackTimeMS = null;

  /**
   * Deterministic shader clock, in milliseconds.
   * @type {number}
   */
  let shaderTimeMS = 0;

  /**
   * Requested and selected renderer backend.
   * @type {"webgl" | "webgpu"}
   */
  let rendererPreference = "webgl";
  let selectedRendererType = "webgl";

  /**
   * @type {Function[]}
   */
  let animationBusListenerCleanup = [];

  /**
   * @type {(event: MouseEvent) => void | undefined}
   */
  let canvasContextMenuListener;

  /**
   * @type {(event: Event) => void | undefined}
   */
  let canvasWebglContextLostListener;

  /**
   * @type {(event: Event) => void | undefined}
   */
  let canvasWebglContextRestoredListener;

  /**
   * Identity token used to ignore a WebGPU device-loss promise after destroy.
   * @type {object|undefined}
   */
  let webgpuDeviceLossSubscription;

  /**
   * Assets created by this Route Graphics instance and eligible for explicit
   * unload. Known entries owned by another Route Graphics instance are
   * retained as shared; unrelated external cache entries remain borrowed.
   * @type {Map<string, { category: string, value?: unknown, sharedOwnership?: object, released?: boolean }>}
   */
  const loadedAssetRecords = new Map();

  /**
   * Loads currently running for this instance, keyed by their public asset ID.
   * unloadAssets waits for these promises so an unload request always wins a
   * race with a pending load.
   * @type {Map<string, Promise<unknown>>}
   */
  const pendingAssetLoads = new Map();

  /**
   * Video source URLs created or attached in loadAssets; revokable blob URLs
   * are cleaned up on destroy.
   * @type {Map<string, { url: string, revokable: boolean }>}
   */
  const videoSourceUrls = new Map();

  /**
   * Visible stage background graphic.
   * @type {Graphics|undefined}
   */
  let backgroundGraphic;

  const drawBackgroundGraphic = (graphic, width, height, color) => {
    graphic.clear();
    graphic.rect(0, 0, width, height);
    graphic.fill(color ?? 0x000000);
  };

  /**
   * Classify asset by type
   * @param {string} mimeType - The MIME type of the asset
   * @returns {string} Asset category
   */
  const classifyAsset = (mimeType) => {
    if (!mimeType) return "texture";

    const normalizedMimeType = mimeType.split(";")[0].trim().toLowerCase();

    if (
      normalizedMimeType.startsWith("audio/") ||
      normalizedMimeType === "application/ogg"
    ) {
      return "audio";
    }

    if (
      normalizedMimeType.startsWith("font/") ||
      [
        "application/font-woff",
        "application/font-woff2",
        "application/x-font-ttf",
        "application/x-font-otf",
      ].includes(normalizedMimeType)
    ) {
      return "font";
    }

    if (normalizedMimeType.startsWith("video/")) return "video";

    return "texture";
  };

  const inferAudioTypeFromUrl = (url) => {
    if (typeof url !== "string") return "audio/mpeg";

    const pathWithoutQuery = url.split("?")[0].split("#")[0].toLowerCase();
    if (
      pathWithoutQuery.endsWith(".ogg") ||
      pathWithoutQuery.endsWith(".oga")
    ) {
      return "audio/ogg";
    }
    if (pathWithoutQuery.endsWith(".m4a")) return "audio/mp4";
    if (pathWithoutQuery.endsWith(".aac")) return "audio/aac";
    if (pathWithoutQuery.endsWith(".wav")) return "audio/wav";
    if (pathWithoutQuery.endsWith(".flac")) return "audio/flac";

    return "audio/mpeg";
  };

  const getErrorMessage = (error) => {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;
    return error.message || String(error);
  };

  const truncateErrorValue = (value, maxLength = 180) => {
    if (typeof value !== "string") return undefined;
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1)}...`;
  };

  const getBufferByteLength = (buffer) => {
    if (!buffer) return 0;
    if (typeof buffer.byteLength === "number") return buffer.byteLength;
    return 0;
  };

  const getAssetKindLabel = (category, asset = {}) => {
    if (category === "texture") {
      return asset.type?.startsWith("image/") ? "image" : "visual asset";
    }

    return category || "asset";
  };

  const getHttpStatusCode = (message) => {
    const match = message.match(/HTTP\s+(\d{3})/);
    return match?.[1];
  };

  const getVideoElementCauseMessage = (causeMessage) => {
    if (/Timed out loading video asset/i.test(causeMessage)) {
      return "Timed out while loading video metadata.";
    }

    if (!/Failed to load video asset/i.test(causeMessage)) {
      return undefined;
    }

    const details = causeMessage.match(/\((.*)\)\.?$/)?.[1];
    return details
      ? `Video element failed to load (${details}).`
      : "Video element failed to load.";
  };

  const getFriendlyCauseMessage = ({ category, phase, error }) => {
    if (error?.rootCauseMessage) {
      return error.rootCauseMessage;
    }

    const causeMessage = getErrorMessage(error);
    const httpStatusCode = getHttpStatusCode(causeMessage);

    if (httpStatusCode === "404") {
      return "File not found.";
    }

    if (httpStatusCode === "401" || httpStatusCode === "403") {
      return "Access denied.";
    }

    if (httpStatusCode?.startsWith("5")) {
      return "File server error.";
    }

    if (/URL is missing/i.test(causeMessage)) {
      return "Missing file URL.";
    }

    if (/missing or empty/i.test(causeMessage)) {
      return "Missing file data.";
    }

    if (category === "audio" || /decode/i.test(causeMessage)) {
      return "Unsupported or damaged audio file.";
    }

    if (category === "font") {
      return "Unsupported or damaged font file.";
    }

    if (category === "video") {
      return (
        getVideoElementCauseMessage(causeMessage) ??
        "Unsupported, damaged, or inaccessible video file."
      );
    }

    if (category === "texture" && phase === "image bitmap creation") {
      return "Unsupported or damaged image file.";
    }

    if (category === "texture") {
      return "Missing, inaccessible, or unsupported image file.";
    }

    return "File could not be loaded.";
  };

  const getAssetErrorDetails = ({
    key,
    kind,
    category,
    phase,
    asset,
    error,
  }) => {
    const details = {
      assetKey: key,
      assetKind: kind,
      assetCategory: category,
      phase,
      cause: getErrorMessage(error),
    };

    if (asset?.type) details.type = asset.type;
    if (asset?.source) details.source = asset.source;
    if (asset?.url) details.url = truncateErrorValue(asset.url);
    if (asset?.buffer) details.bufferBytes = getBufferByteLength(asset.buffer);

    return details;
  };

  const createAssetLoadError = ({ key, category, phase, asset, error }) => {
    const kind = getAssetKindLabel(category, asset);
    const rootCauseMessage = getFriendlyCauseMessage({
      category,
      phase,
      error,
    });
    const message = `Could not load ${kind} "${key}". ${rootCauseMessage}`;
    const assetError = new Error(message, { cause: error });

    assetError.userMessage = message;
    assetError.rootCauseMessage = rootCauseMessage;
    assetError.details = getAssetErrorDetails({
      key,
      kind,
      category,
      phase,
      asset,
      error,
    });

    return assetError;
  };

  const loadAssetWithContext = async (
    { key, category, phase, asset },
    load,
  ) => {
    try {
      return await load();
    } catch (error) {
      throw createAssetLoadError({
        key,
        category,
        phase,
        asset,
        error,
      });
    }
  };

  const assertAssetBuffer = (asset, category) => {
    if (getBufferByteLength(asset?.buffer) === 0) {
      throw new Error(`${category} asset data is missing or empty.`);
    }
  };

  const quoteAssetName = (value) => {
    if (!value) return "unknown";
    return `"${String(value).replaceAll('"', '\\"')}"`;
  };

  const formatAssetFailureName = (failure) => {
    const { assetKind, assetKey } = failure?.details || {};
    if (!assetKey) return "unknown asset";
    if (!assetKind) return quoteAssetName(assetKey);
    return `${assetKind} ${quoteAssetName(assetKey)}`;
  };

  const formatAssetFailureNames = (failures) => {
    const maxVisibleFailures = 3;
    const visibleNames = failures
      .slice(0, maxVisibleFailures)
      .map(formatAssetFailureName);
    const hiddenCount = failures.length - visibleNames.length;
    const suffix = hiddenCount > 0 ? `, and ${hiddenCount} more` : "";

    return `${visibleNames.join(", ")}${suffix}`;
  };

  const formatAssetFailureCauses = (failures) => {
    const maxVisibleFailures = 3;
    const visibleCauses = failures
      .slice(0, maxVisibleFailures)
      .map((failure) => {
        const name = formatAssetFailureName(failure);
        const cause =
          failure?.rootCauseMessage ||
          failure?.details?.cause ||
          getErrorMessage(failure);

        return `${name}: ${truncateErrorValue(cause)}`;
      });
    const hiddenCount = failures.length - visibleCauses.length;
    const suffix = hiddenCount > 0 ? `, and ${hiddenCount} more` : "";

    return `${visibleCauses.join("; ")}${suffix}`;
  };

  const throwAssetLoadFailures = (settledResults) => {
    const failures = settledResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);

    if (failures.length === 0) {
      return;
    }

    if (failures.length === 1) {
      throw failures[0];
    }

    const rootCauseMessage = formatAssetFailureCauses(failures);
    const message = `Could not load ${failures.length} assets: ${formatAssetFailureNames(failures)}. ${rootCauseMessage}`;
    const aggregateError = new AggregateError(failures, message);

    aggregateError.userMessage = message;
    aggregateError.rootCauseMessage = rootCauseMessage;
    aggregateError.details = {
      failures: failures.map(
        (failure) =>
          failure?.details || {
            cause: getErrorMessage(failure),
          },
      ),
    };

    throw aggregateError;
  };

  const trackVideoSourceUrl = (key, url, { revokable = false } = {}) => {
    videoSourceUrls.set(key, {
      url,
      revokable,
    });
  };

  const revokeVideoSourceUrl = (key) => {
    const value = videoSourceUrls.get(key);
    if (value?.revokable === true && typeof value?.url === "string") {
      URL.revokeObjectURL(value.url);
    }
    videoSourceUrls.delete(key);
  };

  const recordLoadedAsset = (key, record) => {
    loadedAssetRecords.set(key, record);
    return record.value;
  };

  const trackAssetLoad = (key, load) =>
    trackPendingLoad(pendingAssetLoads, key, load);
  const trackSharedTextureLoad = (identity, load) =>
    trackPendingLoad(sharedPendingTextureLoads, identity, load);

  const loadAudioRecord = async (key, loadSource) => {
    const existingRecord = loadedAssetRecords.get(key);
    if (existingRecord?.category === "audio") return existingRecord.value;
    const cached = AudioAsset.getAsset(key);
    const borrowed = !sharedAudioAssetOwners.has(key) && cached !== undefined;
    // Retain before the first await: another instance may unload while this
    // instance prepares decoders or awaits an already-cached audio buffer.
    const ownership = retainSharedAsset({
      registry: sharedAudioAssetOwners,
      identity: key,
      value: cached,
      dispose: borrowed ? undefined : () => AudioAsset.unload(key),
    });
    try {
      let value = cached;
      if (value === undefined) {
        const source = loadSource();
        const asset =
          source && typeof source.then === "function" ? await source : source;
        assertAssetBuffer(asset, "Audio");
        await AudioAsset.prepareDecoders?.({ [key]: asset });
        value = await AudioAsset.load(key, asset.buffer, asset.type);
      }
      ownership.value = value;
      return recordLoadedAsset(key, {
        category: "audio",
        value,
        sharedOwnership: ownership,
      });
    } catch (error) {
      try {
        await releaseSharedAsset(ownership);
      } catch {
        /* Preserve the load failure. */
      }
      throw error;
    }
  };

  const getTexturePrimaryValue = (value) =>
    Array.isArray(value) ? value[0] : value;

  const recordLoadedTexture = (
    key,
    record,
    {
      dispose,
      ownership: reservedOwnership,
      ownershipAlreadyRetained = false,
      cacheAliasInstalled = false,
    } = {},
  ) => {
    const ownership = reservedOwnership
      ? ownershipAlreadyRetained
        ? reservedOwnership
        : retainSharedOwnership(reservedOwnership)
      : retainSharedAsset({
          registry: sharedTextureAssetOwners,
          identity: record.value,
          value: record.value,
          dispose,
        });
    ownership.aliasRecords ??= new Map();

    let aliasRecord = ownership.aliasRecords.get(key);
    if (!aliasRecord) {
      aliasRecord = {
        referenceCount: 0,
        cacheAliasInstalled: false,
        primaryValue: getTexturePrimaryValue(record.value),
      };
      ownership.aliasRecords.set(key, aliasRecord);
    }
    aliasRecord.referenceCount += 1;
    if (cacheAliasInstalled) {
      aliasRecord.cacheAliasInstalled = true;
      aliasRecord.primaryValue = getTexturePrimaryValue(record.value);
    }

    sharedTextureAliasOwners.set(key, ownership);
    record.sharedOwnership = ownership;

    return recordLoadedAsset(key, record);
  };

  const recordSharedTextureLoadResult = (key, category, result) => {
    const aliasOwnership = sharedTextureAliasOwners.get(key);
    const ownership =
      (aliasOwnership &&
      getTexturePrimaryValue(aliasOwnership.value) ===
        getTexturePrimaryValue(result.value)
        ? aliasOwnership
        : undefined) ?? sharedTextureAssetOwners.get(result.value);

    if (!result.created && !ownership) {
      return result.value;
    }

    return recordLoadedTexture(
      key,
      {
        category,
        value: ownership?.value ?? result.value,
      },
      ownership
        ? {
            ownership,
            cacheAliasInstalled: result.cacheAliasInstalled,
          }
        : {
            dispose: result.dispose,
            cacheAliasInstalled: result.cacheAliasInstalled,
          },
    );
  };

  const releaseTextureResource = (resource) => {
    const isVideoElement =
      resource?.nodeName === "VIDEO" ||
      (typeof HTMLVideoElement !== "undefined" &&
        resource instanceof HTMLVideoElement);
    if (isVideoElement) {
      resource.pause();
      resource.removeAttribute("src");
      resource.querySelectorAll("source").forEach((source) => source.remove());
      resource.load();
      return;
    }

    if (typeof resource?.close === "function") {
      resource.close();
    }
  };

  const getTextureResources = (value) => {
    const resources = new Set();
    const textures = Array.isArray(value) ? value : [value];

    for (const texture of textures) {
      const resource = texture?.source?.resource;
      if (resource) {
        resources.add(resource);
      }
    }

    return resources;
  };

  const getCanonicalTextureSource = (sourceUrl) => {
    let resolvedSource = sourceUrl;

    try {
      resolvedSource = Assets.resolver?.resolve?.(sourceUrl)?.src ?? sourceUrl;
    } catch {
      // Fall back to URL resolution when a custom resolver rejects an
      // unregistered source.
    }

    try {
      const baseUrl =
        (typeof document !== "undefined" ? document.baseURI : undefined) ??
        globalThis.location?.href;
      return new URL(resolvedSource, baseUrl).href;
    } catch {
      return resolvedSource;
    }
  };

  const createUrlTextureOwnership = (
    sourceUrl,
    sourceIdentity,
    waitForDisposal,
  ) => {
    const ownership = {
      sourceUrl,
      sourceIdentity,
      referenceCount: 0,
      aliasRecords: new Map(),
      disposing: false,
    };
    sharedUrlTextureAssetOwners.set(sourceIdentity, ownership);

    ownership.loadPromise = (async () => {
      if (waitForDisposal) {
        try {
          await waitForDisposal;
        } catch {
          // A successor load must run after disposal settles even if the
          // previous caller observes a disposal failure.
        }
      }

      const sourceWasAlreadyCached = Assets.cache.has(sourceUrl);
      const value = await Assets.load(sourceUrl);
      const resources = getTextureResources(value);

      ownership.value = value;
      sharedTextureAssetOwners.set(value, ownership);
      if (!sourceWasAlreadyCached) {
        ownership.dispose = async () => {
          try {
            await Assets.unload(sourceUrl);
          } finally {
            for (const resource of resources) {
              releaseTextureResource(resource);
            }
          }
        };
      }

      return value;
    })();

    ownership.onZeroReferences = async () => {
      ownership.disposing = true;
      if (
        ownership.value !== undefined &&
        sharedTextureAssetOwners.get(ownership.value) === ownership
      ) {
        sharedTextureAssetOwners.delete(ownership.value);
      }

      const disposalPromise = Promise.resolve().then(() =>
        ownership.dispose?.(),
      );
      ownership.disposalPromise = disposalPromise;

      try {
        await disposalPromise;
      } finally {
        if (sharedUrlTextureAssetOwners.get(sourceIdentity) === ownership) {
          sharedUrlTextureAssetOwners.delete(sourceIdentity);
        }
      }
    };

    return ownership;
  };

  const reserveUrlTextureOwnership = (sourceUrl) => {
    const sourceIdentity = getCanonicalTextureSource(sourceUrl);
    let ownership = sharedUrlTextureAssetOwners.get(sourceIdentity);

    if (!ownership || ownership.disposing) {
      ownership = createUrlTextureOwnership(
        sourceUrl,
        sourceIdentity,
        ownership?.disposalPromise,
      );
    }

    return retainSharedOwnership(ownership);
  };

  const releaseTextureRecord = async (key, record) => {
    const ownership = record.sharedOwnership;
    const aliasRecord = ownership.aliasRecords.get(key);
    const remainingAliasReferences = (aliasRecord?.referenceCount ?? 1) - 1;

    if (remainingAliasReferences > 0) {
      aliasRecord.referenceCount = remainingAliasReferences;
    } else {
      ownership.aliasRecords.delete(key);
      if (sharedTextureAliasOwners.get(key) === ownership) {
        sharedTextureAliasOwners.delete(key);
      }
      if (
        aliasRecord?.cacheAliasInstalled === true &&
        Assets.cache.has(key) &&
        Assets.cache.get(key) === aliasRecord.primaryValue
      ) {
        Assets.cache.remove(key);
      }
    }

    await releaseSharedAsset(ownership);
  };

  const unloadAsset = async (key) => {
    const pendingLoad = pendingAssetLoads.get(key);
    if (pendingLoad) {
      try {
        await pendingLoad;
      } catch {
        // A failed load did not install an asset, so there is nothing left for
        // the racing unload request to release.
        return false;
      }
    }

    const record = loadedAssetRecords.get(key);
    if (!record || record.released === true) {
      return false;
    }

    record.released = true;
    if (loadedAssetRecords.get(key) === record) {
      loadedAssetRecords.delete(key);
    }

    if (record.category === "audio") {
      await releaseSharedAsset(record.sharedOwnership);
    } else if (record.category === "font") {
      document.fonts?.delete?.(record.value);
    } else if (record.category === "texture" || record.category === "video") {
      await releaseTextureRecord(key, record);
    }
    return true;
  };

  const loadVideoTexture = async ({ sourceUrl, mimeType }) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    const sourceElement = document.createElement("source");
    sourceElement.src = sourceUrl;
    if (typeof mimeType === "string" && mimeType.length > 0) {
      sourceElement.type = mimeType;
    }
    video.appendChild(sourceElement);
    video.load();

    const alphaMode = await detectVideoAlphaMode();
    const texture = new Texture({
      source: createVideoTextureSource(video, alphaMode),
      // Lazy video metadata changes the frame and the sprite's geometry.
      dynamic: true,
    });
    configureManagedVideoTextureUpdates(texture);

    return texture;
  };

  /**
   * Apply global cursor styles to the PixiJS application
   * @param {Application} appInstance - The PixiJS application instance
   * @param {GlobalConfiguration} [prevGlobal] - Previous global configuration
   * @param {GlobalConfiguration} [nextGlobal] - Next global configuration
   */
  const applyGlobalObjects = (appInstance, prevGlobal, nextGlobal) => {
    if (keyboardManager) {
      keyboardManager.registerHotkeys(nextGlobal?.keyboard ?? {});
    }

    // Initialize default cursor styles if they don't exist
    if (!appInstance.renderer.events.cursorStyles) {
      appInstance.renderer.events.cursorStyles = {};
    }
    if (!appInstance.renderer.events.cursorStyles.default) {
      appInstance.renderer.events.cursorStyles.default = "default";
    }
    if (!appInstance.renderer.events.cursorStyles.hover) {
      appInstance.renderer.events.cursorStyles.hover = "pointer";
    }

    const prevCursorStyles = prevGlobal?.cursorStyles;
    const nextCursorStyles = nextGlobal?.cursorStyles;

    // Only update if cursor styles have changed
    if (!isDeepEqual(prevCursorStyles, nextCursorStyles)) {
      if (nextCursorStyles) {
        // Apply new cursor styles
        if (nextCursorStyles.default) {
          appInstance.renderer.events.cursorStyles.default =
            nextCursorStyles.default;
          // Also set canvas cursor directly
          appInstance.canvas.style.cursor = nextCursorStyles.default;
        }
        if (nextCursorStyles.hover) {
          appInstance.renderer.events.cursorStyles.hover =
            nextCursorStyles.hover;
        }
      } else if (prevCursorStyles) {
        // Reset to default cursor styles if global config was removed
        appInstance.renderer.events.cursorStyles.default = "default";
        appInstance.renderer.events.cursorStyles.hover = "pointer";
      }
    }
  };

  /**
   * Render function (synchronous public API, with internal async cancellation).
   * @param {Application} appInstance
   * @param {RouteGraphicsState} nextState
   * @param {Function} handler
   */
  const renderInternal = (appInstance, parent, nextState, handler) => {
    if (!needsReconciliation && isDeepEqual(state, nextState)) {
      if (typeof appInstance.render === "function") {
        appInstance.render();
      }

      return;
    }

    appInstance.audioStage?.validateGraphTransition?.({
      prevAudio: state.audio,
      nextAudio: nextState.audio,
      prevAudioEffects: state.audioEffects,
      nextAudioEffects: nextState.audioEffects,
    });

    const continuityPlan = buildAnimationContinuityPlan({
      prevState: state,
      nextState,
      activeAnimations: animationBus.getContinuableAnimations(),
    });

    if (renderAbortController) {
      renderAbortController.abort();
    }
    renderAbortController = new AbortController();
    const signal = renderAbortController.signal;

    // Reset completion tracker for new state (emits aborted if previous had pending)
    completionTracker.reset(nextState.id);
    if (signal.aborted) return;
    const version = completionTracker.getVersion();
    needsReconciliation = false;
    const isCurrent = () =>
      !signal.aborted && completionTracker.getVersion() === version;
    const failRender = (error) => {
      if (!isCurrent()) return;
      needsReconciliation = true;
      // Keep the last applied frame as the diff baseline. Async mount failure
      // does not undo changes already presented to existing elements or cursors.
      completionTracker.fail(version, error);
    };
    // Hold a root reservation so a rejecting plugin cannot release its own
    // reservation and announce success before its rejection reaches us.
    completionTracker.track(version);
    try {
      applyGlobalObjects(appInstance, state.global, nextState.global);

      // Cancel any running animation that is not explicitly continuing.
      animationBus.cancelAllExcept(continuityPlan.continuedAnimationIds);
      if (!isCurrent()) return;

      const renderOperation = renderElements({
        app: appInstance,
        parent,
        prevComputedTree: state.elements,
        nextComputedTree: nextState.elements,
        animations: nextState.animations,
        elementPlugins: plugins.elements,
        animationBus,
        completionTracker,
        eventHandler: handler,
        signal,
        shaderTime: shaderTimeMS / 1000,
        getShaderTime: () => shaderTimeMS / 1000,
      });

      if (renderOperation && typeof renderOperation.then === "function")
        void Promise.resolve(renderOperation).catch(() => {});

      if (!isCurrent()) return;
      // Flush animation commands to apply initial values immediately
      animationBus.flush();
      if (!isCurrent()) return;

      if (
        animationPlaybackMode === "manual" &&
        animationPlaybackTimeMS !== null
      ) {
        animationBus.setTime(animationPlaybackTimeMS);
      }

      if (!isCurrent()) return;
      // Render audio
      renderAudio({
        app: appInstance,
        prevAudioTree: state.audio,
        nextAudioTree: nextState.audio,
        prevAudioEffects: state.audioEffects,
        nextAudioEffects: nextState.audioEffects,
        audioPlugins: plugins.audio,
        eventHandler: handler,
      });

      // Present the updated stage immediately instead of relying on Pixi's
      // implicit auto-render loop, which can fail in VT/manual browser runs.
      if (typeof appInstance.render === "function") {
        setShaderTimeInTree(appInstance.stage, shaderTimeMS / 1000);
        appInstance.render();
      }

      // Commit logical state only after the renderer accepts the frame.
      if (!isCurrent()) return;
      state = nextState;
      if (renderOperation && typeof renderOperation.then === "function") {
        void Promise.resolve(renderOperation)
          .then(() => {
            if (!isCurrent()) return;
            animationBus.flush();
            if (
              animationPlaybackMode === "manual" &&
              animationPlaybackTimeMS !== null
            ) {
              animationBus.setTime(animationPlaybackTimeMS);
            }
            if (!isCurrent()) return;
            appInstance.render?.();
            completionTracker.complete(version);
          })
          .catch(failRender);
      } else {
        completionTracker.complete(version);
      }

      // Fire stateComplete immediately if no animations/reveals to track
      completionTracker.completeIfEmpty();

      if (!hasRenderedOnce) {
        hasRenderedOnce = true;
        if (onFirstRenderCallback) {
          onFirstRenderCallback();
        }
      }
    } catch (error) {
      failRender(error);
      throw error;
    }
  };

  const routeGraphicsInstance = {
    rendererName: "pixi",

    get rendererType() {
      return selectedRendererType;
    },

    get canvas() {
      return app.canvas;
    },

    /** @param {string} targetLabel @returns {import("pixi.js").Container | null} */
    findElementByLabel: (targetLabel) => {
      return app.stage.getChildByLabel(targetLabel, true) ?? null;
    },

    /**
     * Return a serializable layout snapshot of the last committed state and
     * currently mounted text. Does not advance animation or trigger rendering.
     */
    getLayoutReport: () => {
      if (!app?.renderer) {
        throw new Error(
          "Route Graphics must be initialized before reporting layout.",
        );
      }
      return createLayoutReport({
        elements: state.elements ?? [],
        stage: app.stage,
        viewport: {
          width: app.screen.width,
          height: app.screen.height,
          resolution: app.renderer.resolution,
        },
      });
    },

    hitTestElementBounds: ({ x, y }) =>
      hitTestElementBoundsInTree({
        stage: app.stage,
        x,
        y,
      }),

    /** @param {string} [label] @returns {Promise<string>} */
    extractBase64: async (label) => {
      if (typeof app.render === "function") {
        setShaderTimeInTree(app.stage, shaderTimeMS / 1000);
        app.render();
      }

      const frame = new Rectangle(
        0,
        0,
        app.renderer.width,
        app.renderer.height,
      );
      if (!label) {
        return await app.renderer.extract.base64({ target: app.stage, frame });
      }
      const element = app.stage.getChildByLabel(label, true);
      if (!element) {
        throw new Error(`Element with label '${label}' not found`);
      }
      return await app.renderer.extract.base64({ target: element, frame });
    },

    assignStageEvent: (eventType, callback) => {
      app.stage.eventMode = "static";
      app.stage.on(eventType, callback);
    },

    resumeAudio: () => audioStage.resume(),

    setAnimationPlaybackMode: (mode) => {
      assertAnimationPlaybackMode(mode);

      animationPlaybackMode = mode;

      if (animationPlaybackMode !== "manual") {
        animationPlaybackTimeMS = null;
        animationBus?.clearTime?.();
      }
    },

    setAnimationTime: (timeMS) => {
      const nextTime = Number(timeMS);
      if (!Number.isFinite(nextTime)) {
        throw new Error("Animation time must be a finite number.");
      }

      if (animationPlaybackMode === "manual") {
        animationPlaybackTimeMS = nextTime;
      }

      shaderTimeMS = Math.max(0, nextTime);
      setShaderTimeInTree(app.stage, shaderTimeMS / 1000);
      animationBus.flush();
      animationBus.setTime(nextTime);

      if (animationPlaybackMode !== "manual") {
        animationPlaybackTimeMS = null;
        animationBus.clearTime();
      }

      if (typeof app.render === "function") {
        app.render();
      }
    },

    pauseAnimation: (animationId) => animationBus.pause(animationId),

    resumeAnimation: (animationId) => animationBus.resume(animationId),

    reverseAnimation: (animationId, enabled = true) =>
      animationBus.reverse(animationId, enabled),

    setAnimationDirection: (animationId, direction) => {
      if (direction !== "forward" && direction !== "reverse") {
        throw new Error(
          'Animation direction must be either "forward" or "reverse".',
        );
      }
      return animationBus.reverse(animationId, direction === "reverse");
    },

    seekAnimation: (animationId, timeMS, options = {}) => {
      const didSeek = animationBus.seek(animationId, timeMS, options);
      if (didSeek && typeof app.render === "function") {
        app.render();
      }
      return didSeek;
    },

    setAnimationProgress: (animationId, progress, options = {}) => {
      const didSeek = animationBus.setProgress(animationId, progress, options);
      if (didSeek && typeof app.render === "function") {
        app.render();
      }
      return didSeek;
    },

    setAnimationSpeed: (animationId, speed) =>
      animationBus.setSpeed(animationId, speed),

    getAnimationState: (animationId) => {
      const animationState = animationBus.getState();
      if (animationId === undefined) return animationState;
      return (
        animationState.animations.find(
          (animation) => animation.id === animationId,
        ) ?? null
      );
    },

    /**
     *
     * @param {RouteGraphicsInitOptions} options
     * @returns
     */
    init: async (options) => {
      const {
        eventHandler: handler,
        plugins: pluginConfig,
        width,
        height,
        backgroundColor,
        debug = false,
        onFirstRender,
        animationPlaybackMode: nextAnimationPlaybackMode = "auto",
        rendererPreference: nextRendererPreference = "webgl",
        rendererFallback = true,
      } = options;

      onFirstRenderCallback = onFirstRender;
      assertAnimationPlaybackMode(nextAnimationPlaybackMode);
      assertRendererPreference(nextRendererPreference);
      if (typeof rendererFallback !== "boolean") {
        throw new Error("rendererFallback must be a boolean.");
      }
      animationPlaybackMode = nextAnimationPlaybackMode;
      animationPlaybackTimeMS = null;
      shaderTimeMS = 0;
      rendererPreference = nextRendererPreference;
      animationBusListenerCleanup.forEach((cleanup) => cleanup());
      animationBusListenerCleanup = [];

      const parserPlugins = [];

      pluginConfig?.elements?.forEach((plugin) => {
        if (plugin?.parse)
          parserPlugins.push(
            createParserPlugin({ type: plugin.type, parse: plugin.parse }),
          );
      });

      plugins = {
        elements: pluginConfig?.elements ?? [],
        audio: pluginConfig?.audio ?? [],
        parsers: parserPlugins,
      };
      eventHandler = handler;

      keyboardManager = createKeyboardManager(handler);
      completionTracker = createCompletionTracker((event, payload) => {
        if (payload.failed) {
          needsReconciliation = true;
          renderAbortController?.abort();
          animationBus.cancelAll();
        }
        handler?.(event, payload);
      });

      /**
       * @type {ApplicationWithAudioStage}
       */
      app = new Application();
      app.audioStage = audioStage;
      await app.init({
        width,
        height,
        backgroundColor,
        preference: rendererPreference,
        preserveDrawingBuffer: debug === true,
      });
      selectedRendererType = app.renderer?.gpu != null ? "webgpu" : "webgl";
      if (!rendererFallback && selectedRendererType !== rendererPreference) {
        app.destroy();
        throw new Error(
          `Renderer "${rendererPreference}" is unavailable and rendererFallback is false.`,
        );
      }
      if (typeof app.ticker?.remove === "function") {
        app.ticker.remove(app.render, app);
      }
      app.debug = debug;
      app.inputDomBridge = createInputDomBridge({ app });
      canvasContextMenuListener = (event) => {
        event.preventDefault();
      };
      app.canvas.addEventListener("contextmenu", canvasContextMenuListener);
      canvasWebglContextLostListener = (event) => {
        event.preventDefault();
        const payload = {};
        if (
          typeof event.statusMessage === "string" &&
          event.statusMessage.length > 0
        ) {
          payload.statusMessage = event.statusMessage;
        }
        eventHandler?.("rendererContextLost", payload);
      };
      canvasWebglContextRestoredListener = () => {
        eventHandler?.("rendererContextRestored", {});
      };
      app.canvas.addEventListener(
        "webglcontextlost",
        canvasWebglContextLostListener,
      );
      app.canvas.addEventListener(
        "webglcontextrestored",
        canvasWebglContextRestoredListener,
      );

      const webgpuDeviceLost = app.renderer?.gpu?.device?.lost;
      if (webgpuDeviceLost && typeof webgpuDeviceLost.then === "function") {
        const subscription = {};
        webgpuDeviceLossSubscription = subscription;
        void Promise.resolve(webgpuDeviceLost).then(
          (deviceLostInfo) => {
            if (webgpuDeviceLossSubscription !== subscription) {
              return;
            }

            const payload = {};
            if (
              typeof deviceLostInfo?.reason === "string" &&
              deviceLostInfo.reason.length > 0
            ) {
              payload.reason = deviceLostInfo.reason;
            }
            if (
              typeof deviceLostInfo?.message === "string" &&
              deviceLostInfo.message.length > 0
            ) {
              payload.statusMessage = deviceLostInfo.message;
            }
            eventHandler?.("rendererContextLost", payload);
          },
          () => {
            // GPUDevice.lost resolves by specification. Ignore non-standard
            // thenables that reject so lifecycle observation cannot create an
            // unhandled rejection.
          },
        );
      }

      backgroundGraphic = new Graphics();
      backgroundGraphic.label = "__route_graphics_background__";
      drawBackgroundGraphic(backgroundGraphic, width, height, backgroundColor);
      app.stage.addChild(backgroundGraphic);
      app.stage.width = width;
      app.stage.height = height;
      app.ticker.add(app.audioStage.tick);

      // Create animation bus and attach to ticker
      animationBus = createAnimationBus();
      const renderManualFrame = () => {
        if (
          animationPlaybackMode === "manual" &&
          typeof app.render === "function"
        ) {
          app.render();
        }
      };
      animationBusListenerCleanup = [
        animationBus.on("started", renderManualFrame),
        animationBus.on("completed", renderManualFrame),
        animationBus.on("cancelled", renderManualFrame),
        animationBus.on("timelineEvent", (timelineEvent) => {
          eventHandler?.("timelineEvent", timelineEvent);
        }),
      ];
      if (!debug) {
        frameTickerListener = (time) => {
          if (animationPlaybackMode !== "auto") {
            return;
          }

          shaderTimeMS += time.deltaMS;
          setShaderTimeInTree(app.stage, shaderTimeMS / 1000);
          animationBus.tick(time.deltaMS);
          if (typeof app.render === "function") {
            app.render();
          }
        };
        app.ticker.add(frameTickerListener);
      } else {
        debugAnimationListener = (event) => {
          if (animationPlaybackMode !== "auto") {
            return;
          }

          if (event?.detail?.deltaMS) {
            const deltaMS = Number(event.detail.deltaMS);
            shaderTimeMS += deltaMS;
            setShaderTimeInTree(app.stage, shaderTimeMS / 1000);
            animationBus.tick(deltaMS);
            if (typeof app.render === "function") {
              app.render();
            }
          }
        };
        window.addEventListener("snapShotKeyFrame", debugAnimationListener);
      }

      return routeGraphicsInstance;
    },

    destroy: () => {
      if (renderAbortController) {
        renderAbortController.abort();
        renderAbortController = undefined;
      }
      if (debugAnimationListener) {
        window.removeEventListener("snapShotKeyFrame", debugAnimationListener);
        debugAnimationListener = undefined;
      }
      if (frameTickerListener && typeof app?.ticker?.remove === "function") {
        app.ticker.remove(frameTickerListener);
        frameTickerListener = undefined;
      }
      if (canvasContextMenuListener && app?.canvas) {
        app.canvas.removeEventListener(
          "contextmenu",
          canvasContextMenuListener,
        );
        canvasContextMenuListener = undefined;
      }
      if (canvasWebglContextLostListener && app?.canvas) {
        app.canvas.removeEventListener(
          "webglcontextlost",
          canvasWebglContextLostListener,
        );
        canvasWebglContextLostListener = undefined;
      }
      if (canvasWebglContextRestoredListener && app?.canvas) {
        app.canvas.removeEventListener(
          "webglcontextrestored",
          canvasWebglContextRestoredListener,
        );
        canvasWebglContextRestoredListener = undefined;
      }
      webgpuDeviceLossSubscription = undefined;

      const ownedAssetIds = new Set([
        ...loadedAssetRecords.keys(),
        ...pendingAssetLoads.keys(),
      ]);
      for (const assetId of ownedAssetIds) {
        void unloadAsset(assetId).catch(() => {
          // destroy is synchronous and best-effort; explicit unloadAssets calls
          // continue to surface disposal failures to the caller.
        });
      }

      app?.inputDomBridge?.destroy?.();
      keyboardManager?.destroy();
      clearPendingSounds();
      animationBusListenerCleanup.forEach((cleanup) => cleanup());
      animationBusListenerCleanup = [];
      if (animationBus) animationBus.destroy();
      if (app?.audioStage) app.audioStage.destroy();

      // Pause all video elements before destroying
      const pauseVideosRecursively = (container) => {
        for (const child of container.children) {
          const resource = child.texture?.source?.resource;
          if (resource instanceof HTMLVideoElement) {
            resource.pause();
          }
          if (child.children) {
            pauseVideosRecursively(child);
          }
        }
      };

      if (app?.stage) {
        pauseVideosRecursively(app.stage);
        cleanupParticlesInTree({ app, root: app.stage });
      }

      if (app) app.destroy(false, { children: true });
      animationPlaybackMode = "auto";
      animationPlaybackTimeMS = null;
      shaderTimeMS = 0;
      rendererPreference = "webgl";
      selectedRendererType = "webgl";
      backgroundGraphic = undefined;
    },

    /**
     * Load assets from either raw buffers or direct source URLs.
     * @param {Object<string, {buffer?: ArrayBuffer, url?: string, type: string, source?: string}>} assetBufferMap - Result from assetBufferManager.getBufferMap()
     * @returns {Promise<Array>} Promise that resolves to an array of loaded assets
     */
    loadAssets: async (assetBufferMap) => {
      if (!assetBufferMap) {
        throw new Error("assetBufferMap is required");
      }

      // Classify assets by type
      const assetsByType = {
        audio: {},
        font: {},
        video: {},
        texture: {}, // includes images and other PIXI-compatible assets
      };

      for (const [key, asset] of Object.entries(assetBufferMap)) {
        const assetType = classifyAsset(asset.type);
        assetsByType[assetType][key] = asset;
      }

      const audioAssets = Object.entries(assetsByType.audio);
      const loadJobs = [];

      audioAssets.forEach(([key, asset]) => {
        loadJobs.push({
          includeInReturn: false,
          promise: trackAssetLoad(key, () =>
            loadAssetWithContext(
              {
                key,
                category: "audio",
                phase: "decode",
                asset,
              },
              () => loadAudioRecord(key, () => asset),
            ),
          ),
        });
      });

      Object.entries(assetsByType.font).forEach(([key, asset]) => {
        loadJobs.push({
          includeInReturn: false,
          promise: trackAssetLoad(key, () =>
            loadAssetWithContext(
              {
                key,
                category: "font",
                phase: "font face load",
                asset,
              },
              async () => {
                const existingRecord = loadedAssetRecords.get(key);
                if (existingRecord?.category === "font") {
                  return existingRecord.value;
                }
                assertAssetBuffer(asset, "Font");
                const blob = new Blob([asset.buffer], { type: asset.type });
                const url = URL.createObjectURL(blob);
                // Use the key as font family name - this should match the fontFamily in text styles
                const fontFace = new FontFace(key, `url(${url})`);
                try {
                  await fontFace.load();
                  document.fonts.add(fontFace);
                  return recordLoadedAsset(key, {
                    category: "font",
                    value: fontFace,
                  });
                } finally {
                  URL.revokeObjectURL(url);
                }
              },
            ),
          ),
        });
      });

      Object.entries(assetsByType.texture).forEach(([key, asset]) =>
        loadJobs.push({
          includeInReturn: true,
          promise: trackAssetLoad(key, () =>
            loadAssetWithContext(
              {
                key,
                category: "texture",
                phase:
                  asset?.source === "url" && typeof asset?.url === "string"
                    ? "Pixi URL load"
                    : "image bitmap creation",
                asset,
              },
              async () => {
                const existingRecord = loadedAssetRecords.get(key);
                if (existingRecord?.category === "texture") {
                  return existingRecord.value;
                }
                if (Assets.cache.has(key)) {
                  const cachedPrimaryValue = Assets.cache.get(key);
                  const sourceUrl =
                    asset?.source === "url" && typeof asset?.url === "string"
                      ? asset.url
                      : undefined;
                  const sourceOwnership = sourceUrl
                    ? sharedUrlTextureAssetOwners.get(
                        getCanonicalTextureSource(sourceUrl),
                      )
                    : undefined;
                  const sourceTransitionInProgress =
                    sourceOwnership &&
                    (sourceOwnership.disposing ||
                      sourceOwnership.value === undefined);

                  if (!sourceTransitionInProgress) {
                    const aliasOwnership = sharedTextureAliasOwners.get(key);
                    const ownership =
                      (aliasOwnership &&
                      getTexturePrimaryValue(aliasOwnership.value) ===
                        cachedPrimaryValue
                        ? aliasOwnership
                        : undefined) ??
                      (sourceOwnership &&
                      getTexturePrimaryValue(sourceOwnership.value) ===
                        cachedPrimaryValue
                        ? sourceOwnership
                        : undefined) ??
                      sharedTextureAssetOwners.get(cachedPrimaryValue);

                    // A cache entry owned by Route Graphics is a shared
                    // resource, so this instance must retain it. Unknown
                    // external entries remain borrowed and are never destroyed
                    // by this instance.
                    if (ownership) {
                      return recordLoadedTexture(
                        key,
                        {
                          category: "texture",
                          value: ownership.value,
                        },
                        { ownership },
                      );
                    }
                    return cachedPrimaryValue;
                  }
                }

                if (asset?.source === "url" && typeof asset?.url === "string") {
                  const sourceUrl = asset.url;
                  const ownership = reserveUrlTextureOwnership(sourceUrl);
                  let cacheAliasInstalled = false;

                  try {
                    // Load by URL and add the logical key only to Pixi's cache.
                    // This avoids leaving a persistent resolver alias that
                    // would point a later reload at an expired signed URL.
                    const texture = await ownership.loadPromise;
                    if (key !== sourceUrl) {
                      Assets.cache.set(key, texture);
                      cacheAliasInstalled = true;
                    }

                    return recordLoadedTexture(
                      key,
                      {
                        category: "texture",
                        value: texture,
                      },
                      {
                        ownership,
                        ownershipAlreadyRetained: true,
                        cacheAliasInstalled,
                      },
                    );
                  } catch (error) {
                    if (
                      cacheAliasInstalled &&
                      Assets.cache.has(key) &&
                      Assets.cache.get(key) ===
                        getTexturePrimaryValue(ownership.value)
                    ) {
                      Assets.cache.remove(key);
                    }
                    await releaseSharedAsset(ownership);
                    throw error;
                  }
                }

                const result = await trackSharedTextureLoad(
                  `texture:${key}`,
                  async () => {
                    if (Assets.cache.has(key)) {
                      return {
                        value: Assets.cache.get(key),
                        created: false,
                        cacheAliasInstalled: false,
                      };
                    }

                    assertAssetBuffer(asset, "Texture");
                    const blob = new Blob([asset.buffer], {
                      type: asset.type,
                    });
                    const imageBitmap = await createImageBitmap(blob);
                    const texture = Texture.from(imageBitmap);
                    const dispose = () => {
                      try {
                        if (!texture?.destroyed) {
                          texture?.destroy?.(true);
                        }
                      } finally {
                        releaseTextureResource(imageBitmap);
                      }
                    };

                    // An external cache writer may have won while image decode
                    // was pending. Keep its value and discard our duplicate.
                    if (Assets.cache.has(key)) {
                      dispose();
                      return {
                        value: Assets.cache.get(key),
                        created: false,
                        cacheAliasInstalled: false,
                      };
                    }

                    // Alias the logical asset key so Texture.from("key")
                    // resolves directly from the cache instead of attempting a
                    // relative URL fetch.
                    Assets.cache.set(key, texture);
                    return {
                      value: texture,
                      created: true,
                      cacheAliasInstalled: true,
                      dispose,
                    };
                  },
                );

                return recordSharedTextureLoadResult(key, "texture", result);
              },
            ),
          ),
        }),
      );

      // Load video assets via direct URL when possible, otherwise fall back
      // to a revokable blob URL for buffer-backed inputs.
      Object.entries(assetsByType.video).forEach(([key, asset]) => {
        loadJobs.push({
          includeInReturn: true,
          promise: trackAssetLoad(key, () =>
            loadAssetWithContext(
              {
                key,
                category: "video",
                phase: "video texture load",
                asset,
              },
              async () => {
                const existingRecord = loadedAssetRecords.get(key);
                if (existingRecord?.category === "video") {
                  return existingRecord.value;
                }
                if (Assets.cache.has(key)) {
                  const texture = Assets.cache.get(key);
                  if (sharedTextureAssetOwners.has(texture)) {
                    return recordLoadedTexture(key, {
                      category: "video",
                      value: texture,
                    });
                  }
                  return texture;
                }

                if (asset?.source !== "url") {
                  assertAssetBuffer(asset, "Video");
                }

                const result = await trackSharedTextureLoad(
                  `video:${key}`,
                  async () => {
                    if (Assets.cache.has(key)) {
                      return {
                        value: Assets.cache.get(key),
                        created: false,
                        cacheAliasInstalled: false,
                      };
                    }

                    const sourceUrl =
                      asset?.source === "url" && typeof asset?.url === "string"
                        ? asset.url
                        : URL.createObjectURL(
                            new Blob([asset.buffer], { type: asset.type }),
                          );
                    const isRevokableBlobUrl = asset?.source !== "url";

                    trackVideoSourceUrl(key, sourceUrl, {
                      revokable: isRevokableBlobUrl,
                    });

                    let texture;
                    try {
                      texture = await loadVideoTexture({
                        sourceUrl,
                        mimeType: asset?.type,
                      });
                    } catch (error) {
                      videoSourceUrls.delete(key);
                      if (isRevokableBlobUrl) {
                        URL.revokeObjectURL(sourceUrl);
                      }
                      throw error;
                    }

                    const resource = texture?.source?.resource;
                    const dispose = () => {
                      try {
                        if (!texture?.destroyed) {
                          texture?.destroy?.(true);
                        }
                        releaseTextureResource(resource);
                      } finally {
                        revokeVideoSourceUrl(key);
                      }
                    };

                    // Keep a cache entry installed while video setup was
                    // pending and discard this duplicate texture.
                    if (Assets.cache.has(key)) {
                      dispose();
                      return {
                        value: Assets.cache.get(key),
                        created: false,
                        cacheAliasInstalled: false,
                      };
                    }

                    Assets.cache.set(key, texture);
                    return {
                      value: texture,
                      created: true,
                      cacheAliasInstalled: true,
                      dispose,
                    };
                  },
                );

                return recordSharedTextureLoadResult(key, "video", result);
              },
            ),
          ),
        });
      });

      const settledResults = await Promise.allSettled(
        loadJobs.map((job) => job.promise),
      );
      throwAssetLoadFailures(settledResults);

      return settledResults
        .map((result, index) =>
          loadJobs[index].includeInReturn && result.status === "fulfilled"
            ? result.value
            : undefined,
        )
        .filter(Boolean);
    },

    /**
     * Unload assets previously created by this Route Graphics instance.
     * Unknown or already-unloaded keys are ignored.
     * @param {string[]} assetIds
     * @returns {Promise<string[]>} Asset IDs successfully unloaded
     */
    unloadAssets: async (assetIds) => {
      if (!Array.isArray(assetIds)) {
        throw new Error("assetIds must be an array");
      }

      const uniqueAssetIds = Array.from(
        new Set(
          assetIds.filter(
            (assetId) => typeof assetId === "string" && assetId.length > 0,
          ),
        ),
      );
      const unloadedAssetIds = [];
      const failures = [];

      for (const assetId of uniqueAssetIds) {
        try {
          if (await unloadAsset(assetId)) {
            unloadedAssetIds.push(assetId);
          }
        } catch (cause) {
          const error = new Error(`Could not unload asset "${assetId}".`, {
            cause,
          });
          error.details = {
            assetKey: assetId,
            phase: "unload",
            cause: getErrorMessage(cause),
          };
          failures.push(error);
        }
      }

      if (failures.length === 1) {
        throw failures[0];
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          `Could not unload ${failures.length} assets.`,
        );
      }

      return unloadedAssetIds;
    },

    /** @deprecated Prefer loadAssets with explicit asset aliases and MIME types. */
    loadAudioAssets: (urls) =>
      Promise.all(
        urls.map((url) =>
          trackAssetLoad(url, () =>
            loadAudioRecord(url, async () => {
              const response = await fetch(url);
              if (!response.ok)
                throw new Error(
                  `Could not load audio "${url}": HTTP ${response.status}.`,
                );
              return {
                buffer: await response.arrayBuffer(),
                type: inferAudioTypeFromUrl(url),
              };
            }),
          ),
        ),
      ),

    /**
     *
     * @param {number} color
     */
    updatedBackgroundColor: (color) => {
      app.renderer.background.color = color;
      if (backgroundGraphic) {
        drawBackgroundGraphic(
          backgroundGraphic,
          app.renderer.width,
          app.renderer.height,
          color,
        );
      }
      if (typeof app.render === "function") {
        app.render();
      }
    },

    /**
     *
     * @param {RouteGraphicsState} stateParam
     */
    render: (stateParam) => {
      const normalizedState = normalizeRenderState(stateParam);
      const parsedElements = parseElements({
        JSONObject: normalizedState.elements,
        parserPlugins: plugins.parsers,
      });
      const parsedState = { ...normalizedState, elements: parsedElements };
      validateShaderAnimationBindings(parsedState);
      validateShaderProgramsForRenderer({
        renderer: app.renderer,
        state: parsedState,
      });
      renderInternal(app, app.stage, parsedState, eventHandler);
    },

    /**
     * Parse elements from state object using registered parser plugins
     * @param {RouteGraphicsState} stateParam - The state object containing element definitions
     */
    parse: (stateParam) => {
      const normalizedState = normalizeRenderState(stateParam);
      const parsedElements = parseElements({
        JSONObject: normalizedState.elements,
        parserPlugins: plugins.parsers,
      });
      const parsedState = { ...normalizedState, elements: parsedElements };
      validateShaderAnimationBindings(parsedState);
      return parsedState;
    },
  };

  return routeGraphicsInstance;
};

export default createRouteGraphics;
