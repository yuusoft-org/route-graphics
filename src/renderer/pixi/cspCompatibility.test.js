import { describe, expect, it } from "vitest";
import { GlUboSystem, GpuUboSystem, UniformGroup } from "pixi.js";
import "./cspCompatibility.js";

describe("CSP uniform buffer uploads", () => {
  it.each([
    ["WebGL", GlUboSystem],
    ["WebGPU", GpuUboSystem],
  ])(
    "retains earlier groups when %s writes at a nonzero offset",
    (_backend, System) => {
      const system = new System();
      const uniforms = new UniformGroup({
        uFrame: {
          value: new Float32Array([240, 160, 640, 320]),
          type: "vec4<f32>",
        },
        uTime: { value: 0.6, type: "f32" },
      });
      const data = new Float32Array(64).fill(123);
      system.syncUniformGroup(uniforms, data, 32);
      expect(data.subarray(0, 32)).toEqual(new Float32Array(32).fill(123));
      expect(data.subarray(32, 36)).toEqual(
        new Float32Array([240, 160, 640, 320]),
      );
      expect(data[36]).toBeCloseTo(0.6);
      system.destroy();
    },
  );
});
