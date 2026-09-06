import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";

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
  assert.deepEqual(
    [...files].filter((file) => file.startsWith("dist/")).sort(),
    ["dist/RouteGraphics.js", "dist/cli/routeGraphicsCli.js"],
    "Package should contain only the standalone browser bundle and built CLI",
  );
  assert(
    ![...files].some((file) => file.startsWith("src/")),
    "Package should use its built CLI",
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
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(manifest.main, "dist/RouteGraphics.js");
  assert.equal(manifest.bin["route-graphics"], "./bin/route-graphics.js");
  const require = createRequire(path.join(consumer, "consumer.js"));
  assert.equal(
    require.resolve("route-graphics"),
    path.join(packageRoot, manifest.main),
  );
  for (const entry of ["route-graphics.js", "route-graphics-render.js"]) {
    const result = await exec(
      process.execPath,
      [path.join(packageRoot, "bin", entry), "--help"],
      { cwd: consumer },
    );
    assert.match(result.stdout, /--layout-report/);
  }
  console.log(
    `Package smoke test passed: ${packed.files.length} files, browser bundle resolution and both CLI entries.`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
