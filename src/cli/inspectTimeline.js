import fs from "node:fs/promises";
import path from "node:path";

import { loadRenderDefinition } from "./renderConfig.js";
import { normalizeRenderState } from "../util/normalizeRenderState.js";
import {
  compileAnimationTimelineProgram,
  inspectTimelineProgram,
} from "../plugins/animations/timeline/inspectProgram.js";

export const inspectTimelineDefinition = ({
  definition,
  stateIndex = 0,
  animationId,
}) => {
  if (!Number.isSafeInteger(stateIndex) || stateIndex < 0) {
    throw new Error(
      "Timeline inspection state index must be a non-negative safe integer.",
    );
  }
  const rawState = definition.states[stateIndex];
  if (!rawState) {
    throw new Error(
      `State index ${stateIndex} is out of range for ${definition.states.length} states.`,
    );
  }
  const state = normalizeRenderState(rawState);
  const indexedAnimations = state.animations.map((animation, index) => ({
    animation,
    index,
  }));
  const selected = animationId
    ? indexedAnimations.filter(({ animation }) => animation.id === animationId)
    : indexedAnimations;
  if (animationId && selected.length === 0) {
    throw new Error(
      `Animation "${animationId}" was not found in state "${state.id ?? stateIndex}".`,
    );
  }

  return {
    schema: "route.timeline-inspection-set/v1",
    state: { index: stateIndex, id: state.id ?? null },
    animations: selected.map(({ animation, index }) => {
      const sourcePath = `states[${stateIndex}].animations[${index}]`;
      const program = compileAnimationTimelineProgram(animation, {
        sourcePath,
      });
      return {
        normalizedAst: animation,
        ...inspectTimelineProgram(program),
      };
    }),
  };
};

export const inspectTimelineFile = async ({
  inputPath,
  cwd = process.cwd(),
  stateIndex = 0,
  animationId,
}) => {
  if (!inputPath)
    throw new Error("Timeline inspection requires an input YAML file.");
  const absolutePath = path.resolve(cwd, inputPath);
  const yamlSource = await fs.readFile(absolutePath, "utf8");
  return inspectTimelineDefinition({
    definition: loadRenderDefinition(yamlSource),
    stateIndex,
    animationId,
  });
};
