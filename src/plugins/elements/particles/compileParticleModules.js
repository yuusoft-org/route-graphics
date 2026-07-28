/**
 * Compile structured particle modules into the legacy computed runtime shape.
 */
import { parseCommonObject } from "../util/parseCommonObject.js";

/**
 * @param {Object} state
 * @returns {import("../../../types.js").ParticlesComputedNode}
 */
export function compileParticleModules(state) {
  const emitter = compileEmission(state);
  const behaviors = [];

  behaviors.push(compileSourceBehavior(state.modules.emission.source));

  const movementBehavior = compileMovementBehavior(state.modules.movement);
  if (movementBehavior) {
    behaviors.push(movementBehavior);
  }

  behaviors.push(...compileAppearanceBehaviors(state.modules.appearance));

  const bounds = compileBounds(state.modules.bounds, state.width, state.height);
  if (bounds) {
    emitter.spawnBounds = bounds.spawnBounds;
    emitter.recycleOnBounds = true;
  }

  const texture = compileTexture(state.modules.appearance.texture);
  const count = emitter.maxParticles;
  const computedObj = parseCommonObject({
    ...state,
    scaleX: undefined,
    scaleY: undefined,
  });

  return {
    ...computedObj,
    count,
    texture,
    behaviors,
    emitter,
  };
}

function compileEmission(state) {
  const { emission } = state.modules;
  const emitter = {
    lifetime: normalizeRangeConfig(emission.particleLifetime),
    maxParticles:
      emission.mode === "burst"
        ? Math.max(
            emission.maxActive ?? emission.burstCount,
            emission.burstCount,
          )
        : (emission.maxActive ?? 100),
    emitterLifetime:
      emission.duration === undefined || emission.duration === "infinite"
        ? -1
        : emission.duration,
    ...(state.seed !== undefined && { seed: state.seed }),
  };

  if (emission.mode === "continuous") {
    emitter.frequency = 1 / emission.rate;
    emitter.particlesPerWave = 1;
  } else {
    emitter.frequency = 0;
    emitter.particlesPerWave = emission.burstCount;
  }

  return emitter;
}

function compileSourceBehavior(source) {
  return {
    type: "spawnShape",
    config: {
      type: source.kind,
      data: compileSourceData(source.kind, source.data),
    },
  };
}

function compileSourceData(kind, data) {
  if (kind === "rect") {
    return {
      x: data.x,
      y: data.y,
      w: data.width,
      h: data.height,
    };
  }

  return { ...data };
}

function compileMovementBehavior(movement) {
  if (!movement) return null;

  const config = {
    maxSpeed: movement.maxSpeed ?? 0,
    faceVelocity: movement.faceVelocity ?? false,
  };

  if (movement.velocity) {
    config.velocity = {
      kind: movement.velocity.kind,
      speed: normalizeRangeConfig(movement.velocity.speed),
    };

    if (movement.velocity.kind === "directional") {
      config.velocity.direction = normalizeRangeConfig(
        movement.velocity.direction,
      );
    } else {
      config.velocity.angle = normalizeRangeConfig(
        movement.velocity.angle ?? { min: 0, max: 360 },
      );
    }
  }

  if (movement.acceleration) {
    config.acceleration = {
      x: movement.acceleration.x,
      y: movement.acceleration.y,
    };
  }

  return {
    type: "movement",
    config,
  };
}

function compileAppearanceBehaviors(appearance) {
  const behaviors = [];

  if (appearance.scale) {
    behaviors.push(compileScaleBehavior(appearance.scale));
  }

  if (appearance.alpha) {
    behaviors.push(compileAlphaBehavior(appearance.alpha));
  }

  if (appearance.color) {
    behaviors.push(compileColorBehavior(appearance.color));
  }

  if (appearance.rotation) {
    const rotationBehavior = compileRotationBehavior(appearance.rotation);
    if (rotationBehavior) {
      behaviors.push(rotationBehavior);
    }
  }

  return behaviors;
}

