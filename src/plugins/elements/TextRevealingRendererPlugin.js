import {
  Text,
  TextStyle,
  CanvasTextMetrics,
  Container,
  Graphics,
  Sprite,
} from "pixi.js";
import { TransitionEvent, BaseRendererPlugin } from "../../types";

/**
 * @typedef {import('../../types').ContainerElement} ContainerElement
 * @typedef {import('../../types').Application} Application
 * @typedef {import('../../types').Container} Container
 * @typedef {import('../../types').BaseTransition} BaseTransition
 * @typedef {import('../../types').TextStyle} TextStyleType
 */

/**
 * @typedef {Object} TextRevealingElementOptions
 * @property {string} text - The text content
 * @property {number} displaySpeed - The speed at which the text will be displayed
 * @property {boolean} [hasEnded=false] - Whether the text has ended
 * @property {TextStyleType} style - The style of the text
 * @typedef {ContainerElement & TextRevealingElementOptions} TextRevealingElement
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
 * @implements {BaseRendererPlugin}
 */
export class TextRevealingRendererPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  rendererType = "text-revealing";

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {TextRevealingElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  add = async (app, { parent, element }) => {
    const textStyle = createTextStyle(element.style, element.text);
    const newText = new Text({ text: "", style: textStyle });
    newText.label = element.id;
    newText["text_id"] = element.text;

    const container = new Container();

    if (element.x !== undefined) {
      container.x = element.x;
    }
    if (element.y !== undefined) {
      container.y = element.y;
    }

    container.addChild(newText);
    container.label = element.id;

    parent.addChild(container);

    const wordWrapWidth = element.style.wordWrapWidth || 500;

    const segments = element.text
      ? [
          {
            text: element.text,
            style: element.style,
          },
        ]
      : element.segments;
    // const segments = [
    //   {
    //     text: "Mallo Sallo",
    //     style: {
    //       fontSize: 42,
    //       fill: "blue",
    //     },
    //   },
    //   {
    //     text: element.text,
    //     style: element.style,
    //   },
    //   {
    //     text: "hallo wallo",
    //     style: {
    //       fontSize: 32,
    //       fill: "green",
    //     },
    //     furigana: {
    //       text: "あいうえお",
    //       direction: "top",
    //       style: {
    //         fill: "red",
    //         fontSize: 16,
    //       },
    //     },
    //   },
    //   {
    //     text: element.text,
    //     style: element.style,
    //   },
    //   {
    //     text: "This is some good stuff",
    //     style: {
    //       fontSize: 24,
    //       fill: "#ccc",
    //     },
    //     furigana: {
    //       text: "other stuff",
    //       direction: "top",
    //       style: {
    //         fill: "white",
    //         fontSize: 16,
    //       },
    //     },
    //   },
    // ];

    const chunks = [];
    let lineParts = [];

    let x = 0;
    let y = 0;

    let lineMaxHeight = 0;
    while (true) {
      const segment = segments[0];
      if (!segment) {
        if (lineParts.length > 0) {
          chunks.push({
            lineParts,
            y,
          });
        }
        break;
      }

      if (y > 10000) {
        break;
      }

      const styleWithWordWrapWidth = {
        ...segment.style,
        wordWrapWidth: wordWrapWidth - x,
      };

      const measurements = CanvasTextMetrics.measureText(
        segment.text,
        createTextStyle(styleWithWordWrapWidth),
      );

      if (measurements.lineHeight > lineMaxHeight) {
        lineMaxHeight = measurements.lineHeight;
      }

      const m1 = CanvasTextMetrics.measureText(
        "a",
        createTextStyle(styleWithWordWrapWidth),
      );
      const m2 = CanvasTextMetrics.measureText(
        "a a",
        createTextStyle(styleWithWordWrapWidth),
      );
      const spaceWidth = m2.width - m1.width * 2;

      if (measurements.lineWidths[0] + x > wordWrapWidth) {
        x = 0;
        chunks.push({
          lineParts,
          y,
        });
        y += lineMaxHeight;
        lineMaxHeight = 0;
        lineParts = [];
        continue;
      }

      const text = measurements.lines[0];
      const remainingText = measurements.lines.slice(1).join(" ");

      const newText = { text, style: styleWithWordWrapWidth, x, y: 0 };

      lineParts.push(newText);

      if (remainingText && remainingText.length > 0) {
        segment.text = remainingText;
      } else {
        segments.shift();
      }

      if (!text || text.length === 0) {
        continue;
      }

      if (segment.furigana) {
        const furiganaMeasurement = CanvasTextMetrics.measureText(
          segment.furigana.text,
          createTextStyle(segment.furigana.style),
        );
        const furiganaText = {
          text: segment.furigana.text,
          style: segment.furigana.style,
          x: x + (measurements.width - furiganaMeasurement.width) / 2,
          y: -10,
        };
        lineParts.push(furiganaText);
      }
      x += measurements.lineWidths[0] + spaceWidth;
    }

    chunks.forEach((chunk) => {
      const lineContainer = new Container();
      lineContainer.y = chunk.y;
      lineContainer.alpha = 0;
      chunk.lineParts.forEach((part) => {
        const text = new Text({
          text: part.text,
          style: createTextStyle(part.style),
          x: part.x,
          y: part.y,
        });
        lineContainer.addChild(text);
      });
      container.addChild(lineContainer);
    });

    const gradient = new Graphics();
    const gradientHeight = 1000;
    // width of full opacity section
    const xOffset = wordWrapWidth / 2;
    // width of gradient section
    const gradientWidth = wordWrapWidth / 2;
    gradient.fill({ color: 0xffffff, alpha: 1 });
    gradient.rect(0, 0, xOffset, gradientHeight);
    for (let i = 0; i < gradientWidth; i++) {
      gradient.fill({ color: 0xffffff, alpha: 1 - i / gradientWidth });
      gradient.rect(xOffset + i, 0, xOffset + 1, gradientHeight);
    }
    const gradientTexture = app.renderer.generateTexture(gradient);

    const mask = new Sprite(gradientTexture);
    mask.x = -1.35 * xOffset - gradientWidth;

    app.stage.addChild(mask);

    let timeDelta = 0;
    let lineIndex = 1;

    if (chunks.length === 0) {
      return;
    }

    if (element.displaySpeed === 100 || element.hasEnded) {
      container.children.forEach((child) => {
        app.stage.removeChild(mask);
        child.mask = null;
        child.alpha = 1;
      });
      return;
    }

    await new Promise((resolve) => {
      const effect = (time) => {
        if (lineIndex > container.children.length) {
          resolve();
          return;
        }

        if (!container.getChildAt(lineIndex).mask) {
          container.getChildAt(lineIndex).mask = mask;
          container.getChildAt(lineIndex).alpha = 1;
        }

        timeDelta += time.deltaMS;
        const speed = element.displaySpeed || 50;
        // const speed = 50;
        const widthPerMs = speed / 1000;
        mask.x += widthPerMs * timeDelta;

        if (mask.x >= 0) {
          container.getChildAt(lineIndex).mask = null;
          mask.x = -1.35 * xOffset - gradientWidth;
          lineIndex = lineIndex + 1;
          timeDelta = 0;
          if (lineIndex >= container.children.length) {
            container.getChildAt(lineIndex - 1).mask = null;
            app.ticker.remove(effect);
            resolve();
          }
        }
      };

      app.ticker.add(effect);
    });
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {TextRevealingElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  remove = async (app, options) => {
    const { parent, element, transitions = [], getTransitionByType } = options;
    const container = parent.getChildByName(element.id);
    if (!container) {
      console.warn(`Text with id ${element.id} not found`, {
        parent,
      });
      return;
      // throw new Error(`Text with id ${element.id} not found`);
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
          transitionClass.remove(app, container, transition),
        );
      }
    }
    await Promise.all(transitionPromises);
    container.destroy();
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {TextRevealingElement} options.prevElement
   * @param {TextRevealingElement} options.nextElement
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  update = async (app, options) => {
    const { parent, prevElement, nextElement } = options;
    const text = /** @type {Text | null} */ (
      parent.getChildByName(prevElement.id)
    );
    if (!text) {
      console.warn(`Text with id ${prevElement.id} not found`, {
        parent,
      });
      return;
      // throw new Error(`Text with id ${prevElement.id} not found`);
    }
    await this.remove(app, { parent, element: prevElement });
    await this.add(app, { parent, element: nextElement });
    // if (JSON.stringify(prevElement.style) !== JSON.stringify(nextElement.style)) {
    //   text.style = new TextStyle({
    //     wordWrap: nextElement.style.wordWrap || true,
    //     breakWords: !nextElement.text.includes(" "),
    //     align: nextElement.style.align,
    //     fontSize: nextElement.style.fontSize,
    //     fill: nextElement.style.fill,
    //     lineHeight: nextElement.style.lineHeight,
    //     wordWrapWidth: nextElement.style.wordWrapWidth,
    //   });
    // }
    // if (nextElement.x !== undefined) {
    //   text.x = nextElement.x;
    // }
    // if (nextElement.y !== undefined) {
    //   text.y = nextElement.y;
    // }
    // if (prevElement.text !== nextElement.text) {
    //   text.text = "";
    //   return new Promise((resolve) => {
    //     text["text_id"] = nextElement.text;
    //     const revealText = (content, textObject, speed = 50) => {
    //       if (speed === 100) {
    //         textObject.text = content;
    //         resolve();
    //         return;
    //       }

    //       let index = 0;
    //       let currentTimDelta = 0;
    //       const effect = (time) => {
    //         if (textObject["text_id"] !== element.text) {
    //           app.ticker.remove(effect);
    //           setTimeout(() => {
    //             resolve();
    //           }, 500)
    //           return;
    //         }

    //         currentTimDelta += time.deltaMS;
    //         const characterIntervalInMs = 100 - speed;

    //         const characterIndex = Math.min(content.length, Math.floor(currentTimDelta / characterIntervalInMs) + 1);

    //         if (characterIndex > index) {
    //           textObject.text = content.slice(0, characterIndex);
    //           index = characterIndex;
    //           return;
    //         }

    //         if (index >= content.length) {
    //           app.ticker.remove(effect);
    //           setTimeout(() => {
    //             resolve();
    //           }, 500)
    //         }
    //       };

    //       app.ticker.add(effect);
    //     };
    //     /**
    //      * To prevent last characters of a line to jump to move to the next line
    //      * We use the calculation of number of lines beforehand
    //      */
    //     const measurements = CanvasTextMetrics.measureText(nextElement.text, text.style);
    //     revealText(measurements.lines.join("\n"), text, nextElement.displaySpeed);
    // });
    // }
    // TODO implement transitions
  };
}
