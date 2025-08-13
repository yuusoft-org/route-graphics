import { Observable } from "rxjs";

const easings = {
  linear: (x) => x,
};

const interpolate = (start, end, t, easing) => {
  return start + (end - start) * easings[easing](t);
};

// Lodash-style get function
function get(object, path, defaultValue) {
  if (typeof path === "string") {
    path = path.split(".");
  }

  let result = object;
  for (const key of path) {
    if (result == null) {
      return defaultValue;
    }
    result = result[key];
  }
  return result === undefined ? defaultValue : result;
}

// Lodash-style set function
function set(object, path, value) {
  if (typeof path === "string") {
    path = path.split(".");
  }

  let current = object;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }
  current[path[path.length - 1]] = value;
  return object;
}

/**
 * 
 * @example
 * Input: [
  { id: "a", value: 0 },
  { id: "b", value: 1, duration: 1000, easing: "linear" },
  { id: 'c', value: 0, duration: 1000, easing: "linear" }
]
   output: { '0': 0, '500': 0.5, '1000': 1, '1200': 0.8, '2000': 0 }


 * @param {*} input 
 * @param {*} inputTime 
 * @returns 
 */
const processInput = (input, inputTime) => {
  const keyframes = [];
  let accumulatedTime = 0;
  let latestValue;

  // Create keyframes based on input
  input.forEach(({ value, duration, easing, relative }, index) => {
    if (index === 0) {
      latestValue = value;
      keyframes.push({ time: accumulatedTime, value, easing: "linear" });
    } else if (duration !== undefined && easing !== undefined) {
      accumulatedTime += duration;
      if (relative) {
        latestValue = latestValue + value;
      } else {
        latestValue = value;
      }
      keyframes.push({ time: accumulatedTime, value: latestValue, easing });
    }
  });

  let totalValue = 0;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const { time: startTime, value: startValue, easing } = keyframes[i];
    const { time: endTime, value: endValue } = keyframes[i + 1];

    if (inputTime >= startTime && inputTime <= endTime) {
      const t = (inputTime - startTime) / (endTime - startTime);
      totalValue = interpolate(startValue, endValue, t, easing);
      break;
    } else if (inputTime > endTime) {
      totalValue = endValue;
    }
  }

  return totalValue;
};

function getMaxOfArray(numArray) {
  return Math.max.apply(null, numArray);
}

class KeyframeTransitionPlugin {
  static rendererName = "pixi";
  rendererName = "pixi";
  transitionType = "keyframes";

  _transition = (app, sprite, transition) => {
    return new Observable((observer) => {
      const { properties: propertiesArrayOrObject } =
        transition;
      // TODO: stop supporting arrays

      const animationProperties = Array.isArray(
        propertiesArrayOrObject,
      )
        ? propertiesArrayOrObject
        : Object.entries(propertiesArrayOrObject).map(
          ([property, value]) => ({
            ...value,
            property,
          }),
        );

      const accumulatedDurations = animationProperties.map(
        (animationProperty) => {
          return animationProperty.keyframes.reduce((acc, item) => {
            return acc + item.duration || 0;
          }, 0);
        },
      );
      const maxDuration = getMaxOfArray(accumulatedDurations);

      let currentTimDelta = 0;

      const initialProperties = {};

      animationProperties.forEach((animationProperty) => {
        initialProperties[animationProperty.property] = get(
          sprite,
          animationProperty.property,
        );
      });

      const effect = (time) => {
        currentTimDelta += time.deltaMS;

        if (currentTimDelta >= maxDuration) {
          app.ticker.remove(effect);
          observer.complete();
          return;
        }

        const output = {};

        animationProperties.forEach((animationProperty) => {
          let input = [];
          if (animationProperty.initialValue !== undefined) {
            input = [{ value: animationProperty.initialValue, duration: 0 }];
          } else {
            input = [
              {
                value: initialProperties[animationProperty.property],
                duration: 0,
              },
            ];
          }
          input = input.concat(animationProperty.keyframes);
          set(
            output,
            animationProperty.property,
            processInput(input, currentTimDelta),
          );
        });

        animationProperties.forEach((animationProperty) => {
          const { property } = animationProperty;
          if (sprite && !sprite.destroyed) {
            set(sprite, property, get(output, property));
          }
        });
      };

      app.ticker.add(effect);

      return () => {
        app.ticker.remove(effect);
        // Set to final state when torn down
        effect({ deltaMS: maxDuration - currentTimDelta });
      };
    });
  };

  add = (app, sprite, transition) => {
    return this._transition(app, sprite, transition);
  };

  remove = (app, sprite, transition) => {
    return this._transition(app, sprite, transition);
  };
}

export { KeyframeTransitionPlugin };
