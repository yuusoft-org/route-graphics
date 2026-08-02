import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { loadAll } from "js-yaml";
import { PNG } from "pngjs";

const repositoryRoot = process.cwd();
const routeGraphicsBundle = await readFile(
  path.join(repositoryRoot, "dist/RouteGraphics.js"),
);
const publicAssetRoot = path.join(repositoryRoot, "vt/static/public");

const loadStates = async (relativePath) => {
  const source = await readFile(
    path.join(repositoryRoot, relativePath),
    "utf8",
  );
  const documents = [];
  loadAll(source, (document) => {
    if (document) documents.push(document);
  });
  const spec = Object.assign({}, ...documents);
  assert.ok(
    Array.isArray(spec.states) && spec.states.length >= 2,
    `${relativePath} must define at least two states`,
  );
  return spec.states;
};

const multipleMaskStates = await loadStates(
  "vt/specs/shadertransition/rect-mask-multipass-animated-compositor.yaml",
);
multipleMaskStates[1].animations[0].mask.push({
  kind: "single",
  texture: "mask-diagonal",
  channel: "red",
  invert: true,
  delay: 200,
  softness: 0.06,
  progress: {
    initialValue: 0,
    keyframes: [{ duration: 600, value: 1, easing: "linear" }],
  },
});

const cases = {
  timedUpdate: {
    states: await loadStates(
      "vt/specs/shaderfilters/rect-shader-filter-time-update-completion.yaml",
    ),
    sampleTime: 600,
    expected: "green",
  },
  multipassFilter: {
    states: await loadStates(
      "vt/specs/shaderfilters/shader-filter-multipass-parameter-tween.yaml",
    ),
    sampleTime: 300,
  },
  texturedMeshCompositor: {
    states: await loadStates(
      "vt/specs/shadertransition/sprite-compositor-texture-mesh.yaml",
    ),
    sampleTime: 500,
  },
  maskedMultipassCompositor: {
    states: await loadStates(
      "vt/specs/shadertransition/rect-mask-multipass-animated-compositor.yaml",
    ),
    sampleTime: 400,
  },
  multipleMasks: {
    states: multipleMaskStates,
    sampleTime: 400,
  },
};

const serializeForInlineScript = (value) =>
  JSON.stringify(value).replaceAll("</script", "<\\/script");

const fixtureHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html, body { margin: 0; background: #000; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <script type="module">
      import createRouteGraphics, {
        rectPlugin,
        spritePlugin,
        tweenPlugin,
      } from "/RouteGraphics.js";

      const cases = ${serializeForInlineScript(cases)};
      const gpuErrors = [];

      const waitForPresentedFrame = async () => {
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        await new Promise((resolve) => setTimeout(resolve, 32));
      };

      const assertGpuHealthy = (errorCountBefore) => {
        if (gpuErrors.length > errorCountBefore) {
          throw new Error(gpuErrors.at(-1));
        }
      };

      const prepareCase = async (app, name) => {
        const testCase = cases[name];
        if (!testCase) throw new Error("Unknown WebGPU case: " + name);
        const [initialState] = testCase.states;
        const errorCountBefore = gpuErrors.length;
        app.setAnimationTime(0);
        app.render({
          ...initialState,
          id: "webgpu-" + name + "-initial",
        });
        await waitForPresentedFrame();
        assertGpuHealthy(errorCountBefore);
      };

      const sampleCase = async (app, name) => {
        const testCase = cases[name];
        if (!testCase) throw new Error("Unknown WebGPU case: " + name);
        const [, nextState] = testCase.states;
        const errorCountBefore = gpuErrors.length;
        app.setAnimationTime(0);
        app.render({
          ...nextState,
          id: "webgpu-" + name + "-next",
        });
        app.setAnimationTime(testCase.sampleTime);
        await waitForPresentedFrame();
        assertGpuHealthy(errorCountBefore);

        const targetId = nextState.elements?.[0]?.id;
        const target = targetId ? app.findElementByLabel(targetId) : null;
        const filterTimes = (target?.filters ?? [])
          .map(
            (filter) =>
              filter?.resources?.shaderUniforms?.uniforms?.uTime,
          )
          .filter((value) => value !== undefined);
        return { filterTimes };
      };

      const cleanupCase = async (app, name) => {
        app.render({
          id: "webgpu-" + name + "-cleanup",
          elements: [],
          animations: [],
        });
        await waitForPresentedFrame();
      };

      const run = async () => {
        if (!navigator.gpu) {
          throw new Error("navigator.gpu is unavailable.");
        }

        const app = createRouteGraphics();
        await app.init({
          width: 1280,
          height: 720,
          backgroundColor: "#000000",
          eventHandler: (eventName, payload) => {
            if (eventName === "rendererContextLost") {
              gpuErrors.push(
                "WebGPU device lost: " +
                  (payload?.statusMessage ??
                    payload?.reason ??
                    "unknown reason"),
              );
            }
          },
          plugins: {
            elements: [rectPlugin, spritePlugin],
            animations: [tweenPlugin],
          },
          animationPlaybackMode: "manual",
          rendererPreference: "webgpu",
          rendererFallback: false,
        });
        document.body.appendChild(app.canvas);

        try {
          if (app.rendererType !== "webgpu") {
            throw new Error(
              'Expected rendererType "webgpu", received "' +
                app.rendererType +
                '".',
            );
          }

          await app.loadAssets({
            "mask-diagonal": {
              url: "/public/mask_diagonal.png",
              type: "image/png",
              source: "url",
            },
            "sprite-mask-asym-outgoing": {
              url: "/public/sprite-mask-asym-outgoing.png",
              type: "image/png",
              source: "url",
            },
            "sprite-mask-asym-incoming": {
              url: "/public/sprite-mask-asym-incoming.png",
              type: "image/png",
              source: "url",
            },
          });

          window.__routeGraphicsWebGPUHarness = {
            prepareCase: (name) => prepareCase(app, name),
            sampleCase: (name) => sampleCase(app, name),
            cleanupCase: (name) => cleanupCase(app, name),
            getGpuErrors: () => [...gpuErrors],
            destroy: () => {
              app.destroy();
            },
          };

          return {
            rendererType: app.rendererType,
            caseNames: Object.keys(cases),
          };
        } catch (error) {
          app.destroy();
          throw error;
        }
      };

      window.__routeGraphicsWebGPUTest = run().then(
        (result) => ({ status: "passed", result }),
        (error) => ({
          status: "failed",
          error: error?.stack ?? error?.message ?? String(error),
          gpuErrors,
        }),
      );
    </script>
  </body>
</html>`;

const contentTypes = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
]);

const analyzeScreenshot = (buffer) => {
  const image = PNG.sync.read(buffer);
  const centerOffset =
    (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) *
    4;
  const center = Array.from(
    image.data.subarray(centerOffset, centerOffset + 4),
  );
  const mean = [0, 0, 0, 0];
  let samples = 0;
  for (let index = 0; index < image.data.length; index += 4 * 64) {
    mean[0] += image.data[index];
    mean[1] += image.data[index + 1];
    mean[2] += image.data[index + 2];
    mean[3] += image.data[index + 3];
    samples++;
  }
  return {
    center,
    mean: mean.map((value) => Math.round(value / samples)),
    byteLength: buffer.length,
  };
};

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml);
    return;
  }
  if (requestUrl.pathname === "/RouteGraphics.js") {
    response.writeHead(200, {
      "content-type": contentTypes.get(".js"),
      "cache-control": "no-store",
    });
    response.end(routeGraphicsBundle);
    return;
  }
  if (requestUrl.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (requestUrl.pathname.startsWith("/public/")) {
    const filename = path.basename(requestUrl.pathname);
    const assetPath = path.join(publicAssetRoot, filename);
    void readFile(assetPath).then(
      (asset) => {
        response.writeHead(200, {
          "content-type":
            contentTypes.get(path.extname(filename)) ??
            "application/octet-stream",
        });
        response.end(asset);
      },
      () => {
        response.writeHead(404);
        response.end("Not found");
      },
    );
    return;
  }
  response.writeHead(404);
  response.end("Not found");
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
const browserErrors = [];
const browserExecutablePath = process.env.ROUTE_GRAPHICS_WEBGPU_EXECUTABLE_PATH;
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
    args: [
      "--no-sandbox",
      "--headless=new",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--disable-vulkan-surface",
      "--enable-unsafe-webgpu",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.goto(origin, { waitUntil: "load" });
  const outcome = await page.evaluate(() => window.__routeGraphicsWebGPUTest);
  assert.equal(
    outcome.status,
    "passed",
    outcome.error ?? "WebGPU browser fixture failed",
  );
  assert.equal(outcome.result.rendererType, "webgpu");
  const results = {};
  for (const name of outcome.result.caseNames) {
    await page.evaluate(
      (caseName) => window.__routeGraphicsWebGPUHarness.prepareCase(caseName),
      name,
    );
    const initial = analyzeScreenshot(await page.screenshot());
    const metadata = await page.evaluate(
      (caseName) => window.__routeGraphicsWebGPUHarness.sampleCase(caseName),
      name,
    );
    const sampled = analyzeScreenshot(await page.screenshot());
    results[name] = { initial, sampled, metadata };
    await page.evaluate(
      (caseName) => window.__routeGraphicsWebGPUHarness.cleanupCase(caseName),
      name,
    );

    assert.ok(
      sampled.byteLength > 1000,
      `${name} produced an empty browser screenshot`,
    );
    assert.ok(
      sampled.center[3] > 200,
      `${name} produced a transparent center pixel`,
    );
    const colorDelta = sampled.mean
      .slice(0, 3)
      .reduce(
        (total, value, index) => total + Math.abs(value - initial.mean[index]),
        0,
      );
    assert.ok(colorDelta >= 3, `${name} did not visibly change its output`);
  }

  const gpuErrors = await page.evaluate(() =>
    window.__routeGraphicsWebGPUHarness.getGpuErrors(),
  );
  assert.deepEqual(gpuErrors, []);
  assert.deepEqual(browserErrors, []);

  const timedCenter = results.timedUpdate.sampled.center;
  assert.ok(
    timedCenter[1] > timedCenter[0] + 80 &&
      timedCenter[1] > timedCenter[2] + 80,
    `timed update completion did not retain uTime: ${timedCenter.join(", ")}`,
  );
  assert.ok(
    results.timedUpdate.metadata.filterTimes.some(
      (time) => Math.abs(time - 0.6) < 0.0001,
    ),
    `timed update completion exposed unexpected filter times: ${results.timedUpdate.metadata.filterTimes.join(
      ", ",
    )}`,
  );

  console.log(
    `WebGPU shader integration passed (${Object.keys(cases).length} cases).`,
  );
} finally {
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    await Promise.all(
      pages.map((page) =>
        page
          .evaluate(() => window.__routeGraphicsWebGPUHarness?.destroy?.())
          .catch(() => {}),
      ),
    );
  }
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
