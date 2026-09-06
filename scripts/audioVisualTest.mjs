import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { chromium } from "playwright";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const AVT_DIRECTORY = path.join(ROOT_DIRECTORY, "avt");
const SPEC_DIRECTORY = path.join(AVT_DIRECTORY, "specs");
const REFERENCE_DIRECTORY = path.join(AVT_DIRECTORY, "references");
const OUTPUT_DIRECTORY = path.join(AVT_DIRECTORY, "output");
const BUNDLE_PATH = path.join(ROOT_DIRECTORY, "dist", "RouteGraphics.js");
const RUNNER_PATH = path.join(AVT_DIRECTORY, "runner.js");
const VALID_MODES = new Set(["test", "generate", "report"]);
const mode = process.argv[2] ?? "test";

if (!VALID_MODES.has(mode)) {
  throw new Error(
    `Unknown AVT mode "${mode}". Expected test, generate, or report.`,
  );
}

const parseRepeatCount = () => {
  const value = Number.parseInt(process.env.RTGL_AVT_REPEATS ?? "2", 10);
  if (!Number.isInteger(value) || value < 2) {
    throw new Error("RTGL_AVT_REPEATS must be an integer of at least 2.");
  }
  return value;
};

const repeatCount = parseRepeatCount();
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const snapshotJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const loadSpecs = async () => {
  const filenames = (await readdir(SPEC_DIRECTORY))
    .filter((filename) => filename.endsWith(".yaml"))
    .sort();
  if (filenames.length === 0) {
    throw new Error("No AVT specs were found.");
  }

  return await Promise.all(
    filenames.map(async (filename) => {
      const name = path.basename(filename, ".yaml");
      const spec = yaml.load(
        await readFile(path.join(SPEC_DIRECTORY, filename), "utf8"),
      );
      if (!spec || typeof spec !== "object") {
        throw new Error(`AVT spec "${filename}" must contain an object.`);
      }
      return { filename, name, spec };
    }),
  );
};

const findStaleReferencePaths = async (specs) => {
  const specNames = new Set(specs.map(({ name }) => name));
  let filenames;
  try {
    filenames = await readdir(REFERENCE_DIRECTORY);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return filenames
    .filter((filename) => [".json", ".wav"].includes(path.extname(filename)))
    .filter(
      (filename) =>
        !specNames.has(path.basename(filename, path.extname(filename))),
    )
    .map((filename) => path.join(REFERENCE_DIRECTORY, filename));
};

const createReferenceSnapshot = ({ wav, events, metadata }) => {
  const { pendingTaskCount: _pendingTaskCount, ...stableMetadata } = metadata;
  return {
    version: 1,
    wavSha256: sha256(wav),
    metadata: stableMetadata,
    events,
  };
};

const readReference = async (name) => {
  const wavPath = path.join(REFERENCE_DIRECTORY, `${name}.wav`);
  const jsonPath = path.join(REFERENCE_DIRECTORY, `${name}.json`);
  try {
    return {
      wav: await readFile(wavPath),
      snapshot: JSON.parse(await readFile(jsonPath, "utf8")),
      wavPath,
      jsonPath,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
};

const createPageHarness = async ({ browser, bundle, runner }) => {
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  let activeSpec;
  let consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.stack ?? error.message);
  });
  await page.route("http://route-graphics-avt.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      const serializedSpec = JSON.stringify(activeSpec).replaceAll(
        "<",
        "\\u003c",
      );
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: [
          "<!doctype html><meta charset=utf-8>",
          `<script>globalThis.__RTGL_AVT_SPEC__=${serializedSpec}</script>`,
          '<script type="module" src="/runner.js"></script>',
        ].join(""),
      });
    }
    if (url.pathname === "/RouteGraphics.js") {
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: bundle,
      });
    }
    if (url.pathname === "/runner.js") {
      return route.fulfill({
        status: 200,
        contentType: "text/javascript",
        body: runner,
      });
    }
    return route.fulfill({ status: 204, body: "" });
  });

  const render = async ({ name, spec, run }) => {
    activeSpec = spec;
    consoleErrors = [];
    await page.goto(
      `http://route-graphics-avt.test/?spec=${encodeURIComponent(name)}&run=${run}`,
    );
    await page.waitForFunction(
      () => globalThis.__RTGL_AVT_RESULT__ !== undefined,
    );
    const result = await page.evaluate(() => globalThis.__RTGL_AVT_RESULT__);
    if (!result.ok) {
      throw new Error(
        `Browser AVT failed for "${name}": ${result.error?.message ?? "unknown error"}\n${result.error?.stack ?? ""}`,
      );
    }
    if (consoleErrors.length > 0) {
      throw new Error(
        `Browser AVT logged errors for "${name}":\n${consoleErrors.join("\n")}`,
      );
    }
    return {
      wav: Buffer.from(result.wavBase64, "base64"),
      events: result.events,
      metadata: result.metadata,
    };
  };

  return { page, render };
};

