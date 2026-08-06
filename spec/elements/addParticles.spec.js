import { Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

import { addParticle } from "../../src/plugins/elements/particles/addParticles.js";
import { createAnimationBus } from "../../src/plugins/animations/animationBus.js";
import {
  createAnimatedShaderFilterFixture,
  createFilterAnimationFixture,
} from "../util/shaderFilterFixtures.js";

function createApp() {
  return {
    renderer: {
      generateTexture: vi.fn(() => Texture.WHITE),
    },
    ticker: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  };
}

function collectPositions(emitter) {
  const positions = [];
  let particle = emitter._activeFirst;

  while (particle) {
    positions.push({ x: particle.x, y: particle.y });
    particle = particle.next;
  }

  return positions;
}

describe("addParticle", () => {
  it("keeps particle bounds local and applies the full signed live scale", () => {
    const parent = new Container();
    const app = createApp();
    const element = {
      id: "mirrored-particles",
      type: "particles",
      x: 200,
      y: 120,
      width: 100,
      height: 80,
      originX: -50,
      originY: 40,
      scaleX: -1.5,
      scaleY: 2,
      count: 1,
      texture: {
        shape: "circle",
        radius: 2,
        color: "#ffffff",
      },
      behaviors: [],
      emitter: {
        lifetime: { min: 1, max: 1 },
        frequency: 1,
        maxParticles: 1,
      },
    };

    addParticle({
      app,
      parent,
      element,
      animations: [],
      animationBus: createAnimationBus(),
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      renderContext: {},
      zIndex: 0,
    });

    const particles = parent.getChildByLabel(element.id);
    expect(particles.scale.x).toBe(-1.5);
    expect(particles.scale.y).toBe(2);
    expect(particles.pivot).toMatchObject({ x: 100 / 3, y: 20 });
    expect(particles.x).toBe(150);
    expect(particles.y).toBe(160);
    particles.emitter.destroy();
    particles.destroy({ children: true });
  });

  it("installs shader filters before dispatching mount animations", () => {
    const parent = new Container();
    const app = createApp();
    const animationBus = createAnimationBus();
    const element = {
      id: "animated-particles",
      type: "particles",
      width: 100,
      height: 100,
      count: 1,
      texture: {
        shape: "circle",
        radius: 2,
        color: "#ffffff",
      },
      behaviors: [],
      emitter: {
        lifetime: { min: 1, max: 1 },
        frequency: 0.1,
        maxParticles: 1,
      },
      filters: createAnimatedShaderFilterFixture(),
    };

    addParticle({
      app,
      parent,
      element,
      animations: createFilterAnimationFixture(element.id),
      animationBus,
      completionTracker: {
        getVersion: () => 1,
        track: vi.fn(),
        complete: vi.fn(),
      },
      renderContext: {},
      zIndex: 0,
    });
    animationBus.flush();

    const particles = parent.getChildByLabel(element.id);
    expect(
      particles.filters[0].resources.shaderUniforms.uniforms.uAmount,
    ).toBeCloseTo(0.4);
    particles.emitter.destroy();
    particles.destroy({ children: true });
  });

  it("emits burst particles immediately on mount without weather-style prefill", () => {
    const parent = new Container();
    const app = createApp();

    addParticle({
      app,
      parent,
      renderContext: {},
      zIndex: 0,
      element: {
        id: "burst",
        type: "particles",
        x: 40,
        y: 60,
        originX: 20,
        originY: 15,
        rotation: 30,
        width: 1280,
        height: 720,
        count: 6,
        texture: {
          shape: "rect",
          width: 4,
          height: 18,
          color: "#ffffff",
        },
        behaviors: [
          {
            type: "spawnShape",
            config: {
              type: "circle",
              data: {
                x: 640,
                y: 360,
                radius: 12,
                innerRadius: 4,
              },
            },
          },
          {
            type: "movement",
            config: {
              velocity: {
                kind: "radial",
                angle: { min: 0, max: 360 },
                speed: 200,
              },
              faceVelocity: true,
            },
          },
        ],
        emitter: {
          lifetime: { min: 1, max: 1 },
          frequency: 0,
          particlesPerWave: 6,
          maxParticles: 6,
          emitterLifetime: 0.1,
          spawnBounds: {
            x: 260,
            y: 160,
            width: 760,
            height: 400,
          },
          recycleOnBounds: true,
          seed: 9876,
        },
      },
    });

    const container = parent.getChildByLabel("burst");
    const emitter = container.emitter;

    expect(container.x).toBe(60);
    expect(container.y).toBe(75);
    expect(container.pivot.x).toBe(20);
    expect(container.pivot.y).toBe(15);
    expect(container.rotation).toBeCloseTo(Math.PI / 6);
    expect(emitter.particleCount).toBe(6);
    expect(emitter.emit).toBe(false);

    const positions = collectPositions(emitter);
    const xSpread =
      Math.max(...positions.map((point) => point.x)) -
      Math.min(...positions.map((point) => point.x));
    const ySpread =
      Math.max(...positions.map((point) => point.y)) -
      Math.min(...positions.map((point) => point.y));

    expect(xSpread).toBeGreaterThan(0);
    expect(ySpread).toBeGreaterThan(0);

    container.tickerCallback({ deltaTime: 600 });
    expect(emitter.particleCount).toBe(6);
  });

  it("prefills continuous recycled emitters so weather effects do not start empty", () => {
    const parent = new Container();
    const app = createApp();

    addParticle({
      app,
      parent,
      renderContext: {},
      zIndex: 0,
      element: {
        id: "snow",
        type: "particles",
        width: 1280,
        height: 720,
        count: 12,
        texture: {
          shape: "circle",
          radius: 4,
          color: "#ffffff",
        },
        behaviors: [
          {
            type: "spawnShape",
            config: {
              type: "line",
              data: {
                x1: 0,
                y1: -20,
                x2: 1280,
                y2: -20,
              },
            },
          },
        ],
        emitter: {
          lifetime: { min: 4, max: 4 },
          frequency: 0.05,
          particlesPerWave: 1,
          maxParticles: 12,
          emitterLifetime: -1,
          spawnBounds: {
            x: -50,
            y: -50,
            width: 1380,
            height: 820,
          },
          recycleOnBounds: true,
          seed: 12345,
        },
      },
    });

    const container = parent.getChildByLabel("snow");
    const emitter = container.emitter;

    expect(emitter.particleCount).toBe(12);

    const yValues = collectPositions(emitter).map((point) => point.y);
    expect(Math.max(...yValues)).toBeGreaterThan(0);
  });
});
