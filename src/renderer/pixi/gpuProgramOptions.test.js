import { describe, expect, it } from "vitest";
import { GpuProgram } from "pixi.js";
import { createGpuProgramOptions } from "./gpuProgramOptions.js";

describe("WGSL vertex attribute reflection", () => {
  it.each(["", ",", "\n"])(
    "retains the final vertex input with separator %j",
    (separator) => {
      const source = `
        @vertex
        fn mainVertex(@location(0) aPosition: vec2<f32>${separator}) -> @builtin(position) vec4<f32> {
          return vec4<f32>(aPosition, 0.0, 1.0);
        }
        @fragment
        fn mainFragment() -> @location(0) vec4<f32> {
          return vec4<f32>(1.0);
        }
      `;
      const program = GpuProgram.from(createGpuProgramOptions(source));
      expect(program.attributeData.aPosition).toMatchObject({
        location: 0,
        format: "float32x2",
        stride: 8,
      });
    },
  );
});
