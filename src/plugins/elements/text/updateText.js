import applyTextStyle from "../../../util/applyTextStyle.js";
import { isDeepEqual } from "../../../util/isDeepEqual.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import { positionTextInLayoutBox, syncTextAnchorRatios } from "./textLayout.js";
import {
  applyTextDisplayStyle,
  createTextDisplayObject,
  getTextAnimationTargetState,
} from "./addText.js";
import {
  isRichTextComputedNode,
  isRichTextDisplayObject,
  renderRichTextDisplayObject,
} from "./richTextDisplay.js";
import {
  bindTextInteractions,
  clearTextInteractions,
} from "./textInteractions.js";
import {
  getShaderFilterTargetState,
  hasShaderProgressUpdateAnimation,
  prepareShaderFilterAnimationTargets,
  resetShaderFilterProgress,
  syncShaderFilters,
} from "../util/shaderFilterEffect.js";
import { setElementRenderState } from "../elementRenderState.js";

const displayKindChanged = (displayObject, textComputedNode) =>
  isRichTextDisplayObject(displayObject) !==
  isRichTextComputedNode(textComputedNode);

const replaceTextDisplayObject = ({
  app,
  parent,
  displayObject,
  textComputedNode,
  eventHandler,
  zIndex,
}) => {
  clearTextInteractions(displayObject);

  const replacement = createTextDisplayObject(textComputedNode, zIndex);

  bindTextInteractions({
    app,
    displayObject: replacement,
    textComputedNode,
    eventHandler,
    applyStyle: (overrideStyle) =>
      applyTextDisplayStyle(replacement, textComputedNode, overrideStyle),
  });

  parent.addChild(replacement);
  displayObject.destroy({ children: true });

  return replacement;
};

const updatePlainTextDisplayObject = (displayObject, textComputedNode) => {
  applyTextStyle(displayObject, textComputedNode.textStyle);
  const timelineTextUnits =
    displayObject[Symbol.for("routeGraphics.timelineTextUnits")];
  if (
    timelineTextUnits?.matches(textComputedNode.content, displayObject.style)
  ) {
    timelineTextUnits.originalText = String(textComputedNode.content ?? "");
  } else {
    timelineTextUnits?.destroy();
    displayObject.text = textComputedNode.content;
  }
  syncTextAnchorRatios(displayObject, textComputedNode);
  positionTextInLayoutBox(displayObject, textComputedNode);
  displayObject.alpha = textComputedNode.alpha;
  if (
    timelineTextUnits?.matches(textComputedNode.content, displayObject.style)
  ) {
    timelineTextUnits.sync();
  }
};

const updateTextDisplayObject = ({
  displayObject,
  textComputedNode,
  app,
  eventHandler,
}) => {
  if (isRichTextComputedNode(textComputedNode)) {
    renderRichTextDisplayObject(displayObject, textComputedNode);
  } else {
    updatePlainTextDisplayObject(displayObject, textComputedNode);
  }

  clearTextInteractions(displayObject);
  bindTextInteractions({
    app,
    displayObject,
    textComputedNode,
    eventHandler,
    applyStyle: (overrideStyle) =>
      applyTextDisplayStyle(displayObject, textComputedNode, overrideStyle),
  });
};

/**
 * Update text element (synchronous)
 * @param {import("../elementPlugin.js").UpdateElementOptions} params
 */
export const updateText = ({
  app,
  parent,
  prevElement: prevTextComputedNode,
  nextElement: nextTextComputedNode,
  eventHandler,
  animations,
  animationBus,
  completionTracker,
  zIndex,
  deferRenderStateCommit,
  commitRenderState,
}) => {
  let textElement = parent.children.find(
    (child) => child.label === prevTextComputedNode.id,
  );

  if (!textElement) return;

  textElement.zIndex = zIndex;
  const shouldForceShaderProgress = hasShaderProgressUpdateAnimation(
    animations,
    prevTextComputedNode.id,
  );
  if (shouldForceShaderProgress) {
    syncShaderFilters(textElement, prevTextComputedNode.filters, {
      width: prevTextComputedNode.width,
      height: prevTextComputedNode.height,
      force: true,
      animations,
      targetId: prevTextComputedNode.id,
    });
  } else {
    resetShaderFilterProgress(textElement);
  }
  prepareShaderFilterAnimationTargets({
    displayObject: textElement,
    element: nextTextComputedNode,
    animations,
    targetId: prevTextComputedNode.id,
  });

  const updateElement = () => {
    if (isDeepEqual(prevTextComputedNode, nextTextComputedNode)) {
      setElementRenderState(textElement, nextTextComputedNode);
      commitRenderState?.(textElement);
      return;
    }

    if (displayKindChanged(textElement, nextTextComputedNode)) {
      textElement = replaceTextDisplayObject({
        app,
        parent,
        displayObject: textElement,
        textComputedNode: nextTextComputedNode,
        eventHandler,
        zIndex,
      });
      syncShaderFilters(textElement, nextTextComputedNode.filters, {
        width: nextTextComputedNode.width,
        height: nextTextComputedNode.height,
        force: shouldForceShaderProgress,
        animations,
        targetId: prevTextComputedNode.id,
      });
      setElementRenderState(textElement, nextTextComputedNode);
      commitRenderState?.(textElement);
      return;
    }

    updateTextDisplayObject({
      displayObject: textElement,
      textComputedNode: nextTextComputedNode,
      app,
      eventHandler,
    });
    syncShaderFilters(textElement, nextTextComputedNode.filters, {
      width: nextTextComputedNode.width,
      height: nextTextComputedNode.height,
      force: shouldForceShaderProgress,
      animations,
      targetId: prevTextComputedNode.id,
    });
    setElementRenderState(textElement, nextTextComputedNode);
    commitRenderState?.(textElement);
  };

  const dispatched = dispatchLiveAnimations({
    animations,
    targetId: prevTextComputedNode.id,
    animationBus,
    completionTracker,
    element: textElement,
    targetState: {
      ...getTextAnimationTargetState(nextTextComputedNode),
      ...getShaderFilterTargetState(nextTextComputedNode, {
        force: shouldForceShaderProgress,
      }),
    },
    onComplete: () => {
      updateElement();
    },
  });

  if (!dispatched) {
    updateElement();
  } else {
    deferRenderStateCommit?.();
  }
};
