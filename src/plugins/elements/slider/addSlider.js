import { Sprite, Container } from "pixi.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import {
  bindSliderInteractions,
  getSliderLabels,
  getSliderTexture,
  resizeSliderThumb,
  syncSliderRuntime,
} from "./sliderRuntime.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";
import { syncShaderFilters } from "../util/shaderFilterEffect.js";

/**
 * Add slider element to the stage
 * @param {import("../elementPlugin").AddElementOptions} params
 */
export const addSlider = ({
  app,
  parent,
  element: sliderComputedNode,
  animations,
  animationBus,
  completionTracker,
  eventHandler,
  renderContext,
  zIndex,
}) => {
  const { id, width, height, alpha, thumbSrc, barSrc } = sliderComputedNode;

  // Create container for the slider
  const sliderContainer = new Container();
  sliderContainer.label = id;
  sliderContainer.zIndex = zIndex;
  sliderContainer.alpha = alpha;
  applyElementTransform(sliderContainer, sliderComputedNode);
  sliderContainer.sortableChildren = true;
  sliderContainer.eventMode = "static";

  const labels = getSliderLabels(id);

  // Create bar sprite
  const bar = new Sprite(getSliderTexture(barSrc));
  bar.label = labels.bar;
  bar.eventMode = "static";
  bar.zIndex = 1;

  // Create thumb sprite
  const thumb = new Sprite(getSliderTexture(thumbSrc));
  thumb.label = labels.thumb;
  thumb.eventMode = "static";
  thumb.zIndex = 2;

  resizeSliderThumb({
    thumb,
    thumbSrc,
    direction: sliderComputedNode.direction,
    trackWidth: width,
    trackHeight: height,
  });

  // Add sprites to container
  sliderContainer.addChild(bar);
  sliderContainer.addChild(thumb);

  bindSliderInteractions({
    app,
    sliderContainer,
    sliderComputedNode,
    thumb,
    eventHandler,
  });

  syncSliderRuntime({
    app,
    sliderContainer,
    sliderComputedNode,
    thumb,
    eventHandler,
  });

  parent.addChild(sliderContainer);
  syncShaderFilters(sliderContainer, sliderComputedNode.filters, {
    width,
    height,
  });

  dispatchLiveAnimations({
    animations,
    targetId: id,
    animationBus,
    completionTracker,
    element: sliderContainer,
    targetState: getElementTransformTargetState(sliderComputedNode, { alpha }),
    renderContext,
  });
};
