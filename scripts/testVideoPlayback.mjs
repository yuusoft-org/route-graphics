import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { getRendererBrowserLaunchOptions } from "../src/cli/browserLaunch.js";

const bundle = await readFile(
  process.env.ROUTE_GRAPHICS_TEST_BUNDLE ??
    new URL("../dist/RouteGraphics.js", import.meta.url),
);
const video = await readFile(
  new URL("../vt/static/public/video_sample.mp4", import.meta.url),
);
const server = http.createServer((request, response) => {
  if (request.url === "/bundle.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(bundle);
  } else if (request.url === "/video.mp4") {
    response.setHeader("Content-Type", "video/mp4");
    response.end(video);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><body style='margin:0'></body>");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  getRendererBrowserLaunchOptions(process.env.ROUTE_GRAPHICS_TEST_BROWSER),
);
try {
  for (const source of ["url", "buffer"]) {
    const page = await browser.newPage({
      viewport: { width: 320, height: 180 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (/GL_INVALID|WebGL.*INVALID/.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    // Hold URL media until the sprite is mounted to exercise a real 1x1 texture.
    let releaseVideo;
    const videoReady = new Promise((resolve) => {
      releaseVideo = resolve;
    });
    if (source === "url") {
      await page.route("**/video.mp4", async (route) => {
        await videoReady;
        await route.fulfill({ body: video, contentType: "video/mp4" });
      });
    }
    const initial = await page.evaluate(async (source) => {
      const m = await import("/bundle.js");
      const app = m.default();
      await app.init({
        width: 320,
        height: 180,
        rendererPreference: "webgl",
        rendererFallback: false,
        plugins: { elements: [m.videoPlugin] },
      });
      document.body.append(app.canvas);
      const asset = { source, type: "video/mp4" };
      if (source === "url") asset.url = "/video.mp4";
      else asset.buffer = await (await fetch("/video.mp4")).arrayBuffer();
      await app.loadAssets({ clip: asset });
      app.render({
        elements: [
          {
            id: "clip",
            type: "video",
            src: "clip",
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            volume: 0,
            loop: true,
          },
        ],
      });
      const sprite = app.findElementByLabel("clip");
      window.playbackTest = {
        app,
        sprite,
        video: sprite.texture.source.resource,
      };
      return {
        textureWidth: sprite.texture.source.width,
        videoWidth: sprite.texture.source.resource.videoWidth,
      };
    }, source);
    releaseVideo();
    if (source === "url")
      assert.deepEqual(initial, { textureWidth: 1, videoWidth: 0 });
    await page.waitForFunction(
      () => window.playbackTest.video.currentTime > 0.5,
    );
    const expectedPixels = await page.evaluate(() => {
      const { video } = window.playbackTest;
      video.pause();
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      context.drawImage(video, 0, 0, 320, 180);
      return Array.from(context.getImageData(0, 0, 320, 180).data);
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const first = PNG.sync.read(await page.locator("canvas").screenshot());
    let expectedLitPixels = 0;
    let actualLitPixels = 0;
    let difference = 0;
    for (let i = 0; i < expectedPixels.length; i += 4) {
      if (expectedPixels[i] > 30) expectedLitPixels += 1;
      if (first.data[i] > 30) actualLitPixels += 1;
      for (let channel = 0; channel < 3; channel += 1) {
        difference += Math.abs(
          expectedPixels[i + channel] - first.data[i + channel],
        );
      }
    }
    assert.ok(
      expectedLitPixels > 200,
      "The decoded fixture must have visible content",
    );
    assert.ok(
      actualLitPixels > expectedLitPixels * 0.8,
      `${source}: missing video pixels or stale sprite geometry`,
    );
    assert.ok(
      difference / (320 * 180 * 3) < 8,
      `${source}: rendered video differs from the decoded frame`,
    );
    const before = await page.evaluate(() => {
      const { video } = window.playbackTest;
      video.pause();
      return video.currentTime;
    });
    await page.evaluate(() => window.playbackTest.video.play());
    await page.waitForFunction(
      (before) => window.playbackTest.video.currentTime > before + 0.25,
      before,
    );
    const state = await page.evaluate(() => {
      const { app, sprite, video } = window.playbackTest;
      const result = {
        width: sprite.width,
        height: sprite.height,
        videoWidth: video.videoWidth,
        textureWidth: sprite.texture.source.width,
      };
      app.destroy();
      return result;
    });
    assert.equal(state.width, 320);
    assert.equal(state.height, 180);
    assert.equal(state.textureWidth, state.videoWidth);
    assert.deepEqual(errors, [], `${source}: browser rendering errors`);
    console.log(
      `PASS ${source}: cold video renders across the full frame and resumes playback`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
