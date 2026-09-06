import { Assets, GlProgram, GpuProgram } from "pixi.js";
import { createGpuProgramOptions } from "./gpuProgramOptions.js";
import { DEFAULT_SHADER_FILTER_VERTEX } from "../../plugins/elements/util/shaderFilterEffect.js";
import { getShaderDiagnosticPath } from "../../plugins/elements/util/shaderConfig.js";

const validatedWebGLPrograms = new WeakMap();
const validatedWebGPUPrograms = new WeakMap();

const compactCompilerLog = (value) => {
  const message = String(value ?? "").trim();
  if (message.length === 0) return "No compiler diagnostic was provided.";
  return message.length > 4000 ? `${message.slice(0, 4000)}…` : message;
};

export class RouteGraphicsShaderError extends Error {
  constructor(message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RouteGraphicsShaderError";
    this.code = "ROUTE_GRAPHICS_SHADER_INVALID";
    this.details = details;
  }
}

const describeEffect = ({ effect, owner }) =>
  owner.kind === "element"
    ? `element "${owner.id}" shader filter "${effect.id}"`
    : `animation "${owner.id}" transition compositor`;

const createShaderError = ({
  backend,
  cause,
  effect,
  message,
  owner,
  pass,
  path,
  phase,
  stage,
}) =>
  new RouteGraphicsShaderError(
    `Shader Error: ${describeEffect({ effect, owner })} at ${path} ${message}`,
    {
      backend,
      effectId: effect.id ?? null,
      ownerId: owner.id,
      ownerKind: owner.kind,
      passId: pass.id ?? null,
      path,
      phase,
      ...(stage ? { stage } : {}),
    },
    cause,
  );

const collectElementEffects = (elements, output) => {
  for (const element of elements ?? []) {
    for (const effect of element.filters ?? []) {
      output.push({
        effect,
        owner: { kind: "element", id: element.id },
      });
    }
    collectElementEffects(element.children, output);
  }
};

const collectShaderEffects = (state) => {
  const effects = [];
  collectElementEffects(state.elements, effects);
  for (const animation of state.animations ?? []) {
    if (animation.compositor?.type === "shader") {
      effects.push({
        effect: animation.compositor,
        owner: { kind: "animation", id: animation.id },
      });
    }
  }
  return effects;
};

const assertTextureReferencesLoaded = ({ backend, effect, owner }) => {
  const seen = new Set();

  for (const pass of effect.passes ?? []) {
    for (const texture of pass.textures ?? []) {
      if (seen.has(texture.src)) continue;
      seen.add(texture.src);
      if (Assets.cache.has(texture.src)) continue;

      const path = `${getShaderDiagnosticPath(
        pass,
        getShaderDiagnosticPath(effect),
      )}.textures.${texture.key}`;
      throw createShaderError({
        backend,
        effect,
        message: `references unloaded texture "${texture.src}".`,
        owner,
        pass,
        path,
        phase: "texture",
      });
    }
  }
};

const hasWebGLCompiler = (gl) =>
  [
    "createShader",
    "shaderSource",
    "compileShader",
    "getShaderParameter",
    "getShaderInfoLog",
    "deleteShader",
    "createProgram",
    "attachShader",
    "linkProgram",
    "getProgramParameter",
    "getProgramInfoLog",
    "deleteProgram",
  ].every((method) => typeof gl?.[method] === "function");

const compileWebGLShader = ({
  effect,
  gl,
  owner,
  pass,
  path,
  source,
  stage,
  type,
}) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw createShaderError({
      backend: "webgl",
      effect,
      message: `could not allocate its ${stage} shader.`,
      owner,
      pass,
      path,
      phase: "compile",
      stage,
    });
  }

  try {
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      return shader;
    }

    const compilerLog = compactCompilerLog(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    throw createShaderError({
      backend: "webgl",
      effect,
      message: `failed WebGL ${stage} compilation: ${compilerLog}`,
      owner,
      pass,
      path,
      phase: "compile",
      stage,
    });
  } catch (cause) {
    if (cause instanceof RouteGraphicsShaderError) throw cause;
    gl.deleteShader(shader);
    throw createShaderError({
      backend: "webgl",
      cause,
      effect,
      message: `could not compile its WebGL ${stage} shader: ${compactCompilerLog(
        cause?.message,
      )}`,
      owner,
      pass,
      path,
      phase: "compile",
      stage,
    });
  }
};

