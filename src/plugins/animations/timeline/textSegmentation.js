export const PORTABLE_UNICODE_SEGMENTATION = Object.freeze({
  standard: "unicode-uax29",
  version: "17.0.0",
});

// These code points are letters introduced in Unicode 17. They make an older
// engine fail closed instead of silently producing a different target list.
const unicode17LetterProbes = Object.freeze([
  "\u{11db0}", // Tolong Siki
  "\u{16ea0}", // Beria Erfe
  "\u{10940}", // Sidetic
]);

let unicode17Checked = false;

export const assertPortableUnicode17Support = () => {
  if (unicode17Checked) return;
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
    throw new Error(
      "Portable text targets require an Intl.Segmenter implementation conforming to Unicode 17.0.0.",
    );
  }
  const isLetter = /^\p{Letter}$/u;
  if (!unicode17LetterProbes.every((value) => isLetter.test(value))) {
    throw new Error(
      "Portable text targets require Unicode 17.0.0 property data.",
    );
  }
  unicode17Checked = true;
};

const createSegmenter = (granularity) => {
  assertPortableUnicode17Support();
  return new Intl.Segmenter("und", { granularity });
};

const toUnits = (text, granularity) => {
  const value = String(text ?? "");
  return [...createSegmenter(granularity).segment(value)].map((entry) => ({
    segment: entry.segment,
    start: entry.index,
    end: entry.index + entry.segment.length,
    ...(entry.isWordLike === undefined ? {} : { isWordLike: entry.isWordLike }),
  }));
};

export const segmentPortableGraphemes = (text) => toUnits(text, "grapheme");

export const segmentPortableWords = (text) =>
  toUnits(text, "word")
    .filter(({ segment }) => !/^\s+$/u.test(segment))
    .map(({ isWordLike: _isWordLike, ...unit }) => unit);

export const segmentPortableLines = (text) => {
  const value = String(text ?? "");
  const units = [];
  let start = 0;
  for (let index = 0; index <= value.length; index++) {
    if (index !== value.length && value[index] !== "\n") continue;
    const end = index > start && value[index - 1] === "\r" ? index - 1 : index;
    units.push({ segment: value.slice(start, end), start, end });
    start = index + 1;
  }
  return units;
};

const isRtl = (value) =>
  /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u.test(value);

export const orderPortableTextUnits = (units, order) => {
  if (order !== "visual") return [...units];
  const result = [];
  let run = [];
  let rtl = null;
  const flush = () => {
    result.push(...(rtl ? [...run].reverse() : run));
    run = [];
  };
  for (const unit of units) {
    const nextRtl = [...unit.segment].some(isRtl);
    if (rtl !== null && nextRtl !== rtl) flush();
    rtl = nextRtl;
    run.push(unit);
  }
  flush();
  return result;
};

export const segmentPortableText = (text, unit, order = "logical") => {
  const units =
    unit === "grapheme"
      ? segmentPortableGraphemes(text)
      : unit === "word"
        ? segmentPortableWords(text)
        : segmentPortableLines(text);
  return orderPortableTextUnits(
    units.filter(({ segment }) => segment !== "\r" && segment !== "\n"),
    order,
  );
};
