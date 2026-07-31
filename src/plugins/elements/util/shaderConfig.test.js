import { describe, expect, it } from "vitest";
import {
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
});
