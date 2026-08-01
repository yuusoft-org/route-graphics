import { normalizeEasing, sampleEasing } from "./easing.js";
import { deterministicRandomUnit } from "./random.js";
import { assertSafeTime } from "./validation.js";

const halfUp = (value) => Math.floor(value + 0.5);

const createPermutationRanks = (count, seedParts) => {
  const values = Array.from({ length: count }, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    const unit = deterministicRandomUnit(
      [...seedParts, "stagger"],
      count - index - 1,
    );
    const other = Math.floor(unit * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  const ranks = Array(count);
  values.forEach((targetIndex, rank) => {
    ranks[targetIndex] = rank;
  });
  return ranks;
};

const oneDimensionalDistances = (count, from, seedParts) => {
  if (from === "random") return createPermutationRanks(count, seedParts);
  if (typeof from === "number") {
    if (!Number.isInteger(from) || from < 0 || from >= count) {
      throw new Error(`stagger.from index ${from} is outside the target list.`);
    }
    return Array.from({ length: count }, (_, index) => Math.abs(index - from));
  }
  if (from === "start")
    return Array.from({ length: count }, (_, index) => index);
  if (from === "end") {
    return Array.from({ length: count }, (_, index) => count - 1 - index);
  }
  const center = (count - 1) / 2;
  const centerDistances = Array.from({ length: count }, (_, index) =>
    Math.abs(index - center),
  );
  const minimum = Math.min(...centerDistances);
  const shifted = centerDistances.map((distance) => distance - minimum);
  if (from === "center") return shifted;
  if (from === "edges") {
    const maximum = Math.max(...shifted);
    return shifted.map((distance) => maximum - distance);
  }
  throw new Error(`stagger.from "${from}" is not supported.`);
};

const gridDistances = (count, from, grid, axis, seedParts) => {
  if (from === "random") return createPermutationRanks(count, seedParts);
  const columns = grid.columns;
  if (!Number.isInteger(columns) || columns <= 0) {
    throw new Error("stagger.grid.columns must be a positive integer.");
  }
  const rows = Math.ceil(count / columns);
  const points = Array.from({ length: count }, (_, index) => ({
    x: index % columns,
    y: Math.floor(index / columns),
  }));
  if (from === "edges") {
    return points.map(({ x, y }) =>
      Math.min(x, columns - 1 - x, y, rows - 1 - y),
    );
  }
  let origin;
  if (typeof from === "number") {
    if (!Number.isInteger(from) || from < 0 || from >= count) {
      throw new Error(`stagger.from index ${from} is outside the target list.`);
    }
    origin = points[from];
  } else if (from === "start") origin = { x: 0, y: 0 };
  else if (from === "end") origin = points[count - 1];
  else if (from === "center") {
    origin = { x: (columns - 1) / 2, y: (rows - 1) / 2 };
  } else throw new Error(`stagger.from "${from}" is not supported for a grid.`);

  const distances = points.map((point) => {
    const dx = Math.abs(point.x * 2 - origin.x * 2);
    const dy = Math.abs(point.y * 2 - origin.y * 2);
    if (axis === "x") return dx;
    if (axis === "y") return dy;
    return dx * dx + dy * dy;
  });
  const minimum = Math.min(...distances);
  return distances.map((distance) => distance - minimum);
};

const normalizeDistributionEasing = (input) => {
  const easing = normalizeEasing(input ?? "linear", "stagger.easing");
  const supported =
    easing.kind === "linear" ||
    easing.kind === "sampled" ||
    (easing.kind === "power" && Number.isInteger(easing.exponent));
  if (!supported) {
    throw new Error("stagger.easing must be linear, power, or sampled.");
  }
  for (let index = 0; index <= 100; index++) {
    const value = sampleEasing(easing, index / 100);
    if (value < 0 || value > 1) {
      throw new Error("stagger.easing must remain within [0, 1].");
    }
  }
  return easing;
};

export const calculateStaggerOffsets = (
  count,
  stagger,
  { seedParts = [] } = {},
) => {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      "stagger target count must be a non-negative safe integer.",
    );
  }
  if ((stagger.each === undefined) === (stagger.amount === undefined)) {
    throw new Error("stagger requires exactly one of each or amount.");
  }
  const timing = stagger.each ?? stagger.amount;
  assertSafeTime(
    timing,
    stagger.each === undefined ? "stagger.amount" : "stagger.each",
  );
  if (stagger.axis !== undefined && !new Set(["x", "y"]).has(stagger.axis)) {
    throw new Error("stagger.axis must be x or y.");
  }
  if (stagger.axis !== undefined && !stagger.grid) {
    throw new Error("stagger.axis requires stagger.grid.");
  }
  if (count === 0) return [];
  if (count === 1) return [0];
  const from = stagger.from ?? "start";
  const distances = stagger.grid
    ? gridDistances(count, from, stagger.grid, stagger.axis, seedParts)
    : oneDimensionalDistances(count, from, seedParts);
  const maximum = Math.max(...distances);
  const span = stagger.amount ?? stagger.each * maximum;
  if (!Number.isSafeInteger(span)) {
    throw new Error("stagger span exceeds JSON-safe integer milliseconds.");
  }
  const easing = normalizeDistributionEasing(stagger.easing);
  return distances.map((distance) => {
    if (maximum === 0) return 0;
    if (distance === maximum) return span;
    return halfUp(span * sampleEasing(easing, distance / maximum));
  });
};

export const calculateStaggerSpan = (count, stagger, options) =>
  Math.max(0, ...calculateStaggerOffsets(count, stagger, options));
