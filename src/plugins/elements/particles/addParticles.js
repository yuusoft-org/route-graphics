import { registerElementCleanup } from "../util/elementResources.js";
import { cleanupParticlesRuntime } from "./particleRuntime.js";
import { Container, Texture, Graphics } from "pixi.js";
import { Emitter } from "./emitter/index.js";
import { getTexture } from "./util/registries.js";
import { queueDeferredParticlesStart } from "../renderContext.js";
import { dispatchLiveAnimations } from "../../animations/planAnimations.js";
import {
  applyElementTransform,
  getElementTransformTargetState,
} from "../util/transform.js";
import { syncShaderFilters } from "../util/shaderFilterEffect.js";

/**
 * @typedef {import('pixi.js').Application} Application
 * @typedef {import('../../../types.js').ParticleTextureShape} ParticleTextureShape
 */

function isTextureSelector(texture) {
  return (
    typeof texture === "object" &&
    texture !== null &&
    !Array.isArray(texture) &&
    typeof texture.mode === "string" &&
    Array.isArray(texture.items)
  );
}

/**
 * Create a texture from inline shape definition.
 * Used when user specifies `texture: { shape: "circle", radius: 5 }` instead of a named texture.
 * @param {Application} app - PixiJS app for renderer access
 * @param {ParticleTextureShape} shapeConfig - Shape definition with shape, color, radius/width/height
 * @return {import('pixi.js').Texture}
 */
function createCustomTexture(app, shapeConfig) {
  const g = new Graphics();
  const color = shapeConfig.color ?? "#ffffff";

  switch (shapeConfig.shape) {
    case "circle": {
      const radius = shapeConfig.radius ?? 3;
      g.circle(0, 0, radius);
      g.fill({ color });
      break;
    }
    case "ellipse": {
      const width = shapeConfig.width ?? 2;
      const height = shapeConfig.height ?? 6;
      g.ellipse(0, 0, width / 2, height / 2);
      g.fill({ color });
      break;
    }
    case "rect": {
      const width = shapeConfig.width ?? 4;
      const height = shapeConfig.height ?? 4;
      g.rect(-width / 2, -height / 2, width, height);
      g.fill({ color });
      break;
    }
    default:
      g.circle(0, 0, 3);
      g.fill({ color });
  }

  return app.renderer.generateTexture(g);
}

function resolveTextureDefinition(app, textureDefinition) {
  if (typeof textureDefinition === "object" && textureDefinition?.shape) {
    return createCustomTexture(app, textureDefinition);
  }

  const textureName = textureDefinition ?? "circle";
  let texture = getTexture(textureName, app);
  if (!texture) {
    try {
      texture = Texture.from(textureName);
    } catch (e) {
      console.warn(`Failed to load particle texture: ${textureName}`);
      return null;
    }
  }

  return texture;
}

function resolveTextureSelector(app, selector) {
  const items = [];

  for (const item of selector.items) {
    const definition = item.src ? item.src : item;
    const texture = resolveTextureDefinition(app, definition);
    if (!texture) {
      return null;
    }

    items.push(
      item.weight === undefined
        ? { texture }
        : { texture, weight: item.weight },
    );
  }

  return {
    mode: selector.mode,
    pick: selector.pick ?? "perParticle",
    items,
  };
}

/**
 * Add a particle effect to the stage using custom behavior configs.
 * @param {import("../elementPlugin.js").AddElementOptions} params
 */
export const addParticle = ({
  app,
  parent,
  element,
  animations,
  animationBus,
  completionTracker,
  renderContext,
  zIndex,
}) => {
  const container = new Container();
  registerElementCleanup(container, () =>
    cleanupParticlesRuntime({ app, particleElement: container }),
  );
  container.label = element.id;
  container.zIndex = zIndex;
  parent.addChild(container);

  const width = element.width;
  const height = element.height;
  applyElementTransform(container, element, { scaleMode: "full" });

  // Build emitter config from custom behaviors
  const emitterConfig = {
    lifetime: element.emitter?.lifetime ?? { min: 1, max: 2 },
    frequency: element.emitter?.frequency ?? 0.1,
    particlesPerWave: element.emitter?.particlesPerWave ?? 1,
    maxParticles: element.emitter?.maxParticles ?? element.count ?? 100,
    emitterLifetime: element.emitter?.emitterLifetime ?? -1,
    spawnBounds: element.emitter?.spawnBounds,
    recycleOnBounds: element.emitter?.recycleOnBounds ?? false,
    seed: element.emitter?.seed,
    behaviors: element.behaviors,
  };

  // Resolve texture: custom shape > named texture > circle
  const texture = isTextureSelector(element.texture)
    ? resolveTextureSelector(app, element.texture)
    : resolveTextureDefinition(app, element.texture);
  if (!texture) return;
  emitterConfig.texture = texture;

  const emitter = new Emitter(container, emitterConfig);
  container.emitter = emitter;

  const isBurstEmitter = emitterConfig.frequency <= 0;

  // Fire burst emitters immediately, then retry across the first few browser
  // frames if the mount/update pipeline still leaves the emitter empty.
  if (isBurstEmitter) {
    emitter.emitNow();
    emitter.emit = false;

    const retryBurstMount = (delays) => {
      if (!delays.length) {
        return;
      }

      const [delay, ...rest] = delays;
      const schedule =
        delay === 0 && typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : (callback) => setTimeout(callback, delay);

      schedule(() => {
        if (emitter.destroyed || emitter.particleCount > 0) {
          return;
        }

        emitter.emitNow();
        retryBurstMount(rest);
      });
    };

    retryBurstMount([0, 50, 150]);
  }

  // Pre-fill continuous recycled effects so they do not start empty.
  if (emitterConfig.recycleOnBounds && !isBurstEmitter) {
    const initialCount = Math.min(
      element.count ?? 100,
      emitterConfig.maxParticles,
    );
    emitter.spawn(initialCount);

    let particle = emitter._activeFirst;
    while (particle) {
      particle.y = emitter.random() * height;
      particle.age = emitter.random() * particle.maxLife * 0.8;
      particle = particle.next;
    }
  }

  // Set up ticker for updates
  const tickerCallback = (ticker) => {
    if (emitter.destroyed) {
      app.ticker.remove(tickerCallback);
      return;
    }

    const deltaSec = Math.min(
      typeof ticker.deltaMS === "number"
        ? ticker.deltaMS / 1000
        : ticker.deltaTime / 60,
      0.1,
    );

    emitter.update(deltaSec);
  };
  container.tickerCallback = tickerCallback;

  queueDeferredParticlesStart(renderContext, {
    app,
    emitter,
    container,
    tickerCallback,
  });

  if (element.alpha !== undefined) {
    container.alpha = element.alpha;
  }
  syncShaderFilters(container, element.filters, {
    width,
    height,
  });

  dispatchLiveAnimations({
    animations,
    targetId: element.id,
    animationBus,
    completionTracker,
    element: container,
    targetState: getElementTransformTargetState(element, {
      alpha: element.alpha ?? container.alpha,
      ...(element.scaleX !== undefined ? { scaleX: element.scaleX } : {}),
      ...(element.scaleY !== undefined ? { scaleY: element.scaleY } : {}),
    }),
    renderContext,
  });
};
