import { Container, Graphics } from "pixi.js";
import { TransitionEvent, BaseRendererPlugin } from "../../types";

/**
 * @typedef {import('../../types').ContainerElement} ContainerElement
 * @typedef {import('../../types').Application} Application
 * @typedef {import('../../types').BaseTransition} BaseTransition
 */

/**
 * @typedef {Object} RectElementOptions
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {string} fill
 * @property {any} [clickEventPayload] - Payload for click events
 * @property {any} [rightClickEventPayload] - Payload for right-click events
 * @typedef {ContainerElement & RectElementOptions} RectContainerElement
 */

/**
 * @implements {BaseRendererPlugin}
 */
export class RectRendererPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  rendererType = "rect";

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {RectContainerElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<void>}
   */
  add = async (app, options, signal) => {
    if (signal?.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }

    const {
      parent,
      element,
      transitions = [],
      getTransitionByType,
      eventHandler,
    } = options;

    const graphics = new Graphics();
    graphics.label = element.id;
    graphics.interactiveChildren = false;
    graphics.eventMode = "none";

    if (element.x !== undefined) {
      graphics.x = element.x;
    }
    if (element.y !== undefined) {
      graphics.y = element.y;
    }
    if (element.alpha !== undefined) {
      graphics.alpha = element.alpha;
    }
    if (element.scaleX !== undefined) {
      graphics.scale.x = element.scaleX;
    }
    if (element.scaleY !== undefined) {
      graphics.scale.y = element.scaleY;
    }
    if (element.rotation !== undefined) {
      graphics.rotation = (element.rotation * Math.PI) / 180;
    }

    if (element.cursor) {
      graphics.cursor = element.cursor;
    }

    if (element.pointerDown) {
      graphics.on("pointerdown", (e) => {
        e.stopPropagation();
        eventHandler &&
          eventHandler(element.pointerDown, {
            x: e.global.x,
            y: e.global.y,
          });
      });
    }

    if (element.pointerUp) {
      graphics.on("pointerup", (e) => {
        e.stopPropagation();
        eventHandler &&
          eventHandler(element.pointerUp, {
            x: e.global.x,
            y: e.global.y,
          });
      });
    }

    if (element.pointerMove) {
      graphics.on("pointermove", (e) => {
        e.stopPropagation();
        eventHandler &&
          eventHandler(element.pointerMove, {
            x: e.global.x,
            y: e.global.y,
          });
      });
    }

    if (
      element.cursor ||
      element.pointerDown ||
      element.pointerUp ||
      element.pointerMove
    ) {
      graphics.eventMode = "static";
    }

    const width = element.width;
    const height = element.height;
    graphics.roundRect(0, 0, width, height, element.radius ?? 0);
    if (element.fill) {
      graphics.fill(element.fill);
    }

    if (element.border) {
      graphics.stroke({
        width: element.border.width,
        color: element.border.color,
        alpha: element.border.alpha ?? 1,
        alignment: element.border.alignment ?? 1,
      });
    }

    if (element.anchorX !== undefined) {
      graphics.pivot.x = width * element.anchorX;
    }
    if (element.anchorY !== undefined) {
      graphics.pivot.y = height * element.anchorY;
    }

    if (
      (element.clickEventName || element.rightClickEventName) &&
      eventHandler
    ) {
      graphics.eventMode = "static";
      graphics.on("pointerup", (e) => {
        e.stopPropagation();
        if (e.button === 0) {
          eventHandler(element.clickEventName, element.clickEventPayload);
        } else if (e.button === 2) {
          eventHandler(
            element.rightClickEventName,
            element.rightClickEventPayload,
          );
        }
      });
    }

    if (element.wheelEventName && eventHandler) {
      graphics.eventMode = "static";
      graphics.on("wheel", (e) => {
        e.stopPropagation();
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
        transitionPromises.push(
          transitionClass.add(app, graphics, transition, signal),
        );
      }
    }

    parent.addChild(graphics);

    // Run all transitions in parallel
    await Promise.all(transitionPromises);
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {RectContainerElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<void>}
   */
  remove = async (app, options, signal) => {
    if (signal?.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }

    const { parent, element, transitions = [], getTransitionByType } = options;
    const graphics = parent.getChildByName(element.id);
    if (!graphics) {
      throw new Error(`Rect with id ${element.id} not found`);
    }

    let transitionPromises = [];
    for (const transition of transitions) {
      if (
        transition.elementId === element.id &&
        transition.event === TransitionEvent.Remove
      ) {
        const transitionClass = getTransitionByType(transition.type);
        if (!transitionClass) {
          throw new Error(
            `Transition class not found for type ${transition.type}`,
          );
        }
        transitionPromises.push(
          transitionClass.remove(app, graphics, transition, signal),
        );
      }
    }

    // Run all transitions in parallel
    await Promise.all(transitionPromises);

    // Destroy graphics after transitions complete
    if (graphics) {
      graphics.destroy();
    }
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {RectContainerElement} options.prevElement
   * @param {RectContainerElement} options.nextElement
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
   * @returns {Promise<void>}
   */
  update = async (
    app,
    {
      parent,
      prevElement,
      nextElement,
      transitions = [],
      getTransitionByType,
      eventHandler,
    },
    signal,
  ) => {
    if (signal?.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }

    const graphics = parent.getChildByName(prevElement.id);
    if (!graphics) {
      throw new Error(`Rect with id ${prevElement.id} not found`);
    }

    // Check for update transitions
    let transitionPromises = [];
    for (const transition of transitions) {
      if (
        transition.elementId === prevElement.id &&
        transition.event === TransitionEvent.Update
      ) {
        const transitionClass = getTransitionByType(transition.type);
        if (!transitionClass) {
          throw new Error(
            `Transition class not found for type ${transition.type}`,
          );
        }
        // For update transitions, we pass the current graphics object
        transitionPromises.push(
          transitionClass.add(app, graphics, transition, signal),
        );
      }
    }

    // If there are transitions, apply them
    if (transitionPromises.length > 0) {
      await Promise.all(transitionPromises);
      // After transitions complete, update any properties not covered by transitions
      if (
        prevElement.width !== nextElement.width ||
        prevElement.height !== nextElement.height ||
        prevElement.fill !== nextElement.fill
      ) {
        graphics.clear();
        graphics.rect(0, 0, nextElement.width, nextElement.height);
        graphics.fill(nextElement.fill);
      }
      if (
        prevElement.anchorX !== undefined &&
        nextElement.anchorX !== prevElement.anchorX
      ) {
        graphics.pivot.x = nextElement.width * nextElement.anchorX;
      }
      if (
        prevElement.anchorY !== undefined &&
        nextElement.anchorY !== prevElement.anchorY
      ) {
        graphics.pivot.y = nextElement.height * nextElement.anchorY;
      }
    } else {
      // No transitions, update properties directly
      if (prevElement.x !== undefined && nextElement.x !== prevElement.x) {
        graphics.x = nextElement.x;
      }
      if (prevElement.y !== undefined && nextElement.y !== prevElement.y) {
        graphics.y = nextElement.y;
      }
      if (
        prevElement.alpha !== undefined &&
        nextElement.alpha !== prevElement.alpha
      ) {
        graphics.alpha = nextElement.alpha;
      }
      if (
        prevElement.scaleX !== undefined &&
        nextElement.scaleX !== prevElement.scaleX
      ) {
        graphics.scale.x = nextElement.scaleX;
      }
      if (
        prevElement.scaleY !== undefined &&
        nextElement.scaleY !== prevElement.scaleY
      ) {
        graphics.scale.y = nextElement.scaleY;
      }
      if (
        prevElement.rotation !== undefined &&
        nextElement.rotation !== prevElement.rotation
      ) {
        graphics.rotation = (nextElement.rotation * Math.PI) / 180;
      }

      const borderHasChanged =
        JSON.stringify(prevElement.border) !==
        JSON.stringify(nextElement.border);

      if (
        prevElement.width !== nextElement.width ||
        prevElement.height !== nextElement.height ||
        prevElement.radius !== nextElement.radius ||
        prevElement.fill !== nextElement.fill ||
        borderHasChanged
      ) {
        graphics.clear();
        graphics.roundRect(
          0,
          0,
          nextElement.width,
          nextElement.height,
          nextElement.radius ?? 0,
        );
        if (nextElement.fill) {
          graphics.fill(nextElement.fill);
        }
        if (nextElement.border) {
          graphics.stroke({
            width: nextElement.border.width,
            color: nextElement.border.color,
            alpha: nextElement.border.alpha ?? 1,
            alignment: nextElement.border.alignment ?? 1,
          });
        }
      }

      if (
        prevElement.anchorX !== undefined &&
        nextElement.anchorX !== prevElement.anchorX
      ) {
        graphics.pivot.x = nextElement.width * nextElement.anchorX;
      }
      if (
        prevElement.anchorY !== undefined &&
        nextElement.anchorY !== prevElement.anchorY
      ) {
        graphics.pivot.y = nextElement.height * nextElement.anchorY;
      }
    }
  };
}
