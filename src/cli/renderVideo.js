import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import { chromium } from "playwright";

import { getRendererBrowserLaunchOptions } from "./browserLaunch.js";
import { parseStateSelection } from "./stateSelection.js";

const debugVideoRender = (...args) => {
  if (process.env.ROUTE_GRAPHICS_RENDER_VIDEO_DEBUG === "1") {
    console.error("[render-video]", ...args);
  }
};

const isUnsupportedMediaError = (error) =>
  /DEMUXER_ERROR_NO_SUPPORTED_STREAMS|MEDIA_ERR_SRC_NOT_SUPPORTED|no supported streams/i.test(
    error?.message ?? "",
  );

const getPlaywrightCacheDir = () => {
  const configuredPath = process.env.PLAYWRIGHT_BROWSERS_PATH;

  if (configuredPath && configuredPath !== "0") {
    return configuredPath;
  }

  return path.join(os.homedir(), ".cache", "ms-playwright");
};

const findCachedChromiumExecutables = async () => {
  const cacheDir = getPlaywrightCacheDir();
  let entries;

  try {
    entries = await fsPromises.readdir(cacheDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const match = /^chromium-(\d+)$/.exec(entry.name);
    if (!match) {
      continue;
    }

    const revision = Number.parseInt(match[1], 10);
    for (const executableRelativePath of [
      "chrome-linux64/chrome",
      "chrome-linux/chrome",
    ]) {
      const executablePath = path.join(
        cacheDir,
        entry.name,
        executableRelativePath,
      );

      try {
        await fsPromises.access(executablePath, fs.constants.X_OK);
      } catch {
        continue;
      }

      candidates.push({
        executablePath,
        revision,
      });
    }
  }

  return candidates
    .sort((left, right) => right.revision - left.revision)
    .map((candidate) => candidate.executablePath);
};

const createWriteStreamChunkBinding = async (page, outputPath) => {
  const stream = fs.createWriteStream(outputPath);

  await page.exposeBinding(
    "__routeGraphicsWriteVideoChunk",
    async (_source, base64) => {
      const buffer = Buffer.from(base64, "base64");
      await new Promise((resolve, reject) => {
        stream.write(buffer, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  );

  return () =>
    new Promise((resolve, reject) => {
      stream.end((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
};

const captureVideoWebm = async ({
  origin,
  width,
  height,
  backgroundColor,
  states,
  stateIndexes,
  browserAssets,
  fps,
  holdMS,
  initialHoldMS,
  finalHoldMS,
  maxStateDurationMS,
  browserExecutablePath,
  webmPath,
}) => {
  debugVideoRender("launch browser");
  const browser = await chromium.launch(
    getRendererBrowserLaunchOptions(browserExecutablePath),
  );

  try {
    debugVideoRender("new page", `${width}x${height}`);
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
    page.on("console", (message) => {
      if (process.env.ROUTE_GRAPHICS_RENDER_VIDEO_DEBUG === "1") {
        console.error("[render-video:page]", message.type(), message.text());
      }
    });

    debugVideoRender("goto", origin);
    await page.goto(origin, {
      waitUntil: "domcontentloaded",
    });

    debugVideoRender("open chunk stream", webmPath);
    const closeChunkStream = await createWriteStreamChunkBinding(
      page,
      webmPath,
    );

    let chunkStreamClosed = false;
    const closeChunksOnce = async () => {
      if (chunkStreamClosed) {
        return;
      }
      chunkStreamClosed = true;
      await closeChunkStream();
    };

    try {
      debugVideoRender("evaluate capture script");
      const result = await page.evaluate(
        async ({ moduleUrl, renderPayload }) => {
          const debug = (...args) => {
            if (renderPayload.debug) {
              console.debug("[capture]", ...args);
            }
          };

          const sleep = (ms) =>
            new Promise((resolve) => {
              window.setTimeout(resolve, Math.max(0, ms));
            });

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

          const bytesToBase64 = (bytes) => {
            let binary = "";
            const chunkSize = 0x8000;
            for (let index = 0; index < bytes.length; index += chunkSize) {
              binary += String.fromCharCode(
                ...bytes.subarray(index, index + chunkSize),
              );
            }
            return btoa(binary);
          };

          const getRecorderMimeType = () => {
            const candidates = [
              "video/webm;codecs=vp9",
              "video/webm;codecs=vp8",
              "video/webm",
            ];

            return candidates.find((candidate) =>
              MediaRecorder.isTypeSupported(candidate),
            );
          };

          if (typeof MediaRecorder === "undefined") {
            throw new Error("MediaRecorder is not available in this browser.");
          }

          const recorderMimeType = getRecorderMimeType();
          if (!recorderMimeType) {
            throw new Error(
              "No supported WebM MediaRecorder codec is available.",
            );
          }

          const routeGraphicsModule = await import(moduleUrl);
          debug("module imported");
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
          const pendingRenderWaiters = [];

          const createRenderCompleteWaiter = (stateId) =>
            new Promise((resolve, reject) => {
              let waiter;
              const timeoutId = window.setTimeout(() => {
                const waiterIndex = pendingRenderWaiters.findIndex(
                  (candidate) => candidate === waiter,
                );
                if (waiterIndex >= 0) {
                  pendingRenderWaiters.splice(waiterIndex, 1);
                }
                reject(
                  new Error(
                    `Timed out waiting for renderComplete for state "${stateId}".`,
                  ),
                );
              }, renderPayload.maxStateDurationMS);

              waiter = {
                stateId,
                resolve: (payload) => {
                  window.clearTimeout(timeoutId);
                  resolve(payload);
                },
                reject: (error) => {
                  window.clearTimeout(timeoutId);
                  reject(error);
                },
              };
              pendingRenderWaiters.push(waiter);
            });

          try {
            debug("app init start");
            await app.init({
              width: renderPayload.width,
              height: renderPayload.height,
              backgroundColor: renderPayload.backgroundColor,
              animationPlaybackMode: "auto",
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
                if (eventName !== "renderComplete") {
                  return;
                }

                const waiterIndex = pendingRenderWaiters.findIndex(
                  (waiter) =>
                    (payload?.failed === true || payload?.aborted !== true) &&
                    (waiter.stateId === payload?.id ||
                      waiter.stateId === undefined),
                );

                if (waiterIndex < 0) {
                  return;
                }

                const [waiter] = pendingRenderWaiters.splice(waiterIndex, 1);
                if (payload?.failed) {
                  waiter.reject(payload.error ?? new Error("Render failed."));
                } else {
                  waiter.resolve(payload);
                }
              },
              debug: false,
            });
            debug("app init complete");

            if (Object.keys(renderPayload.assets).length > 0) {
              debug("asset load start", Object.keys(renderPayload.assets));
              await assetBufferManager.load(renderPayload.assets);
              debug("asset buffer load complete");
              await app.loadAssets(assetBufferManager.getBufferMap());
              debug("app asset load complete");
            }

            document.body.replaceChildren(app.canvas);
            await nextFrame(2);
            debug("canvas mounted");

            const stream = app.canvas.captureStream(renderPayload.fps);
            debug("capture stream created", stream.getTracks().length);
            const recorder = new MediaRecorder(stream, {
              mimeType: recorderMimeType,
            });
            const chunkWrites = [];
            const stopped = new Promise((resolve, reject) => {
              recorder.addEventListener("stop", resolve, { once: true });
              recorder.addEventListener("error", (event) => {
                reject(event.error ?? new Error("MediaRecorder failed."));
              });
            });

            recorder.addEventListener("dataavailable", (event) => {
              if (!event.data || event.data.size === 0) {
                return;
              }
              debug("dataavailable", event.data.size);

              chunkWrites.push(
                (async () => {
                  const buffer = await event.data.arrayBuffer();
                  const base64 = bytesToBase64(new Uint8Array(buffer));
                  await window.__routeGraphicsWriteVideoChunk(base64);
                })(),
              );
            });

            recorder.start(250);
            debug("recorder started");

            try {
              for (
                let renderIndex = 0;
                renderIndex < renderPayload.stateIndexes.length;
                renderIndex += 1
              ) {
                const stateIndex = renderPayload.stateIndexes[renderIndex];
                const state = renderPayload.states[stateIndex];
                const waitForComplete = createRenderCompleteWaiter(state.id);
                void waitForComplete.catch(() => {});

                debug("render state start", state.id);
                app.render(state);
                app.render(state);
                await waitForComplete;
                debug("render state complete", state.id);

                const isFinal =
                  renderIndex === renderPayload.stateIndexes.length - 1;
                const hold = isFinal
                  ? renderPayload.finalHoldMS
                  : renderIndex === 0
                    ? renderPayload.initialHoldMS
                    : renderPayload.holdMS;

                if (hold > 0) {
                  debug("hold start", hold);
                  await sleep(hold);
                  debug("hold complete", hold);
                }
              }

              await nextFrame(2);
              debug("post-render frames complete");
            } finally {
              if (recorder.state !== "inactive") {
                debug("recorder stop requested");
                recorder.stop();
              }
              await stopped;
              debug("recorder stopped");
              await Promise.all(chunkWrites);
              debug("chunk writes complete");
              stream.getTracks().forEach((track) => {
                track.stop();
              });
            }

            return {
              mimeType: recorderMimeType,
            };
          } finally {
            pendingRenderWaiters.splice(0).forEach((waiter) => {
              waiter.reject(
                new Error("Render session ended before completion."),
              );
            });
            app.destroy();
          }
        },
        {
          moduleUrl: `${origin}/dist/RouteGraphics.js`,
          renderPayload: {
            width,
            height,
            backgroundColor,
            states,
            stateIndexes,
            assets: browserAssets,
            fps,
            holdMS,
            initialHoldMS,
            finalHoldMS,
            maxStateDurationMS,
            debug: process.env.ROUTE_GRAPHICS_RENDER_VIDEO_DEBUG === "1",
          },
        },
      );

      debugVideoRender("evaluate complete");
      await closeChunksOnce();
      debugVideoRender("chunk stream closed");

      if (pageErrors.length > 0) {
        throw new Error(pageErrors.join("\n"));
      }

      return result;
    } catch (error) {
      await closeChunksOnce();
      throw error;
    }
  } finally {
    await browser.close();
  }
};

const runProcess = async (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");

      if (code !== 0) {
        reject(
          new Error(
            `${command} exited with code ${code}.\n${stderrText || stdoutText}`,
          ),
        );
        return;
      }

      resolve({ stdout: stdoutText, stderr: stderrText });
    });
  });

const transcodeWebmToMp4 = async ({ ffmpegPath, inputPath, outputPath }) => {
  await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
  await runProcess(ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
};

const captureVideoWebmWithBrowserFallback = async (options) => {
  try {
    return await captureVideoWebm(options);
  } catch (error) {
    if (options.browserExecutablePath || !isUnsupportedMediaError(error)) {
      throw error;
    }

    const fallbackExecutables = await findCachedChromiumExecutables();
    const errors = [error];

    for (const executablePath of fallbackExecutables) {
      debugVideoRender("retry with cached chromium", executablePath);

      try {
        return await captureVideoWebm({
          ...options,
          browserExecutablePath: executablePath,
        });
      } catch (fallbackError) {
        errors.push(fallbackError);

        if (!isUnsupportedMediaError(fallbackError)) {
          throw fallbackError;
        }
      }
    }

    const lastError = errors.at(-1) ?? error;
    throw new Error(
      `${lastError.message}\nThe selected Chromium build cannot decode at least one input video stream. Install or select a codec-capable Chrome/Chromium with --browser-executable.`,
    );
  }
};

export const renderMp4 = async ({
  cliOptions,
  definition,
  inputPath,
  outputPath,
  origin,
  browserAssets,
  width,
  height,
  backgroundColor,
}) => {
  const stateIndexes = parseStateSelection(
    cliOptions.stateSelection,
    definition.states.length,
  );
  const tempDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "route-graphics-video-"),
  );
  const webmPath = path.join(tempDir, "capture.webm");
  const ffmpegPath = cliOptions.ffmpegPath ?? "ffmpeg";

  try {
    const renderStartedAt = performance.now();
    debugVideoRender("capture webm start", webmPath);
    const captureInfo = await captureVideoWebmWithBrowserFallback({
      origin,
      width,
      height,
      backgroundColor,
      states: definition.states,
      stateIndexes,
      browserAssets,
      fps: cliOptions.fps ?? 30,
      holdMS: cliOptions.holdMS ?? 0,
      initialHoldMS: cliOptions.initialHoldMS ?? cliOptions.holdMS ?? 0,
      finalHoldMS: cliOptions.finalHoldMS ?? 1000,
      maxStateDurationMS:
        cliOptions.maxStateDurationMS ?? cliOptions.timeoutMS ?? 15000,
      browserExecutablePath: cliOptions.browserExecutablePath,
      webmPath,
    });
    const renderDurationMS = performance.now() - renderStartedAt;
    debugVideoRender(
      "capture webm complete",
      `${Math.round(renderDurationMS)}ms`,
    );

    const writeStartedAt = performance.now();
    debugVideoRender("transcode start", outputPath);
    await transcodeWebmToMp4({
      ffmpegPath,
      inputPath: webmPath,
      outputPath,
    });
    const writeDurationMS = performance.now() - writeStartedAt;
    debugVideoRender("transcode complete", `${Math.round(writeDurationMS)}ms`);

    return {
      inputPath,
      outputPath,
      renderDurationMS,
      writeDurationMS,
      captureMimeType: captureInfo.mimeType,
      stateCount: stateIndexes.length,
    };
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
};
