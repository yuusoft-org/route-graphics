import { trackPendingLoad } from "../assets/sharedAssetOwnership.js";

/**
 * Asset buffer manager for caching loaded assets
 */
const createAssetBufferManager = () => {
  const cache = new Map();
  const pending = new Map();
  let generation = 0;
  const isBlobUrl = (url) => typeof url === "string" && url.startsWith("blob:");
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
  const getHttpStatusCode = (message) => {
    const match = message.match(/HTTP\s+(\d{3})/);
    return match?.[1];
  };
  const getFriendlyFetchCauseMessage = (error) => {
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

    return "File could not be downloaded.";
  };
  const getAssetFetchErrorDetails = ({ key, value, error }) => {
    const details = {
      assetKey: key,
      cause: getErrorMessage(error),
    };

    if (value?.type) details.type = value.type;
    if (value?.url) details.url = truncateErrorValue(value.url);

    return details;
  };
  const createAssetFetchError = ({ key, value, error }) => {
    const rootCauseMessage = getFriendlyFetchCauseMessage(error);
    const message = `Could not load asset "${key}". ${rootCauseMessage}`;
    const fetchError = new Error(message, {
      cause: error,
    });

    fetchError.userMessage = message;
    fetchError.rootCauseMessage = rootCauseMessage;
    fetchError.details = getAssetFetchErrorDetails({ key, value, error });

    return fetchError;
  };
  const shouldCacheByUrl = (value) => {
    return (
      typeof value?.type === "string" &&
      (value.type.startsWith("image/") || value.type.startsWith("video/")) &&
      typeof value?.url === "string" &&
      !isBlobUrl(value.url)
    );
  };

  /**
   * Load assets from URLs with caching
   * @param {Object} assets - Map of asset keys to {url, type} objects
   * @returns {Promise<void>} Promise that resolves when all assets are loaded
   */
  const load = async (assets) => {
    const loadGeneration = generation;
    const toFetch = [];

    // Check what needs to be fetched
    for (const [key, value] of Object.entries(assets)) {
      if (!cache.has(key)) {
        toFetch.push([key, value]);
      }
    }

    // Fetch uncached assets
    if (toFetch.length > 0) {
      await Promise.all(
        toFetch.map(([key, value]) =>
          trackPendingLoad(pending, key, async () => {
            try {
              if (!value?.url) {
                throw new Error("Asset URL is missing.");
              }

              if (shouldCacheByUrl(value)) {
                cache.set(key, {
                  url: value.url,
                  type: value.type,
                  source: "url",
                });
                return;
              }

              const resp = await fetch(value.url);
              if (!resp.ok) {
                throw new Error(
                  `HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ""}`,
                );
              }
              const buffer = await resp.arrayBuffer();
              const bufferData = {
                buffer,
                type: value.type,
                source: "buffer",
              };

              // Cache the result
              if (generation === loadGeneration) cache.set(key, bufferData);
            } catch (error) {
              throw createAssetFetchError({ key, value, error });
            }
          }),
        ),
      );
    }
  };

  /**
   * Get the complete buffer map
   * @returns {Object<string, {buffer: ArrayBuffer, type: string}>} Buffer map with all loaded assets - keys map to objects with {buffer: ArrayBuffer, type: string}
   */
  const getBufferMap = () => {
    return Object.fromEntries(cache);
  };

  /**
   * Clear the cache
   */
  const clear = () => {
    generation++;
    cache.clear();
    pending.clear();
  };

  /**
   * Get cache size
   */
  const size = () => cache.size;

  /**
   * Check if an asset is cached
   */
  const has = (key) => cache.has(key);

  return {
    load,
    getBufferMap,
    clear,
    size,
    has,
  };
};

export { createAssetBufferManager };
