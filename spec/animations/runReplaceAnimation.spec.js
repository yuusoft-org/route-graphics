import {
  AnimatedSprite,
  Container,
  Filter,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import {
  runReplaceAnimation,
  sampleMaskReveal,
  selectSequenceMaskFrameState,
} from "../../src/plugins/animations/replace/runReplaceAnimation.js";
import { getElementRenderState } from "../../src/plugins/elements/elementRenderState.js";
import { syncShaderFilters } from "../../src/plugins/elements/util/shaderFilterEffect.js";
import { normalizeElementShaderFilters } from "../../src/plugins/elements/util/shaderConfig.js";
import {
  queueDeferredAnimatedSpritePlay,
  queueDeferredParticlesStart,
} from "../../src/plugins/elements/renderContext.js";
import { addContainer } from "../../src/plugins/elements/container/addContainer.js";

const createFrame = (x = 0, y = 0, width = 100, height = 100) => ({
  x,
  y,
  width,
  height,
  clone() {
    return createFrame(this.x, this.y, this.width, this.height);
  },
});

const createDisplayObject = (label) => {
  const displayObject = new Container();
  displayObject.label = label;
  displayObject.visible = true;
  displayObject.destroy = vi.fn(function destroy() {
    this.destroyed = true;
  });
  displayObject.getLocalBounds = () => ({
    rectangle: createFrame(),
  });

  return displayObject;
};

const createParent = (...children) => ({
  children: [...children],
  addChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  },
  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    if (child) {
      child.parent = null;
    }

    return child;
  },
});

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
};

const passthroughCompositor = {
  type: "shader",
  uniforms: [],
  textures: [],
  pipeline: {},
  mesh: { grid: [1, 1] },
  tween: {
    uProgress: {
      initialValue: 0,
      keyframes: [{ duration: 300, value: 1, easing: "linear" }],
    },
  },
  source: {
    webgl: {
      fragment: `
precision mediump float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uNextTexture;
uniform mat3 uNextTextureMatrix;
uniform float uProgress;
uniform vec4 uNextTextureClamp;

void main(void)
{
    vec2 nextUv = clamp(
        (uNextTextureMatrix * vec3(vTextureCoord, 1.0)).xy,
        uNextTextureClamp.xy,
        uNextTextureClamp.zw
    );
    finalColor = mix(
        texture(uTexture, vTextureCoord),
        texture(uNextTexture, nextUv),
        clamp(uProgress, 0.0, 1.0)
    );
}
`,
    },
    webgpu: {
      source: `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct ShaderUniforms {
  uProgress: f32,
  uResolution: vec2<f32>,
  uNextTextureMatrix: mat3x3<f32>,
  uNextTextureClamp: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var uTexture: texture_2d<f32>;
@group(0) @binding(1) var uSampler: sampler;
@group(0) @binding(2) var<uniform> gfu: GlobalFilterUniforms;
@group(1) @binding(0) var<uniform> shaderUniforms: ShaderUniforms;
@group(1) @binding(1) var uNextTexture: texture_2d<f32>;

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
) -> VertexOutput {
  var output: VertexOutput;
  let position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  output.position = vec4<f32>(
    position.x * (2.0 / gfu.uOutputTexture.x) - 1.0,
    position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) -
      gfu.uOutputTexture.z,
    0.0,
    1.0,
  );
  output.uv = aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
  return output;
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let nextUv = clamp(
    (shaderUniforms.uNextTextureMatrix * vec3<f32>(uv, 1.0)).xy,
    shaderUniforms.uNextTextureClamp.xy,
    shaderUniforms.uNextTextureClamp.zw,
  );
  let prevColor = textureSample(uTexture, uSampler, uv);
  let nextColor = textureSample(uNextTexture, uSampler, nextUv);
  return mix(prevColor, nextColor, clamp(shaderUniforms.uProgress, 0.0, 1.0));
}
`,
    },
  },
};

