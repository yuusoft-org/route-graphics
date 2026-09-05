import { Container, Matrix, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import { parseText } from "../src/plugins/elements/text/parseText.js";
import { createTextDisplayObject } from "../src/plugins/elements/text/addText.js";
import { createLayoutReport } from "../src/util/layoutReport.js";

const viewport = { width: 1280, height: 720, resolution: 1 };
const makeText = (overrides = {}) =>
  parseText({
    state: {
      id: "text",
      type: "text",
      content: "First\nSecond",
      x: 120,
      y: 80,
      width: 240,
      anchorX: 0.5,
      textStyle: { fontSize: 24, align: "center", strokeWidth: 2 },
      ...overrides,
    },
  });
const report = (elements, stage) =>
  createLayoutReport({ elements, stage, viewport });

describe("layout report v1", () => {
  it("retains non-enumerable layout metadata and reports mounted geometry", () => {
    const parsed = makeText();
    expect(JSON.parse(JSON.stringify(parsed)).__layoutWidth).toBeUndefined();
    const stage = new Container({ x: 11, y: 17, scale: 0.75 });
    const display = stage.addChild(createTextDisplayObject(parsed, 0));
    const value = report([parsed], stage);
    expect(value.schema).toBe("route-graphics-layout-report-v1");
    expect(value.coordinateSpace).toBe("logical-pixels");
    expect(value.elements[0].layout).toMatchObject({
      anchorX: 0.5,
      layoutWidth: 240,
      fixedWidth: true,
    });
    const run = value.elements[0].textRuns[0];
    expect(run.metrics.lines.map((line) => line.text)).toEqual([
      "First",
      "Second",
    ]);
    expect(run.style.strokeWidth).toBe(2);
    const matrix = display.getGlobalTransform(new Matrix());
    expect(run.display.worldTransform.tx).toBe(matrix.tx);
    expect(run.display.worldTransform.ty).toBe(matrix.ty);
    expect(run.display.globalBounds.width).toBe(display.getBounds().width);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    stage.destroy({ children: true });
  });

  it("returns independent data without changing display or parsed state", () => {
    const parsed = makeText();
    const stage = new Container();
    const display = stage.addChild(createTextDisplayObject(parsed, 0));
    const before = JSON.stringify(parsed);
    const first = report([parsed], stage);
    const second = report([parsed], stage);
    expect(second).toEqual(first);
    first.elements[0].textRuns[0].metrics.lines[0].text = "changed";
    first.elements[0].layout.x = -100;
    first.viewport.width = 1;
    expect(JSON.stringify(parsed)).toBe(before);
    expect(display.text).toBe("First\nSecond");
    expect(report([parsed], stage)).toEqual(second);
    stage.destroy({ children: true });
  });

  it("assigns nested text only to its own element and preserves parent indices", () => {
    const parsed = makeText();
    const stage = new Container();
    const parent = stage.addChild(
      new Container({ label: "parent", alpha: 0.5 }),
    );
    parent.addChild(createTextDisplayObject(parsed, 0));
    const value = report(
      [{ id: "parent", type: "container", children: [parsed] }],
      stage,
    );
    expect(value.elements[0].textRuns).toEqual([]);
    expect(value.elements[1].parentIndex).toBe(0);
    expect(value.elements[1].textRuns).toHaveLength(1);
    expect(value.elements[1].textRuns[0].display.globalAlpha).toBe(0.5);
    stage.destroy({ children: true });
  });

  it("reports rich text and furigana as distinct mounted runs", () => {
    const parsed = makeText({
      content: [
        { text: "First", furigana: { text: "reading" } },
        { text: " second", textStyle: { fontSize: 18 } },
      ],
    });
    const stage = new Container();
    stage.addChild(createTextDisplayObject(parsed, 0));
    const runs = report([parsed], stage).elements[0].textRuns;
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(runs.some((run) => run.text === "reading")).toBe(true);
    expect(new Set(runs.map((run) => JSON.stringify(run.path))).size).toBe(
      runs.length,
    );
    expect(runs.map((run) => run.text).join(" ")).toContain("First");
    stage.destroy({ children: true });
  });

  it("reports live style and text instead of remeasuring the initial parsed value", () => {
    const parsed = makeText();
    const stage = new Container();
    const display = stage.addChild(createTextDisplayObject(parsed, 0));
    display.text = "First";
    display.style.fontSize = 32;
    display.scale.x = -1;
    const run = report([parsed], stage).elements[0].textRuns[0];
    expect(run.text).toBe("First");
    expect(run.style.fontSize).toBe(32);
    expect(run.display.worldTransform.a).toBe(-1);
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
    stage.destroy({ children: true });
  });

  it("reports absent and ambiguous mounts without choosing an arbitrary owner", () => {
    const parsed = makeText();
    const stage = new Container();
    expect(report([parsed], stage).elements[0]).toMatchObject({
      mountStatus: "absent",
      display: null,
      textRuns: [],
    });
    stage.addChild(new Text({ label: "text", text: "one" }));
    stage.addChild(new Text({ label: "text", text: "two" }));
    expect(report([parsed], stage).elements[0].mountStatus).toBe("ambiguous");
    stage.removeChildAt(1).destroy();
    expect(
      report([parsed, parsed], stage).elements.map(
        (entry) => entry.mountStatus,
      ),
    ).toEqual(["ambiguous", "ambiguous"]);
    stage.destroy({ children: true });
  });

  it("reports an empty committed state", () => {
    const stage = new Container();
    expect(report([], stage).elements).toEqual([]);
    stage.destroy();
  });
});
