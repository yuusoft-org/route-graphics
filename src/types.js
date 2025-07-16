/**
 * @typedef {import('pixi.js').Application} Application
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @typedef {Object} BaseElement
 * @property {string} id - Unique identifier for the element
 * @property {string} type - Type of the element
 */

/**
 * @typedef {Object} ContainerElementOptions
 * @property {number} [x] - The x-coordinate
 * @property {number} [y] - The y-coordinate
 * @property {number} [xp] - The x-coordinate in percentage
 * @property {number} [yp] - The y-coordinate in percentage
 * @property {number} [xa] - X Anchor
 * @property {number} [ya] - Y Anchor
 * @property {number} [width] - Width
 * @property {number} [height] - Height
 *
 * @typedef {BaseElement & ContainerElementOptions} ContainerElement
 */

/**
 * @readonly
 * @enum {string}
 */
export const TransitionEvent = {
  Add: "add",
  Remove: "remove",
};

/**
 * @typedef {Object} BaseTransition
 * @property {string} type - Type of the transition
 * @property {string} elementId - ID of the element
 * @property {TransitionEvent} event - Event of the transition
 */

/**
 * @template {BaseElement} E
 * @template {BaseTransition} T
 * @typedef {Object} RouteGraphicsState
 * @property {string} id - ID
 * @property {E[]} elements - Array of elements
 * @property {T[]} transitions - Array of transitions
 */

/**
 * @typedef {Object} RouteGraphicsInitOptions
 * @property {number} width - Width of the renderer
 * @property {number} height - Height of the renderer
 * @property {string} backgroundColor - Background color of the renderer
 * @property {Function} eventHandler - Event handler function
 * @property {BaseRendererPlugin[]} plugins - Array of renderer plugins
 */

/**
 * @typedef {Object} TextStyle
 * @property {'left' | 'center' | 'right'} align - The alignment of the text
 * @property {string} fill - The fill color of the text
 * @property {number} fontSize - The font family of the text
 * @property {string} fontWeight - The font weight of the text
 * @property {number} lineHeight - The line height of the text
 * @property {number} wordWrapWidth - Wrap width
 * @property {boolean} wordWrap - Whether to word wrap
 * @property {string} fontFamily - The font family of the text
 * @property {string} strokeColor - The stroke color of the text
 * @property {number} strokeWidth - The stroke width of the text
 */

/**
 * @abstract
 */
export class BaseRouteGraphics {
  /**
   * Initializes the renderer with the given options
   * @param {RouteGraphicsInitOptions} options - Initialization options
   */
  init(options) {
    throw new Error("Method not implemented.");
  }

  /**
   * Renders the state
   * @param {RouteGraphicsState<any,any>} state - State to render
   */
  render(state) {
    throw new Error("Method not implemented.");
  }
}

/**
 * Renderer plugin for rendering elements
 * @abstract
 * @template {BaseElement} E
 * @template {BaseTransition} T
 */
export class BaseRendererPlugin {
  /**
   * Name of the renderer
   * @type {string}
   */
  rendererName;

  /**
   * Type of the renderer
   * @type {string}
   *
   */
  rendererType;

  /**
   * Adds an element to the application stage
   * @param {import('./RouteGraphics').ApplicationWithSoundStage} app - The PixiJS application instance
   * @param {Object} options
   * @param {Container} options.parent - The parent container to add the element to
   * @param {E} options.element - The sprite element to add
   * @param {T[]} [options.transitions=[]] - Array of transitions
   * @param {Function} options.getTransitionByType - Function to get a transition by type
   * @param {Function} options.getRendererByElement
   * @returns {Promise<undefined>}
   */
  add = (app, options) => {
    throw new Error("Method not implemented.");
  };

  /**
   * Removes an element from the application stage
   * @param {import('./RouteGraphics').ApplicationWithSoundStage} app - The PixiJS application instance
   * @param {Object} options
   * @param {Container} options.parent
   * @param {Object} options.element - The sprite element to remove
   * @param {E} options.element - The element to remove
   * @param {T[]} [options.transitions=[]] - Array of transitions
   * @param {Function} options.getTransitionByType - Function to get a transition by type
   * @returns {Promise<undefined>}
   */
  remove = (app, options) => {
    throw new Error("Method not implemented.");
  };

  /**
   * Updates an element on the application stage
   * @param {import('./RouteGraphics').ApplicationWithSoundStage} app - The PixiJS application instance
   * @param {Object} options
   * @param {Container} options.parent
   * @param {E} options.prevElement - The previous state of the sprite element
   * @param {E} options.nextElement - The next state of the sprite element
   * @param {T[]} [options.transitions=[]] - Array of transitions
   * @param {Function} options.getRendererByElement
   * @param {Function} options.getTransitionByType - Function to get a transition by type
   * @returns {Promise<undefined>}
   */
  update = (app, options) => {
    throw new Error("Method not implemented.");
  };
}

/**
 *
 */
export class AbstractTransitionPlugin {
  /**
   *
   * @param {Application} app
   * @param {Container} container
   * @param {Object} transition
   */
  add = (app, container, transition) => {
    throw new Error("Method not implemented.");
  };

  /**
   *
   * @param {Application} app
   * @param {Container} container
   * @param {Object} transition
   */
  remove = (app, container, transition) => {
    throw new Error("Method not implemented.");
  };
}
