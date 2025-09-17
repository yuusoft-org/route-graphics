import { Sprite, Texture } from "pixi.js";
import { TransitionEvent, BaseRendererPlugin } from "../../types";

/**
 * @typedef {import('../../types').ContainerElement} ContainerElement
 * @typedef {import('../../types').Application} Application
 * @typedef {import('../../types').Container} Container
 * @typedef {import('../../types').BaseTransition} BaseTransition
 */

/**
 * @typedef {Object} SliderElementOptions
 * @property {string} url - The URL of the sprite's texture
 * @typedef {ContainerElement & SliderElementOptions} SliderElement
 */

/**
 * Abstraction for PIXI.Sprite
 * Can handle most cases where an image is involved
 * If you need a sprite that can be hovered or clicked such as a button
 * use SpriteInteractiveRendererPlugin instead
 *
 * @class
 * @extends {BaseRendererPlugin<SliderElement,BaseTransition>}
 *
 * @example
 * {
 *   "elements": [{
 *     "id": "slider1",
 *     "type": "slider",
 *     "x": 0.5,
 *     "y": 0.5,
 *     "direction": "horizontal",
 *     "width": 100,
 *     "height": 100,
 *     "idleThumb": "https://www.example.com/idle_thumb.png",
 *     "hoverThumb": "https://www.example.com/hover_thumb.png",
 *     "idleBar": "https://www.example.com/idle_bar.png",
 *     "hoverBar": "https://www.example.com/hover_bar.png",
 *   }]
 * }
 */
