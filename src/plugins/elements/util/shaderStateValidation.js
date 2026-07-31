const getTweenValues = (config) => [
  ...(config.initialValue === undefined ? [] : [config.initialValue]),
  ...config.keyframes.map((keyframe) => keyframe.value),
];

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const valueMatchesParameter = (parameter, value) => {
  if (parameter.type === "f32") {
    return isFiniteNumber(value);
  }

  return (
    Array.isArray(value) &&
    value.length === parameter.value.length &&
    value.every(isFiniteNumber)
  );
};

const validateTweenParameters = ({
  animation,
  effect,
  effectDescription,
  tween,
}) => {
  const parameters = new Map(
    (effect.parameters ?? []).map((parameter) => [parameter.key, parameter]),
  );

  for (const [key, config] of Object.entries(tween ?? {})) {
    const parameter =
      key === "uProgress"
        ? { key, type: "f32", value: 0 }
        : parameters.get(key);
    const authoredKey = key === "uProgress" ? "progress" : key;

    if (!parameter) {
      throw new Error(
        `Animation "${animation.id}" cannot target unknown parameter "${authoredKey}" on ${effectDescription}.`,
      );
    }

    for (const value of getTweenValues(config)) {
      if (!valueMatchesParameter(parameter, value)) {
        const expected =
          parameter.type === "f32"
            ? "a finite number"
            : `a ${parameter.value.length}-number array`;
        throw new Error(
          `Animation "${animation.id}" parameter "${authoredKey}" on ${effectDescription} must be ${expected}.`,
        );
      }
    }
  }
};

const indexElementsById = (elements, index = new Map()) => {
  for (const element of elements ?? []) {
    if (typeof element?.id === "string") {
      index.set(element.id, element);
    }
    indexElementsById(element?.children, index);
  }
  return index;
};

/**
 * Validates shader animation bindings before rendering mutates the display
 * tree. Runtime dispatch still revalidates mounted targets as a defensive
 * boundary.
 */
export const validateShaderAnimationBindings = ({
  elements = [],
  animations = [],
}) => {
  const elementById = indexElementsById(elements);

  for (const animation of animations) {
    if (animation.type === "transition" && animation.compositor) {
      validateTweenParameters({
        animation,
        effect: animation.compositor,
        effectDescription: "transition compositor",
        tween: animation.compositor.tween,
      });
      continue;
    }

    for (const [filterId, tween] of Object.entries(
      animation.filterTweens ?? {},
    )) {
      const element = elementById.get(animation.targetId);
      const filter = element?.filters?.find(
        (candidate) => candidate.id === filterId,
      );

      if (!filter) {
        throw new Error(
          `Animation "${animation.id}" could not find shader filter "${filterId}" on element "${animation.targetId}".`,
        );
      }

      validateTweenParameters({
        animation,
        effect: filter,
        effectDescription: `shader filter "${filterId}" on element "${animation.targetId}"`,
        tween,
      });
    }
  }
};
