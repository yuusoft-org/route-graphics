#!/usr/bin/env node

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
} from "../src/cli/renderConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const bundlePath = path.join(projectRoot, "dist", "RouteGraphics.js");

const usage = `Usage:
  node ./bin/route-graphics-render.js <input.yaml> -o <output.png> [options]

Options:
  -o, --output <path>              Output PNG path
  --width <pixels>                 Override render width
  --height <pixels>                Override render height
  --state <index>                  State index when YAML contains multiple states
  --time <ms>                      Sample animations at a manual time
  --layout-report <path>           Write a JSON layout snapshot beside the PNG
  --background-color <value>       0xRRGGBB, #RRGGBB, or decimal
  --browser-executable <path>      Use a system Chrome/Chromium executable
  --wait-for-render-complete       Wait for renderComplete before capture
  --timeout <ms>                   Browser-side render timeout (default: 15000)
  -h, --help                       Show this help
`;

const exitWithError = (message, { showUsage = false } = {}) => {
  console.error(message);
  if (showUsage) {
    console.error("");
    console.error(usage);
  }
  process.exit(1);
};

const formatDuration = (durationMS) => {
  if (!Number.isFinite(durationMS)) {
    return "unknown";
  }

  if (durationMS < 1000) {
    return `${Math.round(durationMS)}ms`;
  }

  return `${(durationMS / 1000).toFixed(2)}s`;
};

const parseIntegerOption = (label, value) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an integer.`);
  }
  return parsed;
};

const parseCliArgs = (argv) => {
  const options = {
    waitForRenderComplete: false,
    timeoutMS: 15000,
    stateIndex: 0,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-o":
      case "--output":
        index += 1;
        options.outputPath = argv[index];
        break;
      case "--width":
        index += 1;
        options.width = parseIntegerOption("Width", argv[index]);
        break;
      case "--height":
        index += 1;
        options.height = parseIntegerOption("Height", argv[index]);
        break;
      case "--state":
        index += 1;
        options.stateIndex = parseIntegerOption("State index", argv[index]);
        break;
      case "--time":
        index += 1;
        options.timeMS = parseIntegerOption("Animation time", argv[index]);
        break;
      case "--layout-report":
        index += 1;
        if (!argv[index] || argv[index].startsWith("-")) {
          throw new Error("Layout report requires an output path.");
        }
        options.layoutReportPath = argv[index];
        break;
      case "--background-color":
        index += 1;
        options.backgroundColor = argv[index];
        break;
      case "--browser-executable":
        index += 1;
        options.browserExecutablePath = argv[index];
        break;
      case "--timeout":
        index += 1;
        options.timeoutMS = parseIntegerOption("Timeout", argv[index]);
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

const buildRenderPayload = async ({ cliOptions, definition, inputPath }) => {
  const yamlDir = path.dirname(inputPath);
  const states = definition.states;
  const selectedState = states[cliOptions.stateIndex];

  if (!selectedState) {
    throw new Error(
      `State index ${cliOptions.stateIndex} is out of range for ${states.length} state(s).`,
    );
  }

  return {
    width: cliOptions.width ?? definition.width ?? 1280,
    height: cliOptions.height ?? definition.height ?? 720,
    backgroundColor: parseBackgroundColor(
      cliOptions.backgroundColor ?? definition.backgroundColor,
    ),
    state: selectedState,
    assetDefinitions: collectAssetDefinitions({
      assets: definition.assets,
      states: [selectedState],
      baseDir: yamlDir,
    }),
  };
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
  includeLayoutReport,
}) => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutablePath,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });

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

    const capture = await page.evaluate(
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

          // Pixi copies the framebuffer synchronously, then encodes it
          // asynchronously. Snapshot geometry before yielding to another frame.
          const imagePromise = app.extractBase64();
          const layoutReport = renderPayload.includeLayoutReport
            ? app.getLayoutReport()
            : null;
          return {
            base64: await imagePromise,
            layoutReport,
          };
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
          includeLayoutReport,
        },
      },
    );

    if (pageErrors.length > 0) {
      throw new Error(pageErrors.join("\n"));
    }

    return capture;
  } finally {
    await browser.close();
  }
};

const writePngOutput = async (outputPath, base64Png) => {
  const commaIndex = base64Png.indexOf(",");
  const payload = commaIndex >= 0 ? base64Png.slice(commaIndex + 1) : base64Png;
  const buffer = Buffer.from(payload, "base64");

  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await fsPromises.writeFile(outputPath, buffer);
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

const main = async () => {
  const startedAt = performance.now();
  let cliOptions;

  try {
    cliOptions = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    exitWithError(error.message, { showUsage: true });
  }

  if (cliOptions.help) {
    console.log(usage);
    return;
  }

  if (!cliOptions.inputPath) {
    exitWithError("An input YAML file is required.", { showUsage: true });
  }

  if (!cliOptions.outputPath) {
    exitWithError("An output PNG path is required.", { showUsage: true });
  }

  const inputPath = path.resolve(process.cwd(), cliOptions.inputPath);
  const outputPath = path.resolve(process.cwd(), cliOptions.outputPath);
  const layoutReportPath = cliOptions.layoutReportPath
    ? path.resolve(process.cwd(), cliOptions.layoutReportPath)
    : null;
  if (layoutReportPath === outputPath || layoutReportPath === inputPath) {
    exitWithError("Layout report must not overwrite the input or PNG output.");
  }

  await ensureBundleExists();

  const yamlSource = await fsPromises.readFile(inputPath, "utf8");
  const definition = loadRenderDefinition(yamlSource);
  const renderPayload = await buildRenderPayload({
    cliOptions,
    definition,
    inputPath,
  });

  try {
    const { assetRoutes, browserAssets } = await normalizeBrowserAssets({
      assetDefinitions: renderPayload.assetDefinitions,
    });

    const assetServer = await startAssetServer({ assetRoutes });

    try {
      const renderStartedAt = performance.now();
      const { base64, layoutReport } = await capturePng({
        origin: assetServer.origin,
        width: renderPayload.width,
        height: renderPayload.height,
        backgroundColor: renderPayload.backgroundColor,
        state: renderPayload.state,
        browserAssets,
        timeMS: cliOptions.timeMS,
        waitForRenderComplete: cliOptions.waitForRenderComplete,
        timeoutMS: cliOptions.timeoutMS,
        browserExecutablePath: cliOptions.browserExecutablePath,
        includeLayoutReport: layoutReportPath !== null,
      });
      const renderDurationMS = performance.now() - renderStartedAt;

      const writeStartedAt = performance.now();
      await writePngOutput(outputPath, base64);
      if (layoutReportPath !== null) {
        await fsPromises.mkdir(path.dirname(layoutReportPath), { recursive: true });
        await fsPromises.writeFile(
          layoutReportPath,
          `${JSON.stringify(layoutReport, null, 2)}\n`,
        );
      }
      const writeDurationMS = performance.now() - writeStartedAt;
      const totalDurationMS = performance.now() - startedAt;

      console.log(`Wrote ${outputPath}`);
      console.log(
        `Timing: render=${formatDuration(renderDurationMS)}, write=${formatDuration(writeDurationMS)}, total=${formatDuration(totalDurationMS)}`,
      );
    } finally {
      await assetServer.close();
    }
  } catch (error) {
    if (/Executable doesn't exist|browserType\.launch/i.test(error.message)) {
      exitWithError(
        `${error.message}\nInstall Chromium with \`npx playwright install chromium\` or pass --browser-executable.`,
      );
    }

    exitWithError(error.stack ?? error.message);
  }
};

void main();
