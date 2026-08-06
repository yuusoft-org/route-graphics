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

const createNormalizedUpdate = ({
  filterId = "grade",
  parameter = "amount",
  value = 1,
}) => [
  {
    id: "update-filter",
    targetId: "card",
    type: "update",
    filterTweens: {
      [filterId]: {
        [parameter]: {
          keyframes: [{ duration: 100, value }],
        },
      },
    },
  },
];

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

  it("accepts every supported parameter shape on a nested element", () => {
    const nestedFilters = normalizeElementShaderFilters([
      {
        id: "shapes",
        type: "shader",
        parameters: {
          scalar: 0,
          vector2: [0, 0],
          vector3: [0, 0, 0],
          vector4: [0, 0, 0, 0],
          matrix3: Array(9).fill(0),
          matrix4: Array(16).fill(0),
        },
        source,
      },
    ]);
    const animation = {
      id: "all-shapes",
      targetId: "nested-card",
      type: "update",
      filterTweens: {
        shapes: Object.fromEntries(
          [
            ["scalar", 1],
            ["vector2", [1, 2]],
            ["vector3", [1, 2, 3]],
            ["vector4", [1, 2, 3, 4]],
            ["matrix3", Array(9).fill(1)],
            ["matrix4", Array(16).fill(1)],
            ["uProgress", 0.5],
          ].map(([key, value]) => [
            key,
            {
              initialValue: value,
              keyframes: [{ duration: 100, value }],
            },
          ]),
        ),
      },
    };

    expect(() =>
      validateShaderAnimationBindings({
        elements: [
          {
            id: "container",
            children: [{ id: "nested-card", filters: nestedFilters }],
          },
        ],
        animations: [animation],
      }),
    ).not.toThrow();
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
    ["numeric string", "1"],
    ["array", [1]],
    ["null", null],
  ])("rejects %s for a scalar parameter", (_name, value) => {
    expect(() => validate(createNormalizedUpdate({ value }))).toThrow(
      'parameter "amount" on shader filter "grade" on element "card" must be a finite number.',
    );
  });

  it.each([
    ["scalar", 1],
    ["short array", [1, 0, 0]],
    ["long array", [1, 0, 0, 1, 0]],
    ["NaN component", [1, 0, Number.NaN, 1]],
    ["infinite component", [1, 0, Infinity, 1]],
    ["typed array", new Float32Array([1, 0, 0, 1])],
  ])("rejects a %s for a vector parameter", (_name, value) => {
    expect(() =>
      validate(createNormalizedUpdate({ parameter: "tint", value })),
    ).toThrow(
      'parameter "tint" on shader filter "grade" on element "card" must be a 4-number array.',
    );
  });

  it("validates explicit initial values as well as every keyframe", () => {
    expect(() =>
      validate([
        {
          id: "bad-initial",
          targetId: "card",
          type: "update",
          filterTweens: {
            grade: {
              amount: {
                initialValue: [1, 2],
                keyframes: [{ duration: 100, value: 1 }],
              },
            },
          },
        },
      ]),
    ).toThrow(
      'Animation "bad-initial" parameter "amount" on shader filter "grade" on element "card" must be a finite number.',
    );

    expect(() =>
      validate([
        {
          id: "bad-second-keyframe",
          targetId: "card",
          type: "update",
          filterTweens: {
            grade: {
              amount: {
                initialValue: 0,
                keyframes: [
                  { duration: 100, value: 1 },
                  { duration: 100, value: [1, 2] },
                ],
              },
            },
          },
        },
      ]),
    ).toThrow(
      'Animation "bad-second-keyframe" parameter "amount" on shader filter "grade" on element "card" must be a finite number.',
    );

    expect(() =>
      validate([
        {
          id: "bad-start",
          targetId: "card",
          type: "update",
          filterTweens: {
            grade: {
              amount: {
                keyframes: [{ startValue: [1, 2], duration: 100, value: 1 }],
              },
            },
          },
        },
      ]),
    ).toThrow(
      'Animation "bad-start" parameter "amount" on shader filter "grade" on element "card" must be a finite number.',
    );
  });

  it.each([
    {
      name: "missing target element",
      elements: [],
    },
    {
      name: "target without filters",
      elements: [{ id: "card" }],
    },
    {
      name: "target with an empty filter list",
      elements: [{ id: "card", filters: [] }],
    },
  ])("rejects a filter tween on a $name", ({ elements }) => {
    expect(() =>
      validateShaderAnimationBindings({
        elements,
        animations: createUpdate({}),
      }),
    ).toThrow(
      'Animation "update-filter" could not find shader filter "grade" on element "card".',
    );
  });

  it("ignores ordinary tweens and transitions without shader compositors", () => {
    expect(() =>
      validateShaderAnimationBindings({
        elements: [],
        animations: [
          {
            id: "ordinary-update",
            targetId: "missing",
            type: "update",
            tween: {
              alpha: {
                keyframes: [{ duration: 100, value: 1 }],
              },
            },
          },
          {
            id: "ordinary-transition",
            targetId: "missing",
            type: "transition",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("validates compositor initial and keyframe values against their shape", () => {
    const compositor = normalizeAnimations([
      {
        id: "matrix-compositor",
        targetId: "card",
        type: "transition",
        compositor: {
          type: "shader",
          parameters: { transform: Array(9).fill(0) },
          tween: {
            progress: {
              keyframes: [{ duration: 100, value: 1 }],
            },
            transform: {
              initialValue: Array(9).fill(0),
              keyframes: [{ duration: 100, value: Array(9).fill(1) }],
            },
          },
          source,
        },
      },
    ]);
    expect(() => validate(compositor)).not.toThrow();

    compositor[0].compositor.tween.transform.initialValue = [1, 2];
    expect(() => validate(compositor)).toThrow(
      'Animation "matrix-compositor" parameter "transform" on transition compositor must be a 9-number array.',
    );
  });

  it("reports the first invalid shader binding deterministically", () => {
    const animations = [
      {
        id: "first-valid",
        targetId: "card",
        type: "update",
        filterTweens: {
          grade: {
            amount: {
              keyframes: [{ duration: 100, value: 1 }],
            },
          },
        },
      },
      {
        id: "second-invalid",
        targetId: "card",
        type: "update",
        filterTweens: {
          missing: {
            amount: {
              keyframes: [{ duration: 100, value: 1 }],
            },
          },
        },
      },
    ];

    expect(() => validate(animations)).toThrow(
      'Animation "second-invalid" could not find shader filter "missing" on element "card".',
    );
  });

  it("accepts omitted element and animation collections", () => {
    expect(() => validateShaderAnimationBindings({})).not.toThrow();
  });

  it("accepts defensive partially normalized state without bindings", () => {
    expect(() =>
      validateShaderAnimationBindings({
        elements: [
          null,
          {
            children: [{ children: [] }],
          },
        ],
        animations: [
          {
            id: "empty-compositor",
            type: "transition",
            compositor: {
              type: "shader",
            },
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe("rect style animation binding validation", () => {
  const createRectAnimation = (tween) =>
    normalizeAnimations([
      {
        id: "rect-style",
        targetId: "card",
        type: "update",
        tween,
      },
    ]);

  it("accepts style properties compatible with the destination rect", () => {
    const animations = createRectAnimation({
      width: { auto: { duration: 100 } },
      fill: {
        stops: [
          {
            index: 1,
            color: { auto: { duration: 100 } },
          },
        ],
      },
    });

    expect(() =>
      validateShaderAnimationBindings({
        elements: [
          {
            id: "card",
            type: "rect",
            width: 100,
            height: 60,
            fill: {
              type: "linear-gradient",
              stops: [
                { offset: 0, color: "#000000" },
                { offset: 1, color: "#ffffff" },
              ],
            },
          },
        ],
        animations,
      }),
    ).not.toThrow();
  });

  it("rejects rect style properties on another element type", () => {
    expect(() =>
      validateShaderAnimationBindings({
        elements: [{ id: "card", type: "sprite" }],
        animations: createRectAnimation({
          width: { auto: { duration: 100 } },
        }),
      }),
    ).toThrow(
      'Animation "rect-style" can only target rect style properties on a rect element.',
    );
  });

  it("rejects solid fill color animation on a gradient destination", () => {
    expect(() =>
      validateShaderAnimationBindings({
        elements: [
          {
            id: "card",
            type: "rect",
            width: 100,
            height: 60,
            fill: {
              type: "linear-gradient",
              stops: [
                { offset: 0, color: "#000000" },
                { offset: 1, color: "#ffffff" },
              ],
            },
          },
        ],
        animations: createRectAnimation({
          fill: {
            color: { auto: { duration: 100 } },
          },
        }),
      }),
    ).toThrow('property "fill.color" is incompatible with rect "card"');
  });

  it("rejects a missing destination gradient stop", () => {
    expect(() =>
      validateShaderAnimationBindings({
        elements: [
          {
            id: "card",
            type: "rect",
            width: 100,
            height: 60,
            fill: {
              type: "linear-gradient",
              stops: [
                { offset: 0, color: "#000000" },
                { offset: 1, color: "#ffffff" },
              ],
            },
          },
        ],
        animations: createRectAnimation({
          fill: {
            stops: [
              {
                index: 4,
                color: { auto: { duration: 100 } },
              },
            ],
          },
        }),
      }),
    ).toThrow('property "fill.stops.4.color" is incompatible with rect "card"');
  });
});
