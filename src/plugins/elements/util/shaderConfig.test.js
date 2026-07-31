import { describe, expect, it } from "vitest";
import {
  getShaderConfigSignature,
  getShaderDiagnosticPath,
  getShaderStructureSignature,
  normalizeElementShaderFilters,
  normalizeShaderCompositor,
} from "./shaderConfig.js";

const source = {
  webgl: {
    fragment: `
      in vec2 vTextureCoord;
      out vec4 finalColor;
      uniform sampler2D uTexture;
      void main() { finalColor = texture(uTexture, vTextureCoord); }
    `,
  },
  webgpu: {
    source: `
      struct VSOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
      };
      @vertex fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
        return VSOutput(vec4<f32>(aPosition, 0.0, 1.0), aPosition);
      }
      @fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
        return vec4<f32>(uv, 0.0, 1.0);
      }
    `,
  },
};

const normalizeFilter = (overrides = {}) =>
  normalizeElementShaderFilters([
    {
      id: "test",
      type: "shader",
      source,
      ...overrides,
    },
  ])[0];

const createTextureMap = (count) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `texture${index}`,
      `asset-${index}`,
    ]),
  );

describe("shader config normalization", () => {
  it("normalizes element shader filters with sorted uniforms and textures", () => {
    const filters = normalizeElementShaderFilters([
      {
        id: "crt",
        type: "shader",
        uniforms: {
          intensity: 0.3,
          tint: [1, 0.8, 0.4, 1],
          offset: [2, 4],
        },
        textures: {
          noise: "noise-texture",
        },
        source,
      },
    ]);

    expect(filters[0].uniforms.map((uniform) => uniform.symbol)).toEqual([
      "uIntensity",
      "uOffset",
      "uTint",
    ]);
    expect(filters[0].textures[0]).toMatchObject({
      key: "noise",
      symbol: "uNoiseTexture",
      samplerSymbol: "uNoiseTextureSampler",
      src: "noise-texture",
    });
    expect(filters[0].pipeline).toEqual({
      blend: "normal",
      textureWrap: "clamp",
      mipmap: false,
    });
    expect(JSON.parse(JSON.stringify(filters))).toEqual(filters);
  });

  it("rejects generated uniform and texture symbol collisions", () => {
    expect(() =>
      normalizeElementShaderFilters([
        {
          id: "bad",
          type: "shader",
          uniforms: {
            noiseTexture: 1,
          },
          textures: {
            noise: "noise-texture",
          },
          source,
        },
      ]),
    ).toThrow(/duplicate shader symbol uNoiseTexture/);
  });

  it.each([
    [
      "effect",
      { paddding: 12 },
      /Input Error: filters\[0\]\.paddding is not supported/,
    ],
    [
      "pipeline",
      { pipeline: { blend: "normal", textureWarp: "repeat" } },
      /filters\[0\]\.pipeline\.textureWarp is not supported/,
    ],
    [
      "mesh",
      { mesh: { grid: [2, 2], columns: 2 } },
      /filters\[0\]\.mesh\.columns is not supported/,
    ],
    [
      "source",
      { source: { ...source, language: "glsl" } },
      /filters\[0\]\.source\.language is not supported/,
    ],
    [
      "backend source",
      {
        source: {
          ...source,
          webgl: { ...source.webgl, entryPoint: "main" },
        },
      },
      /filters\[0\]\.source\.webgl\.entryPoint is not supported/,
    ],
    [
      "typed parameter",
      {
        parameters: {
          amount: { type: "f32", value: 1, default: 0 },
        },
      },
      /filters\[0\]\.parameters\.amount\.default is not supported/,
    ],
    [
      "texture",
      {
        textures: {
          noise: { src: "noise-texture", filtering: "linear" },
        },
      },
      /filters\[0\]\.textures\.noise\.filtering is not supported/,
    ],
    [
      "pass",
      {
        source: undefined,
        passes: [{ id: "main", source, iterations: 2 }],
      },
      /filters\[0\]\.passes\[0\]\.iterations is not supported/,
    ],
  ])("rejects unknown %s keys", (_name, overrides, expected) => {
    expect(() =>
      normalizeElementShaderFilters([
        {
          id: "strict",
          type: "shader",
          source,
          ...overrides,
        },
      ]),
    ).toThrow(expected);
  });

  it("allows compositor tween while rejecting it on element filters", () => {
    const compositor = normalizeShaderCompositor({
      type: "shader",
      source,
      tween: {
        progress: {
          keyframes: [{ duration: 100, value: 1 }],
        },
      },
    });

    expect(compositor.type).toBe("shader");
    expect(() =>
      normalizeElementShaderFilters([
        {
          id: "filter",
          type: "shader",
          source,
          tween: {},
        },
      ]),
    ).toThrow(/filters\[0\]\.tween is not supported/);
  });

  it("requires real backend entry points rather than names in comments", () => {
    expect(() =>
      normalizeElementShaderFilters([
        {
          id: "missing-gl-main",
          type: "shader",
          source: {
            ...source,
            webgl: {
              fragment: "// void main() is not an entry point",
            },
          },
        },
      ]),
    ).toThrow(/webgl\.fragment must define void main\(\)/);

    expect(() =>
      normalizeElementShaderFilters([
        {
          id: "missing-wgsl-entry",
          type: "shader",
          source: {
            ...source,
            webgpu: {
              source: `
                // @vertex fn mainVertex() {}
                // @fragment fn mainFragment() {}
                fn helper() {}
              `,
            },
          },
        },
      ]),
    ).toThrow(/must define mainVertex and mainFragment/);
  });

  it("requires a non-empty main function in custom WebGL vertex source", () => {
    expect(() =>
      normalizeElementShaderFilters([
        {
          id: "bad-vertex",
          type: "shader",
          source: {
            ...source,
            webgl: {
              ...source.webgl,
              vertex: " ",
            },
          },
        },
      ]),
    ).toThrow(/webgl\.vertex must be a non-empty string/);
  });

  it("rejects generated custom-texture sampler symbol collisions", () => {
    expect(() =>
      normalizeElementShaderFilters([
        {
          id: "bad-sampler",
          type: "shader",
          parameters: {
            noiseTextureSampler: 1,
          },
          textures: {
            noise: "noise-texture",
          },
          source,
        },
      ]),
    ).toThrow(/duplicate shader symbol uNoiseTextureSampler/);
  });

  it("rejects reserved generated texture symbols", () => {
    expect(() =>
      normalizeShaderCompositor({
        type: "shader",
        textures: {
          next: "next-texture",
        },
        source,
      }),
    ).toThrow(/reserved shader symbol uNextTexture/);
  });

  it("rejects reserved compositor coordinate uniform symbols", () => {
    expect(() =>
      normalizeShaderCompositor({
        type: "shader",
        uniforms: {
          nextTextureMatrix: 1,
        },
        source,
      }),
    ).toThrow(/reserved shader symbol uNextTextureMatrix/);
  });

  it("supports vector and matrix parameters and rejects unknown shapes", () => {
    const [filter] = normalizeElementShaderFilters([
      {
        id: "typed",
        type: "shader",
        parameters: {
          direction: [1, 0, 0],
          transform: {
            type: "mat3",
            value: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          },
        },
        source,
      },
    ]);

    expect(filter.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "direction",
          type: "vec3<f32>",
          value: [1, 0, 0],
        }),
        expect.objectContaining({
          key: "transform",
          type: "mat3x3<f32>",
        }),
      ]),
    );

    expect(() =>
      normalizeElementShaderFilters([
        {
          id: "bad",
          type: "shader",
          parameters: {
            unsupported: [1, 2, 3, 4, 5],
          },
          source,
        },
      ]),
    ).toThrow(/length 2, 3, 4, 9, or 16/);
  });

  it("normalizes inline multi-pass effects and pass-local overrides", () => {
    const [filter] = normalizeElementShaderFilters([
      {
        id: "bloom",
        type: "shader",
        parameters: {
          amount: 0.75,
        },
        textures: {
          noise: {
            src: "noise-texture",
            wrap: "repeat",
            mipmap: true,
          },
        },
        padding: 12,
        resolution: "inherit",
        antialias: true,
        time: true,
        mesh: {
          grid: [8, 4],
        },
        passes: [
          {
            id: "horizontal",
            source,
            uniforms: {
              axis: [1, 0],
            },
          },
          {
            id: "vertical",
            source,
            pipeline: {
              blend: "add",
            },
            padding: 20,
          },
        ],
      },
    ]);

    expect(filter.passes).toHaveLength(2);
    expect(filter.passes[0]).toMatchObject({
      id: "horizontal",
      padding: 12,
      resolution: "inherit",
      antialias: "on",
      time: true,
      mesh: { grid: [8, 4] },
    });
    expect(filter.passes[0].uniforms.map(({ key }) => key)).toEqual([
      "amount",
      "axis",
    ]);
    expect(filter.passes[0].textures[0]).toMatchObject({
      key: "noise",
      wrap: "repeat",
      mipmap: true,
    });
    expect(filter.passes[1]).toMatchObject({
      id: "vertical",
      padding: 20,
      pipeline: {
        blend: "add",
        textureWrap: "clamp",
        mipmap: false,
      },
    });
  });

  it("resolves inherited shared-texture sampling against each pass pipeline", () => {
    const [filter] = normalizeElementShaderFilters([
      {
        id: "multi-sample",
        type: "shader",
        textures: {
          inherited: "inherited-texture",
          explicit: {
            src: "explicit-texture",
            wrap: "repeat",
            mipmap: true,
          },
        },
        pipeline: {
          textureWrap: "repeat",
          mipmap: true,
        },
        passes: [
          {
            id: "clamped",
            source,
            pipeline: {
              textureWrap: "clamp",
              mipmap: false,
            },
          },
          {
            id: "inherited",
            source,
          },
        ],
      },
    ]);

    const inheritedTexture = filter.textures.find(
      ({ key }) => key === "inherited",
    );
    expect(inheritedTexture).not.toHaveProperty("wrap");
    expect(inheritedTexture).not.toHaveProperty("mipmap");
    expect(filter.passes[0].textures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "inherited",
          wrap: "clamp",
          mipmap: false,
        }),
        expect.objectContaining({
          key: "explicit",
          wrap: "repeat",
          mipmap: true,
        }),
      ]),
    );
    expect(filter.passes[1].textures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "inherited",
          wrap: "repeat",
          mipmap: true,
        }),
      ]),
    );
  });

  it("normalizes compositor mesh defaults and explicit grids", () => {
    expect(
      normalizeShaderCompositor({
        type: "shader",
        source,
      }).mesh,
    ).toEqual({ grid: [1, 1] });

    expect(
      normalizeShaderCompositor({
        type: "shader",
        mesh: {
          grid: [64, 2],
        },
        source,
      }).mesh,
    ).toEqual({ grid: [64, 2] });
  });

  it.each([
    {
      name: "non-array filter collection",
      run: () => normalizeElementShaderFilters({}),
      expected: /filters must be an array/,
    },
    {
      name: "non-object filter",
      run: () => normalizeElementShaderFilters([null]),
      expected: /filters\[0\] must be an object/,
    },
    {
      name: "unsupported filter type",
      run: () => normalizeFilter({ type: "blur" }),
      expected: /filters\[0\]\.type must be shader/,
    },
    {
      name: "missing filter id",
      run: () => normalizeFilter({ id: undefined }),
      expected: /filters\[0\]\.id must be a non-empty string/,
    },
    {
      name: "blank filter id",
      run: () => normalizeFilter({ id: " \n " }),
      expected: /filters\[0\]\.id must be a non-empty string/,
    },
    {
      name: "duplicate filter id",
      run: () =>
        normalizeElementShaderFilters([
          { id: "same", type: "shader", source },
          { id: "same", type: "shader", source },
        ]),
      expected: /filters\[1\]\.id must be unique within filters/,
    },
    {
      name: "blank optional compositor id",
      run: () =>
        normalizeShaderCompositor({
          id: " ",
          type: "shader",
          source,
        }),
      expected: /compositor\.id must be a non-empty string/,
    },
    {
      name: "parameters and legacy uniforms together",
      run: () =>
        normalizeFilter({
          parameters: { amount: 1 },
          uniforms: { legacy: 1 },
        }),
      expected: /cannot define both parameters and legacy uniforms/,
    },
    {
      name: "source and passes together",
      run: () =>
        normalizeFilter({
          passes: [{ id: "main", source }],
        }),
      expected: /cannot define both source and passes/,
    },
    {
      name: "empty pass array",
      run: () => normalizeFilter({ source: undefined, passes: [] }),
      expected: /passes must be a non-empty array/,
    },
    {
      name: "non-array passes",
      run: () => normalizeFilter({ source: undefined, passes: {} }),
      expected: /passes must be a non-empty array/,
    },
  ])("rejects $name", ({ run, expected }) => {
    expect(run).toThrow(expected);
  });

  it("treats an omitted filter collection as no filters", () => {
    expect(normalizeElementShaderFilters()).toBeUndefined();
  });

  it.each([
    ["scalar", 0.5, "f32"],
    ["vec2", [1, 2], "vec2<f32>"],
    ["vec3", [1, 2, 3], "vec3<f32>"],
    ["vec4", [1, 2, 3, 4], "vec4<f32>"],
    ["mat3", Array.from({ length: 9 }, (_, index) => index), "mat3x3<f32>"],
    ["mat4", Array.from({ length: 16 }, (_, index) => index), "mat4x4<f32>"],
  ])("infers the %s parameter shape", (key, value, expectedType) => {
    const filter = normalizeFilter({ parameters: { [key]: value } });
    expect(filter.parameters[0]).toMatchObject({
      key,
      role: "parameter",
      type: expectedType,
      value,
    });
  });

  it.each([
    ["f32", 1, "f32"],
    ["vec2", [1, 2], "vec2<f32>"],
    ["vec2<f32>", [1, 2], "vec2<f32>"],
    ["vec3", [1, 2, 3], "vec3<f32>"],
    ["vec3<f32>", [1, 2, 3], "vec3<f32>"],
    ["vec4", [1, 2, 3, 4], "vec4<f32>"],
    ["vec4<f32>", [1, 2, 3, 4], "vec4<f32>"],
    ["mat3", Array.from({ length: 9 }, (_, index) => index), "mat3x3<f32>"],
    [
      "mat3x3<f32>",
      Array.from({ length: 9 }, (_, index) => index),
      "mat3x3<f32>",
    ],
    ["mat4", Array.from({ length: 16 }, (_, index) => index), "mat4x4<f32>"],
    [
      "mat4x4<f32>",
      Array.from({ length: 16 }, (_, index) => index),
      "mat4x4<f32>",
    ],
  ])("normalizes the explicit %s type", (type, value, expectedType) => {
    const filter = normalizeFilter({
      parameters: { value: { type, value } },
    });
    expect(filter.parameters[0]).toMatchObject({
      type: expectedType,
      value,
    });
  });

  it.each([
    {
      name: "invalid parameter key",
      parameters: { Bad_key: 1 },
      expected: /must match \^\[a-z\]\[A-Za-z0-9\]\*\$/,
    },
    {
      name: "reserved parameter symbol",
      parameters: { progress: 1 },
      expected: /reserved shader symbol uProgress/,
    },
    {
      name: "non-object parameter map",
      parameters: [],
      expected: /parameters must be an object/,
    },
    {
      name: "non-numeric parameter",
      parameters: { amount: "1" },
      expected: /finite number or a numeric array/,
    },
    {
      name: "non-finite scalar",
      parameters: { amount: Infinity },
      expected: /finite number or a numeric array/,
    },
    {
      name: "non-finite inferred vector component",
      parameters: { amount: [1, Number.NaN] },
      expected: /finite number or a numeric array/,
    },
    {
      name: "typed descriptor missing type",
      parameters: { amount: { value: 1 } },
      expected: /typed values must define type and value/,
    },
    {
      name: "typed descriptor missing value",
      parameters: { amount: { type: "f32" } },
      expected: /typed values must define type and value/,
    },
    {
      name: "unknown typed descriptor",
      parameters: { amount: { type: "i32", value: 1 } },
      expected: /\.type must be one of:/,
    },
    {
      name: "non-finite typed scalar",
      parameters: { amount: { type: "f32", value: Number.NaN } },
      expected: /\.value must be a finite number/,
    },
    {
      name: "wrong typed vector length",
      parameters: { amount: { type: "vec3", value: [1, 2] } },
      expected: /\.value must be a 3-number array for vec3<f32>/,
    },
    {
      name: "non-finite typed matrix component",
      parameters: {
        amount: {
          type: "mat3",
          value: [1, 0, 0, 0, Infinity, 0, 0, 0, 1],
        },
      },
      expected: /\.value must be a 9-number array for mat3x3<f32>/,
    },
  ])("rejects $name", ({ parameters, expected }) => {
    expect(() => normalizeFilter({ parameters })).toThrow(expected);
  });

  it.each([
    {
      name: "non-object texture map",
      textures: [],
      expected: /textures must be an object/,
    },
    {
      name: "invalid texture key",
      textures: { Bad_key: "asset" },
      expected: /textures\.Bad_key must match/,
    },
    {
      name: "blank texture alias",
      textures: { noise: " " },
      expected: /textures\.noise must be a non-empty string/,
    },
    {
      name: "non-object texture descriptor",
      textures: { noise: 7 },
      expected: /textures\.noise must be an object/,
    },
    {
      name: "blank descriptor source",
      textures: { noise: { src: "" } },
      expected: /textures\.noise\.src must be a non-empty string/,
    },
    {
      name: "unsupported wrap",
      textures: { noise: { src: "asset", wrap: "mirror" } },
      expected: /\.wrap must be one of: clamp, repeat/,
    },
    {
      name: "non-boolean mipmap",
      textures: { noise: { src: "asset", mipmap: 1 } },
      expected: /\.mipmap must be a boolean/,
    },
    {
      name: "filter texture limit",
      textures: createTextureMap(8),
      expected: /supports at most 7 custom textures/,
    },
  ])("rejects $name", ({ textures, expected }) => {
    expect(() => normalizeFilter({ textures })).toThrow(expected);
  });

  it("enforces the compositor texture limit independently", () => {
    expect(() =>
      normalizeShaderCompositor({
        type: "shader",
        textures: createTextureMap(7),
        source,
      }),
    ).toThrow(/supports at most 6 custom textures/);
    expect(() =>
      normalizeShaderCompositor({
        type: "shader",
        textures: createTextureMap(6),
        source,
      }),
    ).not.toThrow();
  });

  it.each([
    {
      name: "non-object pipeline",
      overrides: { pipeline: [] },
      expected: /pipeline must be an object/,
    },
    {
      name: "unsupported blend mode",
      overrides: { pipeline: { blend: "overlay" } },
      expected: /\.blend must be one of: normal, add, multiply, screen/,
    },
    {
      name: "unsupported texture wrap",
      overrides: { pipeline: { textureWrap: "mirror" } },
      expected: /\.textureWrap must be one of: clamp, repeat/,
    },
    {
      name: "non-boolean pipeline mipmap",
      overrides: { pipeline: { mipmap: "yes" } },
      expected: /pipeline\.mipmap must be a boolean/,
    },
    {
      name: "non-object mesh",
      overrides: { mesh: [] },
      expected: /mesh must be an object/,
    },
    {
      name: "missing mesh grid",
      overrides: { mesh: {} },
      expected: /mesh\.grid must be \[columns, rows\]/,
    },
    {
      name: "short mesh grid",
      overrides: { mesh: { grid: [1] } },
      expected: /mesh\.grid must be \[columns, rows\]/,
    },
    {
      name: "zero mesh dimension",
      overrides: { mesh: { grid: [0, 1] } },
      expected: /mesh\.grid must be \[columns, rows\]/,
    },
    {
      name: "oversized mesh dimension",
      overrides: { mesh: { grid: [1, 513] } },
      expected: /mesh\.grid must be \[columns, rows\]/,
    },
    {
      name: "fractional mesh dimension",
      overrides: { mesh: { grid: [1, 1.5] } },
      expected: /mesh\.grid must be \[columns, rows\]/,
    },
    {
      name: "negative padding",
      overrides: { padding: -1 },
      expected: /padding must be a finite number >= 0/,
    },
    {
      name: "non-finite padding",
      overrides: { padding: Infinity },
      expected: /padding must be a finite number >= 0/,
    },
    {
      name: "zero resolution",
      overrides: { resolution: 0 },
      expected: /resolution must be "inherit" or a finite number > 0/,
    },
    {
      name: "non-finite resolution",
      overrides: { resolution: Number.NaN },
      expected: /resolution must be "inherit" or a finite number > 0/,
    },
    {
      name: "unsupported antialias mode",
      overrides: { antialias: "auto" },
      expected: /antialias must be on, off, inherit, or a boolean/,
    },
    {
      name: "non-boolean clip flag",
      overrides: { clipToViewport: 1 },
      expected: /clipToViewport must be a boolean/,
    },
    {
      name: "non-boolean time flag",
      overrides: { time: 1 },
      expected: /time must be a boolean/,
    },
  ])("rejects $name", ({ overrides, expected }) => {
    expect(() => normalizeFilter(overrides)).toThrow(expected);
  });

  it("accepts all pipeline enums and pass-option boundaries", () => {
    for (const blend of ["normal", "add", "multiply", "screen"]) {
      expect(
        normalizeFilter({
          pipeline: { blend, textureWrap: "repeat", mipmap: true },
          mesh: { grid: [1, 512] },
          padding: 0,
          resolution: Number.MIN_VALUE,
          antialias: false,
          clipToViewport: false,
          time: true,
        }),
      ).toMatchObject({
        pipeline: { blend, textureWrap: "repeat", mipmap: true },
        mesh: { grid: [1, 512] },
        antialias: "off",
        clipToViewport: false,
        time: true,
      });
    }
  });

  it.each([
    {
      name: "missing source object",
      replacement: undefined,
      expected: /source must be an object/,
    },
    {
      name: "non-object WebGL source",
      replacement: { ...source, webgl: [] },
      expected: /source\.webgl must be an object/,
    },
    {
      name: "missing WebGPU source",
      replacement: { webgl: source.webgl },
      expected: /source\.webgpu must be an object/,
    },
    {
      name: "unknown WebGPU source key",
      replacement: {
        ...source,
        webgpu: { ...source.webgpu, entryPoint: "mainFragment" },
      },
      expected: /source\.webgpu\.entryPoint is not supported/,
    },
    {
      name: "non-string custom vertex",
      replacement: {
        ...source,
        webgl: { ...source.webgl, vertex: 1 },
      },
      expected: /source\.webgl\.vertex must be a non-empty string/,
    },
    {
      name: "custom vertex without main",
      replacement: {
        ...source,
        webgl: { ...source.webgl, vertex: "void helper() {}" },
      },
      expected: /source\.webgl\.vertex must define void main\(\)/,
    },
    {
      name: "blank fragment",
      replacement: {
        ...source,
        webgl: { fragment: "\n " },
      },
      expected: /source\.webgl\.fragment must be a non-empty string/,
    },
    {
      name: "fragment without main",
      replacement: {
        ...source,
        webgl: { fragment: "void helper() {}" },
      },
      expected: /source\.webgl\.fragment must define void main\(\)/,
    },
    {
      name: "blank WGSL",
      replacement: {
        ...source,
        webgpu: { source: " " },
      },
      expected: /source\.webgpu\.source must be a non-empty string/,
    },
    {
      name: "WGSL without vertex entry",
      replacement: {
        ...source,
        webgpu: {
          source:
            "@fragment fn mainFragment() -> @location(0) vec4<f32> { return vec4<f32>(); }",
        },
      },
      expected: /must define mainVertex and mainFragment/,
    },
    {
      name: "WGSL without fragment entry",
      replacement: {
        ...source,
        webgpu: {
          source:
            "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(); }",
        },
      },
      expected: /must define mainVertex and mainFragment/,
    },
  ])("rejects $name", ({ replacement, expected }) => {
    expect(() => normalizeFilter({ source: replacement })).toThrow(expected);
  });

  it.each([
    {
      name: "non-object pass",
      passes: [null],
      expected: /passes\[0\] must be an object/,
    },
    {
      name: "blank pass id",
      passes: [{ id: " ", source }],
      expected: /passes\[0\]\.id must be a non-empty string/,
    },
    {
      name: "duplicate pass id",
      passes: [
        { id: "same", source },
        { id: "same", source },
      ],
      expected: /passes\[1\]\.id must be unique/,
    },
    {
      name: "pass uniform colliding with parameter",
      parameters: { amount: 1 },
      passes: [{ source, uniforms: { amount: 2 } }],
      expected: /duplicate shader symbol uAmount/,
    },
    {
      name: "pass texture colliding with shared texture",
      textures: { noise: "shared" },
      passes: [{ source, textures: { noise: "local" } }],
      expected: /duplicate shader symbol uNoiseTexture/,
    },
    {
      name: "combined texture budget",
      textures: createTextureMap(6),
      passes: [{ source, textures: { extra0: "a", extra1: "b" } }],
      expected: /supports at most 1 custom textures/,
    },
  ])("rejects $name", ({ parameters, textures, passes, expected }) => {
    expect(() =>
      normalizeFilter({
        source: undefined,
        parameters,
        textures,
        passes,
      }),
    ).toThrow(expected);
  });

  it("separates mutable parameter values from structural signatures", () => {
    const first = normalizeFilter({
      parameters: { amount: 0.25 },
    });
    const second = normalizeFilter({
      parameters: { amount: 0.75 },
    });
    const structurallyDifferent = normalizeFilter({
      parameters: { amount: [0.75, 1] },
    });

    expect(getShaderConfigSignature(first)).not.toBe(
      getShaderConfigSignature(second),
    );
    expect(getShaderStructureSignature(first)).toBe(
      getShaderStructureSignature(second),
    );
    expect(getShaderStructureSignature(first)).not.toBe(
      getShaderStructureSignature(structurallyDifferent),
    );
    expect(getShaderConfigSignature()).toBe("null");
    expect(getShaderStructureSignature()).toBe("null");
  });

  it("covers sampling defaults for object and pass-local texture forms", () => {
    const filter = normalizeFilter({
      textures: {
        inheritedObject: { src: "shared-object" },
      },
      source: undefined,
      pipeline: {
        textureWrap: "repeat",
        mipmap: true,
      },
      passes: [
        {
          source,
          pipeline: {
            textureWrap: "clamp",
            mipmap: false,
          },
          textures: {
            localString: "pass-local",
            localObject: { src: "pass-local-object" },
          },
        },
      ],
    });

    expect(filter.textures[0]).toEqual(
      expect.objectContaining({ src: "shared-object" }),
    );
    expect(filter.textures[0]).not.toHaveProperty("wrap");
    expect(filter.textures[0]).not.toHaveProperty("mipmap");
    expect(filter.passes[0].textures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "inheritedObject",
          wrap: "clamp",
          mipmap: false,
        }),
        expect.objectContaining({
          key: "localString",
          wrap: "clamp",
          mipmap: false,
        }),
        expect.objectContaining({
          key: "localObject",
          wrap: "clamp",
          mipmap: false,
        }),
      ]),
    );
  });

  it("accepts a valid custom vertex and tracks diagnostic paths internally", () => {
    const customVertex = `
      in vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    const filter = normalizeFilter({
      source: {
        ...source,
        webgl: {
          ...source.webgl,
          vertex: customVertex,
        },
      },
    });

    expect(filter.passes[0].source.webgl.vertex).toBe(customVertex);
    expect(getShaderDiagnosticPath(filter)).toBe("filters[0]");
    expect(getShaderDiagnosticPath(filter.passes[0])).toBe("filters[0]");
    expect(getShaderDiagnosticPath({}, "fallback.path")).toBe("fallback.path");
    expect(getShaderDiagnosticPath({})).toBe("shader");
  });
});
