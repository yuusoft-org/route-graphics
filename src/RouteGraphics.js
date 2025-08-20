import {
  Application,
  Assets,
  Graphics,
  LoaderParserPriority,
  extensions,
  ExtensionType,
  Texture,
} from "pixi.js";
import { BaseRouteGraphics } from "./types";
import { diffElements } from "./common.js";
import { AudioStage, AudioAsset } from "./AudioStage.js";

/**
 * @typedef {import('./types.js').RouteGraphicsInitOptions} RouteGraphicsInitOptions
 * @typedef {import('./types.js').RouteGraphicsState} RouteGraphicsState
 * @typedef {import('./types.js').BaseRendererPlugin} BaseRendererPlugin
 * @typedef {import('./types.js').BaseElement} BaseElement
 */

const getPathName = (url) => {
  return url.split("/").pop();
};

class AdvancedBufferLoader {
  name = "advancedBufferLoader";
  priority = 2;

  constructor(bufferMap) {
    this.bufferMap = bufferMap;
  }

  test(url) {
    return true;
  }

  async load(_url) {
    // For file: URLs, use the full URL as key, otherwise use just the filename
    let url = _url.startsWith("file:") ? _url : getPathName(_url);
    const blob = this.bufferMap[url];

    if (!blob) {
      throw new Error(`Buffer not found for key: ${url}`);
    }

    const output = {
      data: blob.buffer,
      type: blob.type,
      metadata: null,
    };

    return output;
  }

  async testParse(asset) {
    return true;
    // return asset?.data instanceof Blob;
  }

  async parse(asset) {
    // If asset is already a Texture, return it directly
    if (asset instanceof Texture) {
      return asset;
    }

    // Convert ArrayBuffer to Blob
    const blob = new Blob([asset.data], { type: asset.type });

    // Convert Blob to ImageBitmap
    const imageBitmap = await createImageBitmap(blob);

    // Create and return Texture
    return new Texture.from(imageBitmap);
  }

  async unload(texture) {
    texture.destroy(true);
  }
}

/**
 * @typedef {Object} ApplicationWithAudioStageOptions
 * @property {AudioStage} audioStage
 * @typedef {Application & ApplicationWithAudioStageOptions} ApplicationWithAudioStage
 */
class RouteGraphics extends BaseRouteGraphics {
  static rendererName = "pixi";

  /**
   * @type {ApplicationWithAudioStage}
   */
  _app;

  /**
   * @type {AudioStage}
   */
  _audioStage = new AudioStage();

  /**
   * @type {RouteGraphicsState}
   */
  _state = {
    elements: [],
  };

  /**
   * @type {Function}
   */
  _eventHandler;

  /**
   * @type {BaseRendererPlugin[]}
   */
  _plugins;

  /**
   * @type {AbortController}
   */
  _currentAbortController;

  /**
   * @type {AdvancedBufferLoader}
   */
  _advancedLoader;

  get canvas() {
    return this._app.canvas;
  }

  /**
   *
   * @param {RouteGraphicsInitOptions} options
   * @returns
   */
  init = async (options) => {
    const { eventHandler, plugins, width, height, backgroundColor } = options;

    for (const plugin of plugins) {
      if (plugin.rendererName !== RouteGraphics.rendererName) {
        throw new Error("Plugin does not match renderer name");
      }
    }

    this._plugins = plugins;
    this._eventHandler = eventHandler;

    /**
     * @type {ApplicationWithAudioStage}
     */
    this._app = new Application();
    this._app.audioStage = this._audioStage;
    await this._app.init({
      width,
      height,
      backgroundColor,
    });

    const graphics = new Graphics();
    graphics.rect(0, 0, width, height);
    graphics.fill(backgroundColor || 0x000000);
    this._app.stage.addChild(graphics);
    this._app.stage.width = width;
    this._app.stage.height = height;
    this._app.ticker.add(this._app.audioStage.tick);

    return this;
  };

