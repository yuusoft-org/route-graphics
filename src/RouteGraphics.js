import {
  Application,
  Assets,
  Graphics,
  LoaderParserPriority,
  extensions,
  ExtensionType,
  Texture,
} from "pixi.js";
import "@pixi/unsafe-eval";
import { BaseRouteGraphics } from "./types";
import { AudioStage, AudioAsset } from "./AudioStage.js";
import { renderApp } from "./render/renderApp.js";
import parseJSONToAST from "./parser/index.js";

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
    transitions: [],
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
    if (!mimeType) return "texture";

    if (mimeType.startsWith("audio/")) return "audio";

    if (
      mimeType.startsWith("font/") ||
      [
        "application/font-woff",
        "application/font-woff2",
        "application/x-font-ttf",
        "application/x-font-otf",
      ].includes(mimeType)
    ) {
      return "font";
    }

    // Future: video support can be added here
    // if (mimeType.startsWith('video/')) return 'video';

    return "texture";
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
      texture: {}, // includes images and other PIXI-compatible assets
    };

    for (const [key, asset] of Object.entries(assetBufferMap)) {
      const assetType = this._classifyAsset(asset.type);
      assetsByType[assetType][key] = asset;
    }

    // Load audio assets using AudioAsset.load in parallel
    await Promise.all(
      Object.entries(assetsByType.audio).map(([key, asset]) =>
        AudioAsset.load(key, asset.buffer),
      ),
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
      }),
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
    return Promise.all(
      urls.map(async (url) => {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return AudioAsset.load(url, arrayBuffer);
      }),
    );
  };

  /**
   *
   * @param {string} color
   */
  updatedBackgroundColor = (color) => {
    this._app.renderer.background.color = color;
  };

  getStageElementBounds = () => {
    const items = {};
    const iterate = (children) => {
      if (!children || children.length === 0) {
        return;
      }
      for (const item of children) {
        items[item.label] = {
          x: item.groupTransform.tx,
          y: item.groupTransform.ty,
          width: item.width,
          height: item.height,
        };

        iterate(item.children);
      }
    };
    iterate(this._app.stage.children);
    return items;
  };

  /**
   *
   * @param {RouteGraphicsState} state
   */
  render = (state) => {
    const parsedElements = parseJSONToAST(state.elements)
    const parsedState = {...state,elements:parsedElements}
    this._render(
      this._app,
      this._app.stage,
      this._state,
      parsedState,
      this._eventHandler,
    );
    this._state = parsedState;
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
   * Apply global cursor styles to the PixiJS application
   * @param {Application} app - The PixiJS application instance
   * @param {GlobalConfiguration} [prevGlobal] - Previous global configuration
   * @param {GlobalConfiguration} [nextGlobal] - Next global configuration
   */
  _applyGlobalCursorStyles = (app, prevGlobal, nextGlobal) => {
    // Initialize default cursor styles if they don't exist
    if (!app.renderer.events.cursorStyles) {
      app.renderer.events.cursorStyles = {};
    }
    if (!app.renderer.events.cursorStyles.default) {
      app.renderer.events.cursorStyles.default = "default";
    }
    if (!app.renderer.events.cursorStyles.hover) {
      app.renderer.events.cursorStyles.hover = "pointer";
    }

    const prevCursorStyles = prevGlobal?.cursorStyles;
    const nextCursorStyles = nextGlobal?.cursorStyles;

    // Only update if cursor styles have changed
    if (JSON.stringify(prevCursorStyles) !== JSON.stringify(nextCursorStyles)) {
      if (nextCursorStyles) {
        // Apply new cursor styles
        if (nextCursorStyles.default) {
          app.renderer.events.cursorStyles.default = nextCursorStyles.default;
          // Also set canvas cursor directly
          app.canvas.style.cursor = nextCursorStyles.default;
        }
        if (nextCursorStyles.hover) {
          app.renderer.events.cursorStyles.hover = nextCursorStyles.hover;
        }
      } else if (prevCursorStyles) {
        // Reset to default cursor styles if global config was removed
        app.renderer.events.cursorStyles.default = "default";
        app.renderer.events.cursorStyles.hover = "pointer";
      }
    }
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

    // Apply global cursor styles if they exist and have changed
    this._applyGlobalCursorStyles(app, prevState.global, nextState.global);

    renderApp(app,parent,prevState.elements,nextState.elements)

    // Cancel any previous render operations
    if (this._currentAbortController) {
      this._currentAbortController.abort();
    }

    // Create new AbortController for this render
    this._currentAbortController = new AbortController();
  };
}

export default RouteGraphics;
