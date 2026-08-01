import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  collectAssetDefinitions,
  loadRenderDefinition,
  parseBackgroundColor,
} from "./renderConfig.js";
import { getRendererBrowserLaunchOptions } from "./browserLaunch.js";
import { renderMp4 } from "./renderVideo.js";
import { parseStateSelection } from "./stateSelection.js";
import { inspectTimelineFile } from "./inspectTimeline.js";

const cliModuleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(cliModuleDir, "..", "..");
const bundlePath = path.join(projectRoot, "dist", "RouteGraphics.js");

const SUPPORTED_FORMATS = new Set(["png", "mp4"]);
const INSPECT_TIMELINE_OPTIONS = new Set([
  "-h",
  "--help",
  "--state",
  "--animation",
  "--compact",
]);

const usage = `Usage:
  route-graphics render <input.yaml> -o <output> [options]
  route-graphics inspect-timeline <input.yaml> [options]

Options:
  -o, --output <path>              Output path. Supports .png and .mp4
  --format <png|mp4>               Override format inference
  --width <pixels>                 Override render width
  --height <pixels>                Override render height
  --background-color <value>       0xRRGGBB, #RRGGBB, or decimal

PNG options:
  --state <index>                  State index when YAML contains multiple states
  --time <ms>                      Sample animations at a manual time
  --wait-for-render-complete       Wait for renderComplete before capture

MP4 options:
  --states <list>                  State indexes/ranges, default all. Example: 0,2-5
  --fps <number>                   Output frame rate (default: 30)
  --hold <ms>                      Hold after each intermediate state (default: 0)
  --initial-hold <ms>              Hold after the first state before advancing (default: 0)
  --final-hold <ms>                Hold after the final state (default: 1000)
  --max-state-duration <ms>        Timeout per state (default: 15000)

Runtime options:
  --browser-executable <path>      Use a system Chrome/Chromium executable
  --ffmpeg <path>                  ffmpeg path for MP4 output (default: ffmpeg)
  --timeout <ms>                   Browser-side render timeout (default: 15000)
  -h, --help                       Show this help

Timeline inspection options:
  --state <index>                  State index (default: 0)
  --animation <id>                 Inspect one animation id
  --compact                        Emit compact JSON instead of indented JSON
`;

const renderCommandUsage = usage;

const PNG_ONLY_OPTIONS = ["stateIndex", "timeMS", "waitForRenderComplete"];

const MP4_ONLY_OPTIONS = [
  "stateSelection",
  "fps",
  "holdMS",
  "initialHoldMS",
  "finalHoldMS",
  "maxStateDurationMS",
  "ffmpegPath",
];

const toOptionName = (propertyName) =>
  ({
    stateIndex: "--state",
    timeMS: "--time",
    waitForRenderComplete: "--wait-for-render-complete",
    stateSelection: "--states",
    fps: "--fps",
    holdMS: "--hold",
    initialHoldMS: "--initial-hold",
    finalHoldMS: "--final-hold",
    maxStateDurationMS: "--max-state-duration",
    ffmpegPath: "--ffmpeg",
  })[propertyName] ?? propertyName;

const formatDuration = (durationMS) => {
  if (!Number.isFinite(durationMS)) {
    return "unknown";
  }

  if (durationMS < 1000) {
    return `${Math.round(durationMS)}ms`;
  }

  return `${(durationMS / 1000).toFixed(2)}s`;
};

const normalizeFormatName = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value.trim().replace(/^\./, "").toLowerCase();
};

const formatFromExtension = (outputPath) => {
  const extension = path.extname(outputPath).toLowerCase().replace(/^\./, "");

  return SUPPORTED_FORMATS.has(extension) ? extension : undefined;
};

