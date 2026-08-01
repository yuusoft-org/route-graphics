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
});
