import { Container, Graphics } from "pixi.js";
import { TransitionEvent, BaseRendererPlugin } from "../../types";
import { from, mergeMap, Observable } from "rxjs";

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
   * @returns {Observable<any>}
   */
  add = (app, options) => {
    return new Observable((observer) => {
      const {
        parent,
        element,
        transitions = [],
        getTransitionByType,
        eventHandler,
      } = options;

      const graphics = new Graphics();
      graphics.label = element.id;

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

      const width = element.width;
      const height = element.height;
      graphics.rect(0, 0, width, height);
      graphics.fill(element.fill);

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

      const transitionObservables = [];

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
          transitionObservables.push(
            transitionClass.add(app, graphics, transition),
          );
        }
      }

      parent.addChild(graphics);

      const subscription = from(transitionObservables)
        .pipe(
          mergeMap((task$) => task$),
        )
        .subscribe({
          error: (err) => {
            console.error("Error:", err);
          },
          complete: () => observer.complete(),
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {RectContainerElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Observable<any>}
   */
  remove = (app, options) => {
    return new Observable((observer) => {
      const {
        parent,
        element,
        transitions = [],
        getTransitionByType,
      } = options;
      const graphics = parent.getChildByName(element.id);
      if (!graphics) {
        throw new Error(`Rect with id ${element.id} not found`);
      }
      
      let transitionObservables = [];
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
          transitionObservables.push(
            transitionClass.remove(app, graphics, transition),
          );
        }
      }

      const subscription = from(transitionObservables)
        .pipe(
          mergeMap((task$) => task$),
        )
        .subscribe({
          error: (err) => {
            console.error("Error:", err);
          },
          complete: () => {
            observer.complete();
            if (graphics) {
              graphics.destroy();
            }
          },
        });

      return () => {
        subscription.unsubscribe();
        if (graphics) {
          graphics.destroy();
        }
      };
    });
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {RectContainerElement} options.prevElement
   * @param {RectContainerElement} options.nextElement
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Observable<undefined>}
   */
  update = (
    app,
    {
      parent,
      prevElement,
      nextElement,
      transitions = [],
      getTransitionByType,
      eventHandler,
    },
  ) => {
    return new Observable((observer) => {
      const graphics = parent.getChildByName(prevElement.id);
      if (!graphics) {
        throw new Error(`Rect with id ${prevElement.id} not found`);
      }

      // Check for update transitions
      let transitionObservables = [];
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
          transitionObservables.push(
            transitionClass.add(app, graphics, transition),
          );
        }
      }

      // If there are transitions, apply them
      if (transitionObservables.length > 0) {
        const subscription = from(transitionObservables)
          .pipe(
            mergeMap((task$) => task$),
          )
          .subscribe({
            error: (err) => {
              console.error("Error:", err);
            },
            complete: () => {
              // After transitions complete, update any properties not covered by transitions
              if (prevElement.width !== nextElement.width || prevElement.height !== nextElement.height || prevElement.fill !== nextElement.fill) {
                graphics.clear();
                graphics.rect(0, 0, nextElement.width, nextElement.height);
                graphics.fill(nextElement.fill);
              }
              if (prevElement.anchorX !== undefined && nextElement.anchorX !== prevElement.anchorX) {
                graphics.pivot.x = nextElement.width * nextElement.anchorX;
              }
              if (prevElement.anchorY !== undefined && nextElement.anchorY !== prevElement.anchorY) {
                graphics.pivot.y = nextElement.height * nextElement.anchorY;
              }
              observer.complete();
            },
          });

        return () => {
          subscription.unsubscribe();
        };
      } else {
        // No transitions, update properties directly
        if (prevElement.x !== undefined && nextElement.x !== prevElement.x) {
          graphics.x = nextElement.x;
        }
        if (prevElement.y !== undefined && nextElement.y !== prevElement.y) {
          graphics.y = nextElement.y;
        }
        if (prevElement.alpha !== undefined && nextElement.alpha !== prevElement.alpha) {
          graphics.alpha = nextElement.alpha;
        }
        if (prevElement.scaleX !== undefined && nextElement.scaleX !== prevElement.scaleX) {
          graphics.scale.x = nextElement.scaleX;
        }
        if (prevElement.scaleY !== undefined && nextElement.scaleY !== prevElement.scaleY) {
          graphics.scale.y = nextElement.scaleY;
        }
        if (prevElement.rotation !== undefined && nextElement.rotation !== prevElement.rotation) {
          graphics.rotation = (nextElement.rotation * Math.PI) / 180;
        }

        if (prevElement.width !== nextElement.width || prevElement.height !== nextElement.height || prevElement.fill !== nextElement.fill) {
          graphics.clear();
          graphics.rect(0, 0, nextElement.width, nextElement.height);
          graphics.fill(nextElement.fill);
        }

        if (prevElement.anchorX !== undefined && nextElement.anchorX !== prevElement.anchorX) {
          graphics.pivot.x = nextElement.width * nextElement.anchorX;
        }
        if (prevElement.anchorY !== undefined && nextElement.anchorY !== prevElement.anchorY) {
          graphics.pivot.y = nextElement.height * nextElement.anchorY;
        }

        observer.complete();
        return () => {};
      }
    });
  };
}
