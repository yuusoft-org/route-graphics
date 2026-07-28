import { Text } from "pixi.js";
import applyTextStyle from "../../../util/applyTextStyle.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import {
  applyInteractiveTextStyle,
  positionTextInLayoutBox,
  syncTextAnchorRatios,
} from "./textLayout.js";
import { bindTextInteractions } from "./textInteractions.js";
import {
  createRichTextDisplayObject,
  isRichTextComputedNode,
  renderRichTextDisplayObject,
} from "./richTextDisplay.js";
import {
  getShaderFilterTargetState,
  hasShaderProgressUpdateAnimation,
  syncShaderFilters,
} from "../util/shaderFilterEffect.js";
import { getElementTransformTargetState } from "../util/transform.js";

export const getTextAnimationTargetState = (textComputedNode) => ({
  ...getElementTransformTargetState(textComputedNode),
  alpha: textComputedNode.alpha,
});

export const createTextDisplayObject = (textComputedNode, zIndex) => {
  if (isRichTextComputedNode(textComputedNode)) {
    return createRichTextDisplayObject(textComputedNode, zIndex);
  }

  const text = new Text({
    label: textComputedNode.id,
  });

  text.zIndex = zIndex;
  text.text = textComputedNode.content;
  applyTextStyle(text, textComputedNode.textStyle);
  syncTextAnchorRatios(text, textComputedNode);
  text.alpha = textComputedNode.alpha;
  positionTextInLayoutBox(text, textComputedNode);
  syncShaderFilters(text, textComputedNode.filters, {
    width: textComputedNode.width,
    height: textComputedNode.height,
  });

  return text;
};

export const applyTextDisplayStyle = (
  displayObject,
  textComputedNode,
  overrideStyle,
) => {
  if (isRichTextComputedNode(textComputedNode)) {
    renderRichTextDisplayObject(displayObject, textComputedNode, overrideStyle);
    return;
  }

  applyInteractiveTextStyle(
    displayObject,
    textComputedNode.textStyle,
    overrideStyle,
  );
};

/**
 * Add text element to the stage (synchronous)
 * @param {import("../elementPlugin.js").AddElementOptions} params
 */
export const addText = ({
  app,
  parent,
  element: textComputedNode,
  animations,
  eventHandler,
  animationBus,
  completionTracker,
  renderContext,
  zIndex,
}) => {
  const text = createTextDisplayObject(textComputedNode, zIndex);
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    textComputedNode.id,
  );
  syncShaderFilters(text, textComputedNode.filters, {
    width: textComputedNode.width,
    height: textComputedNode.height,
    force: shouldForceShaderProgress,
  });

  bindTextInteractions({
    app,
    displayObject: text,
    textComputedNode,
    eventHandler,
    applyStyle: (overrideStyle) =>
      applyTextDisplayStyle(text, textComputedNode, overrideStyle),
  });

  parent.addChild(text);

  dispatchLiveAnimations({
    animations,
    targetId: textComputedNode.id,
    animationBus,
    completionTracker,
    element: text,
    targetState: {
      ...getTextAnimationTargetState(textComputedNode),
      ...getShaderFilterTargetState(textComputedNode, {
        force: shouldForceShaderProgress,
      }),
    },
    renderContext,
  });
};
