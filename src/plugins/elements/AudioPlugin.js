import { TransitionEvent, BaseRendererPlugin } from "../../types";

/**
 * @typedef {import('../../types').ContainerElement} ContainerElement
 * @typedef {import('../../types').Application} Application
 * @typedef {import('../../types').Container} Container
 * @typedef {import('../../types').BaseTransition} BaseTransition
 *
 * @typedef {import('../../RouteGraphics').ApplicationWithAudioStage} ApplicationWithAudioStage
 */

/**
 * @typedef {Object} AudioElement
 * @property {string} id
 * @property {string} url - The URL of the sprite's texture
 * @property {number} [delay] - The delay before the audio starts (optional)
 * @property {boolean} [loop=false] - Whether the audio should loop (optional)
 * @property {number} [volume=1.0] - Volume between 0 and 1
 */

/**
 * Abstraction for PIXI.Sprite
 * Can handle most cases where an image is involved
 * If you need a sprite that can be hovered or clicked such as a button
 * use SpriteInteractiveRendererPlugin instead
 *
 * @class
 * @extends {BaseRendererPlugin<AudioElement,BaseTransition>}
 *
 * @example
 * {
 *   "elements": [{
 *     "id": "s1",
 *     "url": "https://example.com/sound.mp3"
 *   }]
 * }
 */
export class AudioPlugin extends BaseRendererPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  rendererType = "audio";

  /**
   * @param {ApplicationWithAudioStage} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {AudioElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  add = async (
    app,
    { parent, element, transitions = [], getTransitionByType },
  ) => {
    if (element.delay) {
      setTimeout(() => {
        app.audioStage.add({
          id: element.id,
          url: element.url,
          loop: element.loop ?? false,
          volume: element.volume ?? 1.0,
        });
      }, element.delay);
    } else {
      app.audioStage.add({
        id: element.id,
        url: element.url,
        loop: element.loop ?? false,
        volume: element.volume ?? 1.0,
      });
    }
  };

  /**
   * @param {ApplicationWithAudioStage} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {AudioElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  remove = async (app, options) => {
    const { element } = options;
    app.audioStage.remove(element.id);
  };

  /**
   * @param {ApplicationWithAudioStage} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {AudioElement} options.prevElement
   * @param {AudioElement} options.nextElement
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  update = async (
    app,
    { parent, prevElement, nextElement, transitions, getTransitionByType },
  ) => {
    if (
      prevElement.url !== nextElement.url ||
      prevElement.volume !== nextElement.volume
    ) {
      const audioElement = app.audioStage.getById(prevElement.id);
      if (audioElement) {
        audioElement.url = nextElement.url;
        audioElement.volume = nextElement.volume ?? 1.0;
      }
    }
  };
}
