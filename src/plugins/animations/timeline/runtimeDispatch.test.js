import { describe, expect, it } from "vitest";
import { createAnimationBus } from "../animationBus.js";
import { dispatchUpdateAnimationsNow } from "../updateAnimationDispatch.js";
import { createCompletionTracker } from "../../../util/completionTracker.js";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import { Container, Text } from "pixi.js";

const display = (label, children = []) => ({
  label,
  children,
  destroyed: false,
  x: 0,
  y: 0,
  alpha: 1,
  width: 100,
  height: 50,
});

describe("portable GSAP update runtime integration", () => {
  it("rejects mixed legacy/GSAP write conflicts before either time-zero frame", () => {
    const root = display("root");
    const animations = normalizeAnimations([
      {
        id: "legacy-x",
        targetId: "root",
        type: "update",
        tween: {
          x: { initialValue: 10, keyframes: [{ value: 100, duration: 100 }] },
        },
      },
      {
        id: "gsap-x",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [{ kind: "set", values: { x: 20 } }],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("conflict");
    const bus = createAnimationBus();

    expect(() =>
      dispatchUpdateAnimationsNow({
        animations,
        animationBus: bus,
        completionTracker: tracker,
        element: root,
        targetState: { x: 100 },
      }),
    ).toThrow(/legacy-x.*gsap-x|gsap-x.*legacy-x/);
    expect(root.x).toBe(0);
    expect(bus.getState().activeCount).toBe(0);
  });

  it("rejects conflicts across separately queued owner activations before writes", () => {
    const child = display("child");
    const root = display("root", [child]);
    const [ownerAnimation, childAnimation] = normalizeAnimations([
      {
        id: "owner-writes-child",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: { child: { element: "child" } },
          steps: [{ kind: "set", targets: "child", values: { x: 10 } }],
        },
      },
      {
        id: "child-writes-self",
        targetId: "child",
        type: "update",
        tween: {
          x: { initialValue: 20, keyframes: [{ value: 30, duration: 100 }] },
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("cross-owner-conflict");
    const bus = createAnimationBus();

    dispatchUpdateAnimationsNow({
      animations: [ownerAnimation],
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 0 },
    });
    dispatchUpdateAnimationsNow({
      animations: [childAnimation],
      animationBus: bus,
      completionTracker: tracker,
      element: child,
      targetState: { x: 30 },
    });

    expect(() => bus.flush()).toThrow(
      /owner-writes-child.*child-writes-self|child-writes-self.*owner-writes-child/,
    );
    expect(child.x).toBe(0);
    expect(bus.getState().activeCount).toBe(0);
  });

  it("rolls back earlier queued starts when a later time-zero adapter fails", () => {
    const first = display("first");
    const second = display("second");
    let secondX = 0;
    Object.defineProperty(second, "x", {
      configurable: true,
      get: () => secondX,
      set: (value) => {
        if (value !== 0) throw new Error("second adapter failed");
        secondX = value;
      },
    });
    const animations = normalizeAnimations([
      {
        id: "first-start",
        targetId: "first",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [{ kind: "set", values: { x: 10 } }],
        },
      },
      {
        id: "second-start",
        targetId: "second",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [{ kind: "set", values: { x: 20 } }],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("adapter-failure");
    const bus = createAnimationBus();

    dispatchUpdateAnimationsNow({
      animations: [animations[0]],
      animationBus: bus,
      completionTracker: tracker,
      element: first,
      targetState: { x: 10 },
    });
    dispatchUpdateAnimationsNow({
      animations: [animations[1]],
      animationBus: bus,
      completionTracker: tracker,
      element: second,
      targetState: { x: 20 },
    });

    expect(() => bus.flush()).toThrow("second adapter failed");
    expect(first.x).toBe(0);
    expect(second.x).toBe(0);
    expect(bus.getState().activeCount).toBe(0);
  });

  it("runs through the shared bus/evaluator for owner and descendant targets", () => {
    const cardA = display("card-a");
    const cardB = display("card-b");
    const root = display("root", [cardA, cardB]);
    const animation = normalizeAnimations([
      {
        id: "cards-enter",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: { cards: { elements: ["card-a", "card-b"] } },
          steps: [
            { kind: "set", targets: "cards", values: { alpha: 0 } },
            {
              kind: "to",
              targets: "cards",
              values: { alpha: 1, x: 100 },
              duration: 100,
              stagger: { each: 20, from: "start" },
            },
          ],
        },
      },
    ]);
    const events = [];
    const tracker = createCompletionTracker((name, payload) =>
      events.push([name, payload]),
    );
    tracker.reset("state-1");
    const bus = createAnimationBus();

    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 0, y: 0, alpha: 1 },
    });
    bus.flush();
    expect(bus.getState().animations[0].backend).toBe("gsap");
    expect(cardA.alpha).toBe(0);
    expect(cardB.alpha).toBe(0);

    bus.tick(60);
    expect(cardA.alpha).toBeCloseTo(0.6, 12);
    expect(cardB.alpha).toBeCloseTo(0.4, 12);
    expect(cardA.x).toBeCloseTo(60, 12);
    expect(cardB.x).toBeCloseTo(40, 12);

    bus.tick(60);
    expect(cardA.alpha).toBe(1);
    expect(cardB.alpha).toBe(1);
    expect(cardA.x).toBe(100);
    expect(cardB.x).toBe(100);
    tracker.completeIfEmpty();
    expect(events).toEqual([
      ["renderComplete", { id: "state-1", aborted: false }],
    ]);
  });

  it("manual setTime is history-independent and does not emit timeline events", () => {
    const root = display("root");
    const animation = normalizeAnimations([
      {
        id: "seek",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            { kind: "to", values: { x: 100 }, duration: 100 },
            { kind: "emit", event: "halfway", start: { time: 50 } },
          ],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("state-2");
    const bus = createAnimationBus();
    const emitted = [];
    bus.on("timelineEvent", (event) => emitted.push(event));
    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 0 },
    });
    bus.setTime(75);
    expect(root.x).toBe(75);
    bus.setTime(25);
    expect(root.x).toBe(25);
    expect(emitted).toEqual([]);
  });

  it("delivers repeat/yoyo event crossings and supports player controls", () => {
    const root = display("root");
    const animation = normalizeAnimations([
      {
        id: "controlled",
        targetId: "root",
        type: "update",
        playback: { repeat: 1, yoyo: true },
        gsap: {
          profile: "portable-v1",
          steps: [
            { kind: "to", values: { x: 100 }, duration: 100 },
            {
              kind: "emit",
              event: "middle",
              direction: "both",
              seekPolicy: "crossed",
              start: { time: 50 },
            },
          ],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("state-3");
    const bus = createAnimationBus();
    const emitted = [];
    bus.on("timelineEvent", (event) => emitted.push(event));
    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 0 },
    });
    bus.flush();

    expect(bus.pause("controlled")).toBe(true);
    bus.tick(25);
    expect(root.x).toBe(0);
    expect(bus.setSpeed("controlled", 2)).toBe(true);
    expect(bus.resume("controlled")).toBe(true);
    bus.tick(30);
    expect(root.x).toBe(60);
    expect(emitted.map(({ direction }) => direction)).toEqual(["forward"]);

    expect(bus.seek("controlled", 160, { emitEvents: true })).toBe(true);
    expect(root.x).toBe(40);
    expect(emitted.map(({ direction }) => direction)).toEqual([
      "forward",
      "reverse",
    ]);
    expect(bus.reverse("controlled")).toBe(true);
    bus.tick(5);
    expect(root.x).toBe(50);
    expect(bus.getState().animations[0]).toMatchObject({
      direction: "reverse",
      controlSpeed: 2,
    });
  });

  it("binds grapheme units to staged Pixi targets without splitting emoji", () => {
    const root = new Container({ label: "root" });
    const background = new Container({ label: "background" });
    const title = new Text({
      label: "title",
      text: "e\u0301👨‍👩‍👧‍👦!",
      style: { fontSize: 20 },
    });
    const foreground = new Container({ label: "foreground" });
    root.addChild(background, title, foreground);
    const animation = normalizeAnimations([
      {
        id: "characters",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: {
            characters: {
              textUnits: {
                elementId: "title",
                unit: "grapheme",
                order: "logical",
              },
            },
          },
          steps: [
            { kind: "set", targets: "characters", values: { alpha: 0 } },
            {
              kind: "to",
              targets: "characters",
              values: { alpha: 1 },
              duration: 100,
              stagger: { each: 10 },
            },
          ],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("text-state");
    const bus = createAnimationBus();
    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: {},
    });
    expect(title.renderable).toBe(true);
    bus.flush();
    const unitContainer = root.children.find((child) =>
      child.label?.startsWith("__timeline-text-units:"),
    );
    expect(title.text).toBe("e\u0301👨‍👩‍👧‍👦!");
    expect(title.renderable).toBe(false);
    expect(root.getChildIndex(unitContainer)).toBe(1);
    expect(root.getChildIndex(background)).toBe(0);
    expect(root.getChildIndex(foreground)).toBe(3);
    expect(unitContainer.children.map((child) => child.text)).toEqual([
      "e\u0301",
      "👨‍👩‍👧‍👦",
      "!",
    ]);
    expect(unitContainer.children.every((child) => child.alpha === 0)).toBe(
      true,
    );
    bus.tick(60);
    expect(unitContainer.children.map((child) => child.alpha)).toEqual([
      0.6, 0.5, 0.4,
    ]);
    root.destroy({ children: true });
  });

  it.each([
    [
      "contextual shaping",
      "مرحبا",
      { fontSize: 20 },
      /contextual or bidirectional shaping/,
    ],
    [
      "automatic wrapping",
      "wrapped text",
      { fontSize: 20, wordWrap: true, wordWrapWidth: 40 },
      /automatic wrapping/,
    ],
    [
      "cross-unit kerning",
      "AV",
      { fontFamily: "RouteGraphicsTestSans", fontSize: 20 },
      /kerning or ligature shaping/,
    ],
  ])(
    "rejects %s that independent Pixi text units cannot preserve",
    (_name, text, style, error) => {
      const root = new Container({ label: "root" });
      const title = new Text({ label: "title", text, style });
      root.addChild(title);
      const animation = normalizeAnimations([
        {
          id: "unsafe-characters",
          targetId: "root",
          type: "update",
          gsap: {
            profile: "portable-v1",
            targets: {
              characters: {
                textUnits: {
                  elementId: "title",
                  unit: "grapheme",
                  order: "logical",
                },
              },
            },
            steps: [
              { kind: "set", targets: "characters", values: { alpha: 0 } },
            ],
          },
        },
      ]);
      const tracker = createCompletionTracker();
      tracker.reset("unsafe-text-state");
      const bus = createAnimationBus();

      expect(() =>
        dispatchUpdateAnimationsNow({
          animations: animation,
          animationBus: bus,
          completionTracker: tracker,
          element: root,
          targetState: {},
        }),
      ).toThrow(error);
      expect(title.renderable).toBe(true);
      expect(root.children).toEqual([title]);
      root.destroy({ children: true });
    },
  );
});
