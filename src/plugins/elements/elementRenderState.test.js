import { describe, expect, it } from "vitest";
import { normalizeElementShaderFilters } from "./util/shaderConfig.js";
import { updateElementWithRenderState } from "./elementRenderState.js";

const shaderSource = {
  webgl: {
    fragment: `
      in vec2 vTextureCoord;
      out vec4 finalColor;
      uniform sampler2D uTexture;
      uniform float uTime;
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

const createElement = () => ({
  id: "timed-element",
  type: "test",
  width: 64,
  height: 32,
  filters: normalizeElementShaderFilters([
    {
      id: "timed-filter",
      type: "shader",
      time: true,
      source: shaderSource,
    },
  ]),
});

const createMountedChild = () => ({
  label: "timed-element",
  width: 64,
  height: 32,
  destroyed: false,
  destroy() {
    this.destroyed = true;
  },
});

const getFilterTime = (child) =>
  child.filters[0].resources.shaderUniforms.uniforms.uTime;

describe("element render state shader time", () => {
  it("keeps the live shader clock when an immediate update commits", () => {
    const child = createMountedChild();
    const parent = { children: [child], destroyed: false };
    const element = createElement();

    updateElementWithRenderState({
      plugin: {
        update: () => undefined,
      },
      parent,
      prevElement: element,
      nextElement: element,
      animations: [],
      shaderTime: 1,
      getShaderTime: () => 3.25,
    });

    expect(getFilterTime(child)).toBe(3.25);
    child.destroy();
  });

  it("reads the current shader clock when a deferred animation commits", () => {
    const child = createMountedChild();
    const parent = { children: [child], destroyed: false };
    const element = createElement();
    let shaderTime = 1;
    let commitRenderState;

    updateElementWithRenderState({
      plugin: {
        update: (options) => {
          options.deferRenderStateCommit();
          commitRenderState = options.commitRenderState;
        },
      },
      parent,
      prevElement: element,
      nextElement: element,
      animations: [],
      shaderTime,
      getShaderTime: () => shaderTime,
    });

    shaderTime = 4.5;
    commitRenderState(child);

    expect(getFilterTime(child)).toBe(4.5);
    child.destroy();
  });
});