export const resolveOutputFormat = ({ outputPath, format }) => {
  const explicitFormat = normalizeFormatName(format);
  const extensionFormat = formatFromExtension(outputPath ?? "");

  if (explicitFormat && !SUPPORTED_FORMATS.has(explicitFormat)) {
    throw new Error(
      `Unsupported format "${format}". Expected one of: png, mp4.`,
    );
  }

  if (explicitFormat && extensionFormat && explicitFormat !== extensionFormat) {
    throw new Error(
      `Output extension ".${extensionFormat}" does not match --format ${explicitFormat}.`,
    );
  }

  const resolved = explicitFormat ?? extensionFormat;

  if (!resolved) {
    throw new Error(
      "Could not infer output format. Use a .png/.mp4 output path or pass --format.",
    );
  }

  return resolved;
};

export const resolveOutputPath = ({ cwd, outputPath, format }) => {
  const absoluteOutputPath = path.resolve(cwd, outputPath);

  if (path.extname(absoluteOutputPath)) {
    return absoluteOutputPath;
  }

  return `${absoluteOutputPath}.${format}`;
};

const parseIntegerOption = (label, value, { min = undefined } = {}) => {
  if (value === undefined || value === null || String(value).length === 0) {
    throw new Error(`${label} requires a value.`);
  }

  if (!/^-?\d+$/.test(String(value))) {
    throw new Error(`${label} must be an integer.`);
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a safe integer.`);
  }

  if (min !== undefined && parsed < min) {
    throw new Error(`${label} must be at least ${min}.`);
  }

  return parsed;
};

const parseNumberOption = (label, value, { min = undefined } = {}) => {
  if (value === undefined || value === null || String(value).length === 0) {
    throw new Error(`${label} requires a value.`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`);
  }

  if (min !== undefined && parsed < min) {
    throw new Error(`${label} must be at least ${min}.`);
  }

  return parsed;
};

const readOptionValue = (argv, index, optionName) => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
};

