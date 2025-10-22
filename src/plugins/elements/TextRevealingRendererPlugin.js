import {
  Text,
  TextStyle,
  CanvasTextMetrics,
  Container,
  Graphics,
  Sprite,
  Texture,
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
 * @property {Array<{text: string, style?: Object, align?: 'top'|'center'|'bottom', furigana?: {text: string, style: Object}}>} content - The content array with text objects
 * @property {number} displaySpeed - The speed at which the text will be displayed
 * @property {boolean} [hasEnded=false] - Whether the text has ended
 * @property {TextStyleType} style - The style of the text
 * @property {'top'|'center'|'bottom'} [align='top'] - Vertical alignment of content blocks
 * @property {Object} [indicator] - Indicator configuration
 * @property {Object} [indicator.revealing] - Revealing indicator config
 * @property {string} [indicator.revealing.url] - URL for revealing indicator sprite
 * @property {number} [indicator.revealing.width] - Width of revealing indicator sprite
 * @property {number} [indicator.revealing.height] - Height of revealing indicator sprite
 * @property {Object} [indicator.complete] - Complete indicator config
 * @property {string} [indicator.complete.url] - URL for complete indicator sprite
 * @property {number} [indicator.complete.width] - Width of complete indicator sprite
 * @property {number} [indicator.complete.height] - Height of complete indicator sprite
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
    whiteSpace: "pre",
    trim: false,
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
    const firstContentText = element.content?.[0]?.text || "";
    const textStyle = createTextStyle(element.style, firstContentText);
    const newText = new Text({ text: "", style: textStyle });
    newText.label = element.id;
    newText["text_id"] = firstContentText;

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

    const segments =
      element.content && element.content.length > 0
        ? element.content.map((item) => ({
            // HACK: Replace trailing spaces with non-breaking spaces to prevent PixiJS from trimming them
            // PixiJS internally trims trailing spaces in TextMetrics.trimRight(), so we use \u00A0 instead
            text: item.text.replace(/ +$/, (match) =>
              "\u00A0".repeat(match.length),
            ),
            style: item.style
              ? { ...element.style, ...item.style }
              : element.style,
            align: item.align || element.align || "top",
            furigana: item.furigana,
          }))
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

    // If there's only one content item, use the original line-by-line wrapping logic
    if (segments.length === 1) {
      let lineParts = [];
      let x = 0;
      let y = 0;
      let lineMaxHeight = 0;

      const segmentsCopy = [...segments];

      while (true) {
        const segment = segmentsCopy[0];
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

        let text = measurements.lines[0];

        // Preserve trailing spaces that might get trimmed by measureText
        if (
          measurements.lines.length === 1 &&
          segment.text.endsWith(" ") &&
          !text.endsWith(" ")
        ) {
          text += " ";
        }
        const remainingText = measurements.lines.slice(1).join(" ");

        const newText = {
          text,
          style: styleWithWordWrapWidth,
          x,
          y: 0,
          align: segment.align,
        };

        lineParts.push(newText);

        if (remainingText && remainingText.length > 0) {
          segment.text = remainingText;
        } else {
          segmentsCopy.shift();
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
    } else {
      // Multiple content blocks - arrange horizontally with proper wrapping
      let lineParts = [];
      let x = 0;
      let y = 0;
      let lineMaxHeight = 0;

      const segmentsCopy = [...segments];
      const segmentFuriganaAdded = new WeakSet(); // Track which segments already have furigana added

      while (true) {
        const segment = segmentsCopy[0];
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

        let text = measurements.lines[0];

        // Preserve trailing spaces that might get trimmed by measureText
        if (
          measurements.lines.length === 1 &&
          segment.text.endsWith(" ") &&
          !text.endsWith(" ")
        ) {
          text += " ";
        }
        const remainingText = measurements.lines.slice(1).join(" ");

        const newText = {
          text,
          style: styleWithWordWrapWidth,
          x,
          y: 0,
          align: segment.align,
        };

        lineParts.push(newText);

        if (remainingText && remainingText.length > 0) {
          segment.text = remainingText;
        } else {
          segmentsCopy.shift();
        }

        if (!text || text.length === 0) {
          continue;
        }

        // Only add furigana once per segment (on first line)
        if (segment.furigana && !segmentFuriganaAdded.has(segment)) {
          segmentFuriganaAdded.add(segment);
          const furiganaMeasurement = CanvasTextMetrics.measureText(
            segment.furigana.text,
            createTextStyle(segment.furigana.style),
          );
          const furiganaText = {
            text: segment.furigana.text,
            style: segment.furigana.style,
            x: x + (measurements.lineWidths[0] - furiganaMeasurement.width) / 2,
            y: 0,
            isFurigana: true,
            parentAlign: segment.align,
            parentX: x,
            parentWidth: measurements.lineWidths[0],
          };
          lineParts.push(furiganaText);
        }
        x += measurements.lineWidths[0];
      }
    }

    chunks.forEach((chunk) => {
      const lineContainer = new Container();
      lineContainer.y = chunk.y;
      lineContainer.alpha = 0;

      // Calculate the maximum height in this line for alignment
      let maxHeight = 0;
      chunk.lineParts.forEach((part) => {
        const measurements = CanvasTextMetrics.measureText(
          part.text,
          createTextStyle(part.style),
        );
        if (measurements.height > maxHeight) {
          maxHeight = measurements.height;
        }
      });

      // First pass: render non-furigana text and calculate their positions
      const textPositions = new Map();
      chunk.lineParts.forEach((part) => {
        if (!part.isFurigana) {
          const measurements = CanvasTextMetrics.measureText(
            part.text,
            createTextStyle(part.style),
          );

          // Calculate y offset based on alignment
          let yOffset = part.y;
          const align = part.align || "top";
          if (align === "center") {
            yOffset += (maxHeight - measurements.height) / 2;
          } else if (align === "bottom") {
            yOffset += maxHeight - measurements.height;
          }

          const text = new Text({
            text: part.text,
            style: createTextStyle(part.style),
            x: part.x,
            y: yOffset,
          });
          lineContainer.addChild(text);

          // Store position info for furigana calculation
          textPositions.set(part.x, { yOffset, height: measurements.height });
        }
      });

      // Second pass: render furigana based on parent positions
      chunk.lineParts.forEach((part) => {
        if (part.isFurigana) {
          const measurements = CanvasTextMetrics.measureText(
            part.text,
            createTextStyle(part.style),
          );

          // Get parent's position info
          const parentPos = textPositions.get(part.parentX);
          let yOffset = -measurements.height - 5;

          if (parentPos) {
            // Position furigana above the parent text
            yOffset = parentPos.yOffset - measurements.height + 2;
          }

          const text = new Text({
            text: part.text,
            style: createTextStyle(part.style),
            x: part.x,
            y: yOffset,
          });
          lineContainer.addChild(text);
        }
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

    // Create indicator sprites if configured
    let revealingIndicator = null;
    let completeIndicator = null;

    if (element.indicator?.revealing?.url) {
      const revealingTexture = Texture.from(element.indicator.revealing.url);
      revealingIndicator = new Sprite(revealingTexture);
      revealingIndicator.anchor.set(0, 0.5);
      revealingIndicator.visible = false;

      // Set dimensions if specified
      if (element.indicator.revealing.width !== undefined) {
        revealingIndicator.width = element.indicator.revealing.width;
      }
      if (element.indicator.revealing.height !== undefined) {
        revealingIndicator.height = element.indicator.revealing.height;
      }

      container.addChild(revealingIndicator);
    }

    if (element.indicator?.complete?.url) {
      const completeTexture = Texture.from(element.indicator.complete.url);
      completeIndicator = new Sprite(completeTexture);
      completeIndicator.anchor.set(0, 0.5);
      completeIndicator.visible = false;

      // Set dimensions if specified
      if (element.indicator.complete.width !== undefined) {
        completeIndicator.width = element.indicator.complete.width;
      }
      if (element.indicator.complete.height !== undefined) {
        completeIndicator.height = element.indicator.complete.height;
      }

      container.addChild(completeIndicator);
    }

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

      // Show complete indicator immediately for fast display mode
      if (completeIndicator) {
        completeIndicator.visible = true;
        // Position at the end of the last line
        if (chunks.length > 0) {
          const lastChunk = chunks[chunks.length - 1];
          let maxX = 0;
          let maxY = lastChunk.y;

          lastChunk.lineParts.forEach((part) => {
            if (!part.isFurigana) {
              const measurements = CanvasTextMetrics.measureText(
                part.text,
                createTextStyle(part.style),
              );
              const endX = part.x + measurements.width;
              if (endX > maxX) {
                maxX = endX;
              }
            }
          });

          completeIndicator.x = maxX + 10;
          completeIndicator.y = maxY + 20;
        }
      }

      return;
    }

    await new Promise((resolve) => {
      const effect = (time) => {
        if (lineIndex > container.children.length) {
          // Hide revealing indicator and show complete indicator
          if (revealingIndicator) {
            revealingIndicator.visible = false;
          }
          if (completeIndicator) {
            completeIndicator.visible = true;
            // Position at the end of the last line
            if (chunks.length > 0) {
              const lastChunk = chunks[chunks.length - 1];
              let maxX = 0;
              let maxY = lastChunk.y;

              lastChunk.lineParts.forEach((part) => {
                if (!part.isFurigana) {
                  const measurements = CanvasTextMetrics.measureText(
                    part.text,
                    createTextStyle(part.style),
                  );
                  const endX = part.x + measurements.width;
                  if (endX > maxX) {
                    maxX = endX;
                  }
                }
              });

              completeIndicator.x = maxX + 10;
              completeIndicator.y = maxY + 20;
            }
          }
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

        // Update revealing indicator position using the same mask logic
        if (revealingIndicator && lineIndex <= chunks.length) {
          const currentChunk = chunks[lineIndex - 1];
          if (
            currentChunk &&
            (container.getChildAt(lineIndex).mask === mask ||
              lineIndex === chunks.length)
          ) {
            revealingIndicator.visible = true;

            // Position ahead of the mask by a fixed amount to ensure it's at the visible text edge
            // Add extra offset to compensate for the mask lag
            const forwardOffset = 150; // Fixed pixels ahead to ensure visibility
            const maskVisibleBoundary =
              mask.x + xOffset + gradientWidth + forwardOffset;

            // Find the rightmost revealed text position and check if line is complete
            let indicatorX = 0;
            let hasVisibleText = false;
            let lineComplete = true;
            let totalLineWidth = 0;

            // Calculate total line width first
            for (const part of currentChunk.lineParts) {
              if (!part.isFurigana) {
                const measurements = CanvasTextMetrics.measureText(
                  part.text,
                  createTextStyle(part.style),
                );
                totalLineWidth = Math.max(
                  totalLineWidth,
                  part.x + measurements.width,
                );
              }
            }

            for (const part of currentChunk.lineParts) {
              if (!part.isFurigana) {
                const measurements = CanvasTextMetrics.measureText(
                  part.text,
                  createTextStyle(part.style),
                );
                const partStartX = part.x;
                const partEndX = part.x + measurements.width;

                if (partEndX <= maskVisibleBoundary) {
                  // This text is fully revealed - position at its end
                  indicatorX = partEndX;
                  hasVisibleText = true;
                } else if (partStartX < maskVisibleBoundary) {
                  // This text is partially revealed - position at the visible boundary
                  indicatorX = Math.max(partStartX, maskVisibleBoundary);
                  hasVisibleText = true;
                  lineComplete = false;
                  break;
                } else {
                  // Text hasn't started revealing yet
                  lineComplete = false;
                }
              }
            }

            // Check if the entire line is revealed
            if (maskVisibleBoundary >= totalLineWidth) {
              lineComplete = true;
            }

            // Show revealing indicator throughout animation, including on last line
            if (hasVisibleText && indicatorX > 0) {
              // Show revealing indicator
              revealingIndicator.x = indicatorX;
              revealingIndicator.y = currentChunk.y + 20;
            } else if (lineIndex === chunks.length && totalLineWidth > 0) {
              // On last line, keep revealing indicator at the end even if mask hasn't caught up
              revealingIndicator.x = totalLineWidth;
              revealingIndicator.y = currentChunk.y + 20;
            } else {
              revealingIndicator.visible = false;
            }

            // Keep complete indicator hidden during animation
            if (completeIndicator) {
              completeIndicator.visible = false;
            }
          } else {
            revealingIndicator.visible = false;
          }
        }

        if (mask.x >= 0) {
          container.getChildAt(lineIndex).mask = null;
          mask.x = -1.35 * xOffset - gradientWidth; // Restore original position for proper reveal
          lineIndex = lineIndex + 1;
          timeDelta = 0;
          // Check if we're on the last line and it's almost complete
          if (lineIndex === container.children.length) {
            // Immediately switch to complete indicator when last line starts
            if (revealingIndicator) {
              revealingIndicator.visible = false;
            }
            if (completeIndicator) {
              completeIndicator.visible = true;
              // Position at the end of the last line
              if (chunks.length > 0) {
                const lastChunk = chunks[chunks.length - 1];
                let maxX = 0;
                let maxY = lastChunk.y;

                lastChunk.lineParts.forEach((part) => {
                  if (!part.isFurigana) {
                    const measurements = CanvasTextMetrics.measureText(
                      part.text,
                      createTextStyle(part.style),
                    );
                    const endX = part.x + measurements.width;
                    if (endX > maxX) {
                      maxX = endX;
                    }
                  }
                });

                completeIndicator.x = maxX + 10;
                completeIndicator.y = maxY + 20;
              }
            }

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
