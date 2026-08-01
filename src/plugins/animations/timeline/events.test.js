import { describe, expect, it } from "vitest";
import { collectTimelineEventCrossings } from "./events.js";

describe("timeline event delivery limits", () => {
  const instance = {
    domains: {
      root: {
        parent: null,
        start: 0,
        cycleDuration: 10,
        iterations: null,
        iterationGap: 0,
        direction: "forward",
        rate: 1,
      },
    },
    events: [
      {
        id: "pulse",
        domain: "root",
        time: 5,
        direction: "both",
        occurrence: "eachIteration",
        seekPolicy: "crossed",
        priority: 0,
      },
    ],
  };

  it("rejects an operation before returning a partial oversized event batch", () => {
    expect(() =>
      collectTimelineEventCrossings(instance, 0, 100, {
        maximumDeliveries: 3,
      }),
    ).toThrow(/delivery limit 3/);
  });

  it("returns the complete ordered batch when it is within the limit", () => {
    const events = collectTimelineEventCrossings(instance, 0, 30, {
      maximumDeliveries: 3,
    });
    expect(events.map(({ resolvedTime }) => resolvedTime)).toEqual([5, 15, 25]);
  });

  it("expands only iterations that intersect a late narrow crossing", () => {
    const events = collectTimelineEventCrossings(
      instance,
      1_000_000,
      1_000_006,
      { maximumDeliveries: 3 },
    );

    expect(events.map(({ resolvedTime }) => resolvedTime)).toEqual([1_000_005]);
  });

  it("includes an event at time zero only for initial delivery", () => {
    const initialInstance = {
      ...instance,
      domains: {
        root: {
          ...instance.domains.root,
          cycleDuration: 0,
          iterations: 1,
        },
      },
      events: [{ ...instance.events[0], time: 0, occurrence: "once" }],
    };

    expect(
      collectTimelineEventCrossings(initialInstance, 0, 0, {
        includeInitial: true,
      }).map(({ resolvedTime }) => resolvedTime),
    ).toEqual([0]);
    expect(collectTimelineEventCrossings(initialInstance, 0, 1)).toEqual([]);
  });

  it("delivers a once event only once across a multi-iteration crossing", () => {
    const onceInstance = {
      ...instance,
      events: [{ ...instance.events[0], occurrence: "once" }],
    };

    expect(
      collectTimelineEventCrossings(onceInstance, 0, 30, {
        maximumDeliveries: 1,
      }).map(({ resolvedTime }) => resolvedTime),
    ).toEqual([5]);
    expect(
      collectTimelineEventCrossings(onceInstance, 30, 0, {
        maximumDeliveries: 1,
      }).map(({ resolvedTime }) => resolvedTime),
    ).toEqual([25]);
  });

  it("orders nested repeated events through an alternating parent", () => {
    const nestedInstance = {
      domains: {
        root: {
          parent: null,
          start: 0,
          cycleDuration: 100,
          iterations: 2,
          iterationGap: 0,
          direction: "alternate",
          rate: 1,
        },
        child: {
          parent: "root",
          start: 20,
          cycleDuration: 20,
          iterations: 2,
          iterationGap: 10,
          direction: "forward",
          rate: 2,
        },
      },
      events: [{ ...instance.events[0], domain: "child", time: 5 }],
    };

    expect(
      collectTimelineEventCrossings(nestedInstance, 0, 200).map(
        ({ resolvedTime, iterationTuple }) => [resolvedTime, iterationTuple],
      ),
    ).toEqual([
      [22.5, [0, 0]],
      [37.5, [0, 1]],
      [162.5, [1, 1]],
      [177.5, [1, 0]],
    ]);
    expect(
      collectTimelineEventCrossings(nestedInstance, 165, 160).map(
        ({ resolvedTime }) => resolvedTime,
      ),
    ).toEqual([162.5]);
  });
});