  destroy = () => {
    this._app.audioStage.destroy();
    this._app.destroy();
  };

  /**
   * Classify asset by type
   * @param {string} mimeType - The MIME type of the asset
   * @returns {string} Asset category
   */
  _classifyAsset = (mimeType) => {
    if (!mimeType) return 'texture';
    
    if (mimeType.startsWith('audio/')) return 'audio';
    
    if (mimeType.startsWith('font/') || 
        ['application/font-woff', 'application/font-woff2', 
         'application/x-font-ttf', 'application/x-font-otf'].includes(mimeType)) {
      return 'font';
    }
    
    // Future: video support can be added here
    // if (mimeType.startsWith('video/')) return 'video';
    
    return 'texture';
  };

  /**
   * Load assets using buffer data stored in memory
   * @param {Object<string, {buffer: ArrayBuffer, type: string}>} assetBufferMap - Result from assetBufferManager.getBufferMap()
   * @returns {Promise<Array>} Promise that resolves to an array of loaded assets
   */
  loadAssets = async (assetBufferMap) => {
    if (!assetBufferMap) {
      throw new Error("assetBufferMap is required");
    }

    // Classify assets by type
    const assetsByType = {
      audio: {},
      font: {},
      texture: {} // includes images and other PIXI-compatible assets
    };

    for (const [key, asset] of Object.entries(assetBufferMap)) {
      const assetType = this._classifyAsset(asset.type);
      assetsByType[assetType][key] = asset;
    }

    // Load audio assets using AudioAsset.load in parallel
    await Promise.all(
      Object.entries(assetsByType.audio).map(([key, asset]) => 
        AudioAsset.load(key, asset.buffer)
      )
    );

    // Load font assets
    await Promise.all(
      Object.entries(assetsByType.font).map(async ([key, asset]) => {
        const blob = new Blob([asset.buffer], { type: asset.type });
        const url = URL.createObjectURL(blob);
        // Use the key as font family name - this should match the fontFamily in text styles
        const fontFace = new FontFace(key, `url(${url})`);
        try {
          await fontFace.load();
          document.fonts.add(fontFace);
          console.log(`Font loaded successfully: ${key}`);
        } catch (error) {
          console.error(`Failed to load font ${key}:`, error);
        } finally {
          URL.revokeObjectURL(url);
        }
      })
    );

    if (!this._advancedLoader) {
      this._advancedLoader = new AdvancedBufferLoader(assetsByType.texture);

      Assets.loader.parsers.length = 0;
      Assets.reset();
      extensions.add({
        name: "advanced-buffer-loader",
        extension: ExtensionType.Asset,
        priority: LoaderParserPriority.High,
        loader: this._advancedLoader,
      });

      if (typeof Assets.registerPlugin === "function") {
        Assets.registerPlugin(this._advancedLoader);
      }
    } else {
      // Merge new texture assets into existing buffer map
      Object.assign(this._advancedLoader.bufferMap, assetsByType.texture);
    }

    const urls = Object.keys(assetsByType.texture);
    return Promise.all(urls.map((url) => Assets.load(url)));
  };

  loadAudioAssets = async (urls) => {
    return Promise.all(urls.map(async (url) => {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      return AudioAsset.load(url, arrayBuffer);
    }));
  };

  /**
   *
   * @param {string} color
   */
  updatedBackgroundColor = (color) => {
    this._app.renderer.background.color = color;
  };

  /**
   *
   * @param {RouteGraphicsState} state
   */
  render = (state) => {
    this._render(
      this._app,
      this._app.stage,
      this._state,
      state,
      this._eventHandler,
    );
    this._state = state;
  };

  /**
   *
   * @param {BaseElement} element
   * @returns
   */
  _getRendererByElement = (element) => {
    for (const plugin of this._plugins) {
      if (plugin.rendererType === element.type) {
        return plugin;
      }
    }
    throw new Error(`No renderer found for element type: ${element.type}`);
  };

