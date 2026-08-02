import { calculateStaggerSpan } from "./stagger.js";
import { assertSafeTime, checkedTimeAdd } from "./validation.js";

export const evaluateTimingExpression = (
  expression,
  context,
  path = "timing",
) => {
  if (Number.isSafeInteger(expression)) {
    assertSafeTime(expression, path);
    return expression;
  }
  let result;
  switch (expression.kind) {
    case "targetCount":
      result = context.targetCounts.get(expression.targets) ?? 0;
      break;
    case "staggerSpan":
      result = calculateStaggerSpan(
        context.targetCounts.get(expression.targets) ?? 0,
        expression.stagger,
        { seedParts: [context.programId, expression.targets] },
      );
      break;
    case "childStart":
      result = context.childStarts.get(expression.child);
      break;
    case "childEnd":
      result = context.childEnds.get(expression.child);
      break;
    case "scheduleEnd":
      result = context.scheduleEnds.get(expression.schedule);
      break;
    case "add":
      result = expression.values.reduce(
        (sum, item, index) =>
          checkedTimeAdd(
            sum,
            evaluateTimingExpression(item, context, `${path}.values[${index}]`),
            path,
          ),
        0,
      );
      break;
    case "subtract": {
      const values = expression.values.map((item, index) =>
        evaluateTimingExpression(item, context, `${path}.values[${index}]`),
      );
      result = values.slice(1).reduce((value, item) => value - item, values[0]);
      break;
    }
    case "max":
      result = Math.max(
        ...expression.values.map((item, index) =>
          evaluateTimingExpression(item, context, `${path}.values[${index}]`),
        ),
      );
      break;
    case "ceilDivide":
      result = Math.ceil(
        evaluateTimingExpression(expression.value, context, `${path}.value`) /
          expression.rate,
      );
      break;
    case "multiply":
      result =
        evaluateTimingExpression(expression.value, context, `${path}.value`) *
        expression.factor;
      break;
    default:
      throw new Error(`${path}.kind "${expression.kind}" is not supported.`);
  }
  assertSafeTime(result, path);
  return result;
};
