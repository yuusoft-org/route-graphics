import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PIXI_SHADER_MESH_ADAPTER_VERSION } from "./shaderMeshAdapter.js";

const repositoryRoot = process.cwd();
const sourceRoot = path.join(repositoryRoot, "src");
const adapterPath = path.join(sourceRoot, "renderer/pixi/shaderMeshAdapter.js");
const privatePixiShaderMembers = [
  "_filterStack",
  "_filterStackIndex",
  "_filterGlobalUniforms",
  "_globalFilterBindGroup",
  "filter._state",
];

const findProductionJavaScriptFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return findProductionJavaScriptFiles(entryPath);
    }
    if (
      entry.isFile() &&
      entry.name.endsWith(".js") &&
      !entry.name.endsWith(".test.js") &&
      !entry.name.endsWith(".spec.js")
    ) {
      return [entryPath];
    }
    return [];
  });

describe("Pixi shader mesh adapter boundary", () => {
  it("targets the exact Pixi dependency version", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    );

    expect(packageJson.dependencies["pixi.js"]).toBe(
      PIXI_SHADER_MESH_ADAPTER_VERSION,
    );
  });

  it("contains every private Pixi shader access in the adapter", () => {
    const violations = [];

    for (const filePath of findProductionJavaScriptFiles(sourceRoot)) {
      if (filePath === adapterPath) continue;
      const source = readFileSync(filePath, "utf8");
      for (const member of privatePixiShaderMembers) {
        if (source.includes(member)) {
          violations.push(
            `${path.relative(repositoryRoot, filePath)} uses ${member}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