  _getTransitionByType = (transitionType) => {
    for (const plugin of this._plugins) {
      if (plugin.transitionType === transitionType) {
        return plugin;
      }
    }
    throw new Error(
      `No transition found for transition type: ${transitionType}`,
    );
  };

  /**
   *
   * @param {Application} app
   * @param {RouteGraphicsState} prevState
   * @param {RouteGraphicsState} nextState
   * @param {Function} eventHandler
   */
  _render = async (app, parent, prevState, nextState, eventHandler) => {
    const time = Date.now();

    const { toAddElements, toUpdateElements, toDeleteElements } = diffElements(
      prevState.elements,
      nextState.elements,
    );

    // Cancel any previous render operations
    if (this._currentAbortController) {
      this._currentAbortController.abort();
    }

    // Create new AbortController for this render
    this._currentAbortController = new AbortController();
    const signal = this._currentAbortController.signal;

    const actions = [];

    for (const toDeleteElement of toDeleteElements) {
      const elementRenderer = this._getRendererByElement(toDeleteElement);
      actions.push(() => 
        elementRenderer.remove(app, {
          parent: parent,
          element: toDeleteElement,
          elements: nextState.elements,
          transitions: nextState.transitions,
          getRendererByElement: this._getRendererByElement,
          getTransitionByType: this._getTransitionByType,
          eventHandler,
        }, signal)
      );
    }

    for (const toAddElement of toAddElements) {
      const elementRenderer = this._getRendererByElement(toAddElement);
      actions.push(() => 
        elementRenderer.add(app, {
          parent: parent,
          element: toAddElement,
          elements: nextState.elements,
          getRendererByElement: this._getRendererByElement,
          transitions: nextState.transitions,
          getTransitionByType: this._getTransitionByType,
          eventHandler,
        }, signal)
      );
    }

    for (const toUpdateElement of toUpdateElements) {
      const elementRenderer = this._getRendererByElement(toUpdateElement.next);
      actions.push(() => 
        elementRenderer.update(app, {
          parent: parent,
          prevElement: toUpdateElement.prev,
          nextElement: toUpdateElement.next,
          elements: nextState.elements,
          getRendererByElement: this._getRendererByElement,
          transitions: nextState.transitions,
          getTransitionByType: this._getTransitionByType,
          eventHandler,
        }, signal)
      );
    }

    try {
      // Run all actions in parallel
      await Promise.all(actions.map(action => action()));

      // Sort children AFTER all add/update operations complete
      app.stage.children.sort((a, b) => {
        const aElement = nextState.elements.find(
          (element) => element.id === a.label
        );
        const bElement = nextState.elements.find(
          (element) => element.id === b.label
        );
        
        if (aElement && bElement) {
          // First, sort by zIndex if specified
          const aZIndex = aElement.zIndex ?? 0;
          const bZIndex = bElement.zIndex ?? 0;
          if (aZIndex !== bZIndex) {
            return aZIndex - bZIndex;
          }
          
          // If zIndex is the same or not specified, maintain order from nextState.elements
          const aIndex = nextState.elements.findIndex(
            (element) => element.id === a.label
          );
          const bIndex = nextState.elements.findIndex(
            (element) => element.id === b.label
          );
          return aIndex - bIndex;
        }
        
        // Keep elements that aren't in nextState.elements at their current position
        if (!aElement && !bElement) return 0;
        if (!aElement) return -1;
        if (!bElement) return 1;
      });
      
      eventHandler &&
        eventHandler("completed", {
          id: nextState.id,
          diffTime: Date.now() - time,
        });
    } catch (error) {
      if (error.name === 'AbortError') {
        // Operation was cancelled, this is expected
        return;
      }
      console.error("Error:", error);
      throw error;
    } finally {
      this._currentAbortController = undefined;
    }
  };
}

export default RouteGraphics;
