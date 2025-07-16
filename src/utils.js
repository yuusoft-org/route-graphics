/**
 * Asset buffer manager for caching loaded assets
 */
class AssetBufferManager {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Load assets from URLs with caching
   * @param {Object} assets - Map of asset keys to {url, type} objects
   * @returns {Promise<void>} Promise that resolves when all assets are loaded
   */
  async load(assets) {
    const toFetch = [];

    // Check what needs to be fetched
    for (const [key, value] of Object.entries(assets)) {
      if (!this.cache.has(key)) {
        toFetch.push([key, value]);
      }
    }

    // Fetch uncached assets
    if (toFetch.length > 0) {
      await Promise.all(
        toFetch.map(async ([key, value]) => {
          const resp = await fetch(value.url);
          const buffer = await resp.arrayBuffer();
          const bufferData = {
            buffer,
            type: value.type,
          };

          // Cache the result
          this.cache.set(key, bufferData);
        }),
      );
    }
  }

  /**
   * Get the complete buffer map
   * @returns {Object<string, {buffer: ArrayBuffer, type: string}>} Buffer map with all loaded assets - keys map to objects with {buffer: ArrayBuffer, type: string}
   */
  getBufferMap() {
    const bufferMap = {};
    for (const [key, value] of this.cache.entries()) {
      bufferMap[key] = value;
    }
    return bufferMap;
  }

  /**
   * Clear the cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  size() {
    return this.cache.size;
  }

  /**
   * Check if an asset is cached
   */
  has(key) {
    return this.cache.has(key);
  }
}

/**
 * Create a new asset buffer manager instance
 * @returns {AssetBufferManager} New asset buffer manager instance
 */
export const createAssetBufferManager = () => {
  return new AssetBufferManager();
};
