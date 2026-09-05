import { Container, Matrix, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import { parseText } from "../src/plugins/elements/text/parseText.js";
import { createTextDisplayObject } from "../src/plugins/elements/text/addText.js";
import { setElementRenderState } from "../src/plugins/elements/elementRenderState.js";
import { createAnimationBus } from "../src/plugins/animations/animationBus.js";
import { dispatchUpdateAnimationsNow } from "../src/plugins/animations/updateAnimationDispatch.js";
import { createCompletionTracker } from "../src/util/completionTracker.js";
import { normalizeAnimations } from "../src/util/normalizeAnimations.js";
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

const animateTextUnits = (
  display,
  { unit = "grapheme", allowEmpty = false } = {},
) => {
  const bus = createAnimationBus();
  const tracker = createCompletionTracker();
  tracker.reset("layout-report");
  dispatchUpdateAnimationsNow({
    animations: normalizeAnimations([
      {
        id: "split-text",
        targetId: display.label,
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: {
            units: { textUnits: { elementId: display.label, unit, allowEmpty } },
          },
          steps: [
            {
              kind: "to",
              targets: "units",
              values: { alpha: 0.5, y: 40 },
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    ]),
    animationBus: bus,
    completionTracker: tracker,
    element: display,
    targetState: {},
  });
  return bus;
};

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

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "reports active and retained text-unit runs with nested=%s, metadata=%s",
    (nested, metadata) => {
      const parsed = makeText({
        content: "A\nB",
        width: undefined,
        textStyle: { fontSize: 24, wordWrap: false },
      });
      const stage = new Container({ x: 11, y: 17, scale: 0.75 });
      const parent = nested
        ? stage.addChild(new Container({ label: "parent", alpha: 0.5 }))
        : stage;
      const elements = nested
        ? [{ id: "parent", type: "container", children: [parsed] }]
        : [parsed];
      const display = parent.addChild(createTextDisplayObject(parsed, 0));
      if (metadata) {
        setElementRenderState(display, parsed);
        if (nested) setElementRenderState(parent, elements[0]);
      }
      const bus = animateTextUnits(display);
      try {
        expect(report(elements, stage).elements.at(-1).textRuns[0].text).toBe(
          "A\nB",
        );
        bus.flush();
        bus.tick(50);
        const proxy = parent.children.find(
          (child) => child.label === "__timeline-text-units:text",
        );
        expect(display.renderable).toBe(false);
        for (const activeCount of [1, 0]) {
          const before = JSON.stringify(bus.getState());
          const value = report(elements, stage);
          expect(JSON.stringify(bus.getState())).toBe(before);
          expect(report(elements, stage)).toEqual(value);
          expect(JSON.parse(JSON.stringify(value))).toEqual(value);
          const entry = value.elements.at(-1);
          expect(entry.mountStatus).toBe("mounted");
          expect(entry.display.renderable).toBe(true);
          expect(entry.textRuns.map((run) => run.text)).toEqual(["A", "B"]);
          expect(entry.textRuns.map((run) => run.path)).toEqual([
            [0],
            [1],
          ]);
          entry.textRuns.forEach((run, index) => {
            const unit = proxy.children[index];
            const matrix = unit.getGlobalTransform(new Matrix());
            expect(run.display.alpha).toBe(activeCount ? 0.75 : 0.5);
            expect(run.display.globalAlpha).toBe(unit.getGlobalAlpha());
            expect(run.display.worldTransform.tx).toBe(matrix.tx);
            expect(run.display.worldTransform.ty).toBe(matrix.ty);
          });
          if (nested) expect(value.elements[0].textRuns).toEqual([]);
          expect(bus.getState().activeCount).toBe(activeCount);
          if (activeCount) bus.tick(50);
        }
        display[Symbol.for("routeGraphics.timelineTextUnits")].destroy();
        const restored = report(elements, stage).elements.at(-1);
        expect(restored.textRuns.map((run) => run.text)).toEqual(["A\nB"]);
        expect(restored.textRuns[0].path).toEqual([]);
        expect(restored.display.renderable).toBe(true);
      } finally {
        bus.destroy();
        stage.destroy({ children: true });
      }
    },
  );

  it("reports no runs for an empty retained text-unit proxy", () => {
    const parsed = makeText({ content: "   ", width: undefined });
    const stage = new Container();
    const display = stage.addChild(createTextDisplayObject(parsed, 0));
    const bus = animateTextUnits(display, { unit: "word", allowEmpty: true });
    try {
      bus.flush();
      bus.tick(100);
      expect(bus.getState().activeCount).toBe(0);
      expect(display.renderable).toBe(false);
      expect(report([parsed], stage).elements[0].textRuns).toEqual([]);
    } finally {
      bus.destroy();
      stage.destroy({ children: true });
    }
  });

  it.each([false, true])(
    "keeps rich-text runs when an internal label matches an authored ID with metadata=%s",
    (metadata) => {
      const dialogue = makeText({
        id: "dialogue",
        content: [{ text: "Hello", furigana: { text: "reading" } }],
      });
      const other = makeText({ id: "dialogue-line-0", content: "Other" });
      const stage = new Container();
      const display = stage.addChild(createTextDisplayObject(dialogue, 0));
      const otherDisplay = stage.addChild(createTextDisplayObject(other, 1));
      expect(display.children[0].label).toBe(other.id);
      if (metadata) {
        setElementRenderState(display, dialogue);
        setElementRenderState(otherDisplay, other);
      }
      const value = report([dialogue, other], stage);
      expect(value.elements[0].mountStatus).toBe("mounted");
      expect(value.elements[0].textRuns.map((run) => run.text)).toEqual([
        "reading",
        "Hello",
      ]);
      expect(value.elements[1].mountStatus).toBe("mounted");
      expect(value.elements[1].textRuns.map((run) => run.text)).toEqual([
        "Other",
      ]);
      otherDisplay.destroy();
      const afterRemoval = report([dialogue, other], stage);
      expect(afterRemoval.elements[0].textRuns).toEqual(
        value.elements[0].textRuns,
      );
      expect(afterRemoval.elements[1]).toMatchObject({
        mountStatus: "absent",
        display: null,
        textRuns: [],
      });
      stage.destroy({ children: true });
    },
  );

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
