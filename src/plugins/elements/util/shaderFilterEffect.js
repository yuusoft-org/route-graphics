import {
  Filter,
  Geometry,
  Matrix,
  Point,
  RendererType,
  Texture,
  TextureSource,
  UniformGroup,
} from "pixi.js";
import { setManagedFilter } from "./managedFilters.js";
import {
  getShaderStructureSignature,
  toShaderUniformSymbol,
} from "./shaderConfig.js";

const SHADER_FILTERS_STATE_KEY = "__routeGraphicsShaderFilters";
const SHADER_PROGRESS_KEY = "__routeGraphicsShaderProgress";
const SHADER_TIME_KEY = "__routeGraphicsShaderTime";
const SHADER_DESTROY_CLEANUP_KEY = "__routeGraphicsShaderDestroyCleanup";

export const DEFAULT_SHADER_FILTER_VERTEX = `
precision mediump float;

in vec2 aPosition;

out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const clampFiniteProgress = (value) => (Number.isFinite(value) ? value : 0);
const normalizeShaderTime = (value) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const cloneParameterValue = (value) =>
  ArrayBuffer.isView(value)
    ? new Float32Array(value)
    : Array.isArray(value)
      ? [...value]
      : value;

const getAnimationsForTarget = (animations, targetId) => {
  if (!animations) return [];
  if (animations instanceof Map) {
    return animations.get(targetId) ?? [];
  }
  return animations.filter((animation) => animation?.targetId === targetId);
};

export const hasShaderProgressUpdateAnimation = (animations, targetId) =>
  getAnimationsForTarget(animations, targetId).some(
    (animation) =>
      animation?.type === "update" &&
      Object.values(animation.filterTweens ?? {}).some(
        (tween) => tween.uProgress !== undefined,
      ),
  );

const getActiveShaderAnimationChannels = (animations, targetId) => {
  const channels = new Set();
  for (const animation of getAnimationsForTarget(animations, targetId)) {
    if (animation?.type !== "update") continue;

    for (const [filterId, tween] of Object.entries(
      animation.filterTweens ?? {},
    )) {
      for (const parameter of Object.keys(tween)) {
        channels.add(`${filterId}:${parameter}`);
      }
    }
  }
  return channels;
};

const shaderValuesEqual = (left, right) => {
  if (ArrayBuffer.isView(left) || Array.isArray(left)) {
    if (!ArrayBuffer.isView(right) && !Array.isArray(right)) return false;
    const leftArray = Array.from(left);
    const rightArray = Array.from(right);
    return (
      leftArray.length === rightArray.length &&
      leftArray.every((value, index) => value === rightArray[index])
    );
  }
  return left === right;
};

const toUniformValue = (uniform) => {
  if (uniform.type === "f32") {
    return uniform.value;
  }

  return new Float32Array(uniform.value);
};

const createShaderUniformGroup = (
  shader,
  width,
  height,
  progress,
  time,
  { includeNextTextureTransform = false } = {},
) => {
  const uniforms = {
    uProgress: {
      value: clampFiniteProgress(progress),
      type: "f32",
    },
  };

  if (shader.time === true) {
    uniforms.uTime = {
      value: normalizeShaderTime(time),
      type: "f32",
    };
  }
  uniforms.uResolution = {
    value: new Float32Array([Math.max(1, width), Math.max(1, height)]),
    type: "vec2<f32>",
  };

  if (includeNextTextureTransform) {
    uniforms.uNextTextureMatrix = {
      value: new Matrix(),
      type: "mat3x3<f32>",
    };
    uniforms.uNextTextureClamp = {
      value: new Float32Array([0, 0, 1, 1]),
      type: "vec4<f32>",
    };
  }

  for (const uniform of shader.uniforms ?? []) {
    uniforms[uniform.symbol] = {
      value: toUniformValue(uniform),
      type: uniform.type,
    };
  }

  return new UniformGroup(uniforms);
};

const getPipelineAddressMode = (pipeline) =>
  (pipeline?.wrap ?? pipeline?.textureWrap) === "repeat"
    ? "repeat"
    : "clamp-to-edge";

const getPipelineMipmapFilter = (pipeline) =>
  pipeline?.mipmap === true ? "linear" : "nearest";

const createTexturePipelineSource = (textureSource, pipeline) => {
  if (!textureSource) {
    return textureSource;
  }

  if (!textureSource.resource || textureSource.uploadMethodId === "video") {
    return textureSource;
  }

  return TextureSource.from({
    ...(textureSource.options ?? {}),
    resource: textureSource.resource,
    width: textureSource.width,
    height: textureSource.height,
    resolution: textureSource.resolution,
    format: textureSource.format,
    dimensions: textureSource.dimension,
    mipLevelCount: textureSource.mipLevelCount,
    autoGenerateMipmaps: pipeline?.mipmap === true,
    sampleCount: textureSource.sampleCount,
    antialias: textureSource.antialias,
    alphaMode: textureSource.alphaMode,
    addressMode: getPipelineAddressMode(pipeline),
    mipmapFilter: getPipelineMipmapFilter(pipeline),
  });
};

const createTextureResources = (shader) => {
  const resources = {};
  const ownedTextureSources = [];

  for (const texture of shader.textures ?? []) {
    const textureSource = Texture.from(texture.src).source;
    const resource = createTexturePipelineSource(textureSource, {
      ...shader.pipeline,
      ...texture,
    });

    resources[texture.symbol] = resource;
    resources[texture.samplerSymbol ?? `${texture.symbol}Sampler`] =
      resource.style;

    if (resource !== textureSource) {
      ownedTextureSources.push(resource);
    }
  }

  return {
    resources,
    ownedTextureSources,
  };
};

const createShaderFilterGeometry = (grid = [1, 1]) => {
  const columns = Math.max(1, grid[0] ?? 1);
  const rows = Math.max(1, grid[1] ?? 1);

  if (columns === 1 && rows === 1) {
    return null;
  }

  const positions = [];
  const indices = [];

  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      positions.push(column / columns, row / rows);
    }
  }

  const rowStride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const topLeft = row * rowStride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + rowStride;
      const bottomRight = bottomLeft + 1;

      indices.push(
        topLeft,
        topRight,
        bottomLeft,
        topRight,
        bottomRight,
        bottomLeft,
      );
    }
  }

  return new Geometry({
    attributes: {
      aPosition: {
        buffer: new Float32Array(positions),
        format: "float32x2",
        stride: 2 * 4,
        offset: 0,
      },
    },
    indexBuffer: new Uint32Array(indices),
  });
};

const applyShaderFilterWithGeometry = ({
  filterManager,
  filter,
  geometry,
  input,
  output,
  clear,
}) => {
  const renderer = filterManager.renderer;
  const filterData =
    filterManager._filterStack[filterManager._filterStackIndex];
  const bounds = filterData.bounds;
  const offset = Point.shared;
  const previousRenderSurface = filterData.previousRenderSurface;
  const isFinalTarget = previousRenderSurface === output;
  let resolution =
    renderer.renderTarget.rootRenderTarget.colorTexture.source._resolution;
  let currentIndex = filterManager._filterStackIndex - 1;

  while (currentIndex > 0 && filterManager._filterStack[currentIndex].skip) {
    currentIndex--;
  }

  if (currentIndex > 0) {
    resolution =
      filterManager._filterStack[currentIndex].inputTexture.source._resolution;
  }

  const filterUniforms = filterManager._filterGlobalUniforms;
  const uniforms = filterUniforms.uniforms;
  const outputFrame = uniforms.uOutputFrame;
  const inputSize = uniforms.uInputSize;
  const inputPixel = uniforms.uInputPixel;
  const inputClamp = uniforms.uInputClamp;
  const globalFrame = uniforms.uGlobalFrame;
  const outputTexture = uniforms.uOutputTexture;

  if (isFinalTarget) {
    let lastIndex = filterManager._filterStackIndex;

    while (lastIndex > 0) {
      lastIndex--;
      const previousFilterData = filterManager._filterStack[lastIndex];
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
    filterManager._globalFilterBindGroup.setResource(batchUniforms, 0);
  } else {
    filterManager._globalFilterBindGroup.setResource(filterUniforms, 0);
  }

  filterManager._globalFilterBindGroup.setResource(input.source, 1);
  filterManager._globalFilterBindGroup.setResource(input.source.style, 2);
  filter.groups[0] = filterManager._globalFilterBindGroup;

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

export const setShaderFilterProgress = (filter, progress) => {
  const shaderUniforms = filter?.resources?.shaderUniforms;
  if (!shaderUniforms?.uniforms) {
    return;
  }

  shaderUniforms.uniforms.uProgress = clampFiniteProgress(progress);
  shaderUniforms.update();
};

export const setShaderFilterTime = (filter, time) => {
  const shaderUniforms = filter?.resources?.shaderUniforms;
  if (!shaderUniforms?.uniforms) {
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(shaderUniforms.uniforms, "uTime")) {
    return;
  }
  shaderUniforms.uniforms.uTime = normalizeShaderTime(time);
  shaderUniforms.update();
};

export const setShaderFilterParameter = (filter, key, value) => {
  const shaderUniforms = filter?.resources?.shaderUniforms;
  const symbol = toShaderUniformSymbol(key);
  if (
    !shaderUniforms?.uniforms ||
    !Object.prototype.hasOwnProperty.call(shaderUniforms.uniforms, symbol)
  ) {
    return false;
  }

  const currentValue = shaderUniforms.uniforms[symbol];
  shaderUniforms.uniforms[symbol] =
    typeof currentValue === "number" ? Number(value) : new Float32Array(value);
  shaderUniforms.update();
  return true;
};

export const setShaderFilterResolution = (filter, width, height) => {
  const shaderUniforms = filter?.resources?.shaderUniforms;
  if (!shaderUniforms?.uniforms) {
    return;
  }

  shaderUniforms.uniforms.uResolution = new Float32Array([
    Math.max(1, width),
    Math.max(1, height),
  ]);
  shaderUniforms.update();
};

export const createShaderFilter = ({
  shader,
  width,
  height,
  progress = 0,
  time = 0,
  nextTextureSource,
  name = "route-graphics-shader-filter",
}) => {
  const shaderUniforms = createShaderUniformGroup(
    shader,
    width,
    height,
    progress,
    time,
    { includeNextTextureTransform: Boolean(nextTextureSource) },
  );
  const textureResources = createTextureResources(shader);
  const resources = {
    shaderUniforms,
    ...(nextTextureSource ? { uNextTexture: nextTextureSource } : {}),
    ...textureResources.resources,
  };

  const filter = Filter.from({
    gpu: {
      name,
      vertex: {
        source: shader.source.webgpu.source,
        entryPoint: "mainVertex",
      },
      fragment: {
        source: shader.source.webgpu.source,
        entryPoint: "mainFragment",
      },
    },
    gl: {
      vertex: shader.source.webgl.vertex ?? DEFAULT_SHADER_FILTER_VERTEX,
      fragment: shader.source.webgl.fragment,
      name,
    },
    resources,
    blendMode: shader.pipeline?.blend ?? "normal",
    padding: shader.padding ?? 0,
    resolution: shader.resolution ?? 1,
    antialias: shader.antialias ?? "off",
    clipToViewport: shader.clipToViewport ?? true,
  });

  const geometry = createShaderFilterGeometry(shader.mesh?.grid);
  if (geometry) {
    filter.apply = (filterManager, input, output, clear) => {
      applyShaderFilterWithGeometry({
        filterManager,
        filter,
        geometry,
        input,
        output,
        clear,
      });
    };
  }

  if (geometry || textureResources.ownedTextureSources.length > 0) {
    const baseDestroy = filter.destroy.bind(filter);
    filter.destroy = (...args) => {
      baseDestroy(...args);
      geometry?.destroy();
      for (const textureSource of textureResources.ownedTextureSources) {
        textureSource.destroy();
      }
    };
  }

  return filter;
};

const createParameterState = (effect) =>
  new Map(
    (effect.parameters ?? effect.uniforms ?? []).map((parameter) => [
      parameter.key,
      {
        ...parameter,
        value: cloneParameterValue(parameter.value),
      },
    ]),
  );

export const createShaderEffect = ({
  effect,
  width,
  height,
  progress = 0,
  time = 0,
  nextTextureSource,
  name = "route-graphics-shader-effect",
}) => {
  const parameters = createParameterState(effect);
  const passes = effect.passes ?? [effect];
  const filters = passes.map((pass, index) =>
    createShaderFilter({
      shader: pass,
      width,
      height,
      progress,
      time,
      nextTextureSource,
      name: `${name}-${pass.id ?? index + 1}`,
    }),
  );

  const runtime = {
    id: effect.id,
    config: effect,
    filters,
    parameters,
    progress: clampFiniteProgress(progress),
    time: normalizeShaderTime(time),
  };

  for (const filter of filters) {
    filter.__routeGraphicsShaderEffectRuntime = runtime;
  }

  return runtime;
};

export const destroyShaderEffect = (runtime) => {
  for (const filter of runtime?.filters ?? []) {
    filter.destroy();
  }
};

export const setShaderEffectProgress = (runtime, progress) => {
  if (!runtime) return;
  runtime.progress = clampFiniteProgress(progress);
  for (const filter of runtime.filters) {
    setShaderFilterProgress(filter, runtime.progress);
  }
};

export const setShaderEffectTime = (runtime, time) => {
  if (!runtime) return;
  runtime.time = normalizeShaderTime(time);
  for (const filter of runtime.filters) {
    setShaderFilterTime(filter, runtime.time);
  }
};

export const setShaderEffectResolution = (runtime, width, height) => {
  for (const filter of runtime?.filters ?? []) {
    setShaderFilterResolution(filter, width, height);
  }
};

export const getShaderEffectParameter = (runtime, key) => {
  if (key === "uProgress") {
    return runtime?.progress ?? 0;
  }

  const parameter = runtime?.parameters?.get(key);
  return parameter ? cloneParameterValue(parameter.value) : undefined;
};

const assertCompatibleParameterValue = (parameter, value, effectId) => {
  if (parameter.type === "f32") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        `Shader filter "${effectId}" parameter "${parameter.key}" must be a finite number.`,
      );
    }
    return value;
  }

  const expectedLength = parameter.value.length;
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new Error(
      `Shader filter "${effectId}" parameter "${parameter.key}" must be a ${expectedLength}-number array.`,
    );
  }

  const arrayValue = Array.from(value);
  if (
    arrayValue.length !== expectedLength ||
    !arrayValue.every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    )
  ) {
    throw new Error(
      `Shader filter "${effectId}" parameter "${parameter.key}" must be a ${expectedLength}-number array.`,
    );
  }
  return arrayValue;
};

export const validateShaderEffectParameterValue = (runtime, key, value) => {
  if (!runtime) {
    return false;
  }

  const parameter =
    key === "uProgress"
      ? {
          key,
          type: "f32",
          value: runtime.progress,
        }
      : runtime.parameters.get(key);
  if (!parameter) {
    return false;
  }

  assertCompatibleParameterValue(parameter, value, runtime.id ?? "compositor");
  return true;
};

export const setShaderEffectParameter = (runtime, key, value) => {
  if (!runtime) {
    return false;
  }

  if (key === "uProgress") {
    setShaderEffectProgress(runtime, value);
    return true;
  }

  const parameter = runtime.parameters.get(key);
  if (!parameter) {
    return false;
  }

  const nextValue = assertCompatibleParameterValue(
    parameter,
    value,
    runtime.id ?? "compositor",
  );
  parameter.value = cloneParameterValue(nextValue);
  for (const filter of runtime.filters) {
    setShaderFilterParameter(filter, key, nextValue);
  }
  return true;
};

const getShaderFiltersState = (displayObject) =>
  displayObject?.[SHADER_FILTERS_STATE_KEY] ?? null;

export const hasInstalledShaderFilters = (displayObject) =>
  Boolean(getShaderFiltersState(displayObject));

const setShaderFiltersState = (displayObject, state) => {
  Object.defineProperty(displayObject, SHADER_FILTERS_STATE_KEY, {
    value: state,
    enumerable: false,
    configurable: true,
    writable: true,
  });
};

const installShaderFilterDestroyCleanup = (displayObject) => {
  if (
    !displayObject ||
    typeof displayObject.destroy !== "function" ||
    displayObject[SHADER_DESTROY_CLEANUP_KEY]
  ) {
    return;
  }

  const baseDestroy = displayObject.destroy;

  Object.defineProperty(displayObject, SHADER_DESTROY_CLEANUP_KEY, {
    value: true,
    enumerable: false,
    configurable: true,
  });

  displayObject.destroy = function destroyWithShaderFilterCleanup(...args) {
    clearShaderFilters(this);
    return baseDestroy.apply(this, args);
  };
};

const applyProgressToFilters = (displayObject, progress) => {
  const state = getShaderFiltersState(displayObject);
  for (const effect of state?.effects ?? []) {
    setShaderEffectProgress(effect, progress);
  }
};

const applyTimeToFilters = (displayObject, time) => {
  const state = getShaderFiltersState(displayObject);
  for (const effect of state?.effects ?? []) {
    setShaderEffectTime(effect, time);
  }
};

export const installShaderProgressProperty = (displayObject) => {
  if (!displayObject) return;

  if (displayObject[SHADER_PROGRESS_KEY] === undefined) {
    Object.defineProperty(displayObject, SHADER_PROGRESS_KEY, {
      value: 0,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    displayObject,
    "uProgress",
  );
  if (descriptor?.get || descriptor?.set) {
    return;
  }

  Object.defineProperty(displayObject, "uProgress", {
    get() {
      return this[SHADER_PROGRESS_KEY] ?? 0;
    },
    set(value) {
      this[SHADER_PROGRESS_KEY] = clampFiniteProgress(value);
      applyProgressToFilters(this, this[SHADER_PROGRESS_KEY]);
    },
    enumerable: false,
    configurable: true,
  });
};

export const resetShaderFilterProgress = (displayObject) => {
  if (!displayObject || displayObject[SHADER_PROGRESS_KEY] === undefined) {
    return;
  }

  displayObject.uProgress = 0;
};

export const setShaderTime = (displayObject, time) => {
  if (!displayObject) return;
  const nextTime = normalizeShaderTime(time);
  displayObject[SHADER_TIME_KEY] = nextTime;
  applyTimeToFilters(displayObject, nextTime);
};

export const setShaderTimeInTree = (displayObject, time) => {
  if (!displayObject) return;
  setShaderTime(displayObject, time);
  for (const child of displayObject.children ?? []) {
    setShaderTimeInTree(child, time);
  }
};

const findShaderEffectRuntime = (displayObject, filterId) =>
  getShaderFiltersState(displayObject)?.effects?.find(
    (effect) => effect.id === filterId,
  ) ?? null;

export const prepareShaderFilterAnimationTargets = ({
  displayObject,
  element,
  animations,
  targetId = element?.id,
}) => {
  const targetedTweens = getAnimationsForTarget(animations, targetId)
    .filter((animation) => animation?.type === "update")
    .flatMap((animation) => Object.entries(animation.filterTweens ?? {}));

  if (targetedTweens.length === 0) {
    return false;
  }

  const state = getShaderFiltersState(displayObject);
  const nextSignature = element?.filters?.length
    ? getShaderStructureSignature(element.filters)
    : null;
  const needsNextFilterState =
    state?.signature !== nextSignature ||
    targetedTweens.some(([filterId, tween]) => {
      const runtime = findShaderEffectRuntime(displayObject, filterId);
      return (
        !runtime ||
        Object.keys(tween).some(
          (parameter) =>
            getShaderEffectParameter(runtime, parameter) === undefined,
        )
      );
    });

  if (!needsNextFilterState) {
    return false;
  }

  syncShaderFilters(displayObject, element?.filters, {
    width: element?.width,
    height: element?.height,
    animations,
    targetId,
  });
  return true;
};

export const getShaderFilterAnimationTarget = (
  displayObject,
  filterId,
  animationId,
) => {
  if (!displayObject || typeof filterId !== "string") {
    throw new Error(
      `Animation "${animationId}" must target a mounted shader filter.`,
    );
  }

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        if (property === "destroyed") return displayObject.destroyed === true;
        const runtime = findShaderEffectRuntime(displayObject, filterId);
        if (!runtime) {
          throw new Error(
            `Animation "${animationId}" could not find shader filter "${filterId}" on element "${displayObject.label}".`,
          );
        }
        const value = getShaderEffectParameter(runtime, property);
        if (value === undefined) {
          throw new Error(
            `Animation "${animationId}" cannot target unknown parameter "${property}" on shader filter "${filterId}".`,
          );
        }
        return value;
      },
      set(_target, property, value) {
        if (typeof property !== "string") return false;
        const runtime = findShaderEffectRuntime(displayObject, filterId);
        if (!runtime) {
          throw new Error(
            `Animation "${animationId}" could not find shader filter "${filterId}" on element "${displayObject.label}".`,
          );
        }
        if (!setShaderEffectParameter(runtime, property, value)) {
          throw new Error(
            `Animation "${animationId}" cannot target unknown parameter "${property}" on shader filter "${filterId}".`,
          );
        }
        return true;
      },
    },
  );
};

export const validateShaderFilterAnimationTarget = (
  displayObject,
  filterId,
  animationId,
  tween,
) => {
  const runtime = findShaderEffectRuntime(displayObject, filterId);
  if (!runtime) {
    throw new Error(
      `Animation "${animationId}" could not find shader filter "${filterId}" on element "${displayObject?.label}".`,
    );
  }

  for (const [parameter, config] of Object.entries(tween ?? {})) {
    const values = [
      ...(config.initialValue === undefined ? [] : [config.initialValue]),
      ...config.keyframes.map((keyframe) => keyframe.value),
    ];

    for (const value of values) {
      if (!validateShaderEffectParameterValue(runtime, parameter, value)) {
        throw new Error(
          `Animation "${animationId}" cannot target unknown parameter "${parameter}" on shader filter "${filterId}".`,
        );
      }
    }
  }

  return getShaderFilterAnimationTarget(displayObject, filterId, animationId);
};

const hasShaderFilters = (element) =>
  element?.filters?.some((filter) => filter?.type === "shader") ?? false;

const findDisplayObjectByLabel = (displayObject, label) => {
  if (!displayObject || !label) {
    return null;
  }

  if (displayObject.label === label) {
    return displayObject;
  }

  for (const child of displayObject.children ?? []) {
    const match = findDisplayObjectByLabel(child, label);
    if (match) {
      return match;
    }
  }

  return null;
};

const hasStaleShaderFilterParameters = ({ parent, element, animations }) => {
  if (!element) {
    return false;
  }

  if (hasShaderFilters(element)) {
    const displayObject = findDisplayObjectByLabel(parent, element.id);
    const state = getShaderFiltersState(displayObject);
    const activeChannels = getActiveShaderAnimationChannels(
      animations,
      element.id,
    );

    if (
      displayObject?.[SHADER_PROGRESS_KEY] !== undefined &&
      displayObject.uProgress !== 0 &&
      !activeChannels.has("*:uProgress")
    ) {
      return true;
    }

    for (const runtime of state?.effects ?? []) {
      if (
        runtime.progress !== 0 &&
        !activeChannels.has("*:uProgress") &&
        !activeChannels.has(`${runtime.id}:uProgress`)
      ) {
        return true;
      }

      for (const parameter of runtime.config.parameters ?? []) {
        const current = runtime.parameters.get(parameter.key)?.value;
        if (
          !shaderValuesEqual(current, parameter.value) &&
          !activeChannels.has(`${runtime.id}:${parameter.key}`)
        ) {
          return true;
        }
      }
    }
  }

  return hasStaleShaderFilterParametersInTree({
    parent,
    elements: element.children,
    animations,
  });
};

export const hasStaleShaderFilterParametersInTree = ({
  parent,
  elements = [],
  animations,
}) =>
  (elements ?? []).some((element) =>
    hasStaleShaderFilterParameters({ parent, element, animations }),
  );

export const shouldUpdateUnchangedShaderFilterParameters = ({
  parent,
  nextElement,
  animations,
}) =>
  hasStaleShaderFilterParameters({
    parent,
    element: nextElement,
    animations,
  });

export const hasStaleShaderFilterProgressInTree =
  hasStaleShaderFilterParametersInTree;
export const shouldUpdateUnchangedShaderFilterProgress =
  shouldUpdateUnchangedShaderFilterParameters;

const clearShaderFilters = (displayObject) => {
  if (!getShaderFiltersState(displayObject)) {
    return;
  }

  setManagedFilter(displayObject, "shader", null);
  delete displayObject[SHADER_FILTERS_STATE_KEY];
};

const getAnimatedShaderFilterValues = (displayObject, animations, targetId) => {
  const values = [];

  for (const animation of getAnimationsForTarget(animations, targetId)) {
    if (animation?.type !== "update") continue;

    for (const [filterId, tween] of Object.entries(
      animation.filterTweens ?? {},
    )) {
      const runtime = findShaderEffectRuntime(displayObject, filterId);
      if (!runtime) continue;

      for (const parameter of Object.keys(tween)) {
        const value = getShaderEffectParameter(runtime, parameter);
        if (value !== undefined) {
          values.push({
            filterId,
            parameter,
            value,
            hasExplicitInitialValue:
              tween[parameter]?.initialValue !== undefined,
          });
        }
      }
    }
  }

  return values;
};

const canRestoreShaderFilterValue = (runtime, parameter, value) => {
  try {
    return validateShaderEffectParameterValue(runtime, parameter, value);
  } catch {
    return false;
  }
};

const restoreAnimatedShaderFilterValues = (
  displayObject,
  values,
  { skipExplicitInitialValues = false } = {},
) => {
  for (const {
    filterId,
    parameter,
    value,
    hasExplicitInitialValue,
  } of values) {
    if (skipExplicitInitialValues && hasExplicitInitialValue) {
      continue;
    }

    const runtime = findShaderEffectRuntime(displayObject, filterId);
    if (canRestoreShaderFilterValue(runtime, parameter, value)) {
      setShaderEffectParameter(runtime, parameter, value);
    }
  }
};

export const syncShaderFilters = (
  displayObject,
  filters,
  { width, height, force = false, animations, targetId } = {},
) => {
  if (!displayObject) {
    return;
  }

  const animatedValues = getAnimatedShaderFilterValues(
    displayObject,
    animations,
    targetId,
  );

  if (!filters?.length && !force) {
    clearShaderFilters(displayObject);
    return;
  }

  installShaderProgressProperty(displayObject);
  installShaderFilterDestroyCleanup(displayObject);
  if (displayObject[SHADER_TIME_KEY] === undefined) {
    displayObject[SHADER_TIME_KEY] = 0;
  }

  if (!filters?.length) {
    clearShaderFilters(displayObject);
    return;
  }

  const safeWidth = Math.max(1, Math.round(width ?? displayObject.width ?? 1));
  const safeHeight = Math.max(
    1,
    Math.round(height ?? displayObject.height ?? 1),
  );
  const signature = getShaderStructureSignature(filters);
  const previousState = getShaderFiltersState(displayObject);

  if (previousState?.signature === signature) {
    for (let index = 0; index < previousState.effects.length; index++) {
      const runtime = previousState.effects[index];
      const config = filters[index];
      runtime.config = config;
      setShaderEffectResolution(runtime, safeWidth, safeHeight);
      setShaderEffectTime(runtime, displayObject[SHADER_TIME_KEY]);
      setShaderEffectProgress(runtime, displayObject.uProgress);
      for (const parameter of config.parameters ?? []) {
        setShaderEffectParameter(runtime, parameter.key, parameter.value);
      }
    }
    restoreAnimatedShaderFilterValues(displayObject, animatedValues);
    setManagedFilter(displayObject, "shader", previousState.filters);
    return;
  }

  const nextEffects = filters.map((filterConfig) =>
    createShaderEffect({
      effect: filterConfig,
      width: safeWidth,
      height: safeHeight,
      progress: displayObject.uProgress,
      time: displayObject[SHADER_TIME_KEY],
      name: `route-graphics-shader-filter-${filterConfig.id}`,
    }),
  );
  const nextFilters = nextEffects.flatMap((effect) => effect.filters);

  setShaderFiltersState(displayObject, {
    signature,
    effects: nextEffects,
    filters: nextFilters,
  });
  restoreAnimatedShaderFilterValues(displayObject, animatedValues, {
    skipExplicitInitialValues: true,
  });
  setManagedFilter(displayObject, "shader", nextFilters);
};

export const getShaderFilterTargetState = (element, { force = false } = {}) => {
  if (!element?.filters?.length && !force) return {};

  return {
    uProgress: 0,
  };
};
