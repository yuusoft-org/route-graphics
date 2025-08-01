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
      const scaleX = element.scaleX ?? 1;
      const scaleY = element.scaleY ?? 1;

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
      }
      if (element.anchorY !== undefined) {
        sprite.pivot.y = sprite.height * element.anchorY;
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
        sprite.width = element.width * scaleX;
      } else {
        sprite.width *= scaleX;
      }
      if (element.height !== undefined) {
        sprite.height = element.height * scaleY;
      } else {
        sprite.height *= scaleY;
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

      // Check if URL changed (image update)
      const urlChanged = prevElement.url !== nextElement.url ||
                        prevElement.hoverUrl !== nextElement.hoverUrl ||
                        prevElement.clickUrl !== nextElement.clickUrl;

      if (urlChanged) {
        // For URL changes, we need to update the texture
        if (nextElement.url) {
          const textureButton = Texture.from(nextElement.url);
          sprite.texture = textureButton;
          
          // Reset size when texture changes, especially for empty sprites getting their first image
          if (!prevElement.url && nextElement.url) {
            // This is a new image for an empty sprite
            // Wait for texture to load to get correct dimensions
            if (textureButton.baseTexture.valid) {
              const scaleX = nextElement.scaleX ?? 1;
              const scaleY = nextElement.scaleY ?? 1;
              sprite.width = (nextElement.width ?? textureButton.width) * scaleX;
              sprite.height = (nextElement.height ?? textureButton.height) * scaleY;
            } else {
              textureButton.baseTexture.once('loaded', () => {
                const scaleX = nextElement.scaleX ?? 1;
                const scaleY = nextElement.scaleY ?? 1;
                sprite.width = (nextElement.width ?? textureButton.width) * scaleX;
                sprite.height = (nextElement.height ?? textureButton.height) * scaleY;
              });
            }
          }
        }
        
        // Update hover and click textures if needed
        if (nextElement.hoverUrl) {
          const textureButtonHover = Texture.from(nextElement.hoverUrl);
          sprite.off('pointerenter'); // Remove old listener
          sprite.on('pointerenter', () => {
            sprite.texture = textureButtonHover;
          });
        }
        
        if (nextElement.clickUrl) {
          const textureButtonClicked = Texture.from(nextElement.clickUrl);
          sprite.off('pointerdown'); // Remove old listener
          sprite.on('pointerdown', () => {
            sprite.texture = textureButtonClicked;
          });
        }
      }

      // Update other properties directly
      if (nextElement.x !== undefined && nextElement.x !== prevElement.x) {
        sprite.x = nextElement.x;
      }
      if (nextElement.y !== undefined && nextElement.y !== prevElement.y) {
        sprite.y = nextElement.y;
      }
      if (nextElement.rotation !== undefined && nextElement.rotation !== prevElement.rotation) {
        sprite.rotation = (nextElement.rotation * Math.PI) / 180;
      }
      
      const scaleX = nextElement.scaleX ?? 1;
      const scaleY = nextElement.scaleY ?? 1;
      
      if (nextElement.width !== undefined && (nextElement.width !== prevElement.width || scaleX !== (prevElement.scaleX ?? 1))) {
        sprite.width = nextElement.width * scaleX;
      }
      if (nextElement.height !== undefined && (nextElement.height !== prevElement.height || scaleY !== (prevElement.scaleY ?? 1))) {
        sprite.height = nextElement.height * scaleY;
      }
      
      if (nextElement.anchorX !== undefined && nextElement.anchorX !== prevElement.anchorX) {
        sprite.pivot.x = sprite.width * nextElement.anchorX / scaleX;
      }
      if (nextElement.anchorY !== undefined && nextElement.anchorY !== prevElement.anchorY) {
        sprite.pivot.y = sprite.height * nextElement.anchorY / scaleY;
      }
      
      if (nextElement.zIndex !== undefined && nextElement.zIndex !== prevElement.zIndex) {
        sprite.zIndex = nextElement.zIndex;
      }
      
      if (nextElement.alpha !== undefined && nextElement.alpha !== prevElement.alpha) {
        sprite.alpha = nextElement.alpha;
      }

      // Update interactivity
      if ((nextElement.eventName || nextElement.hoverUrl || nextElement.clickUrl) && !sprite.eventMode) {
        sprite.cursor = "pointer";
        sprite.eventMode = "static";
      }

      observer.complete();
      return () => {};
    });
  };
}
