import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "typescript";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(
  path.join(os.tmpdir(), "route-graphics-package-"),
);
try {
  const { stdout } = await exec(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch],
    {
      cwd: root,
      env: {
        ...process.env,
        npm_config_cache: path.join(scratch, "npm-cache"),
      },
    },
  );
  const [packed] = JSON.parse(stdout);
  const files = new Set(packed.files.map((file) => file.path));
  for (const file of [
    "dist/RouteGraphics.js",
    "dist/RouteGraphics.module.js",
    "dist/types/index.d.ts",
    "dist/cli/routeGraphicsCli.js",
  ]) {
    assert(files.has(file), `Missing package file: ${file}`);
  }
  assert(
    ![...files].some((file) => file.startsWith("src/")),
    "Package should use its built CLI and declarations",
  );
  await exec("tar", [
    "-xzf",
    path.join(scratch, packed.filename),
    "-C",
    scratch,
  ]);
  const packageRoot = path.join(scratch, "package");
  await symlink(
    path.join(root, "node_modules"),
    path.join(scratch, "node_modules"),
    "dir",
  );
  const consumer = path.join(scratch, "consumer");
  await mkdir(path.join(consumer, "node_modules"), { recursive: true });
  await symlink(
    packageRoot,
    path.join(consumer, "node_modules", "route-graphics"),
    "dir",
  );
  await writeFile(path.join(consumer, "package.json"), '{"type":"module"}\n');
  const consumerFile = path.join(consumer, "consumer.ts");
  await writeFile(
    consumerFile,
    `
import createRouteGraphics, { rectPlugin, createAssetBufferManager, type RouteGraphicsState } from "route-graphics";
import createModularRouteGraphics from "route-graphics/module";
const app = createRouteGraphics();
await app.init({width: 100, height: 100, plugins: {elements: [rectPlugin]}});
const state: RouteGraphicsState = {elements: [{id: "box", type: "rect", x: 5, width: 10, height: 10, fill: "#fff"}]};
app.render(state);
await app.extractBase64();
app.seekAnimation("move", 10);
createModularRouteGraphics().render(state);
await createAssetBufferManager().load({logo: {url: "logo.png", type: "image/png"}});
// @ts-expect-error Width is numeric.
app.init({width: "100", height: 100});
// @ts-expect-error Common element coordinates are numeric.
app.render({elements: [{id: "box", type: "rect", x: "bad"}]});
// @ts-expect-error Unknown renderer preference.
app.init({width: 100, height: 100, rendererPreference: "canvas"});
`,
  );
  const program = ts.createProgram([consumerFile], {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  });
  // Check our declarations and the consumer strictly. Pixi's installed
  // third-party DOM augmentation has independent TS 5.9 declaration conflicts.
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) =>
        !diagnostic.file ||
        diagnostic.file.fileName.startsWith(packageRoot) ||
        diagnostic.file.fileName === consumerFile,
    );
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => consumer,
      getNewLine: () => "\n",
    }),
  );
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(manifest.types, "./dist/types/index.d.ts");
  for (const entry of ["route-graphics.js", "route-graphics-render.js"]) {
    const result = await exec(
      process.execPath,
      [path.join(packageRoot, "bin", entry), "--help"],
      { cwd: consumer },
    );
    assert.match(result.stdout, /--layout-report/);
  }
  console.log(
    `Package smoke test passed: ${packed.files.length} files, typed consumers and both CLI entries.`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
