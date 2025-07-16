import { Container, Graphics } from "pixi.js";
import { TransitionEvent, BaseRendererPlugin } from "../../types";

/**
 * @typedef {import('../../types').ContainerElement} ContainerElement
 * @typedef {import('../../types').Application} Application
 * @typedef {import('../../types').BaseTransition} BaseTransition
 */

/**
 * @typedef {Object} GraphicsElementOptions
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 * @property {string} fill
 * @typedef {ContainerElement & GraphicsElementOptions} GraphicsContainerElement
 */

/**
 * @implements {BaseRendererPlugin}
 */
export class GraphicsRendererPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  rendererType = "graphics";

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {GraphicsContainerElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  add = async (app, options) => {
    const {
      parent,
      element,
      transitions = [],
      getTransitionByType,
      eventHandler,
    } = options;

    const graphics = new Graphics();
    graphics.label = element.id;

    if (element.xp !== undefined) {
      graphics.x = element.xp * app.screen.width;
    }
    if (element.x !== undefined) {
      graphics.x = element.x;
    }
    if (element.y !== undefined) {
      graphics.y = element.y;
    }
    if (element.yp !== undefined) {
      graphics.y = element.yp * app.screen.height;
    }
    if (element.alpha !== undefined) {
      graphics.alpha = element.alpha;
    }

    if (element.zIndex !== undefined) {
      graphics.zIndex = element.zIndex;
    }

    graphics.rect(element.x1, element.y1, element.x2, element.y2);
    graphics.fill(element.fill);

    if (
      (element.clickEventName || element.rightClickEventName) &&
      eventHandler
    ) {
      graphics.eventMode = "static";
      graphics.on("pointerup", (e) => {
        if (e.button === 0) {
          eventHandler(element.clickEventName);
        } else if (e.button === 2) {
          eventHandler(element.rightClickEventName);
        }
      });
    }

    if (element.wheelEventName && eventHandler) {
      graphics.eventMode = "static";
      graphics.on("wheel", (e) => {
        eventHandler(element.wheelEventName, {
          deltaY: e.deltaY,
        });
      });
    }

    const transitionPromises = [];

    for (const transition of transitions) {
      if (
        transition.elementId === element.id &&
        transition.event === TransitionEvent.Add
      ) {
        const transitionClass = getTransitionByType(transition.type);
        if (!transitionClass) {
          throw new Error(
            `Transition class not found for type ${transition.type}`,
          );
        }
        transitionPromises.push(transitionClass.add(app, graphics, transition));
      }
    }

    parent.addChild(graphics);
    await Promise.all(transitionPromises);
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {GraphicsContainerElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  remove = async (app, options) => {
    const { parent, element } = options;
    const sprite = parent.getChildByName(element.id);
    if (!sprite) {
      throw new Error(`Sprite with id ${element.id} not found`);
    }
    sprite.destroy();
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {GraphicsContainerElement} options.prevElement
   * @param {GraphicsContainerElement} options.nextElement
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  update = async (app, options) => {
    const {
      parent,
      prevElement,
      nextElement,
      transitions = [],
      getTransitionByType,
      eventHandler,
    } = options;
    const graphics = parent.getChildByName(prevElement.id);
    if (!graphics) {
      throw new Error(`Container with id ${prevElement.id} not found`);
    }

    if (JSON.stringify(prevElement) !== JSON.stringify(nextElement)) {
      await Promise.all([
        this.remove(app, {
          parent,
          element: prevElement,
          transitions,
          getTransitionByType,
          eventHandler,
        }),
        this.add(app, {
          parent,
          element: nextElement,
          transitions,
          getTransitionByType,
          eventHandler,
        }),
      ]);
    }
  };
}
