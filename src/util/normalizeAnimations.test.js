import { describe, expect, it } from "vitest";
import { normalizeAnimations } from "./normalizeAnimations.js";

const compositorSource = {
  webgl: {
    fragment: `
      in vec2 vTextureCoord;
      out vec4 finalColor;
      uniform sampler2D uTexture;
      uniform sampler2D uNextTexture;
      uniform float uProgress;
      void main() {
        finalColor = mix(texture(uTexture, vTextureCoord), texture(uNextTexture, vTextureCoord), uProgress);
      }
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

const progressTween = {
  progress: {
    initialValue: 0,
    keyframes: [{ duration: 100, value: 1, easing: "linear" }],
  },
};

const createCompositor = (overrides = {}) => ({
  type: "shader",
  source: compositorSource,
  tween: progressTween,
  ...overrides,
});

describe("normalizeAnimations shader support", () => {
  it("keeps ordinary update tweens unchanged", () => {
    const [animation] = normalizeAnimations([
      {
        id: "enter",
        targetId: "scene",
        type: "update",
        tween: {
          alpha: {
            initialValue: 0,
            keyframes: [{ duration: 100, value: 1 }],
          },
          x: {
            auto: { duration: 100, easing: "easeOutCubic" },
          },
        },
      },
    ]);

    expect(animation.tween.alpha.keyframes[0].value).toBe(1);
    expect(animation.tween.x.auto.easing).toBe("easeOutCubic");
  });

  it("normalizes filter-only updates and vector parameters", () => {
    const [animation] = normalizeAnimations([
      {
        id: "pulse-glow",
        targetId: "scene",
        type: "update",
        tween: {
          filters: {
            glow: {
              tint: {
                initialValue: [1, 0, 0],
                keyframes: [
                  {
                    duration: 200,
                    value: [0, 0.5, 1],
                    easing: "linear",
                  },
                ],
              },
            },
          },
        },
      },
    ]);

    expect(animation.tween).toBeUndefined();
    expect(animation.filterTweens.glow.tint.keyframes[0].value).toEqual([
      0, 0.5, 1,
    ]);
  });

  it("combines ordinary properties and multiple filter targets", () => {
    const [animation] = normalizeAnimations([
      {
        id: "combined",
        targetId: "scene",
        type: "update",
        tween: {
          alpha: {
            keyframes: [{ duration: 100, value: 1 }],
          },
          filters: {
            glow: {
              strength: {
                keyframes: [{ duration: 100, value: 0.8 }],
              },
            },
            grade: {
              progress: {
                keyframes: [{ duration: 100, value: 1 }],
              },
            },
          },
        },
      },
    ]);

    expect(animation.tween.alpha.keyframes[0].value).toBe(1);
    expect(animation.filterTweens.glow.strength.keyframes[0].value).toBe(0.8);
    expect(animation.filterTweens.grade.uProgress.keyframes[0].value).toBe(1);
  });

  it("rejects duplicate animations for the same filter parameter", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "a",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              glow: {
                amount: {
                  keyframes: [{ duration: 100, value: 1 }],
                },
              },
            },
          },
        },
        {
          id: "b",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              glow: {
                amount: {
                  keyframes: [{ duration: 100, value: 0 }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/cannot both animate parameter "amount"/);
  });

  it("rejects the old detached shader animation object", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "legacy",
          targetId: "scene",
          type: "update",
          shader: {
            filterId: "glow",
            tween: {
              amount: {
                keyframes: [{ duration: 100, value: 1 }],
              },
            },
          },
        },
      ]),
    ).toThrow(/shader.*no longer supported/);
  });

  it("uses progress instead of author-facing uProgress", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "legacy-progress",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              glow: {
                uProgress: {
                  keyframes: [{ duration: 100, value: 1 }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/Use .*progress/);
  });

  it("requires scalar progress values", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "bad-progress",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              glow: {
                progress: {
                  keyframes: [{ duration: 100, value: [0, 1] }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/progress.*must be a finite number/);
  });

  it("normalizes an inline compositor tween", () => {
    const [animation] = normalizeAnimations([
      {
        id: "crossfade",
        targetId: "scene",
        type: "transition",
        compositor: createCompositor({
          parameters: {
            edgeWidth: 0.05,
          },
          tween: {
            ...progressTween,
            edgeWidth: {
              keyframes: [{ duration: 100, value: 0.2 }],
            },
          },
        }),
      },
    ]);

    expect(animation.compositor.type).toBe("shader");
    expect(animation.compositor.tween.uProgress.keyframes[0].duration).toBe(
      100,
    );
    expect(animation.compositor.tween.edgeWidth.keyframes[0].value).toBe(0.2);
  });

  it("requires compositor.tween.progress", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "bad",
          targetId: "scene",
          type: "transition",
          compositor: createCompositor({
            tween: {
              edgeWidth: {
                keyframes: [{ duration: 100, value: 0.2 }],
              },
            },
          }),
        },
      ]),
    ).toThrow(/compositor\.tween\.progress is required/);
  });

  it("allows normal surface tweens with an inline compositor tween", () => {
    const [animation] = normalizeAnimations([
      {
        id: "combined-transition",
        targetId: "scene",
        type: "transition",
        prev: {
          tween: {
            alpha: {
              keyframes: [{ duration: 100, value: 0 }],
            },
          },
        },
        next: {
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 100, value: 1 }],
            },
          },
        },
        compositor: createCompositor(),
      },
    ]);

    expect(animation.prev.tween.alpha.keyframes[0].value).toBe(0);
    expect(animation.next.tween.alpha.keyframes[0].value).toBe(1);
    expect(animation.compositor.tween.uProgress.keyframes[0].value).toBe(1);
  });

  it("allows a mask before the inline compositor", () => {
    const [animation] = normalizeAnimations([
      {
        id: "masked-grade",
        targetId: "scene",
        type: "transition",
        compositor: createCompositor(),
        mask: {
          kind: "single",
          texture: "mask-diagonal",
        },
      },
    ]);

    expect(animation.mask.texture).toBe("mask-diagonal");
    expect(animation.compositor.type).toBe("shader");
  });

  it("treats time as a read-only deterministic clock", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "bad-time",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              glow: {
                time: {
                  keyframes: [{ duration: 100, value: 1 }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/time is read-only/);
  });

  it.each([
    ["scalar", 0.75],
    ["vec2", [0.1, 0.9]],
    ["vec3", [0.1, 0.5, 0.9]],
    ["vec4", [0.1, 0.3, 0.6, 1]],
    ["mat3", [1, 0, 0, 0, 1, 0, 0, 0, 1]],
    ["mat4", [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
  ])("accepts and clones %s shader tween values", (_name, value) => {
    const inputValue = Array.isArray(value) ? [...value] : value;
    const [animation] = normalizeAnimations([
      {
        id: "shape",
        targetId: "scene",
        type: "update",
        tween: {
          filters: {
            grade: {
              transform: {
                initialValue: inputValue,
                keyframes: [{ duration: 100, value: inputValue }],
              },
            },
          },
        },
      },
    ]);

    const normalized = animation.filterTweens.grade.transform;
    expect(normalized.initialValue).toEqual(value);
    expect(normalized.keyframes[0].value).toEqual(value);
    if (Array.isArray(value)) {
      expect(normalized.initialValue).not.toBe(inputValue);
      expect(normalized.keyframes[0].value).not.toBe(inputValue);
    }
  });

  it.each([
    ["empty array", []],
    ["one component", [1]],
    ["five components", [1, 2, 3, 4, 5]],
    ["non-finite scalar", Number.POSITIVE_INFINITY],
    ["non-finite component", [0, Number.NaN]],
  ])("rejects invalid shader tween shape: %s", (_name, value) => {
    expect(() =>
      normalizeAnimations([
        {
          id: "bad-shape",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              grade: {
                transform: {
                  keyframes: [{ duration: 100, value }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/finite number or a numeric array with length 2, 3, 4, 9, or 16/);
  });

  it("preserves relative vector keyframes", () => {
    const [animation] = normalizeAnimations([
      {
        id: "relative-vector",
        targetId: "scene",
        type: "update",
        tween: {
          filters: {
            grade: {
              tint: {
                initialValue: [0.1, 0.2, 0.3],
                keyframes: [
                  {
                    duration: 100,
                    value: [0.2, -0.1, 0.4],
                    relative: true,
                  },
                ],
              },
            },
          },
        },
      },
    ]);

    expect(animation.filterTweens.grade.tint.keyframes[0]).toEqual({
      duration: 100,
      easing: "linear",
      relative: true,
      value: [0.2, -0.1, 0.4],
    });
  });

  it("rejects an empty filter target map", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "empty-filters",
          targetId: "scene",
          type: "update",
          tween: { filters: {} },
        },
      ]),
    ).toThrow(/filters must target at least one filter/);
  });

  it("rejects an empty filter id", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "empty-filter-id",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              "": {
                amount: {
                  keyframes: [{ duration: 100, value: 1 }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/filter id must be a non-empty string/);
  });

  it.each(["Amount", "edge-width", "_amount"])(
    "rejects invalid shader parameter key %s",
    (parameter) => {
      expect(() =>
        normalizeAnimations([
          {
            id: "bad-parameter",
            targetId: "scene",
            type: "update",
            tween: {
              filters: {
                grade: {
                  [parameter]: {
                    keyframes: [{ duration: 100, value: 1 }],
                  },
                },
              },
            },
          },
        ]),
      ).toThrow(/must be progress or match/);
    },
  );

  it("allows the same parameter on different filter ids and targets", () => {
    const normalized = normalizeAnimations([
      {
        id: "scene-grade",
        targetId: "scene",
        type: "update",
        tween: {
          filters: {
            grade: {
              amount: {
                keyframes: [{ duration: 100, value: 1 }],
              },
            },
            glow: {
              amount: {
                keyframes: [{ duration: 100, value: 0.5 }],
              },
            },
          },
        },
      },
      {
        id: "title-grade",
        targetId: "title",
        type: "update",
        tween: {
          filters: {
            grade: {
              amount: {
                keyframes: [{ duration: 100, value: 0.25 }],
              },
            },
          },
        },
      },
    ]);

    expect(normalized).toHaveLength(2);
  });

  it("allows separate animations to target different parameters on one filter", () => {
    const normalized = normalizeAnimations([
      {
        id: "grade-amount",
        targetId: "scene",
        type: "update",
        tween: {
          filters: {
            grade: {
              amount: {
                keyframes: [{ duration: 100, value: 1 }],
              },
            },
          },
        },
      },
      {
        id: "grade-tint",
        targetId: "scene",
        type: "update",
        tween: {
          filters: {
            grade: {
              tint: {
                keyframes: [{ duration: 100, value: [1, 0, 0] }],
              },
            },
          },
        },
      },
    ]);

    expect(normalized).toHaveLength(2);
  });

  it("reports authored progress for duplicate progress channels", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "progress-a",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              grade: {
                progress: {
                  keyframes: [{ duration: 100, value: 1 }],
                },
              },
            },
          },
        },
        {
          id: "progress-b",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              grade: {
                progress: {
                  keyframes: [{ duration: 100, value: 0 }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/cannot both animate parameter "progress"/);
  });

  it.each(["time", "uTime"])("rejects read-only shader clock key %s", (key) => {
    expect(() =>
      normalizeAnimations([
        {
          id: "clock",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              grade: {
                [key]: {
                  keyframes: [{ duration: 100, value: 1 }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/read-only/);
  });

  it("rejects shader progress at the ordinary tween level", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "top-progress",
          targetId: "scene",
          type: "update",
          tween: {
            uProgress: {
              keyframes: [{ duration: 100, value: 1 }],
            },
          },
        },
      ]),
    ).toThrow(/uProgress is not a supported animation property/);
  });

  it("rejects a top-level transition tween", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "legacy-transition-progress",
          targetId: "scene",
          type: "transition",
          tween: progressTween,
          compositor: createCompositor(),
        },
      ]),
    ).toThrow(/tween is not valid for transition animations/);
  });

  it("rejects authored compositor uProgress", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "legacy-compositor-progress",
          targetId: "scene",
          type: "transition",
          compositor: createCompositor({
            tween: {
              uProgress: {
                keyframes: [{ duration: 100, value: 1 }],
              },
            },
          }),
        },
      ]),
    ).toThrow(/Use .*compositor\.tween\.progress/);
  });

  it("normalizes vector and relative compositor parameter tracks", () => {
    const [animation] = normalizeAnimations([
      {
        id: "vector-compositor",
        targetId: "scene",
        type: "transition",
        compositor: createCompositor({
          parameters: {
            tint: [0.2, 0.3, 0.4],
          },
          tween: {
            ...progressTween,
            tint: {
              keyframes: [
                {
                  duration: 100,
                  value: [0.1, 0.2, 0.3],
                  relative: true,
                },
              ],
            },
          },
        }),
      },
    ]);

    expect(animation.compositor.tween.tint.keyframes[0]).toEqual({
      duration: 100,
      easing: "linear",
      relative: true,
      value: [0.1, 0.2, 0.3],
    });
  });

  it("rejects auto timelines for shader parameters", () => {
    expect(() =>
      normalizeAnimations([
        {
          id: "shader-auto",
          targetId: "scene",
          type: "update",
          tween: {
            filters: {
              grade: {
                amount: {
                  auto: { duration: 100 },
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/keyframes must be a non-empty array/);
  });
});
