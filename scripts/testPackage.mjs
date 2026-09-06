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
const portableState: RouteGraphicsState = {
  elements: state.elements,
  animations: [{ id: "portable-update", targetId: "box", type: "update", gsap: {
    profile: "portable-v1",
    defaults: { duration: 100, easing: "linear", overwrite: "error" },
    targets: { boxes: { elements: ["box"] } },
    steps: [{ kind: "sequence", repeat: 1, yoyo: true, steps: [
      { kind: "set", targets: "boxes", values: { alpha: 0 } },
      { kind: "to", targets: ["boxes"], values: { x: { by: 10 }, alpha: 1 }, duration: 100, stagger: { each: 10 } },
      { kind: "emit", event: "ready", payload: { visible: true } },
    ] }],
  } }],
};
app.render(portableState);
app.render({ animations: [{ id: "portable-inline", targetId: "box", type: "update", gsap: {
  profile: "portable-v1", steps: [{ kind: "to", duration: 100, values: { x: 20 } }],
} }] });
createModularRouteGraphics().render({ animations: [{ id: "portable-transition", targetId: "box", type: "transition", gsap: {
  profile: "portable-v1", targets: { incoming: { transitionSurface: "next" } },
  steps: [{ kind: "fromTo", targets: "incoming", duration: 100, from: { alpha: 0 }, to: { alpha: 1 } }],
} }] });
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
// @ts-expect-error Only the portable profile is supported.
app.render({animations: [{id: "bad-profile", targetId: "box", type: "update", gsap: {profile: "native", steps: []}}]});
// @ts-expect-error Portable durations are numeric milliseconds.
app.render({animations: [{id: "bad-duration", targetId: "box", type: "update", gsap: {profile: "portable-v1", steps: [{kind: "to", values: {x: 10}, duration: "100"}]}}]});
// @ts-expect-error Portable values cannot contain callbacks.
app.render({animations: [{id: "bad-value", targetId: "box", type: "update", gsap: {profile: "portable-v1", steps: [{kind: "to", values: {x: () => 10}, duration: 100}]}}]});
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
