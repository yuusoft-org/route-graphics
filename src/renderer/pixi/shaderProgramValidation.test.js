import { Assets } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { normalizeElementShaderFilters } from "../../plugins/elements/util/shaderConfig.js";
import {
  RouteGraphicsShaderError,
  validateShaderProgramsForRenderer,
} from "./shaderProgramValidation.js";

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

const createState = (filterOverrides = {}) => ({
  elements: [
    {
      id: "card",
      filters: normalizeElementShaderFilters([
        {
          id: "surface",
          type: "shader",
          source,
          ...filterOverrides,
        },
      ]),
    },
  ],
  animations: [],
});

const createWebGL = ({ failStage, link = true } = {}) => {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn((type) => ({ type })),
    shaderSource: vi.fn((shader, shaderSource) => {
      shader.source = shaderSource;
    }),
    compileShader: vi.fn((shader) => {
      shader.compiled =
        failStage === undefined ||
        (failStage === "vertex"
          ? shader.type !== gl.VERTEX_SHADER
          : shader.type !== gl.FRAGMENT_SHADER);
    }),
    getShaderParameter: vi.fn((shader) => shader.compiled),
    getShaderInfoLog: vi.fn((shader) =>
      shader.type === gl.VERTEX_SHADER
        ? "vertex syntax is invalid"
        : "fragment syntax is invalid",
    ),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => link),
    getProgramInfoLog: vi.fn(() => "varying types do not match"),
    deleteProgram: vi.fn(),
  };
  return gl;
};

describe("shader program preflight", () => {
  it("compiles and links each WebGL source only once per context", () => {
    const gl = createWebGL();
    const state = createState();

    validateShaderProgramsForRenderer({ renderer: { gl }, state });
    validateShaderProgramsForRenderer({ renderer: { gl }, state });

    expect(gl.compileShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  });

  it("wraps WebGL compiler failures with stable shader context", () => {
    const gl = createWebGL({ failStage: "fragment" });
    const state = createState();

    let error;
    try {
      validateShaderProgramsForRenderer({ renderer: { gl }, state });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RouteGraphicsShaderError);
    expect(error).toMatchObject({
      name: "RouteGraphicsShaderError",
      code: "ROUTE_GRAPHICS_SHADER_INVALID",
      details: {
        backend: "webgl",
        effectId: "surface",
        ownerId: "card",
        ownerKind: "element",
        passId: "main",
        path: "filters[0]",
        phase: "compile",
        stage: "fragment",
      },
    });
    expect(error.message).toContain('element "card" shader filter "surface"');
    expect(error.message).toContain("fragment syntax is invalid");
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it("reports WebGL link failures separately from source compilation", () => {
    const gl = createWebGL({ link: false });

    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: createState(),
      }),
    ).toThrow(/failed WebGL program linking: varying types do not match/);
  });

  it("wraps WebGL API failures and releases the temporary shader", () => {
    const gl = createWebGL();
    gl.shaderSource.mockImplementationOnce(() => {
      throw new Error("context rejected shaderSource");
    });

    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: createState(),
      }),
    ).toThrow(
      /could not compile its WebGL vertex shader: context rejected shaderSource/,
    );
    expect(gl.deleteShader).toHaveBeenCalledTimes(1);
  });

  it("rejects unloaded custom textures before compiling or mounting", () => {
    const gl = createWebGL();
    const hasAsset = vi.spyOn(Assets.cache, "has").mockReturnValue(false);

    try {
      expect(() =>
        validateShaderProgramsForRenderer({
          renderer: { gl },
          state: createState({
            textures: {
              noise: "missing-noise",
            },
          }),
        }),
      ).toThrow(
        /element "card" shader filter "surface".*references unloaded texture "missing-noise"/,
      );
      expect(gl.compileShader).not.toHaveBeenCalled();
    } finally {
      hasAsset.mockRestore();
    }
  });

  it("wraps synchronous WebGPU module preparation failures", () => {
    const device = {
      createShaderModule: vi.fn(() => {
        throw new Error("device rejected shader module");
      }),
    };

    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gpu: { device } },
        state: createState(),
      }),
    ).toThrow(
      /element "card" shader filter "surface".*could not prepare WebGPU source: device rejected shader module/,
    );
  });
});
