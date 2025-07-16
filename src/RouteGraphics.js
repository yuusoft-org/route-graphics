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
import { finalize, from, mergeMap, tap } from "rxjs";

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

  _currentSubscription;

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
   * Load assets using buffer data stored in memory
   * @param {Object<string, {buffer: ArrayBuffer, type: string}>} assetBufferMap - Result from assetBufferManager.getBufferMap()
   * @returns {Promise<Array>} Promise that resolves to an array of loaded assets
   */
  loadAssets = async (assetBufferMap) => {
    if (!assetBufferMap) {
      throw new Error("assetBufferMap is required");
    }


    // Filter out audio assets and load them separately
    const nonAudioAssets = {};
    const audioAssets = {};

    for (const [key, asset] of Object.entries(assetBufferMap)) {
      if (asset.type && asset.type.startsWith("audio/")) {
        audioAssets[key] = asset;
      } else {
        nonAudioAssets[key] = asset;
      }
    }

    // Load audio assets using AudioAsset.load in parallel
    await Promise.all(
      Object.entries(audioAssets).map(([key, asset]) => 
        AudioAsset.load(key, asset.buffer)
      )
    );

    if (!this._advancedLoader) {
      this._advancedLoader = new AdvancedBufferLoader(nonAudioAssets);

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
      // Merge new non-audio assets into existing buffer map
      Object.assign(this._advancedLoader.bufferMap, nonAudioAssets);
    }

    const urls = Object.keys(nonAudioAssets);
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

    const actions = [];

    for (const toDeleteElement of toDeleteElements) {
      const elementRenderer = this._getRendererByElement(toDeleteElement);
      actions.push(
        elementRenderer.remove(app, {
          parent: parent,
          element: toDeleteElement,
          transitions: nextState.transitions,
          getRendererByElement: this._getRendererByElement,
          getTransitionByType: this._getTransitionByType,
          eventHandler,
        }),
      );
    }

    for (const toAddElement of toAddElements) {
      const elementRenderer = this._getRendererByElement(toAddElement);
      actions.push(
        elementRenderer.add(app, {
          parent: parent,
          element: toAddElement,
          getRendererByElement: this._getRendererByElement,
          transitions: nextState.transitions,
          getTransitionByType: this._getTransitionByType,
          eventHandler,
        }),
      );
    }

    for (const toUpdateElement of toUpdateElements) {
      const elementRenderer = this._getRendererByElement(toUpdateElement.next);
      actions.push(
        elementRenderer.update(app, {
          parent: parent,
          prevElement: toUpdateElement.prev,
          nextElement: toUpdateElement.next,
          getRendererByElement: this._getRendererByElement,
          transitions: nextState.transitions,
          getTransitionByType: this._getTransitionByType,
          eventHandler,
        }),
      );
    }

    // sort children by element id from nextElement.children
    app.stage.children.sort((a, b) => {
      const aIndex = nextState.elements.findIndex(
        (element) => element.id === a.label,
      );
      const bIndex = nextState.elements.findIndex(
        (element) => element.id === b.label,
      );
      return aIndex - bIndex;
    });

    if (this._currentSubscription) {
      if (!this._currentSubscription.closed) {
        this._currentSubscription.unsubscribe();
      }
    }

    this._currentSubscription = from(actions)
      .pipe(
        mergeMap((task$) => task$), // Runs all in parallel (or use mergeMap(task$, concurrency))
        finalize(() => {
          eventHandler &&
            eventHandler("completed", {
              id: nextState.id,
              diffTime: Date.now() - time,
            });
          this._currentSubscription = undefined;
        }),
      )
      .subscribe({
        error: (err) => {
          console.error("Error:", err);
        },
      });
  };
}

export default RouteGraphics;
