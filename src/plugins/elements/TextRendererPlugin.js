import { Text, TextStyle, Rectangle } from "pixi.js";
import { TransitionEvent, BaseRendererPlugin } from "../../types";
import { from, mergeMap, Observable } from "rxjs";

/**
 * @typedef {import('../../types').ContainerElement} ContainerElement
 * @typedef {import('../../types').Application} Application
 * @typedef {import('../../types').Container} Container
 * @typedef {import('../../types').BaseTransition} BaseTransition
 * @typedef {import('../../types').TextStyle} TextStyleType
 * @typedef {Object} SoundStage
 * @property {Function} add - Add a sound to the sound stage
 */

/**
 * @typedef {Object} TextElementOptions
 * @property {string} text - The text content
 * @property {string} eventName - Event name
 * @property {TextStyleType} style - The style of the text
 * @property {TextStyleType} hoverStyle - The style of the text
 * @property {TextStyleType} clickedStyle - The style of the text
 * @property {string} [clickSoundUrl] - URL to the click sound
 * @property {number} [clickSoundVolume] - Volume of the click sound
 * @property {string} [hoverSoundUrl] - URL to the hover sound
 * @property {number} [hoverSoundVolume] - Volume of the hover sound
 * @property {any} [eventPayload] - Payload for the event
 * @typedef {ContainerElement & TextElementOptions} TextElement
 */

/**
 * @typedef {Application & { soundStage?: SoundStage }} ApplicationWithSoundStage
 */

const createTextStyle = (style, breakWords = false) => {
  return new TextStyle({
    wordWrap: style.wordWrap || true,
    breakWords,
    align: style.align,
    fill: style.fill,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    wordWrapWidth: style.wordWrapWidth,
    fontFamily: style.fontFamily || "Roboto",
    stroke: style.strokeColor
      ? {
          color: style.strokeColor,
          width: style.strokeWidth,
        }
      : undefined,
  });
};

/**
 * @class TextRendererPlugin
 */
export class TextRendererPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  rendererType = "text";

  /**
   * @param {ApplicationWithSoundStage} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {TextElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @param {Function} [options.eventHandler]
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

      const textStyle = createTextStyle(element.style);
      const newText = new Text({ text: element.text, style: textStyle });

      let hoverTextStyle;
      if (element.hoverStyle) {
        hoverTextStyle = createTextStyle(element.hoverStyle);
      }

      let clickedTextStyle;
      if (element.clickedStyle) {
        clickedTextStyle = createTextStyle(element.clickedStyle);
      }

      if (element.eventName || element.clickedStyle || element.hoverStyle) {
        newText.cursor = "pointer";
        newText.eventMode = "static";
      }
      newText.label = element.id;
      if (element.x !== undefined) {
        newText.x = element.x;
      }
      if (element.y !== undefined) {
        newText.y = element.y;
      }
      if (element.anchorX !== undefined) {
        newText.anchor.x = element.anchorX;
      }
      if (element.anchorY !== undefined) {
        newText.anchor.y = element.anchorY;
      }
      if (element.anchorX !== undefined || element.anchorY !== undefined) {
        const bounds = newText.getLocalBounds();
        newText.hitArea = new Rectangle(
          -bounds.width * newText.anchor.x,
          -bounds.height * newText.anchor.y,
          bounds.width,
          bounds.height,
        );
      }

      newText
        .on("pointerupoutside", () => {
          newText.style = textStyle;
        })
        .on("pointerup", () => {
          newText.style = textStyle;
        })
        .on("pointerleave", () => {
          newText.style = textStyle;
        });

      newText.on("pointerup", (e) => {
        if (element.clickSoundUrl && app.soundStage) {
          app.soundStage.add({
            id: `${element.id}-click-${Math.random()}`,
            url: element.clickSoundUrl,
            loop: false,
            volume: element.clickSoundVolume ?? 50 / 100,
          });
        }
        e.stopPropagation();
        eventHandler && eventHandler(element.eventName, element.eventPayload);
      });

      if (clickedTextStyle) {
        newText.on("pointerdown", () => {
          newText.style = clickedTextStyle;
        });
      }
      if (hoverTextStyle) {
        newText.on("pointerenter", () => {
          newText.style = hoverTextStyle;

          if (
            element.hoverSoundUrl &&
            app.soundStage &&
            element.hoverSoundVolume !== undefined
          ) {
            app.soundStage.add({
              id: `${element.id}-hover-${Math.random()}`,
              url: element.hoverSoundUrl,
              loop: false,
              volume: element.hoverSoundVolume / 100,
            });
          }
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
            transitionClass.add(app, newText, transition),
          );
        }
      }

      parent.addChild(newText);

      const subscription = from(transitionObservables)
        .pipe(
          mergeMap((task$) => task$), // Runs all in parallel
        )
        .subscribe({
          error: (err) => {
            console.error("Error:", err);
            observer.error(err);
          },
          complete: () => observer.complete(),
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  };

  /**
   * @param {ApplicationWithSoundStage} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {TextElement} options.element
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
      const text = parent.getChildByName(element.id);
      if (!text) {
        console.warn(`Text with id ${element.id} not found`);
        observer.complete();
        return;
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
            transitionClass.remove(app, text, transition),
          );
        }
      }

      const subscription = from(transitionObservables)
        .pipe(
          mergeMap((task$) => task$), // Runs all in parallel
        )
        .subscribe({
          error: (err) => {
            console.error("Error:", err);
            observer.error(err);
          },
          complete: () => {
            text.destroy();
            observer.complete();
          },
        });

      return () => {
        subscription.unsubscribe();
        if (text) {
          text.destroy();
        }
      };
    });
  };

  /**
   * @param {ApplicationWithSoundStage} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {TextElement} options.prevElement
   * @param {TextElement} options.nextElement
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @param {Function} [options.eventHandler]
   * @returns {Observable<undefined>}
   */
  update = (app, options) => {
    return new Observable((observer) => {
      const {
        parent,
        prevElement,
        nextElement,
        transitions,
        getTransitionByType,
        eventHandler,
      } = options;
      const text = /** @type {Text | null} */ (
        parent.getChildByName(prevElement.id)
      );
      if (!text) {
        console.warn(`Text with id ${prevElement.id} not found`);
        observer.complete();
        return;
      }

      // If significant changes, remove old and add new
      if (JSON.stringify(prevElement) !== JSON.stringify(nextElement)) {
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
            mergeMap((task$) => task$), // Runs all in parallel
          )
          .subscribe({
            error: (err) => {
              console.error("Error:", err);
              observer.error(err);
            },
            complete: () => observer.complete(),
          });

        return () => {
          subscription.unsubscribe();
        };
      } else {
        // Simple updates
        if (prevElement.text !== nextElement.text) {
          text.text = nextElement.text;
        } else {
        }

        if (
          JSON.stringify(prevElement.style) !==
          JSON.stringify(nextElement.style)
        ) {
          text.style = createTextStyle(nextElement?.style);
        }

        if (nextElement.x !== undefined) {
          text.x = nextElement.x;
        }

        if (nextElement.y !== undefined) {
          text.y = nextElement.y;
        }

        observer.complete();
      }

      return () => {};
    });
  };
}
