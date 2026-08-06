import {
  validateBasicFields,
  validateTexture,
  validateBehaviors,
  validateEmitter,
  validateEmitterOptionalProps,
  validateOptionalFields,
} from "./util/validateParticles.js";
import { validateParticleModules } from "./util/validateParticleModules.js";
import { compileParticleModules } from "./compileParticleModules.js";
import { parseCommonObject } from "../util/parseCommonObject.js";

/**
 * @typedef {import('../../../types.js').BaseElement} BaseElement
 * @typedef {import('../../../types.js').ParticlesComputedNode} ParticlesComputedNode
 */

/**
 * Parse particles element.
 *
 * Particle width and height stay unscaled because they define emitter bounds,
 * while the common transform fields still provide anchors, origins, and
 * element-level rotation for the emitter container.
 *
 * @param {Object} params
 * @param {BaseElement} params.state - The particles state to parse
 * @param {Array} [params.parserPlugins] - Array of parser plugins (not used by this parser)
 * @return {ParticlesComputedNode}
 */
export const parseParticles = ({ state }) => {
  if (state.modules) {
    validateBasicFields(state);
    validateParticleModules(state);
    return compileParticleModules(state);
  }

  // Run all validations
  validateBasicFields(state);
  validateTexture(state);
  validateBehaviors(state);
  validateEmitter(state);
  validateEmitterOptionalProps(state);
  validateOptionalFields(state);

  // Reconcile count with emitter.maxParticles
  const count = state.emitter?.maxParticles ?? state.count ?? 100;
  const computedObj = parseCommonObject(state, { scaleMode: "live" });

  // Build emitter config with count synced to maxParticles
  let emitter = state.emitter;
  if (
    emitter &&
    emitter.maxParticles === undefined &&
    state.count !== undefined
  ) {
    emitter = { ...emitter, maxParticles: count };
  }

  return {
    ...computedObj,
    count,
    texture: state.texture,
    behaviors: state.behaviors,
    emitter,
  };
};
