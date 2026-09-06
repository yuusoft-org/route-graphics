/**
 * @typedef {Object} AnimationPlugin
 * @property {string} type - The animation type this plugin handles
 */

/**
 * Creates a legacy animation registration descriptor.
 * @deprecated Animation execution is built in; omit plugins.animations.
 * @param {Object} options - Plugin configuration
 * @param {string} options.type - Animation type
 * @returns {AnimationPlugin} Animation plugin
 */
export const createAnimationPlugin = ({ type }) => ({
  type,
});
