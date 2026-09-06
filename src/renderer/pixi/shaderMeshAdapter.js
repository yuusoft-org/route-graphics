import { Point, RendererType, Texture } from "pixi.js";

/**
 * The Pixi version whose private FilterSystem contract is implemented here.
 *
 * This module is the only production code allowed to access those private
 * fields. Keep Route Graphics' authored shader contract stable and update this
 * adapter when intentionally upgrading Pixi.
 */
export const PIXI_SHADER_MESH_ADAPTER_VERSION = "8.10.2";

const REQUIRED_GLOBAL_UNIFORMS = [
  "uOutputFrame",
  "uInputSize",
  "uInputPixel",
  "uInputClamp",
  "uGlobalFrame",
  "uOutputTexture",
];

const resolveShaderMeshContext = ({ filterManager, filter, input, output }) => {
  const missingInternals = [];
  const filterStack = filterManager?._filterStack;
  const filterStackIndex = filterManager?._filterStackIndex;
  const filterUniforms = filterManager?._filterGlobalUniforms;
  const globalFilterBindGroup = filterManager?._globalFilterBindGroup;
  const renderer = filterManager?.renderer;
  const filterData =
    Array.isArray(filterStack) && Number.isInteger(filterStackIndex)
      ? filterStack[filterStackIndex]
      : null;

  if (!Array.isArray(filterStack)) {
    missingInternals.push("_filterStack");
  }
  if (!Number.isInteger(filterStackIndex)) {
    missingInternals.push("_filterStackIndex");
  }
  if (!filterUniforms?.uniforms) {
    missingInternals.push("_filterGlobalUniforms");
  }
  if (typeof globalFilterBindGroup?.setResource !== "function") {
    missingInternals.push("_globalFilterBindGroup");
  }
  if (!filterData?.bounds) {
    missingInternals.push("active filter stack entry");
  }
  if (
    REQUIRED_GLOBAL_UNIFORMS.some((name) => !filterUniforms?.uniforms?.[name])
  ) {
    missingInternals.push("global filter uniform layout");
  }
  if (
    !renderer?.renderTarget?.rootRenderTarget?.colorTexture?.source ||
    typeof renderer.renderTarget.getRenderTarget !== "function" ||
    typeof renderer.renderTarget.bind !== "function"
  ) {
    missingInternals.push("render target system");
  }
  if (typeof renderer?.encoder?.draw !== "function") {
    missingInternals.push("renderer encoder");
  }
  if (!filter?._state || !filter?.groups) {
    missingInternals.push("filter draw state");
  }
  if (!input?.frame || !input?.source?.style) {
    missingInternals.push("filter input texture");
  }
  if (output === undefined || output === null) {
    missingInternals.push("filter output surface");
  }

  if (missingInternals.length > 0) {
    throw new Error(
      `Custom shader meshes are incompatible with the installed Pixi runtime. Route Graphics' Pixi ${PIXI_SHADER_MESH_ADAPTER_VERSION} adapter could not resolve: ${missingInternals.join(
        ", ",
      )}.`,
    );
  }

  return {
    filterStack,
    filterStackIndex,
    filterUniforms,
    globalFilterBindGroup,
    renderer,
    filterData,
  };
};

/**
 * Applies a Route Graphics shader filter with subdivided geometry.
 *
 * Pixi's public Filter API always draws its built-in quad, so custom filter
 * geometry currently requires a small, versioned copy of its internal draw
 * path. No authored shader configuration or Route Graphics public method
 * depends on these fields.
 */
