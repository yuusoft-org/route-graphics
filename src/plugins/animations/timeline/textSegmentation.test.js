import { describe, expect, it } from "vitest";
import {
  segmentPortableGraphemes,
  segmentPortableLines,
  segmentPortableText,
  segmentPortableWords,
} from "./textSegmentation.js";

describe("portable Unicode 17 text segmentation", () => {
  it("keeps combining, surrogate, flags, and emoji ZWJ clusters intact", () => {
    expect(
      segmentPortableGraphemes("e\u0301😀👨‍👩‍👧‍👦🇸🇬").map((unit) => unit.segment),
    ).toEqual(["e\u0301", "😀", "👨‍👩‍👧‍👦", "🇸🇬"]);
  });

  it("segments words without making whitespace animation targets", () => {
    expect(
      segmentPortableWords("Hello, 世界! 42 can't").map((unit) => unit.segment),
    ).toEqual(["Hello", ",", "世界", "!", "42", "can't"]);
  });

  it("uses Unicode 17 grapheme rules for Indic conjuncts", () => {
    expect(
      segmentPortableGraphemes("क्‍ष").map((unit) => unit.segment),
    ).toEqual(["क्‍ष"]);
  });

  it("preserves empty explicit lines and supports visual RTL ordering", () => {
    expect(segmentPortableLines("a\n\nb").map((unit) => unit.segment)).toEqual([
      "a",
      "",
      "b",
    ]);
    expect(
      segmentPortableText("אבג", "grapheme", "visual").map(
        (unit) => unit.segment,
      ),
    ).toEqual(["ג", "ב", "א"]);
  });
});
