import { Sprite, Texture } from "pixi.js";
import { TransitionEvent, BaseRendererPlugin } from "../../types";
import { from, mergeMap, Observable } from "rxjs";

/**
 * @typedef {import('../../types').ContainerElement} ContainerElement
 * @typedef {import('../../types').Application} Application
 * @typedef {import('../../types').Container} Container
 * @typedef {import('../../types').BaseTransition} BaseTransition
 */

/**
 * @typedef {Object} SpriteElementOptions
 * @property {string} url - The URL of the sprite's texture
 * @property {string} [hoverUrl] - The URL of the sprite's texture when hovered
 * @property {string} [clickUrl] - The URL of the sprite's texture when clicked
 * @property {string} eventName
 * @typedef {ContainerElement & SpriteElementOptions} SpriteElement
 */

/**
 * Abstraction for PIXI.Sprite
 * Can handle most cases where an image is involved
 * If you need a sprite that can be hovered or clicked such as a button
 * use SpriteInteractiveRendererPlugin instead
 *
 * @class
 * @extends {BaseRendererPlugin<SpriteElement,BaseTransition>}
 *
 * @example
 * {
 *   "elements": [{
 *     "id": "sprite1",
 *     "type": "sprite",
 *     "url": "https://www.example.com/image.png",
 *     "width": 100,
 *     "height": 100
 *   }]
 * }
 */
export class SpriteRendererPlugin extends BaseRendererPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  rendererType = "sprite";

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {SpriteElement} options.element
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

      const textureButton = Texture.from(element.url);
      // TODO fix texture is undefined in test environment
      let textureButtonHover;
      let textureButtonClicked;

      if (element.hoverUrl) {
        textureButtonHover = Texture.from(element.hoverUrl);
      }
      if (element.clickUrl) {
        textureButtonClicked = Texture.from(element.clickUrl);
      }

      const sprite = new Sprite(textureButton);
      sprite.label = element.id;

      if (element.eventName || element.hoverUrl || element.clickUrl) {
        sprite.cursor = "pointer";
        sprite.eventMode = "static";
      }
      if (element.anchorX !== undefined) {
        sprite.pivot.x = sprite.width * element.anchorX;
        console.log("sprite.width", sprite.width);
      }
      if (element.anchorY !== undefined) {
        sprite.pivot.y = sprite.height * element.anchorY;
        console.log("sprite.height", sprite.height);
      }
      if (element.scaleX !== undefined) {
        sprite.scale.x = element.scaleX;
      }
      if (element.scaleY !== undefined) {
        sprite.scale.y = element.scaleY;
      }
      if (element.rotation !== undefined) {
        sprite.rotation = (element.rotation * Math.PI) / 180;
      }
      if (element.x !== undefined) {
        sprite.x = element.x;
      }
      if (element.y !== undefined) {
        sprite.y = element.y;
      }
      if (element.width !== undefined) {
        sprite.width = element.width;
      }
      if (element.height !== undefined) {
        sprite.height = element.height;
      }

      if (element.zIndex !== undefined) {
        sprite.zIndex = element.zIndex;
      }

      if (element.alpha !== undefined) {
        sprite.alpha = element.alpha;
      }

      sprite
        .on("pointerup", () => {
          sprite.texture = textureButton;
        })
        .on("pointerupoutside", () => {
          sprite.texture = textureButton;
        })
        .on("pointerleave", () => {
          sprite.texture = textureButton;
        });
      if (textureButtonClicked) {
        sprite.on("pointerdown", () => {
          sprite.texture = textureButtonClicked;
        });
      }
      if (textureButtonHover) {
        sprite.on("pointerenter", () => {
          sprite.texture = textureButtonHover;
        });
      }

      sprite.on("pointerup", (e) => {
        e.stopPropagation();
        const button = e.button;
        if (button === 0) {
          eventHandler && eventHandler(element.eventName, element.eventPayload);
        } else if (button === 2) {
          if (element.rightClickEventName && eventHandler) {
            eventHandler(element.rightClickEventName);
          } else {
            app.stage.emit("rightclick", event);
          }
        }
      });

      // sprite.on("rightclick", (event) => {
      //   if (element.rightClickEventName && eventHandler) {
      //     eventHandler(element.rightClickEventName);
      //   } else {
      //     app.stage.emit("rightclick", event);
      //   }
      // });

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
            transitionClass.add(app, sprite, transition),
          );
        }
      }

      parent.addChild(sprite);

      const subscription = from(transitionObservables)
        .pipe(
          mergeMap((task$) => task$), // Runs all in parallel (or use mergeMap(task$, concurrency))
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
   * @param {SpriteElement} options.element
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
      const sprite = parent.getChildByName(element.id);
      if (!sprite) {
        throw new Error(`Sprite with id ${element.id} not found`);
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
            transitionClass.remove(app, sprite, transition),
          );
        }
      }

      const subscription = from(transitionObservables)
        .pipe(
          mergeMap((task$) => task$), // Runs all in parallel (or use mergeMap(task$, concurrency))
        )
        .subscribe({
          error: (err) => {
            console.error("Error:", err);
          },
          // next: val => console.log('Parallel result:', val),
          complete: () => {
            observer.complete();
            if (sprite) {
              sprite.destroy();
            }
          },
        });

      // subscription.unsubscribe();
      return () => {
        subscription.unsubscribe();
        if (sprite) {
          sprite.destroy();
        }
      };
    });
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {SpriteElement} options.prevElement
   * @param {SpriteElement} options.nextElement
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
      transitions,
      getTransitionByType,
      eventHandler,
    },
  ) => {
    return new Observable((observer) => {
      const sprite = parent.getChildByName(prevElement.id);
      if (!sprite) {
        throw new Error(`Sprite with id ${prevElement.id} not found`);
      }

      // Handle basic positional updates if there are minor changes
      if (JSON.stringify(prevElement) !== JSON.stringify(nextElement)) {
        // For significant changes, remove old and add new
        const tasks = [
          this.add(app, {
            parent,
            element: nextElement,
            transitions,
            getTransitionByType,
            eventHandler,
          }),
          this.remove(app, {
            parent,
            element: prevElement,
            transitions,
            getTransitionByType,
          }),
        ];

        const subscription = from(tasks)
          .pipe(
            mergeMap((task$) => task$), // Runs all in parallel (or use mergeMap(task$, concurrency))
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
      } else {
        // For minor changes, update properties directly
        if (nextElement.x !== undefined) {
          sprite.x = nextElement.x;
        }
        if (nextElement.y !== undefined) {
          sprite.y = nextElement.y;
        }
        if (
          nextElement.width !== undefined &&
          nextElement.width !== prevElement.width
        ) {
          sprite.width = nextElement.width;
        }
        if (
          nextElement.height !== undefined &&
          nextElement.height !== prevElement.height
        ) {
          sprite.height = nextElement.height;
        }
        if (
          nextElement.alpha !== undefined &&
          nextElement.alpha !== prevElement.alpha
        ) {
          sprite.alpha = nextElement.alpha;
        }
        observer.complete();
      }

      return () => {};
    });
  };
}