const writeWavAndSnapshot = async (basename, render) => {
  await writeFile(path.join(OUTPUT_DIRECTORY, `${basename}.wav`), render.wav);
  await writeFile(
    path.join(OUTPUT_DIRECTORY, `${basename}.json`),
    snapshotJson(createReferenceSnapshot(render)),
  );
};

const writeFailureArtifacts = async ({ name, actual, reference, runs }) => {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  if (actual) {
    await writeWavAndSnapshot(`${name}.actual`, actual);
  }
  if (reference) {
    await writeFile(
      path.join(OUTPUT_DIRECTORY, `${name}.expected.wav`),
      reference.wav,
    );
    await writeFile(
      path.join(OUTPUT_DIRECTORY, `${name}.expected.json`),
      snapshotJson(reference.snapshot),
    );
  }
  if (runs.length > 1) {
    await Promise.all(
      runs.map((render, index) =>
        writeWavAndSnapshot(`${name}.run-${index + 1}`, render),
      ),
    );
  }
};

const createReportHtml = (results, mediaByName) => {
  const encodedAudio = {};
  const registerAudio = (key, wav) => {
    if (!wav) return null;
    encodedAudio[key] = wav.toString("base64");
    return key;
  };
  const rows = results
    .map((result) => {
      const status = result.ok ? "PASS" : "FAIL";
      const media = mediaByName.get(result.name) ?? {};
      const actualKey = registerAudio(`${result.name}:actual`, media.actual);
      const expectedKey = result.ok
        ? null
        : registerAudio(`${result.name}:expected`, media.expected);
      const audioPanel = (title, key) =>
        key
          ? `<div><h3>${title}</h3><audio controls data-audio="${escapeHtml(key)}"></audio><canvas class="waveform" data-audio="${escapeHtml(key)}"></canvas><canvas class="spectrogram" data-audio="${escapeHtml(key)}"></canvas></div>`
          : `<div><h3>${title}</h3><p>Audio was not produced.</p></div>`;
      return `
        <section class="result ${result.ok ? "pass" : "fail"}">
          <h2>${escapeHtml(status)} · ${escapeHtml(result.name)}</h2>
          <p>${escapeHtml(result.title ?? "")}</p>
          ${result.message ? `<pre>${escapeHtml(result.message)}</pre>` : ""}
          <div class="audios">
            ${audioPanel(result.ok ? "Reference / actual" : "Actual", actualKey)}
            ${expectedKey ? audioPanel("Expected", expectedKey) : ""}
          </div>
        </section>`;
    })
    .join("\n");

  return `<!doctype html>
<meta charset="utf-8">
<title>Route Graphics AVT Report</title>
<style>
  :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #090909; color: #eee; }
  body { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .result { border: 1px solid #444; border-left-width: 6px; padding: 16px; margin: 16px 0; background: #111; }
  .pass { border-left-color: #4caf50; } .fail { border-left-color: #f44336; }
  .audios { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
  audio, canvas { display: block; width: 100%; margin: 8px 0; }
  canvas { height: 140px; background: #000; }
  pre { overflow: auto; white-space: pre-wrap; color: #ffb4ab; }
</style>
<h1>Route Graphics deterministic audio report</h1>
<p>${results.filter((result) => result.ok).length}/${results.length} specs passed exact byte and event comparison.</p>
${rows}
<script>
const encodedAudio = ${JSON.stringify(encodedAudio).replaceAll("<", "\\u003c")};
const audioUrls = new Map(Object.entries(encodedAudio).map(([key, base64]) => {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return [key, URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))];
}));
const cache = new Map();
const loadAudio = async (key) => {
  if (!cache.has(key)) cache.set(key, (async () => {
    const context = new AudioContext();
    const data = await (await fetch(audioUrls.get(key))).arrayBuffer();
    const buffer = await context.decodeAudioData(data);
    await context.close();
    return buffer;
  })());
  return cache.get(key);
};
const drawWaveform = async (canvas) => {
  const buffer = await loadAudio(canvas.dataset.audio);
  const samples = buffer.getChannelData(0); const width = 900; const height = 140;
  canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#fff'; ctx.beginPath();
  const stride = Math.max(1, Math.floor(samples.length / width));
  for (let x = 0; x < width; x++) { let peak = 0; for (let i = 0; i < stride; i++) peak = Math.max(peak, Math.abs(samples[x * stride + i] || 0)); const y = peak * height / 2; ctx.moveTo(x, height / 2 - y); ctx.lineTo(x, height / 2 + y); }
  ctx.stroke();
};
const drawSpectrogram = async (canvas) => {
  const buffer = await loadAudio(canvas.dataset.audio); const samples = buffer.getChannelData(0);
  const width = 240; const height = 128; const windowSize = 256; canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); const image = ctx.createImageData(width, height);
  for (let x = 0; x < width; x++) { const start = Math.floor(x * Math.max(0, samples.length - windowSize) / Math.max(1, width - 1)); for (let bin = 0; bin < height; bin++) { let re = 0; let im = 0; for (let n = 0; n < windowSize; n++) { const value = (samples[start + n] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * n / (windowSize - 1))); const phase = 2 * Math.PI * bin * n / windowSize; re += value * Math.cos(phase); im -= value * Math.sin(phase); } const magnitude = Math.min(255, Math.max(0, 55 * Math.log10(1 + Math.hypot(re, im)))); const y = height - 1 - bin; const offset = (y * width + x) * 4; image.data[offset] = magnitude; image.data[offset + 1] = magnitude; image.data[offset + 2] = magnitude; image.data[offset + 3] = 255; } }
  ctx.putImageData(image, 0, 0);
};
const renderAudioVisualizations = async () => {
  document.querySelectorAll('audio[data-audio]').forEach((audio) => { audio.src = audioUrls.get(audio.dataset.audio); });
  await Promise.all([
    ...Array.from(document.querySelectorAll('.waveform'), drawWaveform),
    ...Array.from(document.querySelectorAll('.spectrogram'), drawSpectrogram),
  ]);
  document.documentElement.dataset.audioReportState = 'ready';
};
renderAudioVisualizations().catch((error) => {
  document.documentElement.dataset.audioReportState = 'failed';
  document.documentElement.dataset.audioReportError = error.stack || error.message;
  console.error(error);
});
</script>`;
};

