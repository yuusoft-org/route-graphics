const SHADER_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

const FILTER_TEXTURE_LIMIT = 7;
const COMPOSITOR_TEXTURE_LIMIT = 6;

const SHADER_FILTER_TYPES = new Set(["shader"]);
const BLEND_MODES = new Set(["normal", "add", "multiply", "screen"]);
const TEXTURE_WRAP_MODES = new Set(["clamp", "repeat"]);
const ANTIALIAS_MODES = new Set(["on", "off", "inherit"]);

const UNIFORM_TYPE_ALIASES = new Map([
  ["f32", "f32"],
  ["vec2", "vec2<f32>"],
  ["vec2<f32>", "vec2<f32>"],
  ["vec3", "vec3<f32>"],
  ["vec3<f32>", "vec3<f32>"],
  ["vec4", "vec4<f32>"],
  ["vec4<f32>", "vec4<f32>"],
  ["mat3", "mat3x3<f32>"],
  ["mat3x3<f32>", "mat3x3<f32>"],
  ["mat4", "mat4x4<f32>"],
  ["mat4x4<f32>", "mat4x4<f32>"],
]);

const UNIFORM_TYPE_LENGTHS = new Map([
  ["f32", 1],
  ["vec2<f32>", 2],
  ["vec3<f32>", 3],
  ["vec4<f32>", 4],
  ["mat3x3<f32>", 9],
  ["mat4x4<f32>", 16],
]);

