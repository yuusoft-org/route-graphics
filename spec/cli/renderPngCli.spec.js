// @vitest-environment node

import { execFile, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const specDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(specDir, "..", "..");
const cliPath = path.join(projectRoot, "bin", "route-graphics-render.js");
const routeGraphicsCliPath = path.join(projectRoot, "bin", "route-graphics.js");
const aliasFixturePath = path.join(
  projectRoot,
  "examples",
  "benchmark-alias.yaml",
);
const videoFixtureDir = path.join(specDir, "fixtures", "render-video");
const videoSequenceFixturePath = path.join(videoFixtureDir, "sequence.yaml");
const expectedVideoFirstFramePath = path.join(
  videoFixtureDir,
  "expected-first-frame.png",
);
const expectedVideoFinalFramePath = path.join(
  videoFixtureDir,
  "expected-final-frame.png",
);
const hasExecutable = (name) =>
  spawnSync(name, ["-version"], { stdio: "ignore" }).status === 0;
const hasVideoToolchain = hasExecutable("ffmpeg") && hasExecutable("ffprobe");
const browserArgs = process.env.ROUTE_GRAPHICS_TEST_BROWSER
  ? ["--browser-executable", process.env.ROUTE_GRAPHICS_TEST_BROWSER]
  : [];

const readPixel = (png, x, y) => {
  const offset = (png.width * y + x) * 4;

  return png.data.slice(offset, offset + 4);
};

const toHex = (buffer) => {
  return createHash("sha256").update(buffer).digest("hex");
};

const expectPixelNear = (actual, expected, tolerance = 8) => {
  expected.forEach((channel, index) => {
    expect(Math.abs(actual[index] - channel)).toBeLessThanOrEqual(tolerance);
  });
};

const expectPngCloseToFixture = async ({
  actualPath,
  expectedPath,
  maxChannelDelta = 32,
}) => {
  const actual = PNG.sync.read(await fs.readFile(actualPath));
  const expected = PNG.sync.read(await fs.readFile(expectedPath));

  expect(actual.width).toBe(expected.width);
  expect(actual.height).toBe(expected.height);

  let largestDelta = 0;
  for (let offset = 0; offset < actual.data.length; offset += 4) {
    for (let channel = 0; channel < 4; channel += 1) {
      largestDelta = Math.max(
        largestDelta,
        Math.abs(
          actual.data[offset + channel] - expected.data[offset + channel],
        ),
      );
    }
  }

  expect(largestDelta).toBeLessThanOrEqual(maxChannelDelta);
};

const runCliRender = async ({ inputPath, outputPath, args = [] }) => {
  return await execFileAsync(
    process.execPath,
    [cliPath, inputPath, "-o", outputPath, ...browserArgs, ...args],
    {
      cwd: projectRoot,
      env: process.env,
    },
  );
};

const runRouteGraphicsRender = async ({ inputPath, outputPath, args = [] }) => {
  return await execFileAsync(
    process.execPath,
    [
      routeGraphicsCliPath,
      "render",
      inputPath,
      "-o",
      outputPath,
      ...browserArgs,
      ...args,
    ],
    {
      cwd: projectRoot,
      env: process.env,
    },
  );
};

describe("route-graphics-render CLI", () => {
  beforeAll(async () => {
    await execFileAsync("bun", ["run", "build"], {
      cwd: projectRoot,
      env: process.env,
    });
  }, 30_000);

  it("renders a valid PNG from asset aliases", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rtgl-cli-test-"));
    const aliasOutputPath = path.join(tempDir, "alias.png");
    const aliasRun = await runCliRender({
      inputPath: aliasFixturePath,
      outputPath: aliasOutputPath,
    });

    expect(aliasRun.stdout).toContain(`Wrote ${aliasOutputPath}`);
    expect(aliasRun.stdout).toMatch(
      /Timing: render=\d+(?:\.\d+)?(?:ms|s), write=\d+(?:\.\d+)?(?:ms|s), total=\d+(?:\.\d+)?(?:ms|s)/,
    );

    const aliasPngBuffer = await fs.readFile(aliasOutputPath);

    expect(aliasPngBuffer.length).toBeGreaterThan(50_000);
    const aliasPng = PNG.sync.read(aliasPngBuffer);

    expect(aliasPng.width).toBe(1280);
    expect(aliasPng.height).toBe(720);

    expect(Buffer.from(readPixel(aliasPng, 10, 10))).toEqual(
      Buffer.from([0x11, 0x15, 0x1c, 0xff]),
    );
    expect(Buffer.from(readPixel(aliasPng, 780, 480))).toEqual(
      Buffer.from([0x1a, 0x23, 0x30, 0xff]),
    );

    expect(toHex(aliasPngBuffer)).toMatch(/^[0-9a-f]{64}$/);

    const spriteCenterPixel = Buffer.from(readPixel(aliasPng, 108, 192));
    expect(
      spriteCenterPixel.equals(Buffer.from([0x11, 0x15, 0x1c, 0xff])),
    ).toBe(false);
  }, 30_000);

  it("rejects direct file references inside render state", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rtgl-cli-test-"));
    const invalidInputPath = path.join(
      tempDir,
      `invalid-direct-${randomUUID()}.yaml`,
    );
    const outputPath = path.join(tempDir, "invalid.png");

    await fs.writeFile(
      invalidInputPath,
      `
width: 1280
height: 720
elements:
  - id: avatar
    type: sprite
    x: 80
    y: 80
    width: 128
    height: 128
    src: ./assets/hero.png
`,
    );

    let failure;
    try {
      await runCliRender({
        inputPath: invalidInputPath,
        outputPath,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(failure.stderr).toContain(
      "Direct asset references are not supported.",
    );
  });

  it("captures serializable layout beside an unchanged PNG", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "rtgl-layout-cli-"),
    );
    try {
      const outputPath = path.join(tempDir, "with-report.png");
      const ordinaryPath = path.join(tempDir, "ordinary.png");
      const layoutPath = path.join(tempDir, "layout.json");
      await runCliRender({
        inputPath: aliasFixturePath,
        outputPath,
        args: ["--layout-report", layoutPath],
      });
      await runCliRender({
        inputPath: aliasFixturePath,
        outputPath: ordinaryPath,
      });
      const layout = JSON.parse(await fs.readFile(layoutPath, "utf8"));
      expect(layout.schema).toBe("route-graphics-layout-report-v1");
      expect(layout.viewport).toEqual({
        width: 1280,
        height: 720,
        resolution: 1,
      });
      expect(
        layout.elements.some((element) => element.textRuns.length > 0),
      ).toBe(true);
      expect(toHex(await fs.readFile(outputPath))).toBe(
        toHex(await fs.readFile(ordinaryPath)),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects missing or conflicting layout report paths before capture", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "rtgl-layout-cli-"),
    );
    try {
      const outputPath = path.join(tempDir, "capture.png");
      const before = await fs.readFile(aliasFixturePath);
      for (const args of [
        ["--layout-report"],
        ["--layout-report", outputPath],
        ["--layout-report", aliasFixturePath],
      ]) {
        await expect(
          runCliRender({ inputPath: aliasFixturePath, outputPath, args }),
        ).rejects.toThrow();
      }
      expect(await fs.readFile(aliasFixturePath)).toEqual(before);
      await expect(fs.access(outputPath)).rejects.toThrow();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("renders the selected state without validating unused broken states", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rtgl-cli-test-"));
    const validInputPath = path.join(
      tempDir,
      `selected-state-${randomUUID()}.yaml`,
    );
    const outputPath = path.join(tempDir, "selected-state.png");
    const heroPath = path.join(
      projectRoot,
      "playground",
      "static",
      "public",
      "circle-blue.png",
    );

    await fs.writeFile(
      validInputPath,
      `
width: 256
height: 256
assets:
  hero: ${JSON.stringify(heroPath)}
states:
  - id: valid
    elements:
      - id: avatar
        type: sprite
        x: 32
        y: 32
        width: 128
        height: 128
        src: hero
  - id: broken
    elements:
      - id: missing
        type: sprite
        x: 32
        y: 32
        width: 128
        height: 128
        src: missing-asset
`,
    );

    const run = await runCliRender({
      inputPath: validInputPath,
      outputPath,
      args: ["--state", "0"],
    });

    expect(run.stdout).toContain(`Wrote ${outputPath}`);

    const pngBuffer = await fs.readFile(outputPath);
    const png = PNG.sync.read(pngBuffer);

    expect(png.width).toBe(256);
    expect(png.height).toBe(256);
  }, 30_000);
});

describe("route-graphics render CLI", () => {
  beforeAll(async () => {
    await execFileAsync("bun", ["run", "build"], {
      cwd: projectRoot,
      env: process.env,
    });
  }, 30_000);

  it("loads the CLI from the published package contents", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rtgl-pack-test-"));
    await execFileAsync(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", tempDir],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          npm_config_cache: path.join(tempDir, "npm-cache"),
        },
      },
    );
    const filename = (await fs.readdir(tempDir)).find((name) =>
      name.endsWith(".tgz"),
    );
    expect(filename).toBeDefined();
    const packageRoot = path.join(tempDir, "package");

    await execFileAsync(
      "tar",
      ["-xzf", path.join(tempDir, filename), "-C", tempDir],
      { env: process.env },
    );
    await fs.symlink(
      path.join(projectRoot, "node_modules"),
      path.join(packageRoot, "node_modules"),
      "dir",
    );

    await execFileAsync(
      process.execPath,
      [path.join(packageRoot, "bin", "route-graphics.js"), "--help"],
      {
        cwd: packageRoot,
        env: process.env,
      },
    );

    await expect(
      fs.stat(path.join(packageRoot, "dist", "cli", "routeGraphicsCli.js")),
    ).resolves.toBeDefined();
  }, 30_000);

  it("renders PNG output using the package CLI entrypoint", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rtgl-cli-test-"));
    const outputPath = path.join(tempDir, "hello.png");

    const run = await runRouteGraphicsRender({
      inputPath: path.join(projectRoot, "examples", "hello.yaml"),
      outputPath,
      args: ["--width", "320", "--height", "180"],
    });

    expect(run.stdout).toContain(`Wrote ${outputPath}`);

    const pngBuffer = await fs.readFile(outputPath);
    const png = PNG.sync.read(pngBuffer);

    expect(png.width).toBe(320);
    expect(png.height).toBe(180);
  }, 30_000);

  it.skipIf(!hasVideoToolchain)(
    "renders MP4 output matching checked-in frame fixtures",
    async () => {
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "rtgl-cli-test-"),
      );
      const outputPath = path.join(tempDir, "sequence.mp4");

      const run = await runRouteGraphicsRender({
        inputPath: videoSequenceFixturePath,
        outputPath,
        args: [
          "--states",
          "0-1",
          "--fps",
          "10",
          "--initial-hold",
          "200",
          "--final-hold",
          "400",
          "--max-state-duration",
          "3000",
        ],
      });

      expect(run.stdout).toContain(`Wrote ${outputPath}`);
      expect(run.stdout).toContain("Video: states=2");

      const mp4Buffer = await fs.readFile(outputPath);
      expect(mp4Buffer.length).toBeGreaterThan(1000);

      const probe = await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height,codec_name",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          outputPath,
        ],
        {
          cwd: projectRoot,
          env: process.env,
        },
      );
      const metadata = JSON.parse(probe.stdout);

      expect(metadata.streams[0]).toMatchObject({
        width: 160,
        height: 90,
        codec_name: "h264",
      });
      expect(Number(metadata.format.duration)).toBeGreaterThan(0.4);

      const firstFramePath = path.join(tempDir, "first-frame.png");
      const finalFramePath = path.join(tempDir, "final-frame.png");

      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-v",
          "error",
          "-ss",
          "0.10",
          "-i",
          outputPath,
          "-frames:v",
          "1",
          "-update",
          "1",
          firstFramePath,
        ],
        {
          cwd: projectRoot,
          env: process.env,
        },
      );
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-v",
          "error",
          "-ss",
          "0.55",
          "-i",
          outputPath,
          "-frames:v",
          "1",
          "-update",
          "1",
          finalFramePath,
        ],
        {
          cwd: projectRoot,
          env: process.env,
        },
      );

      const firstFrame = PNG.sync.read(await fs.readFile(firstFramePath));
      const finalFrame = PNG.sync.read(await fs.readFile(finalFramePath));

      await expectPngCloseToFixture({
        actualPath: firstFramePath,
        expectedPath: expectedVideoFirstFramePath,
      });
      await expectPngCloseToFixture({
        actualPath: finalFramePath,
        expectedPath: expectedVideoFinalFramePath,
      });

      expectPixelNear(
        Array.from(readPixel(firstFrame, 80, 45)),
        [0xff, 0x00, 0x00, 0xff],
      );
      expectPixelNear(
        Array.from(readPixel(finalFrame, 80, 45)),
        [0x00, 0xff, 0x00, 0xff],
      );
      expectPixelNear(
        Array.from(readPixel(finalFrame, 5, 5)),
        [0x10, 0x18, 0x20, 0xff],
        12,
      );
    },
    60_000,
  );
});
