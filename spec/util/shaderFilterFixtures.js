import { normalizeElementShaderFilters } from "../../src/plugins/elements/util/shaderConfig.js";

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

      @fragment fn mainFragment(
        @location(0) uv: vec2<f32>,
      ) -> @location(0) vec4<f32> {
        return vec4<f32>(uv, 0.0, 1.0);
      }
    `,
  },
};

export const createAnimatedShaderFilterFixture = () =>
  normalizeElementShaderFilters([
    {
      id: "grade",
      type: "shader",
      parameters: {
        amount: 0.2,
      },
      source,
    },
  ]);

export const createFilterAnimationFixture = (targetId) =>
  new Map([
    [
      targetId,
      [
        {
          id: `${targetId}-grade`,
          targetId,
          type: "update",
          filterTweens: {
            grade: {
              amount: {
                initialValue: 0.4,
                keyframes: [
                  {
                    duration: 100,
                    value: 1,
                    easing: "linear",
                  },
                ],
              },
            },
          },
        },
      ],
    ],
  ]);
