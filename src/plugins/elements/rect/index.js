import { createElementPlugin } from "../elementPlugin.js";
import { addRect } from "./addRect.js";
import { shouldRestoreStaticRectTransform, updateRect } from "./updateRect.js";
import { deleteRect } from "./deleteRect.js";
import { parseRect } from "./parseRect.js";
import { shouldUpdateUnchangedShaderFilterProgress } from "../util/shaderFilterEffect.js";

// Export the rect plugin
export const rectPlugin = createElementPlugin({
  type: "rect",
  add: addRect,
  update: updateRect,
  delete: deleteRect,
  parse: parseRect,
  shouldUpdateUnchanged: (options) =>
    shouldRestoreStaticRectTransform(options) ||
    shouldUpdateUnchangedShaderFilterProgress(options),
});
