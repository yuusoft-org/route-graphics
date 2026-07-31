import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import { normalizeElementShaderFilters } from "./shaderConfig.js";
import { validateShaderAnimationBindings } from "./shaderStateValidation.js";

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

const filters = normalizeElementShaderFilters([
  {
    id: "grade",
    type: "shader",
    parameters: {
      amount: 0.5,
      tint: [1, 1, 1, 1],
    },
    source,
  },
]);

const createUpdate = ({
  filterId = "grade",
  parameter = "amount",
  value = 1,
}) =>
  normalizeAnimations([
    {
      id: "update-filter",
      targetId: "card",
      type: "update",
      tween: {
        filters: {
          [filterId]: {
            [parameter]: {
              keyframes: [{ duration: 100, value }],
            },
          },
        },
      },
    },
  ]);

const validate = (animations) =>
  validateShaderAnimationBindings({
    elements: [{ id: "card", filters }],
    animations,
  });

describe("shader state validation", () => {
  it("accepts declared filter parameters and progress", () => {
    expect(() =>
      validate(
        normalizeAnimations([
          {
            id: "valid-filter",
            targetId: "card",
            type: "update",
            tween: {
              filters: {
                grade: {
                  amount: {
                    keyframes: [{ duration: 100, value: 1 }],
                  },
                  tint: {
                    keyframes: [{ duration: 100, value: [1, 0, 0, 1] }],
                  },
                  progress: {
                    keyframes: [{ duration: 100, value: 1 }],
                  },
                },
              },
            },
          },
        ]),
      ),
    ).not.toThrow();
  });

  it("rejects unknown filters before runtime dispatch", () => {
    expect(() => validate(createUpdate({ filterId: "missing" }))).toThrow(
      'Animation "update-filter" could not find shader filter "missing" on element "card".',
    );
  });

  it("rejects unknown filter parameters before runtime dispatch", () => {
    expect(() => validate(createUpdate({ parameter: "intensity" }))).toThrow(
      'Animation "update-filter" cannot target unknown parameter "intensity" on shader filter "grade" on element "card".',
    );
  });

  it("rejects animation values that do not match the declared parameter", () => {
    expect(() =>
      validate(createUpdate({ parameter: "tint", value: [1, 0] })),
    ).toThrow(
      'Animation "update-filter" parameter "tint" on shader filter "grade" on element "card" must be a 4-number array.',
    );
  });

  it("rejects unknown compositor parameters before mounting an overlay", () => {
    const animations = normalizeAnimations([
      {
        id: "bad-compositor",
        targetId: "card",
        type: "transition",
        compositor: {
          type: "shader",
          parameters: { edge: 0.1 },
          tween: {
            progress: {
              keyframes: [{ duration: 100, value: 1 }],
            },
            softness: {
              keyframes: [{ duration: 100, value: 0.2 }],
            },
          },
          source,
        },
      },
    ]);

    expect(() => validate(animations)).toThrow(
      'Animation "bad-compositor" cannot target unknown parameter "softness" on transition compositor.',
    );
  });
});
