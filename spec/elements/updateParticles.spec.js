import { Container } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addParticle, deleteParticles, dispatchLiveAnimations } = vi.hoisted(
  () => ({
    addParticle: vi.fn(),
    deleteParticles: vi.fn(),
    dispatchLiveAnimations: vi.fn(() => false),
  }),
);

vi.mock("../../src/plugins/elements/particles/addParticles.js", () => ({
  addParticle,
}));

vi.mock("../../src/plugins/elements/particles/deleteParticles.js", () => ({
  deleteParticles,
}));

vi.mock("../../src/plugins/animations/planAnimations.js", () => ({
  dispatchLiveAnimations,
}));

import { updateParticles } from "../../src/plugins/elements/particles/updateParticles.js";

function createParticleNode(overrides = {}) {
  return {
    id: "snow-effect",
    type: "particles",
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
    alpha: 1,
    count: 100,
    texture: {
      shape: "circle",
      radius: 5,
      color: "#ffffff",
    },
    behaviors: [],
    emitter: {
      lifetime: { min: 3, max: 5 },
      frequency: 0.01,
      particlesPerWave: 1,
      maxParticles: 100,
      emitterLifetime: -1,
      recycleOnBounds: true,
      spawnBounds: {
        x: -50,
        y: -50,
        width: 1380,
        height: 820,
      },
      seed: 12345,
    },
    ...overrides,
  };
}

describe("updateParticles", () => {
  const app = {
    ticker: {
      add: vi.fn(),
      remove: vi.fn(),
    },
  };
  const animations = [];
  const animationBus = {};
  const completionTracker = {};
  const renderContext = {
    suppressAnimations: true,
    deferredMountOperations: [],
  };

  beforeEach(() => {
    addParticle.mockReset();
    deleteParticles.mockReset();
    dispatchLiveAnimations.mockReset();
    dispatchLiveAnimations.mockReturnValue(false);
    renderContext.deferredMountOperations.length = 0;
  });

  it("passes renderContext when adding particles to a missing container", () => {
    const parent = new Container();
    const nextElement = createParticleNode();

    updateParticles({
      app,
      parent,
      prevElement: createParticleNode(),
      nextElement,
      animations,
      animationBus,
      completionTracker,
      renderContext,
      zIndex: 3,
    });

    expect(addParticle).toHaveBeenCalledTimes(1);
    expect(addParticle).toHaveBeenCalledWith(
      expect.objectContaining({
        renderContext,
        element: nextElement,
        zIndex: 3,
      }),
    );
  });

  it("passes renderContext when recreating a particle emitter", () => {
    const parent = new Container();
    const existingContainer = new Container();
    existingContainer.label = "snow-effect";
    parent.addChild(existingContainer);

    const prevElement = createParticleNode();
    const nextElement = createParticleNode({
      emitter: {
        ...prevElement.emitter,
        maxParticles: 150,
      },
      count: 150,
    });

    updateParticles({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      renderContext,
      zIndex: 4,
    });

    expect(deleteParticles).toHaveBeenCalledTimes(1);
    expect(addParticle).toHaveBeenCalledTimes(1);
    expect(addParticle).toHaveBeenCalledWith(
      expect.objectContaining({
        renderContext,
        element: nextElement,
        zIndex: 4,
      }),
    );
  });

  it("updates and resets the emitter container rotation without recreation", () => {
    const parent = new Container();
    const existingContainer = new Container();
    existingContainer.label = "snow-effect";
    existingContainer.rotation = Math.PI / 2;
    parent.addChild(existingContainer);

    const prevElement = createParticleNode({
      originX: 30,
      originY: 20,
      rotation: 90,
    });
    const nextElement = createParticleNode({
      x: 50,
      y: 70,
      originX: 12,
      originY: 8,
      rotation: 0,
    });

    updateParticles({
      app,
      parent,
      prevElement,
      nextElement,
      animations,
      animationBus,
      completionTracker,
      renderContext,
      zIndex: 5,
    });

    expect(deleteParticles).not.toHaveBeenCalled();
    expect(addParticle).not.toHaveBeenCalled();
    expect(existingContainer.x).toBe(62);
    expect(existingContainer.y).toBe(78);
    expect(existingContainer.pivot.x).toBe(12);
    expect(existingContainer.pivot.y).toBe(8);
    expect(existingContainer.rotation).toBe(0);
  });
});
