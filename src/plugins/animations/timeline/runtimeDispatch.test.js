import { describe, expect, it, vi } from "vitest";
import { createAnimationBus } from "../animationBus.js";
import { dispatchUpdateAnimationsNow } from "../updateAnimationDispatch.js";
import { createCompletionTracker } from "../../../util/completionTracker.js";
import { normalizeAnimations } from "../../../util/normalizeAnimations.js";
import { Container, Text } from "pixi.js";
import {
  getElementRenderState,
  setElementRenderState,
} from "../../elements/elementRenderState.js";
import { hitTestElementBounds } from "../../../util/hitTestElementBounds.js";

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
  it("keeps an explicitly normalized speed when activating a pending transition", () => {
    const bus = createAnimationBus();
    const frames = [];
    bus.registerPending({
      id: "fast-transition",
      animationType: "transition",
      targetId: "scene",
      continuity: "persistent",
      playbackSpeed: 2,
    });

    expect(
      bus.activatePending("fast-transition", {
        driver: "custom",
        duration: 50,
        playbackSpeed: 1,
        applyFrame: (time) => frames.push(time),
      }),
    ).toBe(true);
    bus.tick(25);

    expect(frames.at(-1)).toBe(25);
    expect(bus.getState().animations[0]).toMatchObject({
      currentTime: 25,
      duration: 50,
      playbackSpeed: 1,
    });
  });

  it("preserves live GSAP owner channels while settling an infinite update", () => {
    const root = display("root");
    root.x = 25;
    const animation = normalizeAnimations([
      {
        id: "infinite-relative",
        targetId: "root",
        type: "update",
        playback: { repeat: "infinite" },
        gsap: {
          profile: "portable-v1",
          steps: [{ kind: "to", values: { x: { by: 10 } }, duration: 100 }],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("settled-gsap");
    const bus = createAnimationBus();
    const onComplete = () => {
      root.x = 100;
    };

    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 100 },
      onComplete,
    });
    expect(root.x).toBe(25);
    bus.flush();
    expect(root.x).toBe(25);
    bus.tick(50);
    expect(root.x).toBe(30);
  });

  it("preserves descendant alias channels while settling an infinite update", () => {
    const child = display("child");
    const root = display("root", [child]);
    const animation = normalizeAnimations([
      {
        id: "infinite-descendant-relative",
        targetId: "root",
        type: "update",
        playback: { repeat: "infinite" },
        gsap: {
          profile: "portable-v1",
          targets: {
            child: { element: "child" },
          },
          steps: [
            {
              kind: "to",
              targets: "child",
              values: { x: { by: 100 } },
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("settled-descendant-gsap");
    const bus = createAnimationBus();
    const onComplete = vi.fn(() => {
      child.x = 100;
    });

    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: {},
      onComplete,
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(child.x).toBe(0);
    bus.flush();
    bus.tick(50);
    expect(child.x).toBe(50);
  });

  it("settles and does not completion-track a nested infinite GSAP group", () => {
    const root = display("root");
    const animation = normalizeAnimations([
      {
        id: "nested-infinite",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "sequence",
              repeat: "infinite",
              steps: [
                {
                  kind: "to",
                  values: { x: 100 },
                  duration: 100,
                  easing: "linear",
                },
              ],
            },
          ],
        },
      },
    ]);
    const events = [];
    const tracker = createCompletionTracker((name, payload) =>
      events.push([name, payload]),
    );
    tracker.reset("nested-infinite-state");
    const bus = createAnimationBus();
    const onComplete = vi.fn(() => {
      root.x = 100;
    });

    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 100 },
      onComplete,
    });
    tracker.completeIfEmpty();
    bus.flush();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual([
      "renderComplete",
      { id: "nested-infinite-state", aborted: false },
    ]);
    expect(bus.getState().animations[0].duration).toBe(Infinity);
  });

  it("releases render completion when a timeline frame adapter fails", () => {
    const root = display("root");
    let liveX = 0;
    let rejectWrites = false;
    Object.defineProperty(root, "x", {
      configurable: true,
      get: () => liveX,
      set: (value) => {
        if (rejectWrites && value !== 0) {
          throw new Error("adapter write failed");
        }
        liveX = value;
      },
    });
    const animation = normalizeAnimations([
      {
        id: "failing-frame",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { x: 100 },
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    ]);
    const eventHandler = vi.fn();
    const tracker = createCompletionTracker(eventHandler);
    tracker.reset("failing-frame-state");
    const bus = createAnimationBus();
    const onComplete = vi.fn();

    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 100 },
      onComplete,
    });
    bus.flush();
    tracker.completeIfEmpty();
    expect(eventHandler).not.toHaveBeenCalled();

    rejectWrites = true;
    bus.tick(50);

    expect(bus.getState().activeCount).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "failing-frame-state",
      aborted: false,
    });
  });

  it("releases render completion at a finite update's reverse boundary", () => {
    const root = display("root");
    const animation = normalizeAnimations([
      {
        id: "reverse-tracked-update",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { x: 100 },
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    ]);
    const eventHandler = vi.fn();
    const tracker = createCompletionTracker(eventHandler);
    tracker.reset("reverse-tracked-state");
    const bus = createAnimationBus();
    const onComplete = vi.fn(() => {
      root.x = 100;
    });

    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 100 },
      onComplete,
    });
    bus.flush();
    tracker.completeIfEmpty();
    bus.tick(40);

    expect(bus.reverse("reverse-tracked-update")).toBe(true);
    bus.tick(40);

    expect(bus.getState().activeCount).toBe(0);
    expect(root.x).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "reverse-tracked-state",
      aborted: false,
    });
  });

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

  it("settles descendant aliases to their mounted target states on cancellation", () => {
    const child = display("child");
    const root = display("root", [child]);
    setElementRenderState(child, {
      id: "child",
      type: "container",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      alpha: 1,
    });
    const animation = normalizeAnimations([
      {
        id: "descendant-cancel",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: { child: { element: "child" } },
          steps: [
            {
              kind: "to",
              targets: "child",
              values: { x: 100 },
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("descendant-cancel-state");
    const bus = createAnimationBus();

    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: { x: 0, y: 0, alpha: 1 },
      targetStates: new Map([
        [
          "child",
          {
            id: "child",
            type: "container",
            x: 100,
            y: 0,
            width: 100,
            height: 50,
            alpha: 1,
          },
        ],
      ]),
    });
    bus.flush();
    bus.tick(50);
    expect(child.x).toBe(50);

    bus.cancelAllExcept(new Set());
    expect(child.x).toBe(100);
    expect(bus.getState().activeCount).toBe(0);
  });

  it("rejects rect-only channels on targets without a rect runtime", () => {
    const root = new Container({ label: "root" });
    const title = new Text({ label: "title", text: "not a rect" });
    root.addChild(title);
    const animation = normalizeAnimations([
      {
        id: "invalid-rect-channel",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: { title: { element: "title" } },
          steps: [
            {
              kind: "to",
              targets: "title",
              values: { "rect.width": 200 },
              duration: 100,
            },
          ],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("invalid-rect-channel-state");
    const bus = createAnimationBus();

    expect(() =>
      dispatchUpdateAnimationsNow({
        animations: animation,
        animationBus: bus,
        completionTracker: tracker,
        element: root,
        targetState: {},
      }),
    ).toThrow(/does not support channel "geometry\.rect\.width"/);
    expect(title._routeGraphicsRectStyle).toBeUndefined();
    root.destroy({ children: true });
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

  it("delivers a leading event when an event-only timeline is activated", () => {
    const root = display("root");
    const animation = normalizeAnimations([
      {
        id: "leading-event",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [{ kind: "emit", event: "ready" }],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("leading-event-state");
    const bus = createAnimationBus();
    const emitted = [];
    bus.on("timelineEvent", (event) => emitted.push(event));

    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: {},
    });
    bus.flush();

    expect(emitted).toMatchObject([
      {
        id: "leading-event",
        event: "ready",
        time: 0,
        direction: "forward",
        iteration: [0],
      },
    ]);
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
    const semanticState = {
      id: "title",
      type: "text",
      content: "e\u0301👨‍👩‍👧‍👦!",
      x: 0,
      y: 0,
      width: title.width,
      height: title.height,
      alpha: 1,
    };
    setElementRenderState(title, semanticState);
    title.eventMode = "static";
    const pointerUp = vi.fn();
    title.on("pointerup", pointerUp);
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
    expect(getElementRenderState(unitContainer)).toBe(semanticState);
    expect(unitContainer.eventMode).toBe("static");
    expect(
      hitTestElementBounds({
        stage: root,
        elements: [semanticState],
        x: 1,
        y: 1,
      }),
    ).toEqual([
      {
        path: [expect.objectContaining({ id: "title", type: "text" })],
      },
    ]);
    unitContainer.emit("pointerup", { button: 0 });
    expect(pointerUp).toHaveBeenCalledTimes(1);
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
    title.style = { fontSize: 24 };
    title[Symbol.for("routeGraphics.timelineTextUnits")].sync();
    expect(unitContainer.destroyed).toBe(true);
    expect(title.renderable).toBe(true);
    root.destroy({ children: true });
  });

  it("enforces allowEmpty for Pixi text-unit queries", () => {
    const createAnimation = (allowEmpty) =>
      normalizeAnimations([
        {
          id: `empty-words-${allowEmpty}`,
          targetId: "root",
          type: "update",
          gsap: {
            profile: "portable-v1",
            targets: {
              words: {
                textUnits: {
                  elementId: "title",
                  unit: "word",
                  order: "logical",
                  ...(allowEmpty === undefined ? {} : { allowEmpty }),
                },
              },
            },
            steps: [{ kind: "set", targets: "words", values: { alpha: 0 } }],
          },
        },
      ]);
    const createRuntime = () => {
      const root = new Container({ label: "root" });
      const title = new Text({
        label: "title",
        text: "   ",
        style: { fontSize: 20 },
      });
      root.addChild(title);
      const tracker = createCompletionTracker();
      tracker.reset("empty-text-state");
      return { root, title, tracker, bus: createAnimationBus() };
    };

    const rejected = createRuntime();
    expect(() =>
      dispatchUpdateAnimationsNow({
        animations: createAnimation(undefined),
        animationBus: rejected.bus,
        completionTracker: rejected.tracker,
        element: rejected.root,
        targetState: {},
      }),
    ).toThrow('Target query "words" resolved no text units.');
    expect(rejected.title.renderable).toBe(true);
    rejected.root.destroy({ children: true });

    const allowed = createRuntime();
    expect(() =>
      dispatchUpdateAnimationsNow({
        animations: createAnimation(true),
        animationBus: allowed.bus,
        completionTracker: allowed.tracker,
        element: allowed.root,
        targetState: {},
      }),
    ).not.toThrow();
    allowed.bus.flush();
    allowed.root.destroy({ children: true });
  });

  it("keeps retained text units synced during later tween and GSAP self animations", () => {
    const root = new Container({ label: "root" });
    const title = new Text({
      label: "title",
      text: "A",
      style: { fontSize: 20 },
    });
    root.addChild(title);
    const tracker = createCompletionTracker();
    tracker.reset("retained-text-state");
    const bus = createAnimationBus();
    const [splitAnimation] = normalizeAnimations([
      {
        id: "split-once",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: {
            character: {
              textUnits: {
                elementId: "title",
                unit: "grapheme",
                order: "logical",
              },
            },
          },
          steps: [
            {
              kind: "from",
              targets: "character",
              values: { alpha: 0 },
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    ]);
    dispatchUpdateAnimationsNow({
      animations: [splitAnimation],
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: {},
    });
    bus.flush();
    bus.tick(100);
    const unitContainer = root.children.find((child) =>
      child.label?.startsWith("__timeline-text-units:"),
    );
    expect(title.renderable).toBe(false);

    const [ordinaryTween] = normalizeAnimations([
      {
        id: "move-retained-text",
        targetId: "title",
        type: "update",
        tween: {
          x: {
            initialValue: 0,
            keyframes: [{ value: 100, duration: 100, easing: "linear" }],
          },
          alpha: {
            initialValue: 1,
            keyframes: [{ value: 0.5, duration: 100, easing: "linear" }],
          },
        },
      },
    ]);
    dispatchUpdateAnimationsNow({
      animations: [ordinaryTween],
      animationBus: bus,
      completionTracker: tracker,
      element: title,
      targetState: { x: 100, alpha: 0.5 },
    });
    bus.flush();
    bus.tick(50);
    expect(title.x).toBe(50);
    expect(unitContainer.x).toBe(50);
    expect(title.alpha).toBe(0.75);
    expect(unitContainer.alpha).toBe(0.75);
    bus.tick(50);

    const [gsapSelf] = normalizeAnimations([
      {
        id: "move-retained-text-again",
        targetId: "title",
        type: "update",
        gsap: {
          profile: "portable-v1",
          steps: [
            {
              kind: "to",
              values: { x: 200, alpha: 1 },
              duration: 100,
              easing: "linear",
            },
          ],
        },
      },
    ]);
    dispatchUpdateAnimationsNow({
      animations: [gsapSelf],
      animationBus: bus,
      completionTracker: tracker,
      element: title,
      targetState: { x: 200, alpha: 1 },
    });
    bus.flush();
    bus.tick(50);
    expect(title.x).toBe(150);
    expect(unitContainer.x).toBe(150);
    expect(title.alpha).toBe(0.75);
    expect(unitContainer.alpha).toBe(0.75);
    root.destroy({ children: true });
  });

  it("destroys a split-text sibling when its source text is destroyed", () => {
    const root = new Container({ label: "root" });
    const title = new Text({
      label: "title",
      text: "A",
      style: { fontSize: 20 },
    });
    root.addChild(title);
    const animation = normalizeAnimations([
      {
        id: "split-lifecycle",
        targetId: "root",
        type: "update",
        gsap: {
          profile: "portable-v1",
          targets: {
            character: {
              textUnits: {
                elementId: "title",
                unit: "grapheme",
                order: "logical",
              },
            },
          },
          steps: [{ kind: "set", targets: "character", values: { alpha: 0 } }],
        },
      },
    ]);
    const tracker = createCompletionTracker();
    tracker.reset("split-lifecycle-state");
    const bus = createAnimationBus();
    dispatchUpdateAnimationsNow({
      animations: animation,
      animationBus: bus,
      completionTracker: tracker,
      element: root,
      targetState: {},
    });
    bus.flush();
    const unitContainer = root.children.find((child) =>
      child.label?.startsWith("__timeline-text-units:"),
    );

    title.destroy({ children: true });

    expect(unitContainer.destroyed).toBe(true);
    expect(root.children).not.toContain(unitContainer);
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