const timedFilterSource = {
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

      @fragment fn mainFragment(
        @location(0) uv: vec2<f32>,
      ) -> @location(0) vec4<f32> {
        return vec4<f32>(uv, 0.0, 1.0);
      }
    `,
  },
};

describe("runReplaceAnimation", () => {
  it("reveals higher-valued mask pixels earlier by default", () => {
    const highMaskStart = sampleMaskReveal({
      progress: 0,
      maskValue: 0.8,
      softness: 0.08,
    });
    const highMaskMid = sampleMaskReveal({
      progress: 0.2,
      maskValue: 0.8,
      softness: 0.08,
    });
    const highMaskEnd = sampleMaskReveal({
      progress: 1,
      maskValue: 0.8,
      softness: 0.08,
    });
    const lowMaskMid = sampleMaskReveal({
      progress: 0.2,
      maskValue: 0.2,
      softness: 0.08,
    });

    expect(highMaskStart).toBeLessThan(highMaskMid);
    expect(highMaskMid).toBeLessThan(highMaskEnd);
    expect(lowMaskMid).toBeLessThan(highMaskMid);
  });

  it("reveals white edge pixels first and black edge pixels last", () => {
    const blackStartReveal = sampleMaskReveal({
      progress: 0,
      maskValue: 0,
      softness: 0,
    });
    const whiteStartReveal = sampleMaskReveal({
      progress: 0,
      maskValue: 1,
      softness: 0,
    });
    const blackEndReveal = sampleMaskReveal({
      progress: 1,
      maskValue: 0,
      softness: 0,
    });

    expect(blackStartReveal).toBe(0);
    expect(whiteStartReveal).toBe(1);
    expect(blackEndReveal).toBe(1);
  });

  it("selects sequence mask frames from explicit progress positions", () => {
    const frames = [{ at: 0 }, { at: 0.25 }, { at: 1 }];

    expect(
      selectSequenceMaskFrameState({
        progress: 0.5,
        frames,
        sampleMode: "linear",
      }),
    ).toEqual({
      fromIndex: 1,
      toIndex: 2,
      mix: 1 / 3,
    });

    expect(
      selectSequenceMaskFrameState({
        progress: 0.74,
        frames,
        sampleMode: "hold",
      }),
    ).toEqual({
      fromIndex: 1,
      toIndex: 1,
      mix: 0,
    });

    expect(
      selectSequenceMaskFrameState({
        progress: 1.2,
        frames,
        sampleMode: "linear",
      }),
    ).toEqual({
      fromIndex: 2,
      toIndex: 2,
      mix: 0,
    });
  });

  it("mounts next-only transitions through hidden add flow and reveals the result on complete", () => {
    const parent = createParent();
    const nextDisplayObject = createDisplayObject("scene-root");
    const deferredEffect = vi.fn();

    const plugin = {
      add: vi.fn(({ parent: targetParent, element, renderContext }) => {
        expect(renderContext.suppressAnimations).toBe(true);
        expect(targetParent).not.toBe(parent);
        nextDisplayObject.label = element.id;
        queueDeferredAnimatedSpritePlay(renderContext, {
          destroyed: false,
          play: deferredEffect,
        });
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };

    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };
    runReplaceAnimation({
      app,
      parent,
      prevElement: null,
      nextElement: {
        id: "scene-root",
        type: "container",
        children: [],
      },
      animation: {
        id: "scene-enter",
        targetId: "scene-root",
        type: "transition",
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [
                { delay: 100, duration: 300, value: 1, easing: "linear" },
              ],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(plugin.add).toHaveBeenCalledTimes(1);
    expect(plugin.delete).not.toHaveBeenCalled();
    expect(parent.children).toHaveLength(2);
    expect(nextDisplayObject.visible).toBe(false);
    expect(
      getElementRenderState(
        parent.children.find((child) => child !== nextDisplayObject),
      ),
    ).toMatchObject({ id: "scene-root", type: "container" });
    expect(tracker.track).toHaveBeenCalledWith(11);

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    expect(dispatched.payload.deferCompletionUntilNextFrame).toBe(false);
    expect(dispatched.payload.duration).toBe(400);

    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );
    dispatched.payload.applyFrame(99);
    expect(overlay.children[0].alpha).toBe(0);
    dispatched.payload.applyFrame(250);
    expect(overlay.children[0].alpha).toBeCloseTo(0.5);

    dispatched.payload.onComplete();

    expect(parent.children).toEqual([nextDisplayObject]);
    expect(nextDisplayObject.visible).toBe(true);
    expect(deferredEffect).toHaveBeenCalledTimes(1);
    expect(tracker.complete).toHaveBeenCalledWith(11);
  });

  it("seeds hidden transition snapshots with the current shader clock", () => {
    const parent = createParent();
    const nextDisplayObject = createDisplayObject("scene-root");
    const [timedFilter] = normalizeElementShaderFilters([
      {
        id: "clock",
        type: "shader",
        time: true,
        source: timedFilterSource,
      },
    ]);
    let snapshotTime;

    const plugin = {
      add: vi.fn(({ parent: targetParent }) => {
        syncShaderFilters(nextDisplayObject, [timedFilter], {
          width: 100,
          height: 100,
        });
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };
    const animationBus = {
      dispatch: vi.fn(),
    };
    const app = {
      renderer: {
        generateTexture: vi.fn(({ target }) => {
          snapshotTime =
            target.filters[0].resources.shaderUniforms.uniforms.uTime;
          return Texture.EMPTY;
        }),
      },
    };

    const shaderClock = 4.25;
    runReplaceAnimation({
      app,
      parent,
      prevElement: null,
      nextElement: {
        id: "scene-root",
        type: "container",
        children: [],
      },
      animation: {
        id: "scene-enter",
        targetId: "scene-root",
        type: "transition",
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      shaderTime: 1,
      getShaderTime: () => shaderClock,
      signal: new AbortController().signal,
    });

    expect(snapshotTime).toBeCloseTo(4.25);
    expect(
      nextDisplayObject.filters[0].resources.shaderUniforms.uniforms.uTime,
    ).toBeCloseTo(4.25);

    animationBus.dispatch.mock.calls[0][0].payload.onComplete();
    nextDisplayObject.destroy();
  });

  it("uses separate plugins for cross-type transition lifecycle operations", () => {
    const prevDisplayObject = createDisplayObject("preview-background");
    const nextDisplayObject = createDisplayObject("preview-background");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;

    const prevPlugin = {
      add: vi.fn(),
      delete: vi.fn(({ parent: targetParent }) => {
        targetParent.removeChild(prevDisplayObject);
      }),
    };
    const nextPlugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };
    const animationBus = { dispatch: vi.fn() };

    runReplaceAnimation({
      app: {
        renderer: {
          width: 1280,
          height: 720,
          generateTexture: vi.fn(() => Texture.EMPTY),
        },
      },
      parent,
      prevElement: {
        id: "preview-background",
        type: "sprite",
      },
      nextElement: {
        id: "preview-background",
        type: "rect",
      },
      animation: {
        id: "background-transition",
        targetId: "preview-background",
        type: "transition",
        prev: {
          tween: {
            alpha: {
              initialValue: 1,
              keyframes: [{ duration: 300, value: 0, easing: "linear" }],
            },
          },
        },
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      prevPlugin,
      nextPlugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(nextPlugin.add).toHaveBeenCalledTimes(1);
    expect(prevPlugin.delete).toHaveBeenCalledTimes(1);
    expect(prevPlugin.add).not.toHaveBeenCalled();
    expect(nextPlugin.delete).not.toHaveBeenCalled();

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    dispatched.payload.onComplete();

    expect(parent.children).toEqual([nextDisplayObject]);
    expect(nextDisplayObject.visible).toBe(true);
  });

  it("awaits async previous-plugin cleanup before installing a cross-type transition", async () => {
    const prevDisplayObject = createDisplayObject("preview-background");
    const nextDisplayObject = createDisplayObject("preview-background");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const cleanup = createDeferred();
    const prevPlugin = {
      add: vi.fn(),
      delete: vi.fn(() =>
        cleanup.promise.then(() => {
          parent.removeChild(prevDisplayObject);
        }),
      ),
    };
    const nextPlugin = {
      add: vi.fn(({ parent: targetParent }) => {
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };
    const animationBus = { dispatch: vi.fn() };
    const operation = runReplaceAnimation({
      app: {
        renderer: {
          width: 1280,
          height: 720,
          generateTexture: vi.fn(() => Texture.EMPTY),
        },
      },
      parent,
      prevElement: { id: "preview-background", type: "sprite" },
      nextElement: { id: "preview-background", type: "rect" },
      animation: {
        id: "background-transition",
        targetId: "preview-background",
        type: "transition",
        prev: {
          tween: {
            alpha: {
              initialValue: 1,
              keyframes: [{ duration: 300, value: 0, easing: "linear" }],
            },
          },
        },
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      prevPlugin,
      nextPlugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(typeof operation?.then).toBe("function");
    expect(
      parent.children.filter((child) => child.label === "preview-background"),
    ).toEqual([prevDisplayObject]);
    expect(prevPlugin.delete).toHaveBeenCalledTimes(1);
    expect(animationBus.dispatch).not.toHaveBeenCalled();

    cleanup.resolve();
    await operation;

    expect(
      parent.children.filter((child) => child.label === "preview-background"),
    ).toEqual([nextDisplayObject]);
    expect(animationBus.dispatch).toHaveBeenCalledTimes(1);
  });

  it("activates an asynchronously installed transition before it can be superseded", async () => {
    const prevDisplayObject = createDisplayObject("preview-background");
    const nextDisplayObject = createDisplayObject("preview-background");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const cleanup = createDeferred();
    const prevPlugin = {
      add: vi.fn(),
      delete: vi.fn(() =>
        cleanup.promise.then(() => {
          parent.removeChild(prevDisplayObject);
        }),
      ),
    };
    const nextPlugin = {
      add: vi.fn(({ parent: targetParent }) => {
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };
    const animationBus = createAnimationBus();
    const operation = runReplaceAnimation({
      app: {
        renderer: {
          width: 1280,
          height: 720,
          generateTexture: vi.fn(() => Texture.EMPTY),
        },
      },
      parent,
      prevElement: { id: "preview-background", type: "sprite" },
      nextElement: { id: "preview-background", type: "rect" },
      animation: {
        id: "background-transition",
        targetId: "preview-background",
        type: "transition",
        prev: {
          tween: {
            alpha: {
              initialValue: 1,
              keyframes: [{ duration: 300, value: 0, easing: "linear" }],
            },
          },
        },
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      prevPlugin,
      nextPlugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    cleanup.resolve();
    await operation;

    expect(animationBus.getState().activeCount).toBe(1);

    animationBus.cancelAllExcept(new Set());
    expect(animationBus.getState().activeCount).toBe(0);

    animationBus.flush();
    expect(animationBus.getState().activeCount).toBe(0);
  });

  it("returns async transition cleanup rejection to the caller", async () => {
    const prevDisplayObject = createDisplayObject("preview-background");
    const nextDisplayObject = createDisplayObject("preview-background");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const cleanup = createDeferred();
    void cleanup.promise.catch(() => {});
    const prevPlugin = {
      add: vi.fn(),
      delete: vi.fn(() => cleanup.promise),
    };
    const nextPlugin = {
      add: vi.fn(({ parent: targetParent }) => {
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };
    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };
    const animationBus = { dispatch: vi.fn() };
    const operation = runReplaceAnimation({
      app: {
        renderer: {
          width: 1280,
          height: 720,
          generateTexture: vi.fn(() => Texture.EMPTY),
        },
      },
      parent,
      prevElement: { id: "preview-background", type: "sprite" },
      nextElement: { id: "preview-background", type: "rect" },
      animation: {
        id: "background-transition",
        targetId: "preview-background",
        type: "transition",
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      prevPlugin,
      nextPlugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(typeof operation?.then).toBe("function");

    const error = new Error("cleanup failed");
    cleanup.reject(error);

    await expect(operation).rejects.toBe(error);
    expect(animationBus.dispatch).not.toHaveBeenCalled();
    expect(parent.children).toEqual([prevDisplayObject]);
    expect(nextDisplayObject.destroy).toHaveBeenCalledTimes(1);
    expect(tracker.complete).toHaveBeenCalledWith(11);
  });

  it("defers compositor transition completion until the final shader frame is presented", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    prevDisplayObject.x = 160;
    prevDisplayObject.y = 90;
    prevDisplayObject.scale.set(0.75, 0.75);
    nextDisplayObject.x = 160;
    nextDisplayObject.y = 90;
    nextDisplayObject.scale.set(0.75, 0.75);
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const snapshotCalls = [];
    const renderedSurfaceFrames = [];
    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(({ target }) => {
          snapshotCalls.push({
            x: target.x,
            y: target.y,
            scaleX: target.scale.x,
            scaleY: target.scale.y,
            alpha: target.alpha,
          });
          return Texture.EMPTY;
        }),
        render: vi.fn(({ container }) => {
          const surface = container.children[0];
          renderedSurfaceFrames.push({
            x: surface?.x,
            y: surface?.y,
            scaleX: surface?.scale?.x,
            scaleY: surface?.scale?.y,
            alpha: surface?.alpha,
          });
        }),
      },
    };
    const amountParameter = {
      key: "amount",
      symbol: "uAmount",
      role: "parameter",
      type: "f32",
      value: 0.2,
    };
    const tintParameter = {
      key: "tint",
      symbol: "uTint",
      role: "parameter",
      type: "vec3<f32>",
      value: [0.2, 0.4, 0.6],
    };
    const animatedCompositor = {
      ...passthroughCompositor,
      time: true,
      padding: 12,
      parameters: [amountParameter, tintParameter],
      uniforms: [amountParameter, tintParameter],
      tween: {
        ...passthroughCompositor.tween,
        amount: {
          keyframes: [
            { delay: 100, duration: 500, value: 0.8, easing: "linear" },
          ],
        },
        tint: {
          keyframes: [
            {
              delay: 100,
              duration: 200,
              value: [0.8, 0.6, 0.4],
              easing: "linear",
            },
          ],
        },
      },
    };

    let shaderClock = 7.5;
    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: { id: "scene-root", type: "container", children: [] },
      animation: {
        id: "scene-compositor",
        targetId: "scene-root",
        type: "transition",
        next: {
          tween: {
            translateY: {
              initialValue: 0.45,
              keyframes: [{ duration: 600, value: 0, easing: "linear" }],
            },
            scaleX: {
              initialValue: 0.7,
              keyframes: [{ duration: 600, value: 1, easing: "linear" }],
            },
          },
        },
        compositor: animatedCompositor,
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      shaderTime: 1,
      getShaderTime: () => shaderClock,
      signal: new AbortController().signal,
    });

    expect(animationBus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "scene-compositor",
          driver: "custom",
          duration: 600,
          deferCompletionUntilNextFrame: true,
        }),
      }),
    );

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    dispatched.payload.applyFrame(50);

    expect(snapshotCalls).toEqual([
      { x: 0, y: 0, scaleX: 1, scaleY: 1, alpha: 1 },
      { x: 0, y: 0, scaleX: 1, scaleY: 1, alpha: 1 },
    ]);
    expect(prevDisplayObject).toEqual(
      expect.objectContaining({
        x: 160,
        y: 90,
        alpha: 1,
      }),
    );
    expect(prevDisplayObject.scale.x).toBe(0.75);
    expect(prevDisplayObject.scale.y).toBe(0.75);
    expect(renderedSurfaceFrames[1]).toMatchObject({
      x: 160,
      scaleY: 0.75,
      alpha: 1,
    });
    expect(renderedSurfaceFrames[1].y).toBeCloseTo(120.9375);
    expect(renderedSurfaceFrames[1].scaleX).toBeCloseTo(0.54375);

    expect(app.renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        clear: true,
        clearColor: [0, 0, 0, 0],
      }),
    );

    const overlay = parent.children.find((child) =>
      child.children?.some((grandchild) => grandchild.filters?.length > 0),
    );
    const compositorSprite = overlay.children.find(
      (child) => child.filters?.length > 0,
    );
    const compositorFilter = compositorSprite.filters[0];
    const shaderUniforms = compositorFilter.resources.shaderUniforms;
    const filterManager = {
      calculateSpriteMatrix: vi.fn(),
      applyFilter: vi.fn(),
    };

    compositorFilter.apply(filterManager, Texture.EMPTY, Texture.EMPTY, true);

    expect(compositorFilter.padding).toBe(12);
    expect(compositorSprite.filterArea).toMatchObject({
      x: 0,
      y: 0,
      width: compositorSprite.texture.width,
      height: compositorSprite.texture.height,
    });
    expect(shaderUniforms.uniforms.uProgress).toBeCloseTo(1 / 6);
    expect(shaderUniforms.uniforms.uTime).toBeCloseTo(7.5);
    expect(shaderUniforms.uniforms.uAmount).toBeCloseTo(0.2);
    expect(Array.from(shaderUniforms.uniforms.uTint)).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.2),
        expect.closeTo(0.4),
        expect.closeTo(0.6),
      ]),
    );
    expect(filterManager.calculateSpriteMatrix).toHaveBeenCalledWith(
      shaderUniforms.uniforms.uNextTextureMatrix,
      compositorSprite,
    );
    expect(Array.from(shaderUniforms.uniforms.uNextTextureClamp)).not.toEqual([
      0, 0, 1, 1,
    ]);
    expect(filterManager.applyFilter).toHaveBeenCalledWith(
      compositorFilter,
      Texture.EMPTY,
      Texture.EMPTY,
      true,
    );

    dispatched.payload.applyFrame(150);
    compositorFilter.apply(filterManager, Texture.EMPTY, Texture.EMPTY, true);
    expect(shaderUniforms.uniforms.uProgress).toBeCloseTo(0.5);
    expect(shaderUniforms.uniforms.uAmount).toBeCloseTo(0.26);
    expect(Array.from(shaderUniforms.uniforms.uTint)).toEqual(
      expect.arrayContaining([
        expect.closeTo(0.35),
        expect.closeTo(0.45),
        expect.closeTo(0.55),
      ]),
    );

    shaderClock = 9.25;
    dispatched.payload.applyFrame(150);
    expect(shaderUniforms.uniforms.uTime).toBeCloseTo(9.25);

    dispatched.payload.applyFrame(600);
    expect(renderedSurfaceFrames.at(-1)).toMatchObject({
      x: 160,
      scaleY: 0.75,
      alpha: 1,
    });
    expect(renderedSurfaceFrames.at(-1).y).toBeCloseTo(90);
    expect(renderedSurfaceFrames.at(-1).scaleX).toBeCloseTo(0.75);
  });

  it("reuses plain sprite textures for compositor snapshots instead of baking display scale into the texture", () => {
    const prevDisplayObject = new Sprite(Texture.WHITE);
    const nextDisplayObject = new Sprite(Texture.WHITE);
    prevDisplayObject.label = "scene-root";
    nextDisplayObject.label = "scene-root";
    prevDisplayObject.x = 160;
    prevDisplayObject.y = 90;
    prevDisplayObject.scale.set(0.75, 0.75);
    nextDisplayObject.x = 160;
    nextDisplayObject.y = 90;
    nextDisplayObject.scale.set(0.75, 0.75);

    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;

    const plugin = {
      add: vi.fn(({ parent: targetParent }) => {
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };
    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "sprite" },
      nextElement: { id: "scene-root", type: "sprite" },
      animation: {
        id: "sprite-compositor",
        targetId: "scene-root",
        type: "transition",
        compositor: passthroughCompositor,
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 12,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    dispatched.payload.applyFrame(150);

    expect(app.renderer.generateTexture).not.toHaveBeenCalled();
    expect(prevDisplayObject.scale.x).toBe(0.75);
    expect(prevDisplayObject.scale.y).toBe(0.75);
    expect(nextDisplayObject.scale.x).toBe(0.75);
    expect(nextDisplayObject.scale.y).toBe(0.75);
  });

  it("applies transition rotation tween values as degree deltas", () => {
    const parent = createParent();
    const nextDisplayObject = createDisplayObject("scene-root");

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };
    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: null,
      nextElement: {
        id: "scene-root",
        type: "container",
        children: [],
      },
      animation: {
        id: "scene-rotate",
        targetId: "scene-root",
        type: "transition",
        next: {
          tween: {
            rotation: {
              keyframes: [{ duration: 300, value: 90, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 0,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    const overlay = parent.children[1];
    const wrapper = overlay.children[0];

    dispatched.payload.applyFrame(300);

    expect(wrapper.rotation).toBeCloseTo(Math.PI / 2);
  });

  it("runs persistent transitions without tracking render completion", () => {
    const parent = createParent();
    const nextDisplayObject = createDisplayObject("scene-root");

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };

    const tracker = {
      getVersion: vi.fn(),
      track: vi.fn(),
      complete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
      registerPending: vi.fn(),
      removePending: vi.fn(),
      activatePending: vi.fn().mockReturnValue(false),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: null,
      nextElement: {
        id: "scene-root",
        type: "container",
        children: [],
      },
      animation: {
        id: "scene-enter",
        targetId: "scene-root",
        type: "transition",
        playback: { continuity: "persistent" },
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(animationBus.registerPending).toHaveBeenCalledTimes(1);
    expect(tracker.getVersion).not.toHaveBeenCalled();
    expect(tracker.track).not.toHaveBeenCalled();

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    expect(dispatched.payload.continuity).toBe("persistent");

    dispatched.payload.onComplete();
    dispatched.payload.onCancel();

    expect(tracker.complete).not.toHaveBeenCalled();
  });

  it("runs delete-only transitions without mounting a next element", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;

    const plugin = {
      add: vi.fn(),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: null,
      animation: {
        id: "scene-exit",
        targetId: "scene-root",
        type: "transition",
        prev: {
          tween: {
            alpha: {
              initialValue: 1,
              keyframes: [{ duration: 300, value: 0, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(plugin.add).not.toHaveBeenCalled();
    expect(plugin.delete).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).not.toBe(prevDisplayObject);
    expect(tracker.track).toHaveBeenCalledWith(11);

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    dispatched.payload.onComplete();

    expect(parent.children).toHaveLength(0);
    expect(tracker.complete).toHaveBeenCalledWith(11);
  });

  it("tracks async transition mounts before the next element promise resolves", async () => {
    const parent = createParent();
    const nextDisplayObject = createDisplayObject("scene-root");

    let resolveAdd;
    const addPromise = new Promise((resolve) => {
      resolveAdd = resolve;
    });

    const plugin = {
      add: vi.fn(({ parent: targetParent, element, renderContext }) => {
        expect(renderContext.suppressAnimations).toBe(true);
        return addPromise.then(() => {
          nextDisplayObject.label = element.id;
          targetParent.addChild(nextDisplayObject);
        });
      }),
      delete: vi.fn(),
    };

    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: null,
      nextElement: {
        id: "scene-root",
        type: "container",
        children: [],
      },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(tracker.track).toHaveBeenCalledWith(11);
    expect(animationBus.dispatch).not.toHaveBeenCalled();

    resolveAdd();
    await addPromise;
    await vi.waitFor(() => {
      expect(animationBus.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps nested animated sprites live during plain async container transitions", async () => {
    const parent = createParent();
    let resolveChildMount;
    const childMountOperation = new Promise((resolve) => {
      resolveChildMount = resolve;
    });
    let animatedSprite;

    const childPlugin = {
      type: "spritesheet-animation",
      add: vi.fn(({ parent: targetParent, element, renderContext }) =>
        childMountOperation.then(() => {
          animatedSprite = new AnimatedSprite([Texture.EMPTY]);
          vi.spyOn(animatedSprite, "play");
          animatedSprite.label = element.id;
          queueDeferredAnimatedSpritePlay(renderContext, animatedSprite);
          targetParent.addChild(animatedSprite);
        }),
      ),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const plugin = {
      add: addContainer,
      delete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
      },
    };

    const result = runReplaceAnimation({
      app,
      parent,
      prevElement: null,
      nextElement: {
        id: "scene-root",
        type: "container",
        x: 0,
        y: 0,
        alpha: 1,
        children: [
          {
            id: "character-face",
            type: "spritesheet-animation",
          },
        ],
      },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [childPlugin],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(typeof result?.then).toBe("function");
    expect(animationBus.dispatch).not.toHaveBeenCalled();

    resolveChildMount();
    await result;

    expect(animationBus.dispatch).toHaveBeenCalledTimes(1);
    expect(app.renderer.generateTexture).not.toHaveBeenCalled();
    expect(animatedSprite.play).toHaveBeenCalledTimes(1);

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    const overlay = parent.children[0];

    expect(overlay.getChildByLabel("scene-root", true)).toBeNull();
    expect(animatedSprite.parent.label).toBe("scene-root");

    dispatched.payload.applyFrame(500);

    expect(app.renderer.render).toHaveBeenCalled();
    expect(overlay.children[0].alpha).toBe(0.5);
    expect(animatedSprite.parent.alpha).toBe(1);

    dispatched.payload.onComplete();

    expect(parent.children.find((child) => child.label === "scene-root")).toBe(
      animatedSprite.parent,
    );
    expect(animatedSprite.destroyed).not.toBe(true);
  });

  it("keeps live transition resources and completion pending for async cleanup", async () => {
    const prevDisplayObject = new AnimatedSprite([Texture.EMPTY]);
    prevDisplayObject.label = "scene-root";
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const cleanup = createDeferred();
    let cleanedPrevious = false;
    const prevPlugin = {
      add: vi.fn(),
      delete: vi.fn(({ parent: targetParent, element }) =>
        cleanup.promise.then(() => {
          const child = targetParent.children.find(
            (item) => item.label === element.id,
          );
          if (!child) return;
          targetParent.removeChild(child);
          cleanedPrevious = true;
        }),
      ),
    };
    const nextPlugin = {
      add: vi.fn(({ parent: targetParent }) => {
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };
    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };
    const animationBus = { dispatch: vi.fn() };

    runReplaceAnimation({
      app: {
        renderer: {
          width: 1280,
          height: 720,
          generateTexture: vi.fn(() => Texture.EMPTY),
          render: vi.fn(),
        },
      },
      parent,
      prevElement: { id: "scene-root", type: "spritesheet-animation" },
      nextElement: { id: "scene-root", type: "container" },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
        prev: {
          tween: {
            alpha: {
              initialValue: 1,
              keyframes: [{ duration: 300, value: 0, easing: "linear" }],
            },
          },
        },
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      prevPlugin,
      nextPlugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    const overlay = parent.children.find(
      (child) => child !== prevDisplayObject && child !== nextDisplayObject,
    );
    const completionOperation = dispatched.payload.onComplete();

    expect(typeof completionOperation?.then).toBe("function");
    expect(tracker.complete).not.toHaveBeenCalled();
    expect(overlay.destroyed).toBe(false);
    expect(nextDisplayObject.parent).toBe(parent);
    expect(prevDisplayObject.parent).not.toBe(parent);

    cleanup.resolve();
    await completionOperation;

    expect(cleanedPrevious).toBe(true);
    expect(tracker.complete).toHaveBeenCalledWith(11);
    expect(overlay.destroyed).toBe(true);
    expect(nextDisplayObject.parent).toBe(parent);
    expect(nextDisplayObject.visible).toBe(true);
  });

  it("observes live transition cleanup rejection and releases resources", async () => {
    const prevDisplayObject = new AnimatedSprite([Texture.EMPTY]);
    prevDisplayObject.label = "scene-root";
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const cleanup = createDeferred();
    const prevPlugin = {
      add: vi.fn(),
      delete: vi.fn(() => cleanup.promise),
    };
    const nextPlugin = {
      add: vi.fn(({ parent: targetParent }) => {
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };
    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };
    const animationBus = { dispatch: vi.fn() };

    runReplaceAnimation({
      app: {
        renderer: {
          width: 1280,
          height: 720,
          generateTexture: vi.fn(() => Texture.EMPTY),
          render: vi.fn(),
        },
      },
      parent,
      prevElement: { id: "scene-root", type: "spritesheet-animation" },
      nextElement: { id: "scene-root", type: "container" },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
        prev: {},
        next: {},
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      prevPlugin,
      nextPlugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    const overlay = parent.children[0];
    const completionOperation = dispatched.payload.onComplete();
    const error = new Error("live cleanup failed");
    cleanup.reject(error);

    await expect(completionOperation).rejects.toBe(error);
    expect(tracker.complete).toHaveBeenCalledWith(11);
    expect(overlay.destroyed).toBe(true);
    expect(nextDisplayObject.parent).toBe(parent);
    expect(nextDisplayObject.visible).toBe(true);
  });

  it("keeps hidden next animated sprite playback deferred for prev-only same-id live transitions", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    let animatedSprite;

    const childPlugin = {
      type: "spritesheet-animation",
      add: vi.fn(({ parent: targetParent, element, renderContext }) => {
        animatedSprite = new AnimatedSprite([Texture.EMPTY]);
        vi.spyOn(animatedSprite, "play");
        animatedSprite.label = element.id;
        queueDeferredAnimatedSpritePlay(renderContext, animatedSprite);
        targetParent.addChild(animatedSprite);
      }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const plugin = {
      add: addContainer,
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: {
        id: "scene-root",
        type: "container",
        x: 0,
        y: 0,
        alpha: 1,
        children: [
          {
            id: "hidden-character-face",
            type: "spritesheet-animation",
          },
        ],
      },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
        prev: {
          tween: {
            alpha: {
              initialValue: 1,
              keyframes: [{ duration: 1000, value: 0, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [childPlugin],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(animationBus.dispatch).toHaveBeenCalledTimes(1);
    expect(animatedSprite.play).not.toHaveBeenCalled();
    expect(animatedSprite.parent.visible).toBe(false);

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    dispatched.payload.onComplete();

    expect(animatedSprite.parent.visible).toBe(true);
    expect(animatedSprite.play).toHaveBeenCalledTimes(1);
  });

  it("preserves continuation zIndex updates while an async persistent transition is pending", async () => {
    const parent = createParent();
    const nextDisplayObject = createDisplayObject("scene-root");

    let resolveAdd;
    const addPromise = new Promise((resolve) => {
      resolveAdd = resolve;
    });
    /** @type {{ onContinuationUpdate?: Function } | null} */
    let pendingContext = null;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element, renderContext }) => {
        expect(renderContext.suppressAnimations).toBe(true);
        return addPromise.then(() => {
          nextDisplayObject.label = element.id;
          targetParent.addChild(nextDisplayObject);
        });
      }),
      delete: vi.fn(),
    };

    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
      registerPending: vi.fn((payload) => {
        pendingContext = payload;
      }),
      removePending: vi.fn(),
      activatePending: vi.fn().mockReturnValue(false),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: null,
      nextElement: {
        id: "scene-root",
        type: "container",
        children: [],
      },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
        playback: { continuity: "persistent" },
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(animationBus.registerPending).toHaveBeenCalledTimes(1);

    pendingContext?.onContinuationUpdate?.({ zIndex: 7 });

    resolveAdd();
    await addPromise;
    await vi.waitFor(() => {
      expect(animationBus.dispatch).toHaveBeenCalledTimes(1);
    });

    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );

    expect(nextDisplayObject.zIndex).toBe(7);
    expect(overlay?.zIndex).toBe(7);
  });

  it("reuses plugin delete/add so transition keeps child setup and deferred activation", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const deferredEffect = vi.fn();

    const childAnimations = new Map([
      [
        "child-1",
        [
          {
            id: "child-enter",
            targetId: "child-1",
            type: "update",
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 300, value: 1, easing: "linear" }],
              },
            },
          },
        ],
      ],
    ]);

    const plugin = {
      add: vi.fn(
        ({
          parent: targetParent,
          element,
          animations,
          completionTracker,
          renderContext,
        }) => {
          expect(animations).toBe(childAnimations);
          expect(completionTracker).toBe(tracker);
          expect(targetParent).not.toBe(parent);
          expect(renderContext.suppressAnimations).toBe(true);
          queueDeferredAnimatedSpritePlay(renderContext, {
            destroyed: false,
            play: deferredEffect,
          });
          nextDisplayObject.label = element.id;
          targetParent.addChild(nextDisplayObject);
        },
      ),
      delete: vi.fn(
        ({ parent: targetParent, element, animations, completionTracker }) => {
          expect(animations).toEqual([]);
          expect(completionTracker).toBe(tracker);
          const child = targetParent.children.find(
            (item) => item.label === element.id,
          );
          if (child) {
            targetParent.removeChild(child);
          }
        },
      ),
    };

    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: {
        id: "scene-root",
        type: "container",
        children: [{ id: "child-1", type: "rect" }],
      },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
      },
      animations: childAnimations,
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(plugin.delete).toHaveBeenCalledTimes(1);
    expect(plugin.add).toHaveBeenCalledTimes(1);
    expect(prevDisplayObject.destroy).not.toHaveBeenCalled();
    expect(nextDisplayObject.visible).toBe(false);
    expect(tracker.track).toHaveBeenCalledWith(11);
    const dispatched = animationBus.dispatch.mock.calls[0][0];

    expect(dispatched).toEqual(
      expect.objectContaining({
        type: "START",
        payload: expect.objectContaining({
          id: "scene-transition",
          driver: "custom",
        }),
      }),
    );

    dispatched.payload.onComplete();

    expect(nextDisplayObject.visible).toBe(true);
    expect(deferredEffect).toHaveBeenCalledTimes(1);
  });

  it("preserves particle runtimes on the next live element during hidden replace mount cleanup", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const tickerCallback = vi.fn();
    const emitter = {
      destroyed: false,
      destroy: vi.fn(() => {
        emitter.destroyed = true;
      }),
    };

    const plugin = {
      add: vi.fn(({ parent: targetParent, element, renderContext }) => {
        nextDisplayObject.label = element.id;
        nextDisplayObject.emitter = emitter;
        nextDisplayObject.tickerCallback = tickerCallback;
        queueDeferredParticlesStart(renderContext, {
          app,
          emitter,
          container: nextDisplayObject,
          tickerCallback,
        });
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };
    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
      ticker: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: { id: "scene-root", type: "particles" },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    expect(emitter.destroy).not.toHaveBeenCalled();
    expect(app.ticker.remove).not.toHaveBeenCalled();
    expect(nextDisplayObject.emitter).toBe(emitter);
    expect(nextDisplayObject.tickerCallback).toBe(tickerCallback);

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    dispatched.payload.onComplete();

    expect(app.ticker.add).toHaveBeenCalledWith(tickerCallback);
    expect(nextDisplayObject.visible).toBe(true);
  });

  it("uses only the previous snapshot for same-id prev-only transitions", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: { id: "scene-root", type: "container", children: [] },
      animation: {
        id: "scene-slide-out",
        targetId: "scene-root",
        type: "transition",
        prev: {
          tween: {
            translateX: {
              initialValue: 0,
              keyframes: [{ duration: 1000, value: -1, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );

    expect(overlay.children).toHaveLength(1);
    dispatched.payload.applyFrame(500);
    expect(overlay.children[0].x).toBeCloseTo(-50);
    expect(nextDisplayObject.visible).toBe(false);
  });

  it("uses only the next snapshot for same-id next-only transitions", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: { id: "scene-root", type: "container", children: [] },
      animation: {
        id: "scene-slide-in",
        targetId: "scene-root",
        type: "transition",
        next: {
          tween: {
            translateX: {
              initialValue: 1,
              keyframes: [{ duration: 1000, value: 0, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );

    expect(overlay.children).toHaveLength(1);
    dispatched.payload.applyFrame(500);
    expect(overlay.children[0].x).toBeCloseTo(50);
    expect(nextDisplayObject.visible).toBe(false);
  });

  it("applies absolute x and y tweens to transition snapshots", () => {
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent();

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: null,
      nextElement: { id: "scene-root", type: "container", children: [] },
      animation: {
        id: "scene-absolute-in",
        targetId: "scene-root",
        type: "transition",
        next: {
          tween: {
            x: {
              initialValue: 20,
              keyframes: [{ duration: 1000, value: 120, easing: "linear" }],
            },
            y: {
              initialValue: 10,
              keyframes: [{ duration: 1000, value: 60, easing: "linear" }],
            },
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];
    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );

    dispatched.payload.applyFrame(500);
    expect(overlay.children[0].x).toBeCloseTo(70);
    expect(overlay.children[0].y).toBeCloseTo(35);
  });

  it("expands masked transition bounds for absolute position tweens", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const maskTexture = document.createElement("canvas");
    maskTexture.width = 1;
    maskTexture.height = 1;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: { id: "scene-root", type: "container", children: [] },
      animation: {
        id: "scene-mask-position",
        targetId: "scene-root",
        type: "transition",
        prev: {
          tween: {
            alpha: {
              initialValue: 1,
              keyframes: [{ duration: 1000, value: 0, easing: "linear" }],
            },
          },
        },
        next: {
          tween: {
            x: {
              initialValue: 200,
              keyframes: [{ duration: 1000, value: 400, easing: "linear" }],
            },
          },
        },
        mask: {
          kind: "single",
          texture: maskTexture,
          channel: "red",
          progress: {
            initialValue: 0,
            keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );
    const sprite = overlay.children[0];

    expect(sprite.x).toBe(0);
    expect(sprite.filterArea.width).toBe(401);
    expect(sprite.filterArea.height).toBe(1);
  });

  it("does not preprocess single masks through CPU extraction", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const maskTexture = document.createElement("canvas");
    maskTexture.width = 1;
    maskTexture.height = 1;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
        extract: {
          pixels: vi.fn(() => ({
            pixels: new Uint8ClampedArray(100 * 100 * 4),
          })),
        },
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: { id: "scene-root", type: "container", children: [] },
      animation: {
        id: "scene-mask-replace",
        targetId: "scene-root",
        type: "transition",
        mask: {
          kind: "single",
          texture: maskTexture,
          channel: "red",
          progress: {
            initialValue: 0,
            keyframes: [
              { delay: 200, duration: 800, value: 1, easing: "linear" },
            ],
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];

    expect(app.renderer.extract.pixels).not.toHaveBeenCalled();
    expect(dispatched.payload.duration).toBe(1000);
    dispatched.payload.applyFrame(199);

    expect(app.renderer.extract.pixels).not.toHaveBeenCalled();
    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );
    const maskFilter = overlay.children[0].filters[0];

    expect(
      maskFilter.resources.replaceMaskUniforms.uniforms.uMaskDirectReveal,
    ).toBe(0);
    expect(maskFilter.resources.replaceMaskUniforms.uniforms.uProgress).toBe(0);

    dispatched.payload.applyFrame(600);
    expect(
      maskFilter.resources.replaceMaskUniforms.uniforms.uProgress,
    ).toBeCloseTo(0.5);
  });

  it("routes single alpha masks through the alpha preprocessing filter", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const maskTexture = document.createElement("canvas");
    maskTexture.width = 1;
    maskTexture.height = 1;
    const filterFromSpy = vi.spyOn(Filter, "from");

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
        extract: {
          pixels: vi.fn(() => ({
            pixels: new Uint8ClampedArray(100 * 100 * 4),
          })),
        },
      },
    };

    try {
      runReplaceAnimation({
        app,
        parent,
        prevElement: { id: "scene-root", type: "container" },
        nextElement: { id: "scene-root", type: "container", children: [] },
        animation: {
          id: "scene-mask-replace-alpha",
          targetId: "scene-root",
          type: "transition",
          mask: {
            kind: "single",
            texture: maskTexture,
            channel: "alpha",
            progress: {
              initialValue: 0,
              keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
            },
          },
        },
        animations: new Map(),
        animationBus,
        completionTracker: {
          getVersion: () => 11,
          track: vi.fn(),
          complete: vi.fn(),
        },
        eventHandler: vi.fn(),
        elementPlugins: [],
        plugin,
        zIndex: 0,
        signal: new AbortController().signal,
      });

      const dispatched = animationBus.dispatch.mock.calls[0][0];
      const overlay = parent.children.find(
        (child) => child !== nextDisplayObject,
      );
      const sprite = overlay.children[0];
      const maskFilter = sprite.filters[0];
      const maskChannelFilterCall = filterFromSpy.mock.calls.find(
        ([config]) => config.resources?.maskChannelUniforms,
      );

      dispatched.payload.applyFrame(500);

      expect(maskChannelFilterCall).toBeTruthy();
      expect(
        Array.from(
          maskChannelFilterCall[0].resources.maskChannelUniforms.uniforms
            .uMaskChannelWeights,
        ),
      ).toEqual([0, 0, 0, 1]);
      expect(
        Array.from(
          maskFilter.resources.replaceMaskUniforms.uniforms.uMaskChannelWeights,
        ),
      ).toEqual([1, 0, 0, 0]);
      expect(
        maskFilter.resources.replaceMaskUniforms.uniforms.uMaskDirectReveal,
      ).toBe(0);
      expect(maskFilter.resources.uMaskTextureA).not.toBe(Texture.EMPTY.source);
      expect(maskFilter.resources.uMaskTextureB).not.toBe(Texture.EMPTY.source);
      expect(app.renderer.extract.pixels).not.toHaveBeenCalled();
    } finally {
      filterFromSpy.mockRestore();
    }
  });

  it("maps masked replace secondary textures through the overlay sprite matrix", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const maskTexture = document.createElement("canvas");
    maskTexture.width = 1;
    maskTexture.height = 1;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
        extract: {
          pixels: vi.fn(() => ({
            pixels: new Uint8ClampedArray(100 * 100 * 4),
          })),
        },
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: { id: "scene-root", type: "container", children: [] },
      animation: {
        id: "scene-mask-replace",
        targetId: "scene-root",
        type: "transition",
        mask: {
          kind: "single",
          texture: maskTexture,
          channel: "red",
          progress: {
            initialValue: 0,
            keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );
    const sprite = overlay.children[0];
    const maskFilter = sprite.filters[0];
    const filterManager = {
      calculateSpriteMatrix: vi.fn((matrix) => {
        matrix.a = 1.6;
        matrix.b = 0;
        matrix.c = 0;
        matrix.d = 1.4222222222222223;
        matrix.tx = 0;
        matrix.ty = 0;
        return matrix;
      }),
      applyFilter: vi.fn(),
    };

    maskFilter.apply(filterManager, Texture.EMPTY, Texture.EMPTY, false);

    expect(filterManager.calculateSpriteMatrix).toHaveBeenCalledWith(
      maskFilter.resources.replaceMaskUniforms.uniforms.uSecondaryMatrix,
      sprite,
    );
    expect(filterManager.applyFilter).toHaveBeenCalledWith(
      maskFilter,
      Texture.EMPTY,
      Texture.EMPTY,
      false,
    );
    expect(
      maskFilter.resources.replaceMaskUniforms.uniforms.uSecondaryMatrix.a,
    ).toBeCloseTo(1.6);
    expect(
      maskFilter.resources.replaceMaskUniforms.uniforms.uSecondaryMatrix.d,
    ).toBeCloseTo(1.4222222222222223);
    expect(
      Array.from(
        maskFilter.resources.replaceMaskUniforms.uniforms.uSecondaryClamp,
      ),
    ).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("destroys masked replace filters before their bound textures on completion", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const maskTexture = document.createElement("canvas");
    maskTexture.width = 1;
    maskTexture.height = 1;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };
    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };
    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
      },
    };

    const destroyOrder = [];
    const renderTextureConfigs = [];
    let renderTextureIndex = 0;
    let filterIndex = 0;
    const renderTextureSpy = vi
      .spyOn(RenderTexture, "create")
      .mockImplementation((config) => {
        renderTextureConfigs.push(config);
        const id = renderTextureIndex++;
        const texture = Object.create(Texture.EMPTY);
        Object.defineProperty(texture, "source", {
          value: {
            destroyed: false,
          },
          writable: true,
          configurable: true,
        });
        texture.destroy = vi.fn(() => {
          texture.destroyed = true;
          texture.source.destroyed = true;
          destroyOrder.push(`renderTexture:${id}`);
        });
        Object.defineProperty(texture, "destroy", {
          value: texture.destroy,
          writable: true,
          configurable: true,
        });

        return texture;
      });
    const filterSpy = vi.spyOn(Filter, "from").mockImplementation(() => {
      if (filterIndex++ === 0) {
        return {
          destroy: vi.fn(() => {
            destroyOrder.push("maskChannelFilter.destroy");
          }),
          resources: {},
        };
      }

      const replaceMaskUniforms = {
        uniforms: {},
        update: vi.fn(),
      };
      const replaceMaskFilter = {
        resources: {
          replaceMaskUniforms,
          uNextTexture: Texture.EMPTY.source,
          uMaskTextureA: Texture.EMPTY.source,
          uMaskTextureB: Texture.EMPTY.source,
        },
        destroy: vi.fn(() => {
          destroyOrder.push("maskFilter.destroy");
          const boundTextures = [
            replaceMaskFilter.resources.uNextTexture,
            replaceMaskFilter.resources.uMaskTextureA,
            replaceMaskFilter.resources.uMaskTextureB,
          ];

          if (boundTextures.some((resource) => resource?.destroyed)) {
            throw new Error("mask filter destroy ran after texture teardown");
          }
        }),
      };

      return replaceMaskFilter;
    });

    try {
      runReplaceAnimation({
        app,
        parent,
        prevElement: { id: "scene-root", type: "container" },
        nextElement: { id: "scene-root", type: "container", children: [] },
        animation: {
          id: "scene-mask-replace",
          targetId: "scene-root",
          type: "transition",
          mask: {
            kind: "single",
            texture: maskTexture,
            channel: "red",
            progress: {
              initialValue: 0,
              keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
            },
          },
        },
        animations: new Map(),
        animationBus,
        completionTracker: tracker,
        eventHandler: vi.fn(),
        elementPlugins: [],
        plugin,
        zIndex: 0,
        signal: new AbortController().signal,
      });

      const dispatched = animationBus.dispatch.mock.calls[0][0];

      expect(() => dispatched.payload.onComplete()).not.toThrow();
      expect(tracker.complete).toHaveBeenCalledWith(11);

      const maskFilterDestroyIndex = destroyOrder.indexOf("maskFilter.destroy");

      expect(maskFilterDestroyIndex).toBeGreaterThan(-1);
      expect(maskFilterDestroyIndex).toBeLessThan(
        destroyOrder.indexOf("renderTexture:0"),
      );
      expect(maskFilterDestroyIndex).toBeLessThan(
        destroyOrder.indexOf("renderTexture:1"),
      );
      expect(maskFilterDestroyIndex).toBeLessThan(
        destroyOrder.indexOf("renderTexture:2"),
      );
      expect(renderTextureConfigs).toEqual([
        expect.objectContaining({ resolution: 1 }),
        expect.objectContaining({ resolution: 1 }),
        expect.objectContaining({ resolution: 1 }),
      ]);
    } finally {
      renderTextureSpy.mockRestore();
      filterSpy.mockRestore();
    }
  });

  it("does not preprocess sequence masks through CPU extraction", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const leftMask = document.createElement("canvas");
    const rightMask = document.createElement("canvas");
    leftMask.width = 1;
    leftMask.height = 1;
    rightMask.width = 1;
    rightMask.height = 1;

    const plugin = {
      add: vi.fn(({ parent: targetParent, element }) => {
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
        render: vi.fn(),
        extract: {
          pixels: vi.fn(() => ({
            pixels: new Uint8ClampedArray(100 * 100 * 4),
          })),
        },
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: { id: "scene-root", type: "container", children: [] },
      animation: {
        id: "scene-mask-sequence",
        targetId: "scene-root",
        type: "transition",
        mask: {
          kind: "sequence",
          frames: [
            { at: 0, texture: leftMask },
            { at: 1, texture: rightMask },
          ],
          channel: "alpha",
          sample: "linear",
          invert: true,
          progress: {
            initialValue: 0,
            keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
          },
        },
      },
      animations: new Map(),
      animationBus,
      completionTracker: {
        getVersion: () => 11,
        track: vi.fn(),
        complete: vi.fn(),
      },
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];

    expect(app.renderer.extract.pixels).not.toHaveBeenCalled();
    dispatched.payload.applyFrame(500);

    expect(app.renderer.extract.pixels).not.toHaveBeenCalled();
    const overlay = parent.children.find(
      (child) => child !== nextDisplayObject,
    );
    const maskFilter = overlay.children[0].filters[0];

    expect(
      maskFilter.resources.replaceMaskUniforms.uniforms.uMaskDirectReveal,
    ).toBe(1);
  });

  it("does not flush deferred activation when a transition is cancelled", () => {
    const prevDisplayObject = createDisplayObject("scene-root");
    const nextDisplayObject = createDisplayObject("scene-root");
    const parent = createParent(prevDisplayObject);
    prevDisplayObject.parent = parent;
    const deferredEffect = vi.fn();

    const plugin = {
      add: vi.fn(({ parent: targetParent, element, renderContext }) => {
        queueDeferredAnimatedSpritePlay(renderContext, {
          destroyed: false,
          play: deferredEffect,
        });
        nextDisplayObject.label = element.id;
        targetParent.addChild(nextDisplayObject);
      }),
      delete: vi.fn(({ parent: targetParent, element }) => {
        const child = targetParent.children.find(
          (item) => item.label === element.id,
        );
        if (child) {
          targetParent.removeChild(child);
        }
      }),
    };

    const tracker = {
      getVersion: () => 11,
      track: vi.fn(),
      complete: vi.fn(),
    };

    const animationBus = {
      dispatch: vi.fn(),
    };

    const app = {
      renderer: {
        width: 1280,
        height: 720,
        generateTexture: vi.fn(() => Texture.EMPTY),
      },
    };

    runReplaceAnimation({
      app,
      parent,
      prevElement: { id: "scene-root", type: "container" },
      nextElement: {
        id: "scene-root",
        type: "container",
        children: [],
      },
      animation: {
        id: "scene-transition",
        targetId: "scene-root",
        type: "transition",
      },
      animations: new Map(),
      animationBus,
      completionTracker: tracker,
      eventHandler: vi.fn(),
      elementPlugins: [],
      plugin,
      zIndex: 0,
      signal: new AbortController().signal,
    });

    const dispatched = animationBus.dispatch.mock.calls[0][0];

    dispatched.payload.applyTargetState();
    dispatched.payload.onCancel();

    expect(nextDisplayObject.visible).toBe(true);
    expect(deferredEffect).not.toHaveBeenCalled();
    expect(tracker.complete).toHaveBeenCalledWith(11);
  });
});