export const applyPixiShaderFilterMesh = ({
  filterManager,
  filter,
  geometry,
  input,
  output,
  clear,
}) => {
  const {
    filterStack,
    filterStackIndex,
    filterUniforms,
    globalFilterBindGroup,
    renderer,
    filterData,
  } = resolveShaderMeshContext({
    filterManager,
    filter,
    input,
    output,
  });
  const bounds = filterData.bounds;
  const offset = Point.shared.set(0, 0);
  const isFinalTarget = filterData.outputRenderSurface === output;
  let resolution =
    renderer.renderTarget.rootRenderTarget.colorTexture.source.resolution;
  let currentIndex = filterStackIndex - 1;

  while (currentIndex > 0 && filterStack[currentIndex].skip) {
    currentIndex--;
  }

  if (currentIndex > 0 && filterStack[currentIndex].inputTexture) {
    resolution = filterStack[currentIndex].inputTexture.source.resolution;
  }

  const uniforms = filterUniforms.uniforms;
  const outputFrame = uniforms.uOutputFrame;
  const inputSize = uniforms.uInputSize;
  const inputPixel = uniforms.uInputPixel;
  const inputClamp = uniforms.uInputClamp;
  const globalFrame = uniforms.uGlobalFrame;
  const outputTexture = uniforms.uOutputTexture;

  if (isFinalTarget) {
    let lastIndex = filterStackIndex;

    while (lastIndex > 0) {
      lastIndex--;
      const previousFilterData = filterStack[lastIndex];
      if (!previousFilterData.skip) {
        offset.x = previousFilterData.bounds.minX;
        offset.y = previousFilterData.bounds.minY;
        break;
      }
    }

    outputFrame[0] = bounds.minX - offset.x;
    outputFrame[1] = bounds.minY - offset.y;
  } else {
    outputFrame[0] = 0;
    outputFrame[1] = 0;
  }

  outputFrame[2] = input.frame.width;
  outputFrame[3] = input.frame.height;
  inputSize[0] = input.source.width;
  inputSize[1] = input.source.height;
  inputSize[2] = 1 / inputSize[0];
  inputSize[3] = 1 / inputSize[1];
  inputPixel[0] = input.source.pixelWidth;
  inputPixel[1] = input.source.pixelHeight;
  inputPixel[2] = 1 / inputPixel[0];
  inputPixel[3] = 1 / inputPixel[1];
  inputClamp[0] = 0.5 * inputPixel[2];
  inputClamp[1] = 0.5 * inputPixel[3];
  inputClamp[2] = input.frame.width * inputSize[2] - 0.5 * inputPixel[2];
  inputClamp[3] = input.frame.height * inputSize[3] - 0.5 * inputPixel[3];

  const rootTexture = renderer.renderTarget.rootRenderTarget.colorTexture;
  globalFrame[0] = offset.x * resolution;
  globalFrame[1] = offset.y * resolution;
  globalFrame[2] = rootTexture.source.width * resolution;
  globalFrame[3] = rootTexture.source.height * resolution;

  if (output instanceof Texture) output.source.resource = null;
  const renderTarget = renderer.renderTarget.getRenderTarget(output);
  renderer.renderTarget.bind(output, Boolean(clear));

  if (output instanceof Texture) {
    outputTexture[0] = output.frame.width;
    outputTexture[1] = output.frame.height;
  } else {
    outputTexture[0] = renderTarget.width;
    outputTexture[1] = renderTarget.height;
  }

  outputTexture[2] = renderTarget.isRoot ? -1 : 1;
  filterUniforms.update();

  if (renderer.renderPipes.uniformBatch) {
    const batchUniforms =
      renderer.renderPipes.uniformBatch.getUboResource(filterUniforms);
    globalFilterBindGroup.setResource(batchUniforms, 0);
  } else {
    globalFilterBindGroup.setResource(filterUniforms, 0);
  }

  globalFilterBindGroup.setResource(input.source, 1);
  globalFilterBindGroup.setResource(input.source.style, 2);
  filter.groups[0] = globalFilterBindGroup;

  renderer.encoder.draw({
    geometry,
    shader: filter,
    state: filter._state,
    topology: "triangle-list",
  });

  if (renderer.type === RendererType.WEBGL) {
    renderer.renderTarget.finishRenderPass();
  }
};