const RESERVED_SHADER_SYMBOLS = new Set([
  "uTexture",
  "uPrevTexture",
  "uNextTexture",
  "uNextTextureMatrix",
  "uNextTextureClamp",
  "uMaskTexture",
  "uProgress",
  "uTime",
  "uResolution",
  "uSampler",
  "GlobalFilterUniforms",
  "ShaderUniforms",
  "VSOutput",
  "gfu",
  "shaderUniforms",
  "mainVertex",
  "mainFragment",
  "uInputSize",
  "uInputPixel",
  "uInputClamp",
  "uOutputFrame",
  "uGlobalFrame",
  "uOutputTexture",
]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const assertPlainObject = (value, path) => {
  if (!isPlainObject(value)) {
    throw new Error(`Input Error: ${path} must be an object`);
  }
};

const assertNonEmptyString = (value, path) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Input Error: ${path} must be a non-empty string`);
  }
};

const assertShaderKey = (key, path) => {
  if (!SHADER_KEY_PATTERN.test(key)) {
    throw new Error(
      `Input Error: ${path} must match ${SHADER_KEY_PATTERN.source}`,
    );
  }
};

const toPascalCase = (key) => key.charAt(0).toUpperCase() + key.slice(1);

export const toShaderUniformSymbol = (key) => `u${toPascalCase(key)}`;

export const toShaderTextureSymbol = (key) => `u${toPascalCase(key)}Texture`;

const assertGeneratedSymbolAvailable = ({
  key,
  symbol,
  path,
  symbols,
  kind,
}) => {
  if (RESERVED_SHADER_SYMBOLS.has(symbol)) {
    throw new Error(
      `Input Error: ${path}.${key} generates reserved shader symbol ${symbol}`,
    );
  }

  if (symbols.has(symbol)) {
    throw new Error(
      `Input Error: ${path}.${key} generates duplicate shader symbol ${symbol}`,
    );
  }

  symbols.set(symbol, { key, kind });
};

const inferUniformType = (value, path) => {
  if (isFiniteNumber(value)) {
    return "f32";
  }

  if (!Array.isArray(value) || !value.every(isFiniteNumber)) {
    throw new Error(
      `Input Error: ${path} must be a finite number or a numeric array`,
    );
  }

  switch (value.length) {
    case 2:
      return "vec2<f32>";
    case 3:
      return "vec3<f32>";
    case 4:
      return "vec4<f32>";
    case 9:
      return "mat3x3<f32>";
    case 16:
      return "mat4x4<f32>";
    default:
      throw new Error(
        `Input Error: ${path} numeric arrays must have length 2, 3, 4, 9, or 16`,
      );
  }
};

const normalizeTypedUniformValue = (descriptor, path) => {
  const type = UNIFORM_TYPE_ALIASES.get(descriptor.type);
  if (!type) {
    throw new Error(
      `Input Error: ${path}.type must be one of: ${Array.from(
        UNIFORM_TYPE_ALIASES.keys(),
      ).join(", ")}`,
    );
  }

  const expectedLength = UNIFORM_TYPE_LENGTHS.get(type);
  const value = descriptor.value;
  if (expectedLength === 1) {
    if (!isFiniteNumber(value)) {
      throw new Error(`Input Error: ${path}.value must be a finite number`);
    }
    return { type, value };
  }

  if (
    !Array.isArray(value) ||
    value.length !== expectedLength ||
    !value.every(isFiniteNumber)
  ) {
    throw new Error(
      `Input Error: ${path}.value must be a ${expectedLength}-number array for ${type}`,
    );
  }

  return { type, value: [...value] };
};

const normalizeUniformValue = (value, path) => {
  if (isPlainObject(value)) {
    if (value.type === undefined || value.value === undefined) {
      throw new Error(
        `Input Error: ${path} typed values must define type and value`,
      );
    }
    return normalizeTypedUniformValue(value, path);
  }

  const type = inferUniformType(value, path);
  return {
    type,
    value: type === "f32" ? value : [...value],
  };
};

const registerExistingSymbols = (symbols, entries) => {
  for (const entry of entries) {
    symbols.set(entry.symbol, {
      key: entry.key,
      kind: entry.role ?? "uniform",
    });
  }
};

const normalizeShaderUniforms = (uniforms, path, symbols, role = "uniform") => {
  if (uniforms === undefined) {
    return [];
  }

  assertPlainObject(uniforms, path);

  return Object.keys(uniforms)
    .sort()
    .map((key) => {
      assertShaderKey(key, `${path}.${key}`);
      const symbol = toShaderUniformSymbol(key);
      assertGeneratedSymbolAvailable({
        key,
        symbol,
        path,
        symbols,
        kind: role,
      });

      return {
        key,
        symbol,
        role,
        ...normalizeUniformValue(uniforms[key], `${path}.${key}`),
      };
    });
};

const normalizeTextureDescriptor = (
  value,
  path,
  pipeline,
  preserveInheritedSampling,
) => {
  if (typeof value === "string") {
    assertNonEmptyString(value, path);
    return preserveInheritedSampling
      ? { src: value }
      : {
          src: value,
          wrap: pipeline.textureWrap,
          mipmap: pipeline.mipmap,
        };
  }

  assertPlainObject(value, path);
  assertNonEmptyString(value.src, `${path}.src`);

  const wrap = value.wrap ?? pipeline.textureWrap;
  if (!TEXTURE_WRAP_MODES.has(wrap)) {
    throw new Error(
      `Input Error: ${path}.wrap must be one of: ${Array.from(
        TEXTURE_WRAP_MODES,
      ).join(", ")}`,
    );
  }

  const mipmap = value.mipmap ?? pipeline.mipmap;
  if (typeof mipmap !== "boolean") {
    throw new Error(`Input Error: ${path}.mipmap must be a boolean`);
  }

  return {
    src: value.src,
    ...(value.wrap !== undefined || !preserveInheritedSampling ? { wrap } : {}),
    ...(value.mipmap !== undefined || !preserveInheritedSampling
      ? { mipmap }
      : {}),
  };
};

const normalizeShaderTextures = ({
  textures,
  path,
  symbols,
  maxTextures,
  pipeline,
  preserveInheritedSampling = false,
}) => {
  if (textures === undefined) {
    return [];
  }

  assertPlainObject(textures, path);

  const keys = Object.keys(textures).sort();
  if (keys.length > maxTextures) {
    throw new Error(
      `Input Error: ${path} supports at most ${maxTextures} custom textures`,
    );
  }

  return keys.map((key) => {
    assertShaderKey(key, `${path}.${key}`);
    const symbol = toShaderTextureSymbol(key);
    assertGeneratedSymbolAvailable({
      key,
      symbol,
      path,
      symbols,
      kind: "texture",
    });

    return {
      key,
      symbol,
      ...normalizeTextureDescriptor(
        textures[key],
        `${path}.${key}`,
        pipeline,
        preserveInheritedSampling,
      ),
    };
  });
};

const normalizeShaderPipeline = (pipeline, path, defaults = {}) => {
  if (pipeline !== undefined) {
    assertPlainObject(pipeline, path);
  }

  const blend = pipeline?.blend ?? defaults.blend ?? "normal";
  if (!BLEND_MODES.has(blend)) {
    throw new Error(
      `Input Error: ${path}.blend must be one of: ${Array.from(
        BLEND_MODES,
      ).join(", ")}`,
    );
  }

  const textureWrap = pipeline?.textureWrap ?? defaults.textureWrap ?? "clamp";
  if (!TEXTURE_WRAP_MODES.has(textureWrap)) {
    throw new Error(
      `Input Error: ${path}.textureWrap must be one of: ${Array.from(
        TEXTURE_WRAP_MODES,
      ).join(", ")}`,
    );
  }

  const mipmap = pipeline?.mipmap ?? defaults.mipmap ?? false;
  if (typeof mipmap !== "boolean") {
    throw new Error(`Input Error: ${path}.mipmap must be a boolean`);
  }

  return { blend, textureWrap, mipmap };
};

const normalizeShaderSource = (source, path) => {
  assertPlainObject(source, path);
  assertPlainObject(source.webgl, `${path}.webgl`);
  assertPlainObject(source.webgpu, `${path}.webgpu`);

  if (
    source.webgl.vertex !== undefined &&
    typeof source.webgl.vertex !== "string"
  ) {
    throw new Error(`Input Error: ${path}.webgl.vertex must be a string`);
  }

  assertNonEmptyString(source.webgl.fragment, `${path}.webgl.fragment`);
  assertNonEmptyString(source.webgpu.source, `${path}.webgpu.source`);

  if (
    !source.webgpu.source.includes("mainVertex") ||
    !source.webgpu.source.includes("mainFragment")
  ) {
    throw new Error(
      `Input Error: ${path}.webgpu.source must define mainVertex and mainFragment`,
    );
  }

  return {
    webgl: {
      ...(source.webgl.vertex !== undefined
        ? { vertex: source.webgl.vertex }
        : {}),
      fragment: source.webgl.fragment,
    },
    webgpu: {
      source: source.webgpu.source,
    },
  };
};

const normalizeShaderMesh = (mesh, path, defaultMesh) => {
  const candidate = mesh ?? defaultMesh;
  if (candidate === undefined) {
    return { grid: [1, 1] };
  }

  assertPlainObject(candidate, path);
  if (
    !Array.isArray(candidate.grid) ||
    candidate.grid.length !== 2 ||
    !candidate.grid.every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 512,
    )
  ) {
    throw new Error(
      `Input Error: ${path}.grid must be [columns, rows] with integers from 1 to 512`,
    );
  }

  return { grid: [candidate.grid[0], candidate.grid[1]] };
};

const normalizePassOptions = (raw, path, defaults = {}) => {
  const padding = raw.padding ?? defaults.padding ?? 0;
  if (!isFiniteNumber(padding) || padding < 0) {
    throw new Error(
      `Input Error: ${path}.padding must be a finite number >= 0`,
    );
  }

  const resolution = raw.resolution ?? defaults.resolution ?? 1;
  if (
    resolution !== "inherit" &&
    (!isFiniteNumber(resolution) || resolution <= 0)
  ) {
    throw new Error(
      `Input Error: ${path}.resolution must be "inherit" or a finite number > 0`,
    );
  }

  let antialias = raw.antialias ?? defaults.antialias ?? "off";
  if (typeof antialias === "boolean") {
    antialias = antialias ? "on" : "off";
  }
  if (!ANTIALIAS_MODES.has(antialias)) {
    throw new Error(
      `Input Error: ${path}.antialias must be on, off, inherit, or a boolean`,
    );
  }

  const clipToViewport = raw.clipToViewport ?? defaults.clipToViewport ?? true;
  if (typeof clipToViewport !== "boolean") {
    throw new Error(`Input Error: ${path}.clipToViewport must be a boolean`);
  }

  const time = raw.time ?? defaults.time ?? false;
  if (typeof time !== "boolean") {
    throw new Error(`Input Error: ${path}.time must be a boolean`);
  }

  return { padding, resolution, antialias, clipToViewport, time };
};

const normalizeEffectPass = ({
  pass,
  index,
  path,
  parameters,
  commonTextures,
  effectPipeline,
  effectOptions,
  effectMesh,
  textureLimit,
}) => {
  assertPlainObject(pass, path);

  const id = pass.id ?? `pass${index + 1}`;
  assertNonEmptyString(id, `${path}.id`);

  const pipeline = normalizeShaderPipeline(
    pass.pipeline,
    `${path}.pipeline`,
    effectPipeline,
  );
  const symbols = new Map();
  registerExistingSymbols(symbols, parameters);
  registerExistingSymbols(symbols, commonTextures);

  const uniforms = normalizeShaderUniforms(
    pass.uniforms,
    `${path}.uniforms`,
    symbols,
  );
  const remainingTextureBudget = textureLimit - commonTextures.length;
  const textures = normalizeShaderTextures({
    textures: pass.textures,
    path: `${path}.textures`,
    symbols,
    maxTextures: remainingTextureBudget,
    pipeline,
  });
  const resolvedCommonTextures = commonTextures.map((texture) => ({
    ...texture,
    wrap: texture.wrap ?? pipeline.textureWrap,
    mipmap: texture.mipmap ?? pipeline.mipmap,
  }));

  return {
    id,
    source: normalizeShaderSource(pass.source, `${path}.source`),
    uniforms: [...parameters, ...uniforms].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    textures: [...resolvedCommonTextures, ...textures].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    pipeline,
    mesh: normalizeShaderMesh(pass.mesh, `${path}.mesh`, effectMesh),
    ...normalizePassOptions(pass, path, effectOptions),
  };
};

const normalizeShaderConfig = ({ shader, path, requireId, textureLimit }) => {
  assertPlainObject(shader, path);

  if (!SHADER_FILTER_TYPES.has(shader.type)) {
    throw new Error(`Input Error: ${path}.type must be shader`);
  }

  const normalized = { type: "shader" };
  if (requireId) {
    assertNonEmptyString(shader.id, `${path}.id`);
    normalized.id = shader.id;
  } else if (shader.id !== undefined) {
    assertNonEmptyString(shader.id, `${path}.id`);
    normalized.id = shader.id;
  }

  if (shader.parameters !== undefined && shader.uniforms !== undefined) {
    throw new Error(
      `Input Error: ${path} cannot define both parameters and legacy uniforms`,
    );
  }

  const symbols = new Map();
  normalized.parameters = normalizeShaderUniforms(
    shader.parameters ?? shader.uniforms,
    shader.parameters !== undefined ? `${path}.parameters` : `${path}.uniforms`,
    symbols,
    "parameter",
  );
  // Internal compatibility alias for integrations that consumed the v1
  // normalized shape. New runtime code uses `parameters`.
  normalized.uniforms = normalized.parameters;
  normalized.pipeline = normalizeShaderPipeline(
    shader.pipeline,
    `${path}.pipeline`,
  );
  normalized.textures = normalizeShaderTextures({
    textures: shader.textures,
    path: `${path}.textures`,
    symbols,
    maxTextures: textureLimit,
    pipeline: normalized.pipeline,
    preserveInheritedSampling: true,
  });
  normalized.mesh = normalizeShaderMesh(shader.mesh, `${path}.mesh`);
  Object.assign(normalized, normalizePassOptions(shader, path));

  const hasPasses = shader.passes !== undefined;
  if (hasPasses && shader.source !== undefined) {
    throw new Error(
      `Input Error: ${path} cannot define both source and passes`,
    );
  }

  let rawPasses;
  if (hasPasses) {
    if (!Array.isArray(shader.passes) || shader.passes.length === 0) {
      throw new Error(`Input Error: ${path}.passes must be a non-empty array`);
    }
    rawPasses = shader.passes;
  } else {
    rawPasses = [
      {
        id: "main",
        source: shader.source,
      },
    ];
  }

  const seenPassIds = new Set();
  normalized.passes = rawPasses.map((pass, index) => {
    const normalizedPass = normalizeEffectPass({
      pass,
      index,
      path: hasPasses ? `${path}.passes[${index}]` : path,
      parameters: normalized.parameters,
      commonTextures: normalized.textures,
      effectPipeline: normalized.pipeline,
      effectOptions: normalized,
      effectMesh: normalized.mesh,
      textureLimit,
    });

    if (seenPassIds.has(normalizedPass.id)) {
      throw new Error(
        `Input Error: ${path}.passes[${index}].id must be unique`,
      );
    }
    seenPassIds.add(normalizedPass.id);
    return normalizedPass;
  });

  return normalized;
};

export const normalizeElementShaderFilters = (filters, path = "filters") => {
  if (filters === undefined) {
    return undefined;
  }
  if (!Array.isArray(filters)) {
    throw new Error(`Input Error: ${path} must be an array`);
  }

  const seenIds = new Set();
  return filters.map((filter, index) => {
    const normalized = normalizeShaderConfig({
      shader: filter,
      path: `${path}[${index}]`,
      requireId: true,
      textureLimit: FILTER_TEXTURE_LIMIT,
    });

    if (seenIds.has(normalized.id)) {
      throw new Error(
        `Input Error: ${path}[${index}].id must be unique within filters`,
      );
    }
    seenIds.add(normalized.id);
    return normalized;
  });
};

export const normalizeShaderCompositor = (compositor, path = "compositor") =>
  normalizeShaderConfig({
    shader: compositor,
    path,
    requireId: false,
    textureLimit: COMPOSITOR_TEXTURE_LIMIT,
  });

export const getShaderConfigSignature = (config) =>
  JSON.stringify(config ?? null);

export const getShaderStructureSignature = (config) =>
  JSON.stringify(
    config ?? null,
    function omitMutableParameterValues(key, value) {
      if (key === "value" && this?.role === "parameter") {
        return null;
      }
      return value;
    },
  );