export const parseRouteGraphicsCliArgs = (argv) => {
  const options = {
    command: undefined,
    timeoutMS: 15000,
    stateIndex: undefined,
    waitForRenderComplete: false,
    fps: undefined,
    holdMS: undefined,
    initialHoldMS: undefined,
    finalHoldMS: undefined,
    maxStateDurationMS: undefined,
    ffmpegPath: undefined,
  };
  const positionals = [];

  if (argv.length === 0) {
    return {
      ...options,
      help: true,
    };
  }

  const [command, ...rest] = argv;
  options.command = command;

  if (command === "-h" || command === "--help") {
    return {
      ...options,
      command: undefined,
      help: true,
    };
  }

  if (command !== "render" && command !== "inspect-timeline") {
    throw new Error(`Unknown command: ${command}`);
  }

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (
      command === "inspect-timeline" &&
      token.startsWith("-") &&
      !INSPECT_TIMELINE_OPTIONS.has(token)
    ) {
      throw new Error(`${token} is not supported by inspect-timeline.`);
    }

    switch (token) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-o":
      case "--output":
        options.outputPath = readOptionValue(rest, index, token);
        index += 1;
        break;
      case "--format":
        options.format = readOptionValue(rest, index, token);
        index += 1;
        break;
      case "--width":
        options.width = parseIntegerOption(
          "Width",
          readOptionValue(rest, index, token),
          { min: 1 },
        );
        index += 1;
        break;
      case "--height":
        options.height = parseIntegerOption(
          "Height",
          readOptionValue(rest, index, token),
          { min: 1 },
        );
        index += 1;
        break;
      case "--state":
        options.stateIndex = parseIntegerOption(
          "State index",
          readOptionValue(rest, index, token),
          { min: 0 },
        );
        index += 1;
        break;
      case "--animation":
        if (command !== "inspect-timeline") {
          throw new Error("--animation is only supported by inspect-timeline.");
        }
        options.animationId = readOptionValue(rest, index, token);
        index += 1;
        break;
      case "--compact":
        if (command !== "inspect-timeline") {
          throw new Error("--compact is only supported by inspect-timeline.");
        }
        options.compact = true;
        break;
      case "--states":
        options.stateSelection = readOptionValue(rest, index, token);
        index += 1;
        break;
      case "--time":
        options.timeMS = parseIntegerOption(
          "Animation time",
          readOptionValue(rest, index, token),
          { min: 0 },
        );
        index += 1;
        break;
      case "--fps":
        options.fps = parseNumberOption(
          "FPS",
          readOptionValue(rest, index, token),
          {
            min: 1,
          },
        );
        index += 1;
        break;
      case "--hold":
        options.holdMS = parseIntegerOption(
          "Hold",
          readOptionValue(rest, index, token),
          { min: 0 },
        );
        index += 1;
        break;
      case "--initial-hold":
        options.initialHoldMS = parseIntegerOption(
          "Initial hold",
          readOptionValue(rest, index, token),
          { min: 0 },
        );
        index += 1;
        break;
      case "--final-hold":
        options.finalHoldMS = parseIntegerOption(
          "Final hold",
          readOptionValue(rest, index, token),
          { min: 0 },
        );
        index += 1;
        break;
      case "--max-state-duration":
        options.maxStateDurationMS = parseIntegerOption(
          "Max state duration",
          readOptionValue(rest, index, token),
          { min: 1 },
        );
        index += 1;
        break;
      case "--background-color":
        options.backgroundColor = readOptionValue(rest, index, token);
        index += 1;
        break;
      case "--browser-executable":
        options.browserExecutablePath = readOptionValue(rest, index, token);
        index += 1;
        break;
      case "--timeout":
        options.timeoutMS = parseIntegerOption(
          "Timeout",
          readOptionValue(rest, index, token),
          { min: 1 },
        );
        index += 1;
        break;
      case "--ffmpeg":
        options.ffmpegPath = readOptionValue(rest, index, token);
        index += 1;
        break;
      case "--wait-for-render-complete":
        options.waitForRenderComplete = true;
        break;
      default:
        if (token.startsWith("-")) {
          throw new Error(`Unknown option: ${token}`);
        }
        positionals.push(token);
        break;
    }
  }

  if (positionals.length > 1) {
    throw new Error("Only one input YAML file can be provided.");
  }

  return {
    ...options,
    inputPath: positionals[0],
  };
};

const validateOptionsForFormat = (options, format) => {
  if (format === "png") {
    for (const option of MP4_ONLY_OPTIONS) {
      if (options[option] !== undefined) {
        throw new Error(
          `${toOptionName(option)} is only supported for MP4 output.`,
        );
      }
    }
    return;
  }

  for (const option of PNG_ONLY_OPTIONS) {
    if (option === "waitForRenderComplete") {
      if (options[option] === true) {
        throw new Error(
          `${toOptionName(option)} is only supported for PNG output.`,
        );
      }
      continue;
    }

    if (options[option] !== undefined) {
      throw new Error(
        `${toOptionName(option)} is only supported for PNG output.`,
      );
    }
  }
};

const toBrowserPath = (assetId) => {
  return `/__asset/${encodeURIComponent(assetId)}`;
};

const getServedAssetPath = (assetId, assetPath) => {
  const extension = path.extname(assetPath) || "";

  return `${toBrowserPath(assetId)}${extension}`;
};

const createRequestHandler = ({ assetRoutes }) => {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body></body></html>");
      return;
    }

    if (url.pathname === "/dist/RouteGraphics.js") {
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
      });
      fs.createReadStream(bundlePath).pipe(response);
      return;
    }

    if (!url.pathname.startsWith("/__asset/")) {
      response.writeHead(404);
      response.end("Not Found");
      return;
    }

    const assetRecord = assetRoutes.get(url.pathname);

    if (!assetRecord) {
      response.writeHead(404);
      response.end("Unknown asset");
      return;
    }

    const stat = await fsPromises.stat(assetRecord.path);
    const rangeHeader = request.headers.range;
    const headers = {
      "accept-ranges": "bytes",
      "content-type": assetRecord.type,
    };

    if (!rangeHeader) {
      headers["content-length"] = stat.size;
      response.writeHead(200, headers);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(assetRecord.path).pipe(response);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      response.writeHead(416);
      response.end();
      return;
    }

    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;

    headers["content-length"] = end - start + 1;
    headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
    response.writeHead(206, headers);

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(assetRecord.path, { start, end }).pipe(response);
  };
};