const validateReportHtml = async (page, html) => {
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.documentElement.dataset.audioReportState !== undefined,
  );
  const validation = await page.evaluate(() => ({
    state: document.documentElement.dataset.audioReportState,
    error: document.documentElement.dataset.audioReportError,
    audioCount: document.querySelectorAll("audio[src]").length,
    declaredAudioCount: document.querySelectorAll("audio[data-audio]").length,
    renderedCanvasCount: [...document.querySelectorAll("canvas")].filter(
      (canvas) => canvas.width > 0 && canvas.height > 0,
    ).length,
    canvasCount: document.querySelectorAll("canvas").length,
  }));
  if (
    validation.state !== "ready" ||
    validation.audioCount !== validation.declaredAudioCount ||
    validation.renderedCanvasCount !== validation.canvasCount
  ) {
    throw new Error(
      `Generated AVT report failed browser validation: ${JSON.stringify(validation)}.`,
    );
  }
};

const writeReport = async ({ html, mode, repeatCount, results }) => {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await writeFile(path.join(OUTPUT_DIRECTORY, "report.html"), html);
  await writeFile(
    path.join(OUTPUT_DIRECTORY, "report.json"),
    snapshotJson({ mode, repeatCount, results }),
  );
};

const main = async () => {
  await access(BUNDLE_PATH);
  const [specs, bundle, runner] = await Promise.all([
    loadSpecs(),
    readFile(BUNDLE_PATH, "utf8"),
    readFile(RUNNER_PATH, "utf8"),
  ]);
  const staleReferencePaths = await findStaleReferencePaths(specs);
  if (mode !== "generate" && staleReferencePaths.length > 0) {
    throw new Error(
      `Stale AVT references have no matching spec: ${staleReferencePaths
        .map((filename) => path.basename(filename))
        .join(", ")}.`,
    );
  }
  await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
  if (mode === "generate") {
    await mkdir(REFERENCE_DIRECTORY, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.ROUTE_GRAPHICS_TEST_BROWSER
      ? { executablePath: process.env.ROUTE_GRAPHICS_TEST_BROWSER }
      : {}),
  });
  const harness = await createPageHarness({ browser, bundle, runner });
  const results = [];
  const mediaByName = new Map();

  try {
    for (const entry of specs) {
      let actual;
      let reference;
      const runs = [];
      try {
        for (let run = 0; run < repeatCount; run++) {
          runs.push(await harness.render({ ...entry, run }));
        }
        actual = runs[0];
        mediaByName.set(entry.name, { actual: actual.wav });
        const deterministicSnapshot = snapshotJson(
          createReferenceSnapshot(actual),
        );
        for (const candidate of runs.slice(1)) {
          if (
            !actual.wav.equals(candidate.wav) ||
            deterministicSnapshot !==
              snapshotJson(createReferenceSnapshot(candidate))
          ) {
            const hashes = runs.map((render) => sha256(render.wav)).join(", ");
            throw new Error(
              `Non-deterministic output across ${repeatCount} independent renders: ${hashes}.`,
            );
          }
        }

        if (mode === "generate") {
          await writeFile(
            path.join(REFERENCE_DIRECTORY, `${entry.name}.wav`),
            actual.wav,
          );
          await writeFile(
            path.join(REFERENCE_DIRECTORY, `${entry.name}.json`),
            deterministicSnapshot,
          );
          results.push({
            ok: true,
            name: entry.name,
            title: entry.spec.title,
            message: `Generated ${sha256(actual.wav)}`,
          });
          console.log(`GENERATED ${entry.name} ${sha256(actual.wav)}`);
          continue;
        }

        reference = await readReference(entry.name);
        if (!reference) {
          throw new Error("Missing WAV or JSON reference artifact.");
        }
        mediaByName.get(entry.name).expected = reference.wav;
        const actualSnapshot = createReferenceSnapshot(actual);
        if (!actual.wav.equals(reference.wav)) {
          throw new Error(
            `PCM mismatch: expected ${sha256(reference.wav)}, received ${sha256(actual.wav)}.`,
          );
        }
        if (snapshotJson(actualSnapshot) !== snapshotJson(reference.snapshot)) {
          throw new Error("Public event or metadata snapshot mismatch.");
        }

        results.push({
          ok: true,
          name: entry.name,
          title: entry.spec.title,
        });
        console.log(`PASS ${entry.name} ${sha256(actual.wav)}`);
      } catch (error) {
        reference ??= await readReference(entry.name);
        const media = mediaByName.get(entry.name) ?? {};
        media.expected = reference?.wav;
        mediaByName.set(entry.name, media);
        await writeFailureArtifacts({
          name: entry.name,
          actual,
          reference,
          runs,
        });
        results.push({
          ok: false,
          name: entry.name,
          title: entry.spec.title,
          message: error.stack ?? error.message,
        });
        console.error(`FAIL ${entry.name}\n${error.stack ?? error.message}`);
      }
    }

    if (mode === "report" || results.some((result) => !result.ok)) {
      const reportHtml = createReportHtml(results, mediaByName);
      await writeReport({ html: reportHtml, mode, repeatCount, results });
      await validateReportHtml(harness.page, reportHtml);
    }
  } finally {
    await harness.page.close();
    await browser.close();
  }

  const failureCount = results.filter((result) => !result.ok).length;
  if (mode === "generate" && failureCount === 0) {
    await Promise.all(
      staleReferencePaths.map((filename) => rm(filename, { force: true })),
    );
  }
  console.log(
    `${results.length - failureCount}/${results.length} deterministic audio specs passed.`,
  );
  if (failureCount > 0) process.exitCode = 1;
};

await main();
