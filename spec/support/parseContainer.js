import { createParserPlugin } from "../../src/plugins/elements/parserPlugin.js";
import { parseRect } from "../../src/plugins/elements/rect/parseRect.js";
import { parseSlider } from "../../src/plugins/elements/slider/parseSlider.js";
import { parseSprite } from "../../src/plugins/elements/sprite/parseSprite.js";
import { parseTextRevealing } from "../../src/plugins/elements/text-revealing/parseTextRevealing.js";
import { parseText } from "../../src/plugins/elements/text/parseText.js";
import { parseParticles } from "../../src/plugins/elements/particles/parseParticles.js";
import { parseContainer } from "../../src/plugins/elements/container/parseContainer.js";

// Mock plugins for testing
const mockParserPlugins = [
  createParserPlugin({
    type: "text-revealing",
    parse: parseTextRevealing,
  }),
  createParserPlugin({
    type: "text",
    parse: parseText,
  }),
  createParserPlugin({
    type: "rect",
    parse: parseRect,
  }),
  createParserPlugin({
    type: "sprite",
    parse: parseSprite,
  }),
  createParserPlugin({
    type: "slider",
    parse: parseSlider,
  }),
  createParserPlugin({
    type: "particles",
    parse: parseParticles,
  }),
  createParserPlugin({
    type: "container",
    parse: parseContainer,
  }),
];

/**
 * Helper function for testing parseContainer with all available parsers
 * @param {Object} params
 * @param {import('../../src/types.js').BaseElement} params.state - The container state to parse
 * @returns {import('../../src/types.js').ContainerComputedNode}
 */
export const parseContainerForTesting = ({ state }) => {
  return parseContainer({ state, parserPlugins: mockParserPlugins });
};
