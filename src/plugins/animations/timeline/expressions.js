import {
  addTimelineValues,
  cloneTimelineValue,
  isNumericSequence,
} from "./valueTypes.js";
import { deterministicRandomUnit } from "./random.js";
import { assertFiniteNumber } from "./validation.js";

const assertResult = (value, path) => {
  if (isNumericSequence(value)) {
    const result = Array.from(value);
    result.forEach((component, index) =>
      assertFiniteNumber(component, `${path}[${index}]`),
    );
    return result;
  }
  if (typeof value === "number") assertFiniteNumber(value, path);
  return value;
};

const subtractValues = (left, right, path) =>
  addTimelineValues(
    left,
    isNumericSequence(right) ? Array.from(right, (value) => -value) : -right,
    path,
  );

const scaleValue = (value, scalar, path, divide = false) => {
  assertFiniteNumber(scalar, `${path}.scalar`);
  if (divide && scalar === 0) throw new Error(`${path} divides by zero.`);
  const factor = divide ? 1 / scalar : scalar;
  if (isNumericSequence(value)) {
    return Array.from(value, (component) => component * factor);
  }
  assertFiniteNumber(value, `${path}.value`);
  return value * factor;
};

const randomParts = (expression, context, randomCounter) => [
  context.programId,
  context.sourcePath,
  context.targetIdentity,
  context.channel,
  context.iteration ?? 0,
  expression.seed ?? "",
  randomCounter,
];

export const evaluateExpression = (
  expression,
  context,
  path = "expression",
  randomState = { counter: context.randomCounter ?? 0 },
) => {
  let result;
  switch (expression.kind) {
    case "constant":
      result = cloneTimelineValue(expression.value);
      break;
    case "underlying":
      result = cloneTimelineValue(context.underlying);
      break;
    case "targetState": {
      const property = expression.property ?? context.property;
      if (
        context.targetState == null ||
        !Object.prototype.hasOwnProperty.call(context.targetState, property)
      ) {
        throw new Error(
          `${path} cannot resolve target-state property "${property}".`,
        );
      }
      result = cloneTimelineValue(context.targetState[property]);
      break;
    }
    case "subjectDimension":
    case "subjectBase": {
      const value = context.subject?.[expression.axis];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${path} cannot resolve subject ${expression.axis}.`);
      }
      result = value;
      break;
    }
    case "targetIndex":
      result = context.targetIndex;
      break;
    case "targetCount":
      result = context.targetCount;
      break;
    case "iteration":
      result = context.iteration ?? 0;
      break;
    case "add":
      result = addTimelineValues(
        evaluateExpression(
          expression.left,
          context,
          `${path}.left`,
          randomState,
        ),
        evaluateExpression(
          expression.right,
          context,
          `${path}.right`,
          randomState,
        ),
        path,
      );
      break;
    case "subtract":
      result = subtractValues(
        evaluateExpression(
          expression.left,
          context,
          `${path}.left`,
          randomState,
        ),
        evaluateExpression(
          expression.right,
          context,
          `${path}.right`,
          randomState,
        ),
        path,
      );
      break;
    case "multiply": {
      const left = evaluateExpression(
        expression.left,
        context,
        `${path}.left`,
        randomState,
      );
      const right = evaluateExpression(
        expression.right,
        context,
        `${path}.right`,
        randomState,
      );
      if (isNumericSequence(left) && isNumericSequence(right)) {
        throw new Error(`${path} cannot multiply two numeric shapes.`);
      }
      result = isNumericSequence(left)
        ? scaleValue(left, right, path)
        : scaleValue(right, left, path);
      break;
    }
    case "divide": {
      const left = evaluateExpression(
        expression.left,
        context,
        `${path}.left`,
        randomState,
      );
      const right = evaluateExpression(
        expression.right,
        context,
        `${path}.right`,
        randomState,
      );
      if (isNumericSequence(right)) {
        throw new Error(`${path} divisor must be a scalar.`);
      }
      result = scaleValue(left, right, path, true);
      break;
    }
    case "min":
    case "max": {
      const values = expression.values.map((item, index) =>
        evaluateExpression(
          item,
          context,
          `${path}.values[${index}]`,
          randomState,
        ),
      );
      values.forEach((value, index) =>
        assertFiniteNumber(value, `${path}.values[${index}]`),
      );
      result = Math[expression.kind](...values);
      break;
    }
    case "clamp": {
      const value = evaluateExpression(
        expression.value,
        context,
        `${path}.value`,
        randomState,
      );
      const min = evaluateExpression(
        expression.min,
        context,
        `${path}.min`,
        randomState,
      );
      const max = evaluateExpression(
        expression.max,
        context,
        `${path}.max`,
        randomState,
      );
      [value, min, max].forEach((item, index) =>
        assertFiniteNumber(item, `${path}[${index}]`),
      );
      if (min > max) throw new Error(`${path} clamp min exceeds max.`);
      result = Math.min(Math.max(value, min), max);
      break;
    }
    case "randomNumber": {
      const unit = deterministicRandomUnit(
        randomParts(expression, context, randomState.counter++),
      );
      if (expression.step === undefined) {
        result = expression.min + (expression.max - expression.min) * unit;
      } else {
        const count =
          Math.floor((expression.max - expression.min) / expression.step) + 1;
        result = expression.min + Math.floor(unit * count) * expression.step;
      }
      break;
    }
    case "randomChoice": {
      const unit = deterministicRandomUnit(
        randomParts(expression, context, randomState.counter++),
      );
      result = cloneTimelineValue(
        expression.choices[Math.floor(unit * expression.choices.length)],
      );
      break;
    }
    default:
      throw new Error(`${path}.kind "${expression.kind}" is not supported.`);
  }
  return assertResult(result, path);
};