const startAssetServer = async ({ assetRoutes }) => {
  const server = http.createServer((request, response) => {
    createRequestHandler({ assetRoutes })(request, response).catch((error) => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.stack ?? error.message);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine local render server address.");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
};

const normalizeBrowserAssets = async ({ assetDefinitions }) => {
  const browserAssets = {};
  const assetRoutes = new Map();

  for (const [key, definition] of Object.entries(assetDefinitions)) {
    if (definition.kind === "remote") {
      browserAssets[key] = {
        type: definition.type,
        url: definition.url,
      };
      continue;
    }

    await fsPromises.access(definition.path, fs.constants.R_OK);
    const servedPath = getServedAssetPath(key, definition.path);

    assetRoutes.set(servedPath, {
      path: definition.path,
      type: definition.type,
    });
    browserAssets[key] = {
      type: definition.type,
      url: servedPath,
    };
  }

  return {
    assetRoutes,
    browserAssets,
  };
};

const ensureBundleExists = async () => {
  try {
    await fsPromises.access(bundlePath, fs.constants.R_OK);
  } catch {
    throw new Error(
      "dist/RouteGraphics.js is missing. Run `bun run build` before using the renderer CLI.",
    );
  }
};

const normalizeRenderSettings = ({ cliOptions, definition }) => ({
  width: cliOptions.width ?? definition.width ?? 1280,
  height: cliOptions.height ?? definition.height ?? 720,
  backgroundColor: parseBackgroundColor(
    cliOptions.backgroundColor ?? definition.backgroundColor,
  ),
});

const writePngOutput = async (outputPath, base64Png) => {
  const commaIndex = base64Png.indexOf(",");
  const payload = commaIndex >= 0 ? base64Png.slice(commaIndex + 1) : base64Png;
  const buffer = Buffer.from(payload, "base64");

  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await fsPromises.writeFile(outputPath, buffer);
};

const capturePng = async ({
  origin,
  width,
  height,
  backgroundColor,
  state,
  browserAssets,
  timeMS,
  waitForRenderComplete,
  timeoutMS,
  browserExecutablePath,
}) => {
  const browser = await chromium.launch(
    getRendererBrowserLaunchOptions(browserExecutablePath),
  );

  try {
    const page = await browser.newPage({
      viewport: {
        width,
        height,
      },
    });
    const pageErrors = [];

    page.on("pageerror", (error) => {
      pageErrors.push(error.stack ?? error.message);
    });

    await page.goto(origin, {
      waitUntil: "domcontentloaded",
    });

    const base64 = await page.evaluate(
      async ({ moduleUrl, renderPayload }) => {
        const nextFrame = async (count = 2) => {
          await new Promise((resolve) => {
            let remaining = count;
            const tick = () => {
              if (remaining <= 0) {
                resolve();
                return;
              }
              remaining -= 1;
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        };

        const routeGraphicsModule = await import(moduleUrl);
        const {
          default: createRouteGraphics,
          animatedSpritePlugin,
          containerPlugin,
          createAssetBufferManager,
          inputPlugin,
          particlesPlugin,
          rectPlugin,
          sliderPlugin,
          soundPlugin,
          spritePlugin,
          textPlugin,
          textRevealingPlugin,
          tweenPlugin,
          videoPlugin,
        } = routeGraphicsModule;

        const app = createRouteGraphics();
        const assetBufferManager = createAssetBufferManager();
        let renderCompleteResolve = () => {};
        let renderTimeoutId = null;
        let renderCompletePromise = Promise.resolve(null);

        if (renderPayload.waitForRenderComplete) {
          renderCompletePromise = new Promise((resolve, reject) => {
            renderCompleteResolve = resolve;
            renderTimeoutId = window.setTimeout(() => {
              reject(new Error("Timed out waiting for renderComplete."));
            }, renderPayload.timeoutMS);
          });
        }

        try {
          await app.init({
            width: renderPayload.width,
            height: renderPayload.height,
            backgroundColor: renderPayload.backgroundColor,
            animationPlaybackMode:
              renderPayload.timeMS === null ? "auto" : "manual",
            plugins: {
              elements: [
                textPlugin,
                rectPlugin,
                spritePlugin,
                videoPlugin,
                sliderPlugin,
                inputPlugin,
                containerPlugin,
                textRevealingPlugin,
                animatedSpritePlugin,
                particlesPlugin,
              ].filter(Boolean),
              animations: [tweenPlugin].filter(Boolean),
              audio: [soundPlugin].filter(Boolean),
            },
            eventHandler: (eventName, payload) => {
              if (eventName === "renderComplete" && payload?.aborted !== true) {
                renderCompleteResolve(payload);
              }
            },
            debug: false,
          });

          if (Object.keys(renderPayload.assets).length > 0) {
            await assetBufferManager.load(renderPayload.assets);
            await app.loadAssets(assetBufferManager.getBufferMap());
          }

          document.body.replaceChildren(app.canvas);
          app.render(renderPayload.state);
          app.render(renderPayload.state);

          if (renderPayload.timeMS !== null) {
            app.setAnimationTime(renderPayload.timeMS);
          } else if (renderPayload.waitForRenderComplete) {
            await renderCompletePromise;
          }

          await nextFrame(2);

          try {
            await app.extractBase64();
          } catch {}

          await nextFrame(2);

          return await app.extractBase64();
        } finally {
          if (renderTimeoutId !== null) {
            window.clearTimeout(renderTimeoutId);
          }
          app.destroy();
        }
      },
      {
        moduleUrl: `${origin}/dist/RouteGraphics.js`,
        renderPayload: {
          width,
          height,
          backgroundColor,
          state,
          assets: browserAssets,
          timeMS: timeMS ?? null,
          waitForRenderComplete,
          timeoutMS,
        },
      },
    );

    if (pageErrors.length > 0) {
      throw new Error(pageErrors.join("\n"));
    }

    return base64;
  } finally {
    await browser.close();
  }
};

const renderPng = async ({
  cliOptions,
  definition,
  inputPath,
  outputPath,
  origin,
  browserAssets,
}) => {
  const selectedStateIndex = cliOptions.stateIndex ?? 0;
  const selectedState = definition.states[selectedStateIndex];

  if (!selectedState) {
    throw new Error(
      `State index ${selectedStateIndex} is out of range for ${definition.states.length} state(s).`,
    );
  }

  const settings = normalizeRenderSettings({ cliOptions, definition });
  const renderStartedAt = performance.now();
  const base64 = await capturePng({
    origin,
    width: settings.width,
    height: settings.height,
    backgroundColor: settings.backgroundColor,
    state: selectedState,
    browserAssets,
    timeMS: cliOptions.timeMS,
    waitForRenderComplete: cliOptions.waitForRenderComplete,
    timeoutMS: cliOptions.timeoutMS,
    browserExecutablePath: cliOptions.browserExecutablePath,
  });
  const renderDurationMS = performance.now() - renderStartedAt;

  const writeStartedAt = performance.now();
  await writePngOutput(outputPath, base64);
  const writeDurationMS = performance.now() - writeStartedAt;

  return {
    inputPath,
    outputPath,
    renderDurationMS,
    writeDurationMS,
  };
};

const runRender = async ({ cliOptions, cwd }) => {
  if (!cliOptions.inputPath) {
    throw new Error("An input YAML file is required.");
  }

  if (!cliOptions.outputPath) {
    throw new Error("An output path is required.");
  }

  const format = resolveOutputFormat({
    outputPath: cliOptions.outputPath,
    format: cliOptions.format,
  });
  validateOptionsForFormat(cliOptions, format);

  const inputPath = path.resolve(cwd, cliOptions.inputPath);
  const outputPath = resolveOutputPath({
    cwd,
    outputPath: cliOptions.outputPath,
    format,
  });

  await ensureBundleExists();

  const yamlSource = await fsPromises.readFile(inputPath, "utf8");
  const definition = loadRenderDefinition(yamlSource);
  const settings = normalizeRenderSettings({ cliOptions, definition });
  const yamlDir = path.dirname(inputPath);
  const statesForAssetCollection =
    format === "png"
      ? [definition.states[cliOptions.stateIndex ?? 0]].filter(Boolean)
      : parseStateSelection(
          cliOptions.stateSelection,
          definition.states.length,
        ).map((index) => definition.states[index]);

  const assetDefinitions = collectAssetDefinitions({
    assets: definition.assets,
    states: statesForAssetCollection,
    baseDir: yamlDir,
  });
  const { assetRoutes, browserAssets } = await normalizeBrowserAssets({
    assetDefinitions,
  });
  const assetServer = await startAssetServer({ assetRoutes });

  try {
    if (format === "png") {
      return {
        format,
        ...(await renderPng({
          cliOptions,
          definition,
          inputPath,
          outputPath,
          origin: assetServer.origin,
          browserAssets,
        })),
      };
    }

    return {
      format,
      ...(await renderMp4({
        cliOptions,
        definition,
        inputPath,
        outputPath,
        origin: assetServer.origin,
        browserAssets,
        width: settings.width,
        height: settings.height,
        backgroundColor: settings.backgroundColor,
      })),
    };
  } finally {
    await assetServer.close();
  }
};

export { parseStateSelection };

export const runRouteGraphicsCli = async ({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) => {
  const startedAt = performance.now();
  let cliOptions;

  try {
    cliOptions = parseRouteGraphicsCliArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n\n${usage}\n`);
    return 1;
  }

  if (cliOptions.help) {
    stdout.write(
      `${cliOptions.command === "render" ? renderCommandUsage : usage}\n`,
    );
    return 0;
  }

  try {
    if (cliOptions.command === "inspect-timeline") {
      const inspection = await inspectTimelineFile({
        inputPath: cliOptions.inputPath,
        cwd,
        stateIndex: cliOptions.stateIndex ?? 0,
        animationId: cliOptions.animationId,
      });
      stdout.write(
        `${JSON.stringify(inspection, null, cliOptions.compact ? 0 : 2)}\n`,
      );
      return 0;
    }

    const result = await runRender({ cliOptions, cwd });
    const totalDurationMS = performance.now() - startedAt;

    stdout.write(`Wrote ${result.outputPath}\n`);
    if (result.format === "mp4") {
      stdout.write(
        `Video: states=${result.stateCount}, recorder=${result.captureMimeType}\n`,
      );
    }
    stdout.write(
      `Timing: render=${formatDuration(result.renderDurationMS)}, write=${formatDuration(result.writeDurationMS)}, total=${formatDuration(totalDurationMS)}\n`,
    );
    return 0;
  } catch (error) {
    if (/Executable doesn't exist|browserType\.launch/i.test(error.message)) {
      stderr.write(
        `${error.message}\nInstall Chromium with \`npx playwright install chromium\` or pass --browser-executable.\n`,
      );
      return 1;
    }

    stderr.write(`${error.stack ?? error.message}\n`);
    return 1;
  }
};

export { usage };
