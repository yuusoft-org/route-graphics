/**
 * Base interface for all element plugins
 * Each element plugin must export: type, add, update, delete
 */

/**
 * @typedef {Object} ElementPlugin
 * @property {string} type - The element type this plugin handles
 * @property {Function} add - Function to add the element
 * @property {Function} update - Function to update the element
 * @property {Function} delete - Function to delete the element
 * @property {Function} [shouldUpdateUnchanged] - Optional hook to force an
 * update even when prev/next element definitions are deep-equal
 */

/**
 * @typedef {Object} AddElementOptions
 * @property {import('../../types.js').Application} app - The PixiJS application
 * @property {import('../../types.js').Container} parent - Parent container
 * @property {import('../../types.js').ComputedNode} element - Element to add
 * @property {Object[]} animations - Animation configurations for the element
 * @property {Function} eventHandler - Event handler function
 * @property {Object} animationBus - Animation bus for dispatching animations
 * @property {import('./renderContext.js').createRenderContext} [renderContext] - Render context flags for nested mounts
 * @property {AbortSignal} [signal] - Optional cancellation signal
 * @property {number} [shaderTime] - Current deterministic shader time in seconds
 */

/**
 * @typedef {Object} UpdateElementOptions
 * @property {import('../../types.js').Application} app - The PixiJS application
 * @property {import('../../types.js').Container} parent - Parent container
 * @property {import('../../types.js').ComputedNode} prevElement - Previous element state
 * @property {import('../../types.js').ComputedNode} nextElement - Next element state
 * @property {Object[]} animations - Animation configurations for the element
 * @property {Function} eventHandler - Event handler function
 * @property {Object} animationBus - Animation bus for dispatching animations
 * @property {import('./renderContext.js').createRenderContext} [renderContext] - Render context flags for nested mounts
 * @property {AbortSignal} [signal] - Optional cancellation signal
 * @property {number} [shaderTime] - Current deterministic shader time in seconds
 * @property {Function} [commitRenderState] - Commits the next semantic state after a deferred visual update
 * @property {Function} [deferRenderStateCommit] - Prevents the automatic commit until commitRenderState is called
 */

/**
 * @typedef {Object} DeleteElementOptions
 * @property {import('../../types.js').Application} app - The PixiJS application
 * @property {import('../../types.js').Container} parent - Parent container
 * @property {import('../../types.js').ComputedNode} element - Element to delete
 * @property {Object[]} animations - Animation configurations for the element
 * @property {Function} eventHandler - Event handler function
 * @property {Object} animationBus - Animation bus for dispatching animations
 * @property {import('./renderContext.js').createRenderContext} [renderContext] - Render context flags for nested mounts
 * @property {AbortSignal} [signal] - Optional cancellation signal
 */

/**
 * Creates an element plugin with the required interface
 * @param {Object} options - Plugin configuration
 * @param {string} options.type - Element type
 * @param {Function} options.add - Add function
 * @param {Function} options.update - Update function
 * @param {Function} options.delete - Delete function
 * @param {import('./parserPlugin.js').ParseOption} options.parse
 * @param {Function} [options.shouldUpdateUnchanged]
 * @returns {ElementPlugin} Element plugin
 */
export const createElementPlugin = ({
  type,
  add,
  update,
  delete: deleteFn,
  parse,
  shouldUpdateUnchanged,
}) => ({
  type,
  add,
  update,
  delete: deleteFn,
  parse,
  shouldUpdateUnchanged,
});