const validateWebGLPass = ({ effect, gl, owner, pass }) => {
  const path = getShaderDiagnosticPath(pass, getShaderDiagnosticPath(effect));
  let programSource;

  try {
    programSource = GlProgram.from({
      vertex: pass.source.webgl.vertex ?? DEFAULT_SHADER_FILTER_VERTEX,
      fragment: pass.source.webgl.fragment,
      name: `route-graphics-validation-${pass.id}`,
    });
  } catch (cause) {
    throw createShaderError({
      backend: "webgl",
      cause,
      effect,
      message: `could not prepare WebGL sources: ${compactCompilerLog(cause?.message)}`,
      owner,
      pass,
      path,
      phase: "prepare",
    });
  }

  const vertexShader = compileWebGLShader({
    effect,
    gl,
    owner,
    pass,
    path,
    source: programSource.vertex,
    stage: "vertex",
    type: gl.VERTEX_SHADER,
  });
  let fragmentShader;
  let program;

  try {
    fragmentShader = compileWebGLShader({
      effect,
      gl,
      owner,
      pass,
      path,
      source: programSource.fragment,
      stage: "fragment",
      type: gl.FRAGMENT_SHADER,
    });
    program = gl.createProgram();
    if (!program) {
      throw createShaderError({
        backend: "webgl",
        effect,
        message: "could not allocate its WebGL program.",
        owner,
        pass,
        path,
        phase: "link",
      });
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw createShaderError({
        backend: "webgl",
        effect,
        message: `failed WebGL program linking: ${compactCompilerLog(
          gl.getProgramInfoLog(program),
        )}`,
        owner,
        pass,
        path,
        phase: "link",
      });
    }
  } catch (cause) {
    if (cause instanceof RouteGraphicsShaderError) throw cause;
    throw createShaderError({
      backend: "webgl",
      cause,
      effect,
      message: `could not link its WebGL program: ${compactCompilerLog(
        cause?.message,
      )}`,
      owner,
      pass,
      path,
      phase: "link",
    });
  } finally {
    gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    if (program) gl.deleteProgram(program);
  }
};

const validateWebGLPrograms = ({ effects, gl }) => {
  if (!hasWebGLCompiler(gl)) return;
  let cache = validatedWebGLPrograms.get(gl);
  if (!cache) {
    cache = new Set();
    validatedWebGLPrograms.set(gl, cache);
  }

  for (const { effect, owner } of effects) {
    assertTextureReferencesLoaded({
      backend: "webgl",
      effect,
      owner,
    });
    for (const pass of effect.passes ?? []) {
      const key = JSON.stringify([
        pass.source.webgl.vertex ?? null,
        pass.source.webgl.fragment,
      ]);
      if (cache.has(key)) continue;
      validateWebGLPass({ effect, gl, owner, pass });
      cache.add(key);
    }
  }
};

const validateWebGPUPass = ({ device, effect, owner, pass }) => {
  const path = getShaderDiagnosticPath(pass, getShaderDiagnosticPath(effect));

  try {
    GpuProgram.from(
      createGpuProgramOptions(
        pass.source.webgpu.source,
        `route-graphics-validation-${pass.id}`,
      ),
    );
    device.createShaderModule?.({
      code: pass.source.webgpu.source,
      label: `Route Graphics ${path}`,
    });
  } catch (cause) {
    throw createShaderError({
      backend: "webgpu",
      cause,
      effect,
      message: `could not prepare WebGPU source: ${compactCompilerLog(cause?.message)}`,
      owner,
      pass,
      path,
      phase: "prepare",
    });
  }
};

const validateWebGPUPrograms = ({ device, effects }) => {
  if (!device || typeof GpuProgram?.from !== "function") return;
  let cache = validatedWebGPUPrograms.get(device);
  if (!cache) {
    cache = new Set();
    validatedWebGPUPrograms.set(device, cache);
  }

  for (const { effect, owner } of effects) {
    assertTextureReferencesLoaded({
      backend: "webgpu",
      effect,
      owner,
    });
    for (const pass of effect.passes ?? []) {
      const key = pass.source.webgpu.source;
      if (cache.has(key)) continue;
      validateWebGPUPass({ device, effect, owner, pass });
      cache.add(key);
    }
  }
};

/**
 * Preflights every shader before renderElements can mutate the display tree.
 * WebGL provides synchronous compiler/linker status. WebGPU source layout and
 * module creation are synchronous, while final compiler diagnostics remain
 * asynchronous in the WebGPU platform API.
 */
export const validateShaderProgramsForRenderer = ({ renderer, state }) => {
  const effects = collectShaderEffects(state);
  if (effects.length === 0) return;

  if (renderer?.gl) {
    validateWebGLPrograms({ effects, gl: renderer.gl });
    return;
  }

  if (renderer?.gpu?.device) {
    validateWebGPUPrograms({
      device: renderer.gpu.device,
      effects,
    });
  }
};