function compileTexture(texture) {
  if (typeof texture === "string") return texture;
  if (texture.shape) return { ...texture };

  const selector = {
    mode: texture.mode,
    pick: texture.pick ?? "perParticle",
    items: texture.items.map(normalizeTextureItem),
  };

  if (selector.mode === "single" && selector.items.length === 1) {
    const [item] = selector.items;
    return item.src ?? copyTextureShape(item);
  }

  return selector;
}

function normalizeTextureItem(item) {
  if (item.src) {
    return item.weight === undefined
      ? { src: item.src }
      : { src: item.src, weight: item.weight };
  }

  const shape = copyTextureShape(item);
  if (item.weight !== undefined) {
    shape.weight = item.weight;
  }
  return shape;
}

function copyTextureShape(shape) {
  return {
    shape: shape.shape,
    ...(shape.radius !== undefined ? { radius: shape.radius } : {}),
    ...(shape.width !== undefined ? { width: shape.width } : {}),
    ...(shape.height !== undefined ? { height: shape.height } : {}),
    ...(shape.color !== undefined ? { color: shape.color } : {}),
  };
}

function compileScaleBehavior(scale) {
  if (scale.mode === "curve") {
    return {
      type: "scale",
      config: {
        list: compileCurveKeys(scale.keys),
      },
    };
  }

  const range =
    scale.mode === "single"
      ? { min: scale.value, max: scale.value }
      : normalizeRangeConfig(scale);

  return {
    type: "scaleStatic",
    config: range,
  };
}

function compileAlphaBehavior(alpha) {
  if (alpha.mode === "curve") {
    return {
      type: "alpha",
      config: {
        list: compileCurveKeys(alpha.keys),
      },
    };
  }

  return {
    type: "alphaStatic",
    config: {
      alpha: alpha.value,
    },
  };
}

function compileColorBehavior(color) {
  if (color.mode === "gradient") {
    return {
      type: "color",
      config: {
        list: compileCurveKeys(color.keys),
      },
    };
  }

  return {
    type: "colorStatic",
    config: {
      color: color.value,
    },
  };
}

function compileRotationBehavior(rotation) {
  if (rotation.mode === "none") {
    return null;
  }

  if (rotation.mode === "fixed") {
    return {
      type: "noRotation",
      config: {
        rotation: rotation.value,
      },
    };
  }

  if (rotation.mode === "random") {
    const range = normalizeRangeConfig(rotation);
    return {
      type: "rotationStatic",
      config: {
        min: range.min,
        max: range.max,
        distribution: range.distribution,
      },
    };
  }

  const start = normalizeRangeConfig(rotation.start);
  const speed = normalizeRangeConfig(rotation.speed);

  return {
    type: "rotation",
    config: {
      minStart: start.min,
      maxStart: start.max,
      startDistribution: start.distribution,
      minSpeed: speed.min,
      maxSpeed: speed.max,
      speedDistribution: speed.distribution,
      accel: rotation.accel ?? 0,
    },
  };
}

function compileBounds(bounds, width, height) {
  if (!bounds || bounds.mode === "none") {
    return null;
  }

  if (bounds.source === "custom") {
    return {
      spawnBounds: { ...bounds.custom },
    };
  }

  const padding = normalizePadding(bounds.padding ?? 0);
  return {
    spawnBounds: {
      x: -padding.left,
      y: -padding.top,
      width: width + padding.left + padding.right,
      height: height + padding.top + padding.bottom,
    },
  };
}

function normalizePadding(padding) {
  if (typeof padding === "number") {
    return {
      top: padding,
      right: padding,
      bottom: padding,
      left: padding,
    };
  }

  return {
    top: padding.top,
    right: padding.right,
    bottom: padding.bottom,
    left: padding.left,
  };
}

function compileCurveKeys(keys) {
  return keys.map((key) => ({
    time: key.time,
    value: key.value,
  }));
}

function normalizeRangeConfig(value) {
  if (typeof value === "number") {
    return { min: value, max: value };
  }

  return {
    min: value.min,
    max: value.max ?? value.min,
    ...(value.distribution !== undefined
      ? { distribution: { ...value.distribution } }
      : {}),
  };
}