export class SliderRendererPlugin extends BaseRendererPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  rendererType = "slider";

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {SliderElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  add = async (
    app,
    {
      parent,
      element,
      transitions = [],
      getTransitionByType,
      eventHandler,
      ref,
    },
  ) => {
    const {
      direction,
      idleThumb,
      hoverThumb,
      idleBar,
      hoverBar,
      dragEndEventName,
      dragEventName,
      dragEventPayload,
      initialValue,
    } = element;

    const config = {
      horizontal: {
        axis: "x",
        size: "width",
      },
      vertical: {
        axis: "y",
        size: "height",
      },
    };

    const axis = config[direction].axis;
    const size = config[direction].size;

    const idleHandleTexture = Texture.from(idleThumb);
    const hoverHandleTexture = Texture.from(hoverThumb);
    const idleBarTexture = Texture.from(idleBar);
    const hoverBarTexture = Texture.from(hoverBar);

    // Make the slider
    const slider = new Sprite({
      texture: idleBarTexture,
      anchor: { x: 0, y: 0 },
    });
    slider.label = element.id;
    const sliderSize = slider[size];

    slider.x = element.x || 0;
    slider.y = element.y || 0;

    // Draw the handle
    const handle = new Sprite({
      texture: idleHandleTexture,
      anchor: { x: 0.5, y: 0.5 },
    });

    handle.y = slider.height / 2;
    handle.x = slider.width / 2;
    handle.eventMode = "static";
    handle.cursor = "hover";

    slider.eventMode = "static";
    slider.cursor = "hover";

    handle
      .on("pointerdown", onDragStart)
      .on("pointerup", onDragEnd)
      .on("pointerupoutside", onDragEnd);
    slider
      .on("pointerdown", onSliderDragStart)
      .on("pointerup", onSliderDragEnd)
      .on("pointerupoutside", onSliderDragEnd);

    slider.addChild(handle);

    if (initialValue !== undefined) {
      const halfHandleSize = handle[size] / 2;
      handle[axis] =
        (initialValue / 100) * (sliderSize - handle[size]) + halfHandleSize;
    }

    function onSliderDragStart(e) {
      handle.texture = hoverHandleTexture;
      slider.texture = hoverBarTexture;
      onDrag(e);
      app.stage.eventMode = "static";
      app.stage.addEventListener("pointermove", onDrag);
    }

    function onSliderDragEnd(e) {
      handle.texture = idleHandleTexture;
      slider.texture = idleBarTexture;
      onDrag(e);
      app.stage.eventMode = "auto";
      app.stage.removeEventListener("pointermove", onDrag);
    }

    // Listen to pointermove on stage once handle is pressed.
    function onDragStart(e) {
      e.stopPropagation();
      // replace texture of handler
      handle.texture = hoverHandleTexture;
      slider.texture = hoverBarTexture;
      app.stage.eventMode = "static";
      app.stage.addEventListener("pointermove", onDrag);
    }

    // Stop dragging feedback once the handle is released.
    function onDragEnd(e) {
      handle.texture = idleHandleTexture;
      slider.texture = idleBarTexture;
      app.stage.eventMode = "auto";
      app.stage.removeEventListener("pointermove", onDrag);
      if (dragEndEventName) {
        const axisValue = slider.toLocal(e.global)[axis];
        const halfHandleSize = handle[size] / 2;
        handle[axis] = Math.max(
          0 + halfHandleSize,
          Math.min(axisValue, sliderSize - halfHandleSize),
        );
        const value = Math.floor(
          ((handle[axis] - halfHandleSize) / (sliderSize - handle[size])) * 100,
        );
        const stringifiedPayload = JSON.stringify(dragEventPayload);
        eventHandler &&
          eventHandler(
            dragEndEventName,
            JSON.parse(
              stringifiedPayload.replace('"{{ value }}"', String(value)),
            ),
          );
      }
    }

    function onDrag(e) {
      const axisValue = slider.toLocal(e.global)[axis];
      const halfHandleSize = handle[size] / 2;
      handle[axis] = Math.max(
        0 + halfHandleSize,
        Math.min(axisValue, sliderSize - halfHandleSize),
      );
      const value = Math.floor(
        ((handle[axis] - halfHandleSize) / (sliderSize - handle[size])) * 100,
      );
      if (dragEventName) {
        const stringifiedPayload = JSON.stringify(dragEventPayload);
        eventHandler &&
          eventHandler(
            dragEventName,
            JSON.parse(
              stringifiedPayload.replace('"{{ value }}"', String(value)),
            ),
          );
      }
      return value;
    }

    if (ref) {
      ref.current = {
        updateValue: (value) => {
          const halfHandleSize = handle[size] / 2;
          handle[axis] =
            (value / 100) * (sliderSize - handle[size]) + halfHandleSize;
        },
      };
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
        transitionPromises.push(transitionClass.add(app, slider, transition));
      }
    }

    parent.addChild(slider);
    await Promise.all(transitionPromises);
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {SliderElement} options.element
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  remove = async (app, options) => {
    const { parent, element, transitions = [], getTransitionByType } = options;
    const sprite = parent.getChildByName(element.id);
    if (!sprite) {
      console.warn(`Sprite with id ${element.id} not found`);
      return;
      // throw new Error(`Sprite with id ${element.id} not found`);
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
          transitionClass.remove(app, sprite, transition),
        );
      }
    }
    // all transitions run in parallel
    // wait for all transitions to complete before removing the sprite
    await Promise.all(transitionPromises);
    sprite.destroy();
  };

  /**
   * @param {Application} app
   * @param {Object} options
   * @param {Container} options.parent
   * @param {SliderElement} options.prevElement
   * @param {SliderElement} options.nextElement
   * @param {BaseTransition[]} [options.transitions=[]]
   * @param {Function} options.getTransitionByType
   * @returns {Promise<undefined>}
   */
  update = async (
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
    const sprite = parent.getChildByName(prevElement.id);
    if (!sprite) {
      console.warn(`Slider with id ${prevElement.id} not found`, {
        parent: parent,
      });
      return;
      // throw new Error(`Slider with id ${prevElement.id} not found`);
    }
    // TODO replace instead of removing and adding for when transitions is not needed
    // TODO change id of to be removed sprite so that there won't be 2 sprites with same id at once
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
