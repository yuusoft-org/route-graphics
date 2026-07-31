import { Assets, GlProgram } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeElementShaderFilters,
  normalizeShaderCompositor,
} from "../../plugins/elements/util/shaderConfig.js";
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

const createSourceVariant = (name) => ({
  webgl: {
    fragment: `${source.webgl.fragment}\n// ${name}`,
  },
  webgpu: {
    source: `${source.webgpu.source}\n// ${name}`,
  },
});

const createCompositorState = (overrides = {}) => ({
  elements: [],
  animations: [
    {
      id: "replace-card",
      type: "transition",
      compositor: normalizeShaderCompositor(
        {
          type: "shader",
          source,
          ...overrides,
        },
        "animations[0].compositor",
      ),
    },
  ],
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

  it.each(["vertex", "fragment"])(
    "reports and cleans up a failed WebGL %s shader",
    (failStage) => {
      const gl = createWebGL({ failStage });
      let error;

      try {
        validateShaderProgramsForRenderer({
          renderer: { gl },
          state: createState(),
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RouteGraphicsShaderError);
      expect(error.details).toMatchObject({
        backend: "webgl",
        phase: "compile",
        stage: failStage,
      });
      expect(error.message).toContain(`${failStage} syntax is invalid`);
      expect(gl.deleteShader).toHaveBeenCalledTimes(
        failStage === "vertex" ? 1 : 2,
      );
      expect(gl.createProgram).not.toHaveBeenCalled();
    },
  );

  it("reports a vertex shader allocation failure without leaking resources", () => {
    const gl = createWebGL();
    gl.createShader.mockReturnValueOnce(null);

    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: createState(),
      }),
    ).toThrow(/could not allocate its vertex shader/);
    expect(gl.deleteShader).not.toHaveBeenCalled();
  });

  it("reports a fragment shader allocation failure and releases the vertex", () => {
    const gl = createWebGL();
    gl.createShader
      .mockImplementationOnce((type) => ({ type }))
      .mockReturnValueOnce(null);

    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: createState(),
      }),
    ).toThrow(/could not allocate its fragment shader/);
    expect(gl.deleteShader).toHaveBeenCalledTimes(1);
    expect(gl.createProgram).not.toHaveBeenCalled();
  });

  it("wraps Pixi WebGL source preparation errors with their cause", () => {
    const gl = createWebGL();
    const cause = new Error("program parser rejected declarations");
    const from = vi.spyOn(GlProgram, "from").mockImplementationOnce(() => {
      throw cause;
    });

    try {
      let error;
      try {
        validateShaderProgramsForRenderer({
          renderer: { gl },
          state: createState(),
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RouteGraphicsShaderError);
      expect(error.cause).toBe(cause);
      expect(error.details).toMatchObject({
        backend: "webgl",
        phase: "prepare",
        path: "filters[0]",
      });
      expect(error.message).toContain(
        "could not prepare WebGL sources: program parser rejected declarations",
      );
      expect(gl.createShader).not.toHaveBeenCalled();
    } finally {
      from.mockRestore();
    }
  });

  it("reports program allocation failure and releases both shaders", () => {
    const gl = createWebGL();
    gl.createProgram.mockReturnValueOnce(null);

    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: createState(),
      }),
    ).toThrow(/could not allocate its WebGL program/);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });

  it.each(["attachShader", "linkProgram", "getProgramParameter"])(
    "wraps a thrown WebGL %s failure and releases the program",
    (method) => {
      const gl = createWebGL();
      gl[method].mockImplementationOnce(() => {
        throw new Error(`${method} rejected the program`);
      });

      let error;
      try {
        validateShaderProgramsForRenderer({
          renderer: { gl },
          state: createState(),
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(RouteGraphicsShaderError);
      expect(error.details.phase).toBe("link");
      expect(error.message).toContain(
        `could not link its WebGL program: ${method} rejected the program`,
      );
      expect(gl.deleteShader).toHaveBeenCalledTimes(2);
      expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    },
  );

  it("uses a stable fallback when the driver provides no compiler log", () => {
    const gl = createWebGL({ failStage: "vertex" });
    gl.getShaderInfoLog.mockReturnValueOnce(undefined);

    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: createState(),
      }),
    ).toThrow(
      /failed WebGL vertex compilation: No compiler diagnostic was provided\./,
    );
  });

  it("bounds compiler logs included in public errors", () => {
    const gl = createWebGL({ failStage: "vertex" });
    gl.getShaderInfoLog.mockReturnValueOnce(`start-${"x".repeat(5000)}-end`);

    let error;
    try {
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: createState(),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error.message).toContain("start-");
    expect(error.message).toContain("…");
    expect(error.message).not.toContain("-end");
    expect(error.message.length).toBeLessThan(4300);
  });

  it("caches sources independently per WebGL context", () => {
    const first = createWebGL();
    const second = createWebGL();
    const state = createState();

    validateShaderProgramsForRenderer({ renderer: { gl: first }, state });
    validateShaderProgramsForRenderer({ renderer: { gl: second }, state });

    expect(first.linkProgram).toHaveBeenCalledTimes(1);
    expect(second.linkProgram).toHaveBeenCalledTimes(1);
  });

  it("compiles distinct multipass sources while deduplicating shared sources", () => {
    const gl = createWebGL();
    const state = createState({
      source: undefined,
      passes: [
        { id: "first", source },
        { id: "same-source", source },
        { id: "different", source: createSourceVariant("different") },
      ],
    });

    validateShaderProgramsForRenderer({ renderer: { gl }, state });

    expect(gl.compileShader).toHaveBeenCalledTimes(4);
    expect(gl.linkProgram).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed source and retries it after correction", () => {
    const gl = createWebGL({ failStage: "vertex" });
    const state = createState();

    expect(() =>
      validateShaderProgramsForRenderer({ renderer: { gl }, state }),
    ).toThrow();
    gl.compileShader.mockImplementation((shader) => {
      shader.compiled = true;
    });
    validateShaderProgramsForRenderer({ renderer: { gl }, state });

    expect(gl.compileShader).toHaveBeenCalledTimes(3);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
  });

  it("checks texture availability even when the shader source is cached", () => {
    const gl = createWebGL();
    const hasAsset = vi.spyOn(Assets.cache, "has");
    hasAsset.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const state = createState({ textures: { noise: "asset" } });

    try {
      validateShaderProgramsForRenderer({ renderer: { gl }, state });
      expect(() =>
        validateShaderProgramsForRenderer({ renderer: { gl }, state }),
      ).toThrow(/references unloaded texture "asset"/);
      expect(gl.linkProgram).toHaveBeenCalledTimes(1);
    } finally {
      hasAsset.mockRestore();
    }
  });

  it("deduplicates repeated texture aliases within one effect", () => {
    const gl = createWebGL();
    const hasAsset = vi.spyOn(Assets.cache, "has").mockReturnValue(true);
    const state = createState({
      source: undefined,
      textures: { first: "shared-asset", second: "shared-asset" },
      passes: [
        { id: "one", source },
        { id: "two", source },
      ],
    });

    try {
      validateShaderProgramsForRenderer({ renderer: { gl }, state });
      expect(hasAsset).toHaveBeenCalledTimes(1);
      expect(hasAsset).toHaveBeenCalledWith("shared-asset");
    } finally {
      hasAsset.mockRestore();
    }
  });

  it("finds filters recursively in nested elements", () => {
    const gl = createWebGL();
    const filter = createState().elements[0].filters[0];

    validateShaderProgramsForRenderer({
      renderer: { gl },
      state: {
        elements: [
          {
            id: "parent",
            children: [{ id: "nested-card", filters: [filter] }],
          },
        ],
        animations: [],
      },
    });

    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
  });

  it("reports compositor ownership, pass, and authored path", () => {
    const gl = createWebGL({ failStage: "fragment" });
    let error;

    try {
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: createCompositorState({
          source: undefined,
          passes: [{ id: "composite", source }],
        }),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RouteGraphicsShaderError);
    expect(error.details).toMatchObject({
      backend: "webgl",
      effectId: null,
      ownerId: "replace-card",
      ownerKind: "animation",
      passId: "composite",
      path: "animations[0].compositor.passes[0]",
      phase: "compile",
      stage: "fragment",
    });
    expect(error.message).toContain(
      'animation "replace-card" transition compositor',
    );
  });

  it("no-ops without shader effects, a renderer, or a complete WebGL API", () => {
    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: undefined,
        state: { elements: [], animations: [] },
      }),
    ).not.toThrow();
    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: {},
        state: createState(),
      }),
    ).not.toThrow();
    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gl: { createShader: vi.fn() } },
        state: createState(),
      }),
    ).not.toThrow();
    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gl: createWebGL() },
        state: {
          elements: [{ children: [{ filters: [{ type: "shader" }] }] }],
          animations: [{ compositor: { type: "blur" } }],
        },
      }),
    ).not.toThrow();
  });

  it("defensively preflights a pass without normalized metadata", () => {
    const gl = createWebGL({ failStage: "vertex" });
    let error;

    try {
      validateShaderProgramsForRenderer({
        renderer: { gl },
        state: {
          elements: [
            {
              id: "raw-card",
              filters: [
                {
                  id: "raw-filter",
                  type: "shader",
                  passes: [{ source }],
                },
              ],
            },
          ],
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RouteGraphicsShaderError);
    expect(error.details).toMatchObject({
      effectId: "raw-filter",
      ownerId: "raw-card",
      passId: null,
      path: "shader",
      phase: "compile",
    });
  });

  it("prepares each WebGPU source once per device", () => {
    const device = { createShaderModule: vi.fn(() => ({})) };
    const state = createState();

    validateShaderProgramsForRenderer({
      renderer: { gpu: { device } },
      state,
    });
    validateShaderProgramsForRenderer({
      renderer: { gpu: { device } },
      state,
    });

    expect(device.createShaderModule).toHaveBeenCalledTimes(1);
    expect(device.createShaderModule).toHaveBeenCalledWith({
      code: source.webgpu.source,
      label: "Route Graphics filters[0]",
    });
  });

  it("caches WebGPU sources independently per device and source", () => {
    const first = { createShaderModule: vi.fn(() => ({})) };
    const second = { createShaderModule: vi.fn(() => ({})) };
    const state = createState({
      source: undefined,
      passes: [
        { id: "first", source },
        { id: "different", source: createSourceVariant("webgpu-different") },
      ],
    });

    validateShaderProgramsForRenderer({
      renderer: { gpu: { device: first } },
      state,
    });
    validateShaderProgramsForRenderer({
      renderer: { gpu: { device: second } },
      state,
    });

    expect(first.createShaderModule).toHaveBeenCalledTimes(2);
    expect(second.createShaderModule).toHaveBeenCalledTimes(2);
  });

  it("accepts an unnormalized WebGPU effect without passes", () => {
    const device = { createShaderModule: vi.fn(() => ({})) };

    expect(() =>
      validateShaderProgramsForRenderer({
        renderer: { gpu: { device } },
        state: {
          elements: [
            {
              id: "raw",
              filters: [{ id: "empty", type: "shader" }],
            },
          ],
        },
      }),
    ).not.toThrow();
    expect(device.createShaderModule).not.toHaveBeenCalled();
  });

  it("rejects missing textures before WebGPU module creation", () => {
    const device = { createShaderModule: vi.fn(() => ({})) };
    const hasAsset = vi.spyOn(Assets.cache, "has").mockReturnValue(false);
    let error;

    try {
      try {
        validateShaderProgramsForRenderer({
          renderer: { gpu: { device } },
          state: createState({ textures: { noise: "missing-webgpu-asset" } }),
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(RouteGraphicsShaderError);
      expect(error.details).toMatchObject({
        backend: "webgpu",
        phase: "texture",
        path: "filters[0].textures.noise",
      });
      expect(device.createShaderModule).not.toHaveBeenCalled();
    } finally {
      hasAsset.mockRestore();
    }
  });

  it("prefers the active WebGL backend when both renderer handles exist", () => {
    const gl = createWebGL();
    const device = { createShaderModule: vi.fn(() => ({})) };

    validateShaderProgramsForRenderer({
      renderer: { gl, gpu: { device } },
      state: createState(),
    });

    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
    expect(device.createShaderModule).not.toHaveBeenCalled();
  });
});
