import { chromium } from "playwright";
import assert from "node:assert/strict";
import { getRendererBrowserLaunchOptions } from "../src/cli/browserLaunch.js";
import { readFile } from "node:fs/promises";
import http from "node:http";
const bundle = await readFile(
  new URL("../dist/RouteGraphics.js", import.meta.url),
);
const server = http.createServer((req, res) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;",
  );
  res.setHeader(
    "Content-Type",
    req.url.endsWith(".js") ? "text/javascript" : "text/html",
  );
  res.end(req.url.endsWith(".js") ? bundle : "<!doctype html><body></body>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(
  getRendererBrowserLaunchOptions(process.env.ROUTE_GRAPHICS_TEST_BROWSER),
);
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const m = await import("/bundle.js");
    const opts = {
      width: 300,
      height: 150,
      rendererPreference: "webgl",
      rendererFallback: false,
      plugins: {
        elements: [
          m.rectPlugin,
          m.inputPlugin,
          m.containerPlugin,
          m.textPlugin,
        ],
        animations: [m.tweenPlugin],
        audio: [m.soundPlugin],
      },
    };
    const a = m.default();
    await a.init(opts);
    document.body.append(a.canvas);
    a.render({
      elements: [
        {
          id: "form",
          type: "container",
          width: 250,
          height: 80,
          children: [
            {
              id: "name",
              type: "input",
              width: 180,
              height: 40,
              value: "name",
            },
          ],
        },
      ],
    });
    const input = a.findElementByLabel("name");
    const before = document.querySelectorAll("input,textarea").length;
    a.render({ elements: [] });
    const after = document.querySelectorAll("input,textarea").length;
    const result = {
      removeInputContainer: {
        before,
        after,
        pixiInputDestroyed: input?.destroyed,
      },
    };
    a.destroy();
    const b = m.default();
    await b.init(opts);
    document.body.append(b.canvas);
    b.render({
      elements: [
        {
          id: "box",
          type: "rect",
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          fill: "#00ff00",
        },
      ],
    });
    const rect = b.findElementByLabel("box");
    let destroyedEvent = false;
    rect.on("destroyed", () => {
      destroyedEvent = true;
    });
    b.destroy();
    result.destroyApp = { childDestroyed: rect.destroyed, destroyedEvent };
    const c = m.default();
    const box = (x, y = 0) => ({
      id: "box",
      type: "rect",
      x,
      y,
      width: 50,
      height: 50,
      fill: "#00ff00",
    });
    const events = [];
    await c.init({
      ...opts,
      animationPlaybackMode: "manual",
      eventHandler: (name, payload) => {
        if (
          name === "renderComplete" &&
          payload.id === "animated" &&
          !payload.aborted
        ) {
          c.render({ id: "next", elements: [box(200)] });
          events.push({ duringCallbackX: c.findElementByLabel("box").x });
        }
      },
    });
    c.render({ id: "initial", elements: [box(0)] });
    c.render({
      id: "animated",
      elements: [box(100)],
      animations: [
        {
          id: "move",
          type: "update",
          targetId: "box",
          tween: { x: { auto: { duration: 100, easing: "linear" } } },
        },
      ],
    });
    c.setAnimationTime(100);
    result.renderCompleteReentry = {
      events,
      afterCallbackX: c.findElementByLabel("box").x,
    };
    c.destroy();
    const abortedEvents = [];
    const abortedApp = m.default();
    await abortedApp.init({
      ...opts,
      animationPlaybackMode: "manual",
      eventHandler: (name, payload) => {
        if (name !== "renderComplete") return;
        abortedEvents.push(payload);
        if (payload.id === "pending" && payload.aborted) {
          abortedApp.render({ id: "callback", elements: [box(300)] });
        }
      },
    });
    abortedApp.render({ elements: [box(0)] });
    abortedApp.render({
      id: "pending",
      elements: [box(100)],
      animations: [
        {
          id: "pending-move",
          type: "update",
          targetId: "box",
          tween: { x: { auto: { duration: 100 } } },
        },
      ],
    });
    abortedApp.render({ id: "superseded", elements: [box(200)] });
    result.abortedRenderReentry = {
      x: abortedApp.findElementByLabel("box").x,
      aborts: abortedEvents.filter(
        (event) => event.id === "pending" && event.aborted,
      ).length,
      latestCompleted: abortedEvents.some(
        (event) => event.id === "callback" && !event.aborted,
      ),
    };
    abortedApp.destroy();
    const d = m.default();
    await d.init({ ...opts, animationPlaybackMode: "manual" });
    d.render({ elements: [box(0, 0)] });
    d.render({
      elements: [box(100, 200)],
      animations: [
        {
          id: "long-y",
          type: "update",
          targetId: "box",
          tween: { y: { auto: { duration: 200, easing: "linear" } } },
        },
        {
          id: "short-x",
          type: "update",
          targetId: "box",
          tween: { x: { auto: { duration: 100, easing: "linear" } } },
        },
      ],
    });
    result.splitCompletion = [];
    for (const time of [99, 100, 101, 110]) {
      d.setAnimationTime(time);
      const el = d.findElementByLabel("box");
      result.splitCompletion.push({ time, x: el.x, y: el.y });
    }
    d.destroy();
    const e = m.default();
    await e.init({ ...opts, animationPlaybackMode: "manual" });
    e.render({ elements: [box(0, 0)] });
    e.render({
      elements: [box(100, 100)],
      animations: [
        {
          id: "overwrite",
          type: "update",
          targetId: "box",
          gsap: {
            profile: "portable-v1",
            steps: [
              {
                kind: "to",
                values: { x: 100, y: 100 },
                duration: 100,
                easing: "linear",
                overwrite: "all",
              },
            ],
          },
        },
      ],
    });
    e.setAnimationTime(50);
    const overwritten = e.findElementByLabel("box");
    result.overwriteAll = { x: overwritten.x, y: overwritten.y };
    e.destroy();
    const f = m.default();
    await f.init({ ...opts, animationPlaybackMode: "manual" });
    f.render({ elements: [box(0, 0)] });
    f.render({
      elements: [box(20, 0)],
      animations: [
        {
          id: "yoyo",
          type: "update",
          targetId: "box",
          playback: { repeat: 1, yoyo: true },
          gsap: {
            profile: "portable-v1",
            steps: [
              {
                kind: "to",
                values: { x: 10 },
                duration: 100,
                easing: "linear",
              },
              {
                kind: "to",
                values: { x: 20 },
                duration: 100,
                easing: "linear",
              },
            ],
          },
        },
      ],
    });
    f.setAnimationTime(350);
    result.multiStepYoyo = { x: f.findElementByLabel("box").x };
    f.destroy();
    return result;
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(result.removeInputContainer, {
    before: 1,
    after: 0,
    pixiInputDestroyed: true,
  });
  assert.deepEqual(result.destroyApp, {
    childDestroyed: true,
    destroyedEvent: true,
  });
  assert.deepEqual(result.abortedRenderReentry, {
    x: 300,
    aborts: 1,
    latestCompleted: true,
  });
  assert.equal(result.renderCompleteReentry.afterCallbackX, 200);
  assert.equal(result.splitCompletion[1].y, 100);
  assert.equal(result.splitCompletion[2].y, 101);
  assert.deepEqual(result.overwriteAll, { x: 50, y: 50 });
  assert.equal(result.multiStepYoyo.x, 5);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
