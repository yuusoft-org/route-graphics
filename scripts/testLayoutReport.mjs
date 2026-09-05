import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Real browser coverage of the public API. No private project data required.
const files = new Map([
  ["/bundle.js", ["../dist/RouteGraphics.js", "text/javascript"]],
  ["/font.ttf", ["../spec/assets/fonts/NotoSans-Regular.ttf", "font/ttf"]],
]);
const server = http.createServer(async (request, response) => {
  try {
    const asset = files.get(request.url);
    if (asset) {
      response.writeHead(200, { "content-type": asset[1] });
      response.end(
        await readFile(fileURLToPath(new URL(asset[0], import.meta.url))),
      );
    } else if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><html><body></body></html>");
    } else {
      response.writeHead(404).end();
    }
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let browser;
try {
  browser = await chromium.launch({ executablePath: process.argv[2] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const {
      default: createRouteGraphics,
      textPlugin,
      containerPlugin,
      textRevealingPlugin,
    } = await import("/bundle.js");
    const app = createRouteGraphics();
    let rejectedBeforeInit = false;
    try {
      app.getLayoutReport();
    } catch {
      rejectedBeforeInit = true;
    }
    const events = [];
    await app.init({
      width: 640,
      height: 360,
      animationPlaybackMode: "manual",
      plugins: { elements: [textPlugin, containerPlugin, textRevealingPlugin] },
      eventHandler: (name) => events.push(name),
    });
    try {
      const font = new FontFace("LayoutReportTest", 'url("/font.ttf")');
      document.fonts.add(await font.load());
      document.body.append(app.canvas);
      const state = {
        elements: [
          {
            id: "root",
            type: "container",
            x: 20,
            y: 10,
            width: 600,
            height: 330,
            children: [
              {
                id: "plain",
                type: "text",
                content: "First\nSecond",
                x: 30,
                y: 40,
                width: 260,
                textStyle: {
                  fontFamily: "LayoutReportTest",
                  fontSize: 24,
                  align: "center",
                  strokeWidth: 2,
                  strokeColor: "#000000",
                },
              },
              {
                id: "rich",
                type: "text",
                x: 30,
                y: 140,
                width: 400,
                content: [
                  { text: "Base", furigana: { text: "reading" } },
                  { text: " run", textStyle: { fontSize: 18 } },
                ],
                textStyle: { fontFamily: "LayoutReportTest", fontSize: 24 },
              },
              {
                id: "reveal",
                type: "text-revealing",
                x: 30,
                y: 230,
                width: 400,
                content: [{ text: "Revealed text" }],
                revealEffect: "none",
                speed: 100,
                textStyle: { fontFamily: "LayoutReportTest", fontSize: 24 },
              },
            ],
          },
        ],
      };
      app.render(state);
      app.render(state);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const before = await app.extractBase64();
      const count = events.length;
      const first = app.getLayoutReport();
      const second = app.getLayoutReport();
      const eventsUnchanged = count === events.length;
      const after = await app.extractBase64();
      const get = (id) => first.elements.find((entry) => entry.id === id);
      const original = JSON.stringify(second);
      first.elements[1].layout.x = -999;
      const independent = JSON.stringify(app.getLayoutReport()) === original;
      app.findElementByLabel("plain").style.fontSize = 30;
      const changed = app
        .getLayoutReport()
        .elements.find((entry) => entry.id === "plain");
      return {
        rejectedBeforeInit,
        pixelsUnchanged: before === after,
        eventsUnchanged,
        independent,
        mounted: second.elements.every(
          (entry) => entry.mountStatus === "mounted",
        ),
        nestedOwner: get("root").textRuns.length === 0,
        lines: get("plain").textRuns[0].metrics.lines.length,
        furigana: get("rich").textRuns.some((run) => run.text === "reading"),
        revealRuns: get("reveal").textRuns.length,
        liveFontSize: changed.textRuns[0].style.fontSize,
      };
    } finally {
      app.destroy();
    }
  });
  assert.deepEqual(errors, []);
  for (const key of [
    "rejectedBeforeInit",
    "pixelsUnchanged",
    "eventsUnchanged",
    "independent",
    "mounted",
    "nestedOwner",
    "furigana",
  ])
    assert.equal(result[key], true, key);
  assert.equal(result.lines, 2);
  assert.ok(result.revealRuns > 0);
  assert.equal(result.liveFontSize, 30);
  console.log(JSON.stringify({ result: "pass", ...result }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
