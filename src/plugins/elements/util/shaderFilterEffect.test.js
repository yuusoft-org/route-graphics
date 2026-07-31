import { afterEach, describe, expect, it, vi } from "vitest";
import { Cache, Texture } from "pixi.js";
import {
  createShaderEffect,
  createShaderFilter,
  destroyShaderEffect,
  getShaderFilterAnimationTarget,
  installShaderProgressProperty,
  prepareShaderFilterAnimationTargets,
  resetShaderFilterProgress,
  setShaderEffectParameter,
  setShaderEffectTime,
  shouldUpdateUnchangedShaderFilterProgress,
  syncShaderFilters,
  validateShaderFilterAnimationTarget,
} from "./shaderFilterEffect.js";
import { normalizeElementShaderFilters } from "./shaderConfig.js";
import { createAnimationBus } from "../../animations/animationBus.js";
import {
  applyInitialUpdateAnimationState,
  dispatchUpdateAnimationsNow,
} from "../../animations/updateAnimationDispatch.js";

const TEST_TEXTURE_ALIAS = "shader-filter-effect-test-texture";

const shaderSource = {
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

const customTextureShaderSource = {
  webgl: {
    fragment: `
      in vec2 vTextureCoord;
      out vec4 finalColor;
      uniform sampler2D uTexture;
      uniform sampler2D uNoiseTexture;
      void main() {
        finalColor = texture(uTexture, vTextureCoord)
          * texture(uNoiseTexture, vTextureCoord);
      }
    `,
  },
  webgpu: {
    source: `
      struct ShaderUniforms {
        uProgress: f32,
        uResolution: vec2<f32>,
      };
      struct VSOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
      };

      @group(1) @binding(0) var<uniform> shaderUniforms: ShaderUniforms;
      @group(1) @binding(1) var uNoiseTexture: texture_2d<f32>;
      @group(1) @binding(2) var uNoiseTextureSampler: sampler;

      @vertex fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
        return VSOutput(vec4<f32>(aPosition, 0.0, 1.0), aPosition);
      }

      @fragment fn mainFragment(
        @location(0) uv: vec2<f32>,
      ) -> @location(0) vec4<f32> {
        return textureSample(uNoiseTexture, uNoiseTextureSampler, uv);
      }
    `,
  },
};

const customCompositorTextureShaderSource = {
  ...customTextureShaderSource,
  webgpu: {
    source: customTextureShaderSource.webgpu.source
      .replace(
        "@group(1) @binding(1) var uNoiseTexture: texture_2d<f32>;",
        `@group(1) @binding(1) var uNextTexture: texture_2d<f32>;
      @group(1) @binding(2) var uNoiseTexture: texture_2d<f32>;`,
      )
      .replace(
        "@group(1) @binding(2) var uNoiseTextureSampler: sampler;",
        "@group(1) @binding(3) var uNoiseTextureSampler: sampler;",
      ),
  },
};

const createTestShader = (overrides = {}) => ({
  source: shaderSource,
  uniforms: [],
  textures: [],
  pipeline: {
    blend: "normal",
    textureWrap: "clamp",
    mipmap: false,
  },
  mesh: {
    grid: [1, 1],
  },
  ...overrides,
});

afterEach(() => {
  if (Cache.has(TEST_TEXTURE_ALIAS)) {
    Cache.remove(TEST_TEXTURE_ALIAS);
  }
});

describe("shader filter progress state", () => {
  it("resets an installed shader progress property to the base value", () => {
    const displayObject = {};

    installShaderProgressProperty(displayObject);
    displayObject.uProgress = 1;
    resetShaderFilterProgress(displayObject);

    expect(displayObject.uProgress).toBe(0);
  });

  it("requests an unchanged update when a shader filter has stale progress", () => {
    const displayObject = { label: "shader-target" };
    const parent = { children: [displayObject] };

    installShaderProgressProperty(displayObject);
    displayObject.uProgress = 1;

    expect(
      shouldUpdateUnchangedShaderFilterProgress({
        parent,
        nextElement: {
          id: "shader-target",
          filters: [{ id: "grade", type: "shader" }],
        },
        animations: [],
      }),
    ).toBe(true);
  });

  it("resets stale legacy broadcast progress even with targeted progress", () => {
    const displayObject = { label: "shader-target" };
    const parent = { children: [displayObject] };

    installShaderProgressProperty(displayObject);
    displayObject.uProgress = 1;

    expect(
      shouldUpdateUnchangedShaderFilterProgress({
        parent,
        nextElement: {
          id: "shader-target",
          filters: [{ id: "grade", type: "shader" }],
        },
        animations: [
          {
            id: "progress",
            targetId: "shader-target",
            type: "update",
            filterTweens: {
              grade: {
                uProgress: { initialValue: 0, keyframes: [] },
              },
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("finds stale shader progress in unchanged descendants", () => {
    const childDisplayObject = { label: "child-shader" };
    const containerDisplayObject = {
      label: "container",
      children: [childDisplayObject],
    };
    const parent = { children: [containerDisplayObject] };

    installShaderProgressProperty(childDisplayObject);
    childDisplayObject.uProgress = 0.5;

    expect(
      shouldUpdateUnchangedShaderFilterProgress({
        parent,
        nextElement: {
          id: "container",
          children: [
            {
              id: "child-shader",
              filters: [{ id: "grade", type: "shader" }],
            },
          ],
        },
        animations: [],
      }),
    ).toBe(true);
  });
});

describe("shader filter resources", () => {
  it("creates an ordered filter chain and shares mutable parameters across passes", () => {
    const [config] = normalizeElementShaderFilters([
      {
        id: "glow",
        type: "shader",
        parameters: {
          amount: 0.25,
          tint: [1, 0.5, 0],
        },
        time: true,
        passes: [
          { id: "horizontal", source: shaderSource },
          { id: "vertical", source: shaderSource },
        ],
      },
    ]);
    const runtime = createShaderEffect({
      effect: config,
      width: 64,
      height: 32,
      time: 1.5,
    });

    expect(runtime.filters).toHaveLength(2);
    for (const filter of runtime.filters) {
      expect(filter.resources.shaderUniforms.uniforms.uAmount).toBe(0.25);
      expect(
        Array.from(filter.resources.shaderUniforms.uniforms.uTint),
      ).toEqual([1, 0.5, 0]);
      expect(filter.resources.shaderUniforms.uniforms.uTime).toBe(1.5);
    }

    setShaderEffectParameter(runtime, "amount", 0.8);
    setShaderEffectParameter(runtime, "tint", [0, 0.25, 1]);
    setShaderEffectTime(runtime, 2);

    for (const filter of runtime.filters) {
      expect(filter.resources.shaderUniforms.uniforms.uAmount).toBe(0.8);
      expect(
        Array.from(filter.resources.shaderUniforms.uniforms.uTint),
      ).toEqual([0, 0.25, 1]);
      expect(filter.resources.shaderUniforms.uniforms.uTime).toBe(2);
    }

    for (const filter of runtime.filters) {
      filter.destroy();
    }
  });

  it("does not add uTime unless the inline effect opts in", () => {
    const legacyFilter = createShaderFilter({
      shader: createTestShader(),
      width: 32,
      height: 32,
    });
    const timedFilter = createShaderFilter({
      shader: createTestShader({ time: true }),
      width: 32,
      height: 32,
      time: 1.25,
    });

    expect(legacyFilter.resources.shaderUniforms.uniforms).not.toHaveProperty(
      "uTime",
    );
    expect(timedFilter.resources.shaderUniforms.uniforms.uTime).toBe(1.25);

    legacyFilter.destroy();
    timedFilter.destroy();
  });

  it("updates parameter values without rebuilding the filter programs", () => {
    const createConfig = (amount) =>
      normalizeElementShaderFilters([
        {
          id: "grade",
          type: "shader",
          parameters: {
            amount,
          },
          source: shaderSource,
        },
      ]);
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      destroy() {},
    };

    syncShaderFilters(displayObject, createConfig(0.2), {
      width: 32,
      height: 32,
    });
    const originalFilter = displayObject.filters[0];

    syncShaderFilters(displayObject, createConfig(0.9), {
      width: 32,
      height: 32,
    });

    expect(displayObject.filters[0]).toBe(originalFilter);
    expect(originalFilter.resources.shaderUniforms.uniforms.uAmount).toBe(0.9);

    const animationTarget = getShaderFilterAnimationTarget(
      displayObject,
      "grade",
      "animate-grade",
    );
    animationTarget.amount = 0.4;
    expect(animationTarget.amount).toBe(0.4);
    expect(originalFilter.resources.shaderUniforms.uniforms.uAmount).toBe(0.4);

    displayObject.destroy();
  });

  it("preserves completed targeted values while applying untargeted destination values", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      destroy() {},
    };
    const createConfig = (amount, levels) =>
      normalizeElementShaderFilters([
        {
          id: "grade",
          type: "shader",
          parameters: { amount, levels },
          source: shaderSource,
        },
      ]);
    const animations = [
      {
        id: "animate-grade",
        targetId: "shader-target",
        type: "update",
        filterTweens: {
          grade: {
            amount: {
              keyframes: [{ duration: 100, value: 0.9, easing: "linear" }],
            },
            uProgress: {
              keyframes: [{ duration: 100, value: 0.75, easing: "linear" }],
            },
          },
        },
      },
    ];

    syncShaderFilters(displayObject, createConfig(0.2, [0.1, 0.2]), {
      width: 32,
      height: 32,
    });
    const animationTarget = getShaderFilterAnimationTarget(
      displayObject,
      "grade",
      "animate-grade",
    );
    animationTarget.amount = 0.9;
    animationTarget.uProgress = 0.75;

    syncShaderFilters(displayObject, createConfig(0.4, [0.8, 0.9]), {
      width: 32,
      height: 32,
      animations,
      targetId: "shader-target",
    });

    expect(animationTarget.amount).toBe(0.9);
    expect(animationTarget.uProgress).toBe(0.75);
    expect(animationTarget.levels).toEqual([0.8, 0.9]);

    displayObject.destroy();
  });

  it("preserves an inferred targeted value while preparing a changed shader program", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      destroy() {},
    };
    const initialFilters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: { amount: 0.2 },
        source: shaderSource,
      },
    ]);
    const nextFilters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: { amount: 0.4 },
        source: {
          ...shaderSource,
          webgl: {
            ...shaderSource.webgl,
            fragment: `${shaderSource.webgl.fragment}\n// destination program`,
          },
        },
      },
    ]);
    const animations = [
      {
        id: "animate-changed-grade",
        targetId: "shader-target",
        type: "update",
        filterTweens: {
          grade: {
            amount: {
              keyframes: [{ duration: 100, value: 1, easing: "linear" }],
            },
          },
        },
      },
    ];

    syncShaderFilters(displayObject, initialFilters, {
      width: 32,
      height: 32,
    });
    const originalFilter = displayObject.filters[0];
    getShaderFilterAnimationTarget(
      displayObject,
      "grade",
      "animate-changed-grade",
    ).amount = 0.7;

    expect(
      prepareShaderFilterAnimationTargets({
        displayObject,
        element: {
          id: "shader-target",
          width: 32,
          height: 32,
          filters: nextFilters,
        },
        animations,
      }),
    ).toBe(true);

    expect(displayObject.filters[0]).not.toBe(originalFilter);
    expect(
      getShaderFilterAnimationTarget(
        displayObject,
        "grade",
        "animate-changed-grade",
      ).amount,
    ).toBe(0.7);

    displayObject.destroy();
  });

  it("does not restore an incompatible old value when a parameter shape changes", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      destroy() {},
    };
    const initialFilters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: { amount: 0.2 },
        source: shaderSource,
      },
    ]);
    const nextFilters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: { amount: [0.1, 0.2, 0.3] },
        source: shaderSource,
      },
    ]);
    const animations = [
      {
        id: "animate-vector-grade",
        targetId: "shader-target",
        type: "update",
        filterTweens: {
          grade: {
            amount: {
              initialValue: [0.3, 0.4, 0.5],
              keyframes: [
                {
                  duration: 100,
                  value: [0.8, 0.9, 1],
                  easing: "linear",
                },
              ],
            },
          },
        },
      },
    ];

    syncShaderFilters(displayObject, initialFilters, {
      width: 32,
      height: 32,
    });
    getShaderFilterAnimationTarget(
      displayObject,
      "grade",
      "animate-vector-grade",
    ).amount = 0.7;

    expect(() =>
      prepareShaderFilterAnimationTargets({
        displayObject,
        element: {
          id: "shader-target",
          width: 32,
          height: 32,
          filters: nextFilters,
        },
        animations,
      }),
    ).not.toThrow();

    const animationBus = createAnimationBus();
    dispatchUpdateAnimationsNow({
      animations,
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      element: displayObject,
      targetState: {},
    });
    animationBus.flush();

    expect(
      getShaderFilterAnimationTarget(
        displayObject,
        "grade",
        "animate-vector-grade",
      ).amount,
    ).toEqual([0.3, 0.4, 0.5]);

    displayObject.destroy();
  });

  it("prepares a newly added destination filter before animation dispatch", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      destroy() {},
    };
    const nextFilters = normalizeElementShaderFilters([
      {
        id: "tone",
        type: "shader",
        parameters: {
          amount: 0.2,
        },
        source: shaderSource,
      },
    ]);

    expect(
      prepareShaderFilterAnimationTargets({
        displayObject,
        element: {
          id: "shader-target",
          width: 32,
          height: 32,
          filters: nextFilters,
        },
        animations: [
          {
            id: "animate-new-filter",
            targetId: "shader-target",
            type: "update",
            filterTweens: {
              tone: {
                amount: {
                  keyframes: [{ duration: 100, value: 1, easing: "linear" }],
                },
              },
            },
          },
        ],
      }),
    ).toBe(true);

    expect(
      getShaderFilterAnimationTarget(
        displayObject,
        "tone",
        "animate-new-filter",
      ).amount,
    ).toBe(0.2);

    displayObject.destroy();
  });

  it("prepares a newly declared parameter on an existing destination filter", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      destroy() {},
    };
    syncShaderFilters(
      displayObject,
      normalizeElementShaderFilters([
        {
          id: "tone",
          type: "shader",
          parameters: {
            amount: 0.2,
          },
          source: shaderSource,
        },
      ]),
      { width: 32, height: 32 },
    );
    const nextFilters = normalizeElementShaderFilters([
      {
        id: "tone",
        type: "shader",
        parameters: {
          amount: 0.2,
          levels: [0.5, 1],
        },
        source: shaderSource,
      },
    ]);

    expect(
      prepareShaderFilterAnimationTargets({
        displayObject,
        element: {
          id: "shader-target",
          width: 32,
          height: 32,
          filters: nextFilters,
        },
        animations: [
          {
            id: "animate-new-parameter",
            targetId: "shader-target",
            type: "update",
            filterTweens: {
              tone: {
                levels: {
                  keyframes: [
                    {
                      duration: 100,
                      value: [1, 0.2],
                      easing: "linear",
                    },
                  ],
                },
              },
            },
          },
        ],
      }),
    ).toBe(true);

    expect(
      getShaderFilterAnimationTarget(
        displayObject,
        "tone",
        "animate-new-parameter",
      ).levels,
    ).toEqual([0.5, 1]);

    displayObject.destroy();
  });

  it("validates targeted animation shapes before playback starts", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      destroy() {},
    };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: {
          amount: 0.2,
        },
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, {
      width: 32,
      height: 32,
    });

    expect(() =>
      validateShaderFilterAnimationTarget(displayObject, "grade", "bad-shape", {
        amount: {
          keyframes: [{ duration: 100, value: [1, 2] }],
        },
      }),
    ).toThrow(/parameter "amount" must be a finite number/);
    expect(() =>
      validateShaderFilterAnimationTarget(
        displayObject,
        "grade",
        "unknown-parameter",
        {
          missing: {
            keyframes: [{ duration: 100, value: 1 }],
          },
        },
      ),
    ).toThrow(/unknown parameter "missing"/);

    displayObject.destroy();
  });

  it("animates normal properties and multiple filter targets on one clock", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      alpha: 0.2,
      scale: { x: 1, y: 1 },
      destroy() {},
    };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: { amount: 0.2 },
        source: shaderSource,
      },
      {
        id: "glow",
        type: "shader",
        parameters: { strength: 0.4 },
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, { width: 32, height: 32 });

    const animationBus = createAnimationBus();
    dispatchUpdateAnimationsNow({
      animations: [
        {
          id: "combined",
          targetId: "shader-target",
          type: "update",
          tween: {
            alpha: {
              keyframes: [{ duration: 100, value: 1, easing: "linear" }],
            },
          },
          filterTweens: {
            grade: {
              amount: {
                keyframes: [{ duration: 100, value: 1, easing: "linear" }],
              },
            },
            glow: {
              strength: {
                keyframes: [{ duration: 100, value: 0.8, easing: "linear" }],
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      element: displayObject,
      targetState: { alpha: 1 },
    });

    animationBus.flush();
    animationBus.tick(50);

    expect(displayObject.alpha).toBeCloseTo(0.6);
    expect(
      displayObject.filters[0].resources.shaderUniforms.uniforms.uAmount,
    ).toBeCloseTo(0.6);
    expect(
      displayObject.filters[1].resources.shaderUniforms.uniforms.uStrength,
    ).toBeCloseTo(0.6);

    displayObject.destroy();
  });

  it("animates progress only on the explicitly targeted filter", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      scale: { x: 1, y: 1 },
      destroy() {},
    };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        source: shaderSource,
      },
      {
        id: "glow",
        type: "shader",
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, { width: 32, height: 32 });

    const animationBus = createAnimationBus();
    dispatchUpdateAnimationsNow({
      animations: [
        {
          id: "targeted-progress",
          targetId: "shader-target",
          type: "update",
          filterTweens: {
            grade: {
              uProgress: {
                initialValue: 0,
                keyframes: [{ duration: 100, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      element: displayObject,
      targetState: {},
    });

    animationBus.flush();
    animationBus.tick(50);

    expect(
      displayObject.filters[0].resources.shaderUniforms.uniforms.uProgress,
    ).toBeCloseTo(0.5);
    expect(
      displayObject.filters[1].resources.shaderUniforms.uniforms.uProgress,
    ).toBe(0);

    displayObject.destroy();
  });

  it("settles the display object when a filter-only animation is cancelled", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      x: 10,
      scale: { x: 1, y: 1 },
      destroy() {},
    };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: { amount: 0 },
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, { width: 32, height: 32 });

    const animationBus = createAnimationBus();
    dispatchUpdateAnimationsNow({
      animations: [
        {
          id: "filter-only",
          targetId: "shader-target",
          type: "update",
          filterTweens: {
            grade: {
              amount: {
                keyframes: [{ duration: 100, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      element: displayObject,
      targetState: { x: 200 },
    });

    animationBus.flush();
    animationBus.tick(25);
    expect(displayObject.x).toBe(10);

    animationBus.cancelAllExcept(new Set());

    expect(displayObject.x).toBe(200);
    displayObject.destroy();
  });

  it("applies filter initial values while update animations are suppressed", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      scale: { x: 1, y: 1 },
      destroy() {},
    };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: {
          amount: 0.2,
          tint: [1, 1, 1],
        },
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, { width: 32, height: 32 });

    applyInitialUpdateAnimationState(displayObject, [
      {
        id: "deferred-filter",
        targetId: "shader-target",
        type: "update",
        filterTweens: {
          grade: {
            amount: {
              initialValue: 0.65,
              keyframes: [{ duration: 100, value: 1, easing: "linear" }],
            },
            tint: {
              initialValue: [0.25, 0.5, 0.75],
              keyframes: [
                {
                  duration: 100,
                  value: [1, 1, 1],
                  easing: "linear",
                },
              ],
            },
          },
        },
      },
    ]);

    expect(
      displayObject.filters[0].resources.shaderUniforms.uniforms.uAmount,
    ).toBeCloseTo(0.65);
    expect(
      Array.from(
        displayObject.filters[0].resources.shaderUniforms.uniforms.uTint,
      ),
    ).toEqual([0.25, 0.5, 0.75]);

    displayObject.destroy();
  });

  it("interpolates relative vector parameter keyframes component by component", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      scale: { x: 1, y: 1 },
      destroy() {},
    };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: {
          tint: [0.2, 0.3, 0.4],
        },
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, { width: 32, height: 32 });

    const animationBus = createAnimationBus();
    dispatchUpdateAnimationsNow({
      animations: [
        {
          id: "relative-tint",
          targetId: "shader-target",
          type: "update",
          filterTweens: {
            grade: {
              tint: {
                keyframes: [
                  {
                    duration: 100,
                    value: [0.4, -0.2, 0.2],
                    relative: true,
                    easing: "linear",
                  },
                ],
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      element: displayObject,
      targetState: {},
    });

    animationBus.flush();
    animationBus.tick(50);

    expect(
      Array.from(
        displayObject.filters[0].resources.shaderUniforms.uniforms.uTint,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.4),
        expect.closeTo(0.2),
        expect.closeTo(0.5),
      ]),
    );

    displayObject.destroy();
  });

  it("waits for the longest ordinary or filter timeline before completing", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      alpha: 0,
      scale: { x: 1, y: 1 },
      destroy() {},
    };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: {
          amount: 0,
        },
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, { width: 32, height: 32 });

    const completionTracker = {
      getVersion: () => 7,
      track: vi.fn(),
      complete: vi.fn(),
    };
    const animationBus = createAnimationBus();
    dispatchUpdateAnimationsNow({
      animations: [
        {
          id: "mixed-duration",
          targetId: "shader-target",
          type: "update",
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 100, value: 1, easing: "linear" }],
            },
          },
          filterTweens: {
            grade: {
              amount: {
                initialValue: 0,
                keyframes: [{ duration: 200, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
      animationBus,
      completionTracker,
      element: displayObject,
      targetState: { alpha: 1 },
    });

    animationBus.flush();
    animationBus.tick(100);

    expect(displayObject.alpha).toBe(1);
    expect(
      displayObject.filters[0].resources.shaderUniforms.uniforms.uAmount,
    ).toBeCloseTo(0.5);
    expect(completionTracker.complete).not.toHaveBeenCalled();

    animationBus.tick(100);

    expect(
      displayObject.filters[0].resources.shaderUniforms.uniforms.uAmount,
    ).toBe(1);
    expect(completionTracker.complete).toHaveBeenCalledWith(7);

    displayObject.destroy();
  });

  it("rejects a missing filter target before dispatching playback", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      scale: { x: 1, y: 1 },
      destroy() {},
    };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: { amount: 0 },
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, { width: 32, height: 32 });

    expect(() =>
      dispatchUpdateAnimationsNow({
        animations: [
          {
            id: "missing-filter",
            targetId: "shader-target",
            type: "update",
            filterTweens: {
              glow: {
                amount: {
                  keyframes: [{ duration: 100, value: 1, easing: "linear" }],
                },
              },
            },
          },
        ],
        animationBus: createAnimationBus(),
        completionTracker: {
          getVersion: () => 1,
          track: vi.fn(),
          complete: vi.fn(),
        },
        element: displayObject,
        targetState: {},
      }),
    ).toThrow(/could not find shader filter "glow"/);

    displayObject.destroy();
  });

  it("keeps an actively targeted parameter from being treated as stale", () => {
    const displayObject = {
      label: "shader-target",
      width: 32,
      height: 32,
      destroy() {},
    };
    const parent = { children: [displayObject] };
    const filters = normalizeElementShaderFilters([
      {
        id: "grade",
        type: "shader",
        parameters: { amount: 0.2 },
        source: shaderSource,
      },
    ]);
    syncShaderFilters(displayObject, filters, { width: 32, height: 32 });
    getShaderFilterAnimationTarget(
      displayObject,
      "grade",
      "active-grade",
    ).amount = 0.8;

    expect(
      shouldUpdateUnchangedShaderFilterProgress({
        parent,
        nextElement: {
          id: "shader-target",
          filters: [{ id: "grade", type: "shader" }],
        },
        animations: [
          {
            id: "active-grade",
            targetId: "shader-target",
            type: "update",
            filterTweens: {
              grade: {
                amount: {
                  keyframes: [{ duration: 100, value: 1, easing: "linear" }],
                },
              },
            },
          },
        ],
      }),
    ).toBe(false);

    displayObject.destroy();
  });

  it("does not mutate cached texture sources when applying pipeline options", () => {
    Cache.set(TEST_TEXTURE_ALIAS, Texture.WHITE);
    const cachedSource = Texture.WHITE.source;
    const originalAddressMode = cachedSource.addressMode;
    const originalAutoGenerateMipmaps = cachedSource.autoGenerateMipmaps;
    const originalMipmapFilter = cachedSource.mipmapFilter;

    const repeatFilter = createShaderFilter({
      shader: createTestShader({
        source: customTextureShaderSource,
        textures: [{ symbol: "uNoiseTexture", src: TEST_TEXTURE_ALIAS }],
        pipeline: {
          blend: "normal",
          textureWrap: "repeat",
          mipmap: true,
        },
      }),
      width: 32,
      height: 32,
    });
    const clampFilter = createShaderFilter({
      shader: createTestShader({
        source: customTextureShaderSource,
        textures: [{ symbol: "uNoiseTexture", src: TEST_TEXTURE_ALIAS }],
        pipeline: {
          blend: "normal",
          textureWrap: "clamp",
          mipmap: false,
        },
      }),
      width: 32,
      height: 32,
    });

    const repeatSource = repeatFilter.resources.uNoiseTexture;
    const clampSource = clampFilter.resources.uNoiseTexture;
    const repeatSampler = repeatFilter.resources.uNoiseTextureSampler;
    const clampSampler = clampFilter.resources.uNoiseTextureSampler;

    expect(cachedSource.addressMode).toBe(originalAddressMode);
    expect(cachedSource.autoGenerateMipmaps).toBe(originalAutoGenerateMipmaps);
    expect(cachedSource.mipmapFilter).toBe(originalMipmapFilter);
    expect(repeatSource).not.toBe(cachedSource);
    expect(clampSource).not.toBe(cachedSource);
    expect(repeatSource).not.toBe(clampSource);
    expect(repeatSampler).toBe(repeatSource.style);
    expect(clampSampler).toBe(clampSource.style);
    expect(repeatSampler).not.toBe(clampSampler);
    expect(repeatFilter._uniformBindMap[1][1]).toBe("uNoiseTexture");
    expect(repeatFilter._uniformBindMap[1][2]).toBe("uNoiseTextureSampler");
    expect(clampFilter._uniformBindMap[1][1]).toBe("uNoiseTexture");
    expect(clampFilter._uniformBindMap[1][2]).toBe("uNoiseTextureSampler");
    expect(repeatSource.addressMode).toBe("repeat");
    expect(repeatSource.autoGenerateMipmaps).toBe(true);
    expect(repeatSource.mipmapFilter).toBe("linear");
    expect(clampSource.addressMode).toBe("clamp-to-edge");
    expect(clampSource.autoGenerateMipmaps).toBe(false);
    expect(clampSource.mipmapFilter).toBe("nearest");

    repeatFilter.destroy();
    clampFilter.destroy();

    expect(repeatSource.destroyed).toBe(true);
    expect(clampSource.destroyed).toBe(true);
    expect(cachedSource.destroyed).toBe(false);
  });

  it("binds compositor custom textures after uNextTexture with their own WebGPU sampler", () => {
    Cache.set(TEST_TEXTURE_ALIAS, Texture.WHITE);
    const effect = createShaderEffect({
      effect: createTestShader({
        source: customCompositorTextureShaderSource,
        textures: [
          {
            symbol: "uNoiseTexture",
            samplerSymbol: "uNoiseTextureSampler",
            src: TEST_TEXTURE_ALIAS,
          },
        ],
        pipeline: {
          blend: "normal",
          textureWrap: "repeat",
          mipmap: true,
        },
      }),
      width: 32,
      height: 32,
      nextTextureSource: Texture.EMPTY.source,
    });
    const [filter] = effect.filters;

    expect(filter._uniformBindMap[1][1]).toBe("uNextTexture");
    expect(filter._uniformBindMap[1][2]).toBe("uNoiseTexture");
    expect(filter._uniformBindMap[1][3]).toBe("uNoiseTextureSampler");
    expect(filter.resources.uNoiseTextureSampler).toBe(
      filter.resources.uNoiseTexture.style,
    );
    expect(filter.resources.uNoiseTexture.addressMode).toBe("repeat");
    expect(filter.resources.uNoiseTexture.autoGenerateMipmaps).toBe(true);

    destroyShaderEffect(effect);
  });

  it("uses the loop index when locating the previous non-skipped mesh filter stack entry", () => {
    const filter = createShaderFilter({
      shader: createTestShader({
        mesh: {
          grid: [2, 1],
        },
      }),
      width: 100,
      height: 50,
    });
    const output = {};
    const outputFrame = new Float32Array(4);
    const filterUniforms = {
      uniforms: {
        uOutputFrame: outputFrame,
        uInputSize: new Float32Array(4),
        uInputPixel: new Float32Array(4),
        uInputClamp: new Float32Array(4),
        uGlobalFrame: new Float32Array(4),
        uOutputTexture: new Float32Array(4),
      },
      update: vi.fn(),
    };
    const filterManager = {
      _filterStackIndex: 3,
      _filterStack: [
        null,
        {
          skip: false,
          bounds: { minX: 20, minY: 30 },
          inputTexture: { source: { resolution: 2 } },
        },
        {
          skip: true,
          bounds: { minX: 999, minY: 999 },
          inputTexture: { source: { resolution: 3 } },
        },
        {
          skip: false,
          bounds: { minX: 50, minY: 80 },
          previousRenderSurface: output,
        },
      ],
      _filterGlobalUniforms: filterUniforms,
      _globalFilterBindGroup: {
        setResource: vi.fn(),
      },
      renderer: {
        renderTarget: {
          rootRenderTarget: {
            colorTexture: {
              source: { resolution: 1, width: 800, height: 600 },
            },
          },
          getRenderTarget: () => ({ width: 100, height: 50, isRoot: false }),
          bind: vi.fn(),
        },
        renderPipes: {},
        encoder: {
          draw: vi.fn(),
        },
      },
    };
    const input = {
      frame: { width: 100, height: 50 },
      source: {
        width: 100,
        height: 50,
        pixelWidth: 100,
        pixelHeight: 50,
        style: {},
      },
    };

    filter.apply(filterManager, input, output, false);

    expect(outputFrame[0]).toBe(30);
    expect(outputFrame[1]).toBe(50);

    filter.destroy();
  });

  it("reports a clear compatibility error when Pixi mesh internals change", () => {
    const filter = createShaderFilter({
      shader: createTestShader({
        mesh: {
          grid: [2, 1],
        },
      }),
      width: 100,
      height: 50,
    });

    expect(() =>
      filter.apply(
        {
          _filterStack: [],
          _filterStackIndex: 0,
          renderer: {},
        },
        {},
        {},
        false,
      ),
    ).toThrow(
      /Custom shader meshes are incompatible with the installed Pixi runtime.*_filterGlobalUniforms, _globalFilterBindGroup/,
    );

    filter.destroy();
  });

  it("destroys managed shader filters when the display object is destroyed", () => {
    Cache.set(TEST_TEXTURE_ALIAS, Texture.WHITE);
    const cachedSource = Texture.WHITE.source;
    const baseDestroy = vi.fn(function destroy(options) {
      this.destroyOptions = options;
    });
    const displayObject = {
      width: 32,
      height: 32,
      destroy: baseDestroy,
    };

    syncShaderFilters(
      displayObject,
      [
        createTestShader({
          id: "cleanup",
          textures: [{ symbol: "uNoiseTexture", src: TEST_TEXTURE_ALIAS }],
          pipeline: {
            blend: "normal",
            textureWrap: "repeat",
            mipmap: true,
          },
        }),
      ],
      { width: 32, height: 32 },
    );

    const filter = displayObject.filters[0];
    const clonedSource = filter.resources.uNoiseTexture;
    const destroyFilter = vi.spyOn(filter, "destroy");

    displayObject.destroy({ children: true });

    expect(destroyFilter).toHaveBeenCalledTimes(1);
    expect(clonedSource.destroyed).toBe(true);
    expect(cachedSource.destroyed).toBe(false);
    expect(displayObject.filters).toBe(null);
    expect(baseDestroy).toHaveBeenCalledWith({ children: true });
    expect(displayObject.destroyOptions).toEqual({ children: true });
  });
});
