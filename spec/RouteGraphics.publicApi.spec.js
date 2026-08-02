import { afterEach, describe, expect, it, vi } from "vitest";

const createMockBounds = (width, height) => ({
  x: 0,
  y: 0,
  width,
  height,
  clone() {
    return createMockBounds(this.width, this.height);
  },
});

const createRejectingWebGLCompiler = () => {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: vi.fn((type) => ({ type })),
    shaderSource: vi.fn(),
    compileShader: vi.fn((shader) => {
      shader.compiled = shader.type !== gl.FRAGMENT_SHADER;
    }),
    getShaderParameter: vi.fn((shader) => shader.compiled),
    getShaderInfoLog: vi.fn(() => "intentional fragment compiler failure"),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ""),
    deleteProgram: vi.fn(),
  };
  return gl;
};

const validShaderSource = {
  webgl: {
    fragment: `
      in vec2 vTextureCoord;
      out vec4 finalColor;
      uniform sampler2D uTexture;
      void main() { finalColor = texture(uTexture, vTextureCoord); }
    `,
  },
  webgpu: {
    source: `
      struct VSOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
      };
      @vertex fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
        return VSOutput(vec4<f32>(aPosition, 0.0, 1.0), aPosition);
      }
      @fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
        return vec4<f32>(uv, 0.0, 1.0);
      }
    `,
  },
};

const createPixiModuleMock = ({ rendererOverrides = {} } = {}) => {
  let lastApplication = null;
  const assetCache = new Map();
  const assetCacheGroups = new Map();
  const assetValues = new Map();

  const removeCachedAsset = (key) => {
    const cacheKeys = assetCacheGroups.get(key) ?? [key];
    cacheKeys.forEach((cacheKey) => assetCache.delete(cacheKey));
    assetCacheGroups.delete(key);
    assetValues.delete(key);
  };

  const setCachedAsset = (key, value) => {
    removeCachedAsset(key);
    const cacheKeys = Array.isArray(value)
      ? value.map((_, index) => `${key}${index === 0 ? "" : index + 1}`)
      : [key];

    cacheKeys.forEach((cacheKey, index) => {
      assetCache.set(cacheKey, Array.isArray(value) ? value[index] : value);
    });
    assetCacheGroups.set(key, cacheKeys);
    assetValues.set(key, value);
  };

  class MockDisplayObject {
    constructor(label = null) {
      this.label = label;
      this.children = [];
      this.width = 0;
      this.height = 0;
      this.x = 0;
      this.y = 0;
      this.alpha = 1;
      this.eventMode = "auto";
    }

    addChild(child) {
      this.children.push(child);
      child.parent = this;
      return child;
    }

    removeChild(child) {
      this.children = this.children.filter((candidate) => candidate !== child);
      if (child) child.parent = null;
      return child;
    }

    removeFromParent() {
      this.parent?.removeChild(this);
    }

    destroy() {
      this.destroyed = true;
    }

    on() {
      return this;
    }

    removeAllListeners() {
      return this;
    }
  }

  class MockGraphics extends MockDisplayObject {
    constructor() {
      super();
      this.scale = { x: 1, y: 1, set: vi.fn() };
      this.rotation = 0;
      this.sortableChildren = false;
      this.pathCommands = [];
    }

    clear() {
      this.lastFill = undefined;
      this.drawnRect = undefined;
      this.pathCommands = [];
      return this;
    }

    rect(x, y, width, height) {
      this.drawnRect = { x, y, width, height };
      this.pathCommands.push(["rect", x, y, width, height]);
      return this;
    }

    moveTo(x, y) {
      this.pathCommands.push(["moveTo", x, y]);
      return this;
    }

    lineTo(x, y) {
      this.pathCommands.push(["lineTo", x, y]);
      return this;
    }

    quadraticCurveTo(controlX, controlY, x, y) {
      this.pathCommands.push(["quadraticCurveTo", controlX, controlY, x, y]);
      return this;
    }

    closePath() {
      this.pathCommands.push(["closePath"]);
      return this;
    }

    fill(value) {
      this.lastFill = value;
      return this;
    }

    stroke(value) {
      this.lastStroke = value;
      return this;
    }

    getLocalBounds() {
      const rectangle = createMockBounds(this.width || 1, this.height || 1);

      return {
        rectangle,
      };
    }
  }

  class MockContainer extends MockDisplayObject {
    constructor(label = null) {
      super(label);
      this.scale = { x: 1, y: 1, set: vi.fn() };
      this.rotation = 0;
      this.sortableChildren = false;
    }

    getLocalBounds() {
      const rectangle = createMockBounds(this.width || 1, this.height || 1);

      return {
        rectangle,
      };
    }
  }

  class MockSprite extends MockDisplayObject {
    constructor(texture = null) {
      super();
      this.scale = { x: 1, y: 1, set: vi.fn() };
      this.rotation = 0;
      this.filters = [];
      this.texture = texture;
    }

    set texture(value) {
      this._texture = value;

      if (this._width) {
        this.width = this._width;
      }

      if (this._height) {
        this.height = this._height;
      }
    }

    get texture() {
      return this._texture;
    }

    set width(value) {
      if (!this.scale) {
        this._width = value;
        return;
      }

      const textureWidth = this.texture?.orig?.width ?? 1;
      const sign = Math.sign(this.scale?.x) || 1;

      this.scale.x = textureWidth === 0 ? sign : (value / textureWidth) * sign;
      this._width = value;
    }

    get width() {
      return Math.abs(this.scale.x) * (this.texture?.orig?.width ?? 1);
    }

    set height(value) {
      if (!this.scale) {
        this._height = value;
        return;
      }

      const textureHeight = this.texture?.orig?.height ?? 1;
      const sign = Math.sign(this.scale?.y) || 1;

      this.scale.y =
        textureHeight === 0 ? sign : (value / textureHeight) * sign;
      this._height = value;
    }

    get height() {
      return Math.abs(this.scale.y) * (this.texture?.orig?.height ?? 1);
    }
  }

  class MockAnimatedSprite extends MockSprite {}

  class MockFilter {}

  class MockFillGradient {
    constructor(options = {}) {
      Object.assign(this, options);
    }

    destroy() {}
  }

  class MockUniformGroup {
    constructor(uniforms) {
      this.uniforms = Object.fromEntries(
        Object.entries(uniforms).map(([key, entry]) => [key, entry.value]),
      );
    }
  }

  class MockGlProgram {
    static from(config) {
      return config;
    }
  }

  class MockStage extends MockDisplayObject {
    getChildByLabel(targetLabel, deep = false) {
      const search = (node) => {
        if (node?.label === targetLabel) return node;
        if (!deep || !Array.isArray(node?.children)) return null;

        for (const child of node.children) {
          const found = search(child);
          if (found) return found;
        }

        return null;
      };

      for (const child of this.children) {
        const found = search(child);
        if (found) return found;
      }

      return null;
    }
  }

  class MockApplication {
    constructor() {
      lastApplication = this;
      this.stage = new MockStage();
      this.ticker = {
        add: vi.fn(),
      };
      this.render = vi.fn();
      this.renderer = {
        background: { color: 0 },
        events: {},
        width: 0,
        height: 0,
        generateTexture: vi.fn(() => ({
          destroy: vi.fn(),
          source: { resource: { width: 1, height: 1 } },
        })),
        extract: {
          base64: vi.fn(),
        },
        ...rendererOverrides,
      };
      this.canvas = document.createElement("canvas");
    }

    async init(options) {
      const { width, height, backgroundColor } = options;
      this.initOptions = options;
      this.renderer.width = width;
      this.renderer.height = height;
      this.renderer.background.color = backgroundColor;
    }

    destroy() {}
  }

  return {
    Application: MockApplication,
    Assets: {
      registerPlugin: vi.fn(),
      load: vi.fn(),
      unload: vi.fn(async (key) => {
        const asset = assetValues.get(key) ?? assetCache.get(key);
        removeCachedAsset(key);
        const assets = Array.isArray(asset) ? asset : [asset];
        assets.forEach((value) => value?.destroy?.(true));
      }),
      cache: {
        has: vi.fn((key) => assetCache.has(key)),
        get: vi.fn((key) => assetCache.get(key)),
        set: vi.fn(setCachedAsset),
        remove: vi.fn(removeCachedAsset),
      },
    },
    detectVideoAlphaMode: vi.fn().mockResolvedValue("premultiplied-alpha"),
    Graphics: MockGraphics,
    LoaderParserPriority: {
      High: 1,
    },
    extensions: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    ExtensionType: {
      Asset: "asset",
    },
    Container: MockContainer,
    Sprite: MockSprite,
    AnimatedSprite: MockAnimatedSprite,
    Filter: MockFilter,
    FillGradient: MockFillGradient,
    GlProgram: MockGlProgram,
    UniformGroup: MockUniformGroup,
    defaultFilterVert: "void main() {}",
    Texture: class MockTexture {
      static EMPTY = {};

      constructor(options = {}) {
        this.source = options.source;
        this.orig = {
          width: this.source?.width ?? 1,
          height: this.source?.height ?? 1,
        };
        this.frame = this.orig;
        this.destroy = vi.fn();

        if (this.source) {
          this.source.__mockTextures ??= new Set();
          this.source.__mockTextures.add(this);
        }
      }

      static from(source) {
        return (
          assetCache.get(source) ??
          new MockTexture({
            source: {
              resource: source,
              width: source?.width ?? 1,
              height: source?.height ?? 1,
            },
          })
        );
      }

      once() {
        return this;
      }
    },
    VideoSource: class MockVideoSource {
      constructor(options = {}) {
        Object.assign(this, options);
        this.destroyed = false;
        this.update = vi.fn();
      }

      resize(width, height) {
        this.width = width;
        this.height = height;

        for (const texture of this.__mockTextures ?? []) {
          texture.orig.width = width;
          texture.orig.height = height;
        }
      }

      once() {
        return this;
      }
    },
    Rectangle: class MockRectangle {},
    __getLastApplication: () => lastApplication,
  };
};

let currentApp = null;

const setupRouteGraphics = async ({
  initOptions = {},
  pluginsFactory,
  rendererOverrides,
  audioAsset = {
    load: vi.fn(),
    getAsset: vi.fn(),
    unload: vi.fn(),
  },
} = {}) => {
  const pixiMock = createPixiModuleMock({ rendererOverrides });
  const { Color } = await vi.importActual("pixi.js");
  pixiMock.Color = Color;

  vi.doMock("pixi.js", () => pixiMock);
  vi.doMock("../src/AudioStage.js", () => ({
    createAudioStage: () => ({
      tick: vi.fn(),
      destroy: vi.fn(),
    }),
  }));
  vi.doMock("../src/AudioAsset.js", () => ({
    AudioAsset: audioAsset,
  }));

  const resolvedPlugins = pluginsFactory
    ? await pluginsFactory({ pixiMock })
    : {
        elements: [],
        animations: [],
        audio: [],
      };
  const { default: createRouteGraphics } =
    await import("../src/RouteGraphics.js");

  const app = createRouteGraphics();
  await app.init({
    width: 320,
    height: 240,
    backgroundColor: 0x000000,
    plugins: resolvedPlugins,
    ...initOptions,
  });

  currentApp = app;

  return { app, pixiMock, audioAsset, createRouteGraphics };
};

const getAutoAnimationTick = (pixiMock) =>
  pixiMock.__getLastApplication().ticker.add.mock.calls.at(-1)?.[0];

const findTransitionOverlay = (pixiMock) =>
  pixiMock
    .__getLastApplication()
    .stage.children.find(
      (child) =>
        (child.label === null || child.label === undefined) &&
        Array.isArray(child.children) &&
        child.children.length > 0,
    ) ?? null;

describe("RouteGraphics public API", () => {
  afterEach(() => {
    currentApp?.destroy();
    currentApp = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns null for missing labels without throwing", async () => {
    const { app } = await setupRouteGraphics();

    expect(() => app.findElementByLabel("missing-label")).not.toThrow();
    expect(app.findElementByLabel("missing-label")).toBeNull();
  }, 15000);

  it("exposes empty semantic bounds hits before elements are rendered", async () => {
    const { app } = await setupRouteGraphics();

    expect(app.hitTestElementBounds({ x: 10, y: 10 })).toEqual([]);
  });

  it("selects the requested renderer backend and exposes the result", async () => {
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: {
        rendererPreference: "webgpu",
      },
      rendererOverrides: {
        gpu: { device: {} },
      },
    });

    expect(pixiMock.__getLastApplication().initOptions.preference).toBe(
      "webgpu",
    );
    expect(app.rendererType).toBe("webgpu");
  });

  it("rejects renderer fallback when the requested backend is unavailable", async () => {
    await expect(
      setupRouteGraphics({
        initOptions: {
          rendererPreference: "webgpu",
          rendererFallback: false,
        },
      }),
    ).rejects.toThrow(
      'Renderer "webgpu" is unavailable and rendererFallback is false.',
    );
  });

  it("rejects unknown renderer preferences", async () => {
    await expect(
      setupRouteGraphics({
        initOptions: {
          rendererPreference: "canvas",
        },
      }),
    ).rejects.toThrow(/Expected "webgl" or "webgpu"/);
  });

  it("keeps the last good scene when shader preflight fails", async () => {
    const gl = createRejectingWebGLCompiler();
    const { app } = await setupRouteGraphics({
      rendererOverrides: { gl },
      pluginsFactory: async () => {
        const { rectPlugin } =
          await import("../src/plugins/elements/rect/index.js");
        return {
          elements: [rectPlugin],
          animations: [],
          audio: [],
        };
      },
    });
    app.render({
      id: "good",
      elements: [
        {
          id: "card",
          type: "rect",
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          fill: "#ffffff",
        },
      ],
    });

    expect(() =>
      app.render({
        id: "invalid-shader",
        elements: [
          {
            id: "card",
            type: "rect",
            x: 99,
            y: 20,
            width: 100,
            height: 50,
            fill: "#ffffff",
            filters: [
              {
                id: "broken",
                type: "shader",
                source: validShaderSource,
              },
            ],
          },
        ],
      }),
    ).toThrow(
      /element "card" shader filter "broken".*intentional fragment compiler failure/,
    );
    expect(app.findElementByLabel("card")?.x).toBe(10);
  });

  it.each([
    {
      name: "configuration validation",
      expected: /filters\[0\]\.paddding is not supported/,
      createInvalidState: () => ({
        filters: [
          {
            id: "strict",
            type: "shader",
            paddding: 4,
            source: validShaderSource,
          },
        ],
      }),
    },
    {
      name: "animation binding validation",
      expected: /could not find shader filter "missing"/,
      createInvalidState: () => ({
        filters: [
          {
            id: "grade",
            type: "shader",
            parameters: { amount: 0 },
            source: validShaderSource,
          },
        ],
        animations: [
          {
            id: "invalid-binding",
            targetId: "card",
            type: "update",
            tween: {
              filters: {
                missing: {
                  progress: {
                    keyframes: [{ duration: 100, value: 1 }],
                  },
                },
              },
            },
          },
        ],
      }),
    },
    {
      name: "texture preflight",
      expected: /references unloaded texture "missing-texture"/,
      createInvalidState: () => ({
        filters: [
          {
            id: "textured",
            type: "shader",
            textures: { noise: "missing-texture" },
            source: validShaderSource,
          },
        ],
      }),
    },
  ])(
    "keeps the last good scene after $name fails",
    async ({ createInvalidState, expected }) => {
      const gl = createRejectingWebGLCompiler();
      const { app } = await setupRouteGraphics({
        rendererOverrides: { gl },
        pluginsFactory: async () => {
          const { rectPlugin } =
            await import("../src/plugins/elements/rect/index.js");
          return {
            elements: [rectPlugin],
            animations: [],
            audio: [],
          };
        },
      });

      app.render({
        id: "good",
        elements: [
          {
            id: "card",
            type: "rect",
            x: 10,
            y: 20,
            width: 100,
            height: 50,
            fill: "#ffffff",
          },
        ],
      });
      const { animations = [], ...elementOverrides } = createInvalidState();

      expect(() =>
        app.render({
          id: "invalid",
          elements: [
            {
              id: "card",
              type: "rect",
              x: 99,
              y: 20,
              width: 100,
              height: 50,
              fill: "#ffffff",
              ...elementOverrides,
            },
          ],
          animations,
        }),
      ).toThrow(expected);
      expect(app.findElementByLabel("card")?.x).toBe(10);
      expect(gl.compileShader).not.toHaveBeenCalled();
    },
  );

  it("parse validates shader bindings without compiling or mounting", async () => {
    const gl = createRejectingWebGLCompiler();
    const { app } = await setupRouteGraphics({
      rendererOverrides: { gl },
      pluginsFactory: async () => {
        const { rectPlugin } =
          await import("../src/plugins/elements/rect/index.js");
        return {
          elements: [rectPlugin],
          animations: [],
          audio: [],
        };
      },
    });
    const state = {
      id: "parse-only",
      elements: [
        {
          id: "card",
          type: "rect",
          width: 100,
          height: 50,
          fill: "#ffffff",
          filters: [
            {
              id: "grade",
              type: "shader",
              parameters: { amount: 0 },
              source: validShaderSource,
            },
          ],
        },
      ],
      animations: [],
    };

    expect(app.parse(state).elements[0].filters[0].id).toBe("grade");
    expect(gl.compileShader).not.toHaveBeenCalled();
    expect(app.findElementByLabel("card")).toBeNull();

    expect(() =>
      app.parse({
        ...state,
        animations: [
          {
            id: "bad-binding",
            targetId: "card",
            type: "update",
            tween: {
              filters: {
                missing: {
                  progress: {
                    keyframes: [{ duration: 100, value: 1 }],
                  },
                },
              },
            },
          },
        ],
      }),
    ).toThrow(/could not find shader filter "missing"/);
    expect(gl.compileShader).not.toHaveBeenCalled();
  });

  it("unloads and reloads buffer-backed textures", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const firstBitmap = { width: 8, height: 6, close: vi.fn() };
    const secondBitmap = { width: 8, height: 6, close: vi.fn() };
    const createImageBitmap = vi
      .fn()
      .mockResolvedValueOnce(firstBitmap)
      .mockResolvedValueOnce(secondBitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const asset = {
      buffer: new Uint8Array([1, 2, 3]).buffer,
      type: "image/png",
    };

    await app.loadAssets({ portrait: asset });
    const firstTexture = pixiMock.Assets.cache.get("portrait");

    await expect(
      app.unloadAssets(["portrait", "portrait", "missing"]),
    ).resolves.toEqual(["portrait"]);
    expect(pixiMock.Assets.cache.remove).toHaveBeenCalledWith("portrait");
    expect(firstTexture.destroy).toHaveBeenCalledWith(true);
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);
    expect(pixiMock.Assets.cache.has("portrait")).toBe(false);

    await app.loadAssets({ portrait: asset });

    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    expect(pixiMock.Assets.cache.get("portrait")).not.toBe(firstTexture);
  });

  it("uses Pixi asset unloading for URL-backed textures", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const sourceUrl = "https://cdn.example.test/background.png";
    const resource = { close: vi.fn() };
    const texture = {
      source: { resource },
      destroy: vi.fn(),
    };
    pixiMock.Assets.load.mockImplementation(async (url) => {
      pixiMock.Assets.cache.set(url, texture);
      return texture;
    });

    await app.loadAssets({
      background: {
        source: "url",
        url: sourceUrl,
        type: "image/png",
      },
    });
    await expect(app.unloadAssets(["background"])).resolves.toEqual([
      "background",
    ]);

    expect(pixiMock.Assets.load).toHaveBeenCalledWith(sourceUrl);
    expect(pixiMock.Assets.unload).toHaveBeenCalledWith(sourceUrl);
    expect(texture.destroy).toHaveBeenCalledWith(true);
    expect(resource.close).toHaveBeenCalledTimes(1);
  });

  it("retains URL-backed textures shared by multiple aliases", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const sourceUrl = "https://cdn.example.test/shared-background.png";
    const resource = { close: vi.fn() };
    const texture = {
      source: { resource },
      destroy: vi.fn(),
    };
    pixiMock.Assets.load.mockImplementation(async (url) => {
      if (!pixiMock.Assets.cache.has(url)) {
        pixiMock.Assets.cache.set(url, texture);
      }
      return pixiMock.Assets.cache.get(url);
    });

    await app.loadAssets({
      backgroundDay: {
        source: "url",
        url: sourceUrl,
        type: "image/png",
      },
      backgroundNight: {
        source: "url",
        url: sourceUrl,
        type: "image/png",
      },
    });

    await expect(app.unloadAssets(["backgroundDay"])).resolves.toEqual([
      "backgroundDay",
    ]);
    expect(pixiMock.Assets.unload).not.toHaveBeenCalled();
    expect(texture.destroy).not.toHaveBeenCalled();
    expect(resource.close).not.toHaveBeenCalled();
    expect(pixiMock.Assets.cache.get("backgroundNight")).toBe(texture);

    await expect(app.unloadAssets(["backgroundNight"])).resolves.toEqual([
      "backgroundNight",
    ]);
    expect(pixiMock.Assets.unload).toHaveBeenCalledTimes(1);
    expect(pixiMock.Assets.unload).toHaveBeenCalledWith(sourceUrl);
    expect(texture.destroy).toHaveBeenCalledWith(true);
    expect(resource.close).toHaveBeenCalledTimes(1);
  });

  it("shares ownership for relative and absolute forms of one Pixi URL", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const relativeUrl = "/shared/equivalent.png";
    const absoluteUrl = "https://cdn.example.test/shared/equivalent.png";
    pixiMock.Assets.resolver = {
      resolve: vi.fn(() => ({ src: absoluteUrl })),
    };
    const texture = {
      source: { resource: { close: vi.fn() } },
      destroy: vi.fn(),
    };
    pixiMock.Assets.load.mockImplementation(async (url) => {
      pixiMock.Assets.cache.set(url, texture);
      return texture;
    });

    await app.loadAssets({
      relativeBackground: {
        source: "url",
        url: relativeUrl,
        type: "image/png",
      },
      absoluteBackground: {
        source: "url",
        url: absoluteUrl,
        type: "image/png",
      },
    });

    expect(pixiMock.Assets.load).toHaveBeenCalledTimes(1);
    await app.unloadAssets(["relativeBackground"]);
    expect(pixiMock.Assets.unload).not.toHaveBeenCalled();
    expect(texture.destroy).not.toHaveBeenCalled();
    expect(pixiMock.Assets.cache.get("absoluteBackground")).toBe(texture);

    await app.unloadAssets(["absoluteBackground"]);
    expect(pixiMock.Assets.unload).toHaveBeenCalledTimes(1);
    expect(texture.destroy).toHaveBeenCalledWith(true);
  });

  it("reserves URL texture ownership before a cross-instance load settles", async () => {
    const {
      app: firstApp,
      pixiMock,
      createRouteGraphics,
    } = await setupRouteGraphics();
    const secondApp = createRouteGraphics();
    await secondApp.init({
      width: 320,
      height: 240,
      backgroundColor: 0x000000,
      plugins: { elements: [], animations: [], audio: [] },
    });
    const sourceUrl = "https://cdn.example.test/racing-background.png";
    const texture = {
      source: { resource: { close: vi.fn() } },
      destroy: vi.fn(),
    };
    pixiMock.Assets.load.mockImplementation(async (url) => {
      pixiMock.Assets.cache.set(url, texture);
      return texture;
    });

    try {
      await firstApp.loadAssets({
        firstBackground: {
          source: "url",
          url: sourceUrl,
          type: "image/png",
        },
      });

      const secondLoadPromise = secondApp.loadAssets({
        secondBackground: {
          source: "url",
          url: sourceUrl,
          type: "image/png",
        },
      });
      await expect(firstApp.unloadAssets(["firstBackground"])).resolves.toEqual(
        ["firstBackground"],
      );

      expect(pixiMock.Assets.unload).not.toHaveBeenCalled();
      expect(texture.destroy).not.toHaveBeenCalled();
      await expect(secondLoadPromise).resolves.toEqual([texture]);
      expect(pixiMock.Assets.cache.get("secondBackground")).toBe(texture);

      await secondApp.unloadAssets(["secondBackground"]);
      expect(pixiMock.Assets.unload).toHaveBeenCalledWith(sourceUrl);
      expect(texture.destroy).toHaveBeenCalledWith(true);
    } finally {
      secondApp.destroy();
    }
  });

  it("removes every logical cache key for URL texture arrays before reload", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const sourceUrl = "https://cdn.example.test/characters.json";
    const loadedTextureArrays = [];
    pixiMock.Assets.load.mockImplementation(async (url) => {
      const textures = [
        {
          source: { resource: { close: vi.fn() } },
          destroy: vi.fn(),
        },
        {
          source: { resource: { close: vi.fn() } },
          destroy: vi.fn(),
        },
      ];
      loadedTextureArrays.push(textures);
      pixiMock.Assets.cache.set(url, textures);
      return textures;
    });
    const asset = {
      source: "url",
      url: sourceUrl,
      type: "application/json",
    };

    await app.loadAssets({ characters: asset });
    expect(pixiMock.Assets.cache.get("characters")).toBe(
      loadedTextureArrays[0][0],
    );
    expect(pixiMock.Assets.cache.get("characters2")).toBe(
      loadedTextureArrays[0][1],
    );

    await app.unloadAssets(["characters"]);
    expect(pixiMock.Assets.cache.has("characters")).toBe(false);
    expect(pixiMock.Assets.cache.has("characters2")).toBe(false);
    expect(loadedTextureArrays[0][0].destroy).toHaveBeenCalledWith(true);
    expect(loadedTextureArrays[0][1].destroy).toHaveBeenCalledWith(true);

    await app.loadAssets({ characters: asset });
    expect(pixiMock.Assets.load).toHaveBeenCalledTimes(2);
    expect(pixiMock.Assets.cache.get("characters")).toBe(
      loadedTextureArrays[1][0],
    );
    expect(pixiMock.Assets.cache.get("characters2")).toBe(
      loadedTextureArrays[1][1],
    );

    await app.unloadAssets(["characters"]);
  });

  it("reloads a URL-backed key from its new source URL", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const firstUrl = "https://cdn.example.test/background.png?token=old";
    const secondUrl = "https://cdn.example.test/background.png?token=new";
    const loadedTextures = [];
    pixiMock.Assets.load.mockImplementation(async (url) => {
      const texture = {
        source: { resource: { close: vi.fn() } },
        destroy: vi.fn(),
        url,
      };
      loadedTextures.push(texture);
      pixiMock.Assets.cache.set(url, texture);
      return texture;
    });

    await app.loadAssets({
      background: { source: "url", url: firstUrl, type: "image/png" },
    });
    await app.unloadAssets(["background"]);
    await app.loadAssets({
      background: { source: "url", url: secondUrl, type: "image/png" },
    });

    expect(pixiMock.Assets.load.mock.calls.map(([url]) => url)).toEqual([
      firstUrl,
      secondUrl,
    ]);
    expect(pixiMock.Assets.unload).toHaveBeenCalledWith(firstUrl);
    expect(loadedTextures[0].destroy).toHaveBeenCalledWith(true);
    expect(pixiMock.Assets.cache.get("background")).toBe(loadedTextures[1]);

    await app.unloadAssets(["background"]);
  });

  it("honors unload requests while a texture load is pending", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    let resolveImageBitmap;
    const imageBitmap = { width: 8, height: 6, close: vi.fn() };
    const createImageBitmap = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveImageBitmap = resolve;
        }),
    );
    vi.stubGlobal("createImageBitmap", createImageBitmap);

    const loadPromise = app.loadAssets({
      portrait: {
        buffer: new Uint8Array([1, 2, 3]).buffer,
        type: "image/png",
      },
    });
    await vi.waitFor(() => {
      expect(createImageBitmap).toHaveBeenCalledTimes(1);
    });

    let unloadSettled = false;
    const unloadPromise = app.unloadAssets(["portrait"]).then((result) => {
      unloadSettled = true;
      return result;
    });
    await Promise.resolve();
    expect(unloadSettled).toBe(false);

    resolveImageBitmap(imageBitmap);
    await loadPromise;
    await expect(unloadPromise).resolves.toEqual(["portrait"]);

    const texture = pixiMock.Assets.cache.set.mock.calls.find(
      ([key]) => key === "portrait",
    )?.[1];
    expect(pixiMock.Assets.cache.has("portrait")).toBe(false);
    expect(texture.destroy).toHaveBeenCalledWith(true);
    expect(imageBitmap.close).toHaveBeenCalledTimes(1);
  });

  it("deduplicates pending buffer texture loads across instances", async () => {
    const {
      app: firstApp,
      pixiMock,
      createRouteGraphics,
    } = await setupRouteGraphics();
    const secondApp = createRouteGraphics();
    await secondApp.init({
      width: 320,
      height: 240,
      backgroundColor: 0x000000,
      plugins: { elements: [], animations: [], audio: [] },
    });
    let resolveImageBitmap;
    const imageBitmap = { width: 8, height: 6, close: vi.fn() };
    const createImageBitmap = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveImageBitmap = resolve;
        }),
    );
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const asset = {
      buffer: new Uint8Array([1, 2, 3]).buffer,
      type: "image/png",
    };

    try {
      const firstLoad = firstApp.loadAssets({ portrait: asset });
      const secondLoad = secondApp.loadAssets({ portrait: asset });

      expect(createImageBitmap).toHaveBeenCalledTimes(1);
      resolveImageBitmap(imageBitmap);
      const [[firstTexture], [secondTexture]] = await Promise.all([
        firstLoad,
        secondLoad,
      ]);

      expect(firstTexture).toBe(secondTexture);
      expect(pixiMock.Assets.cache.get("portrait")).toBe(firstTexture);

      await firstApp.unloadAssets(["portrait"]);
      expect(firstTexture.destroy).not.toHaveBeenCalled();
      expect(pixiMock.Assets.cache.get("portrait")).toBe(firstTexture);

      await secondApp.unloadAssets(["portrait"]);
      expect(firstTexture.destroy).toHaveBeenCalledWith(true);
      expect(imageBitmap.close).toHaveBeenCalledTimes(1);
    } finally {
      secondApp.destroy();
    }
  });

  it("unloads audio and font assets", async () => {
    const audioAsset = {
      load: vi.fn().mockResolvedValue({ decoded: true }),
      getAsset: vi.fn(),
      unload: vi.fn(),
    };
    const { app } = await setupRouteGraphics({ audioAsset });
    const fontFace = { load: vi.fn().mockResolvedValue(undefined) };
    const FontFaceMock = vi.fn(function FontFaceMock() {
      return fontFace;
    });
    const fontSet = {
      add: vi.fn(),
      delete: vi.fn(),
    };
    vi.stubGlobal("FontFace", FontFaceMock);
    Object.defineProperty(document, "fonts", {
      value: fontSet,
      configurable: true,
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:http://route-graphics/font",
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    try {
      await app.loadAssets({
        click: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "audio/mpeg",
        },
        dialogueFont: {
          buffer: new Uint8Array([4, 5, 6]).buffer,
          type: "font/woff2",
        },
      });

      await expect(
        app.unloadAssets(["click", "dialogueFont"]),
      ).resolves.toEqual(["click", "dialogueFont"]);
      expect(audioAsset.unload).toHaveBeenCalledWith("click");
      expect(fontSet.delete).toHaveBeenCalledWith(fontFace);
    } finally {
      delete document.fonts;
    }
  });

  it("retains audio shared by separate Route Graphics instances", async () => {
    const decodedAudio = { decoded: true };
    let cachedAudio;
    const audioAsset = {
      load: vi.fn(async () => {
        cachedAudio ??= decodedAudio;
        return cachedAudio;
      }),
      getAsset: vi.fn(() => cachedAudio),
      unload: vi.fn(() => {
        cachedAudio = undefined;
        return true;
      }),
    };
    const { app: firstApp, createRouteGraphics } = await setupRouteGraphics({
      audioAsset,
    });
    const secondApp = createRouteGraphics();
    await secondApp.init({
      width: 320,
      height: 240,
      backgroundColor: 0x000000,
      plugins: { elements: [], animations: [], audio: [] },
    });
    const clickAsset = {
      buffer: new Uint8Array([1, 2, 3]).buffer,
      type: "audio/mpeg",
    };

    try {
      await firstApp.loadAssets({ click: clickAsset });
      await secondApp.loadAssets({ click: clickAsset });

      await expect(firstApp.unloadAssets(["click"])).resolves.toEqual([
        "click",
      ]);
      expect(audioAsset.unload).not.toHaveBeenCalled();
      expect(audioAsset.getAsset("click")).toBe(decodedAudio);

      await expect(secondApp.unloadAssets(["click"])).resolves.toEqual([
        "click",
      ]);
      expect(audioAsset.unload).toHaveBeenCalledTimes(1);
      expect(audioAsset.unload).toHaveBeenCalledWith("click");
    } finally {
      secondApp.destroy();
    }
  });

  it("emits WebGL context lifecycle events", async () => {
    const eventHandler = vi.fn();
    const { app } = await setupRouteGraphics({
      initOptions: { eventHandler },
    });
    const lostEvent = new Event("webglcontextlost", { cancelable: true });

    app.canvas.dispatchEvent(lostEvent);
    app.canvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(lostEvent.defaultPrevented).toBe(true);
    expect(eventHandler).toHaveBeenCalledWith("rendererContextLost", {});
    expect(eventHandler).toHaveBeenCalledWith("rendererContextRestored", {});
  });

  it("emits context loss from the WebGPU fallback device", async () => {
    let resolveDeviceLost;
    const deviceLost = new Promise((resolve) => {
      resolveDeviceLost = resolve;
    });
    const eventHandler = vi.fn();
    await setupRouteGraphics({
      initOptions: { eventHandler },
      rendererOverrides: {
        gpu: {
          device: { lost: deviceLost },
        },
      },
    });

    resolveDeviceLost({
      reason: "unknown",
      message: "The GPU process exited.",
    });

    await vi.waitFor(() => {
      expect(eventHandler).toHaveBeenCalledWith("rendererContextLost", {
        reason: "unknown",
        statusMessage: "The GPU process exited.",
      });
    });
  });

  it("loads video assets through lazy HTML video textures", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const createdVideos = [];
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://route-graphics/video");
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, ...args) => {
        const element = originalCreateElement(tagName, ...args);

        if (tagName === "video") {
          createdVideos.push(element);
          Object.defineProperty(element, "readyState", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "videoWidth", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "videoHeight", {
            value: 0,
            configurable: true,
          });
          element.load = vi.fn();
        }

        return element;
      });

    pixiMock.Assets.load.mockResolvedValue({ source: "loaded" });

    try {
      await app.loadAssets({
        urlTexture: {
          source: "url",
          url: "blob:http://route-graphics/texture",
          type: "image/png",
        },
        bufferVideo: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "video/mp4",
        },
        urlVideo: {
          source: "url",
          url: "http://project-file.localhost/pixi-asset.mp4?path=video",
          type: "video/mp4",
        },
      });
    } finally {
      createElement.mockRestore();
      createObjectURL.mockRestore();
    }

    expect(pixiMock.Assets.load).toHaveBeenCalledTimes(1);
    expect(pixiMock.Assets.load).toHaveBeenCalledWith(
      "blob:http://route-graphics/texture",
    );
    expect(pixiMock.Assets.cache.set).toHaveBeenCalledWith(
      "bufferVideo",
      expect.objectContaining({
        source: expect.any(Object),
      }),
    );
    expect(pixiMock.Assets.cache.set).toHaveBeenCalledWith(
      "urlVideo",
      expect.objectContaining({
        source: expect.any(Object),
      }),
    );
    const bufferVideoTexture = pixiMock.Assets.cache.set.mock.calls.find(
      ([key]) => key === "bufferVideo",
    )?.[1];
    expect(bufferVideoTexture.source.width).toBe(1);
    expect(bufferVideoTexture.source.height).toBe(1);
    expect(bufferVideoTexture.source.alphaMode).toBe("premultiplied-alpha");
    expect(bufferVideoTexture.source.update).not.toHaveBeenCalled();
    expect(pixiMock.detectVideoAlphaMode).toHaveBeenCalled();
    expect(createdVideos).toHaveLength(2);
    expect(
      createdVideos.every((video) => video.crossOrigin === "anonymous"),
    ).toBe(true);
    expect(createdVideos.every((video) => video.preload === "metadata")).toBe(
      true,
    );
    expect(
      createdVideos.every((video) => video.load.mock.calls.length === 1),
    ).toBe(true);
    expect(
      createdVideos.every((video) => {
        const sourceElement = video.querySelector("source");

        return (
          sourceElement?.src &&
          sourceElement.type === "video/mp4" &&
          video.getAttribute("webkit-playsinline") === ""
        );
      }),
    ).toBe(true);
  });

  it("unloads video textures and revokes buffer source URLs", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    let video;
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://route-graphics/video-unload");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, ...args) => {
        const element = originalCreateElement(tagName, ...args);
        if (tagName === "video") {
          video = element;
          element.load = vi.fn();
          element.pause = vi.fn();
        }
        return element;
      });

    try {
      await app.loadAssets({
        cutscene: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "video/mp4",
        },
      });
      const texture = pixiMock.Assets.cache.get("cutscene");

      await expect(app.unloadAssets(["cutscene"])).resolves.toEqual([
        "cutscene",
      ]);

      expect(video.pause).toHaveBeenCalledTimes(1);
      expect(video.querySelector("source")).toBeNull();
      expect(texture.destroy).toHaveBeenCalledWith(true);
      expect(pixiMock.Assets.cache.remove).toHaveBeenCalledWith("cutscene");
      expect(revokeObjectURL).toHaveBeenCalledWith(
        "blob:http://route-graphics/video-unload",
      );
    } finally {
      createElement.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it("deduplicates pending video texture setup across instances", async () => {
    const {
      app: firstApp,
      pixiMock,
      createRouteGraphics,
    } = await setupRouteGraphics();
    const secondApp = createRouteGraphics();
    await secondApp.init({
      width: 320,
      height: 240,
      backgroundColor: 0x000000,
      plugins: { elements: [], animations: [], audio: [] },
    });
    let resolveAlphaMode;
    pixiMock.detectVideoAlphaMode.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAlphaMode = resolve;
        }),
    );
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://route-graphics/shared-video");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const originalCreateElement = document.createElement.bind(document);
    const videos = [];
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, ...args) => {
        const element = originalCreateElement(tagName, ...args);
        if (tagName === "video") {
          videos.push(element);
          element.load = vi.fn();
          element.pause = vi.fn();
        }
        return element;
      });
    const asset = {
      buffer: new Uint8Array([1, 2, 3]).buffer,
      type: "video/mp4",
    };

    try {
      const firstLoad = firstApp.loadAssets({ cutscene: asset });
      const secondLoad = secondApp.loadAssets({ cutscene: asset });

      expect(videos).toHaveLength(1);
      expect(pixiMock.detectVideoAlphaMode).toHaveBeenCalledTimes(1);
      resolveAlphaMode("premultiplied-alpha");
      const [[firstTexture], [secondTexture]] = await Promise.all([
        firstLoad,
        secondLoad,
      ]);

      expect(firstTexture).toBe(secondTexture);
      expect(pixiMock.Assets.cache.get("cutscene")).toBe(firstTexture);

      await firstApp.unloadAssets(["cutscene"]);
      expect(firstTexture.destroy).not.toHaveBeenCalled();
      expect(videos[0].pause).not.toHaveBeenCalled();

      await secondApp.unloadAssets(["cutscene"]);
      expect(firstTexture.destroy).toHaveBeenCalledWith(true);
      expect(videos[0].pause).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith(
        "blob:http://route-graphics/shared-video",
      );
    } finally {
      secondApp.destroy();
      createElement.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it("awaits audio asset decoding during loadAssets", async () => {
    let resolveAudioLoad;
    const audioLoadPromise = new Promise((resolve) => {
      resolveAudioLoad = resolve;
    });
    const audioAsset = {
      prepareDecoders: vi.fn().mockResolvedValue(undefined),
      load: vi.fn(() => audioLoadPromise),
      getAsset: vi.fn(),
    };
    const { app } = await setupRouteGraphics({ audioAsset });
    let loadAssetsResolved = false;

    const loadAssetsPromise = app
      .loadAssets({
        click: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "application/ogg; codecs=vorbis",
        },
      })
      .then(() => {
        loadAssetsResolved = true;
      });

    await Promise.resolve();

    expect(audioAsset.prepareDecoders).toHaveBeenCalledWith({
      click: expect.objectContaining({
        type: "application/ogg; codecs=vorbis",
      }),
    });
    expect(audioAsset.load).toHaveBeenCalledWith(
      "click",
      expect.any(ArrayBuffer),
      "application/ogg; codecs=vorbis",
    );
    expect(loadAssetsResolved).toBe(false);

    resolveAudioLoad();
    await loadAssetsPromise;

    expect(loadAssetsResolved).toBe(true);
  });

  it("adds asset key, type, phase, and cause to Pixi texture load failures", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    pixiMock.Assets.load.mockRejectedValue(new Error("Pixi could not load"));

    let thrownError;
    try {
      await app.loadAssets({
        cityBackground: {
          source: "url",
          url: "https://cdn.example.test/city.png",
          type: "image/png",
        },
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError?.message).toBe(
      'Could not load image "cityBackground". Missing, inaccessible, or unsupported image file.',
    );
    expect(thrownError?.details).toEqual(
      expect.objectContaining({
        assetKey: "cityBackground",
        assetKind: "image",
        assetCategory: "texture",
        phase: "Pixi URL load",
        type: "image/png",
        source: "url",
        url: "https://cdn.example.test/city.png",
        cause: "Pixi could not load",
      }),
    );
  });

  it("aggregates multiple asset load failures with their root causes", async () => {
    const audioAsset = {
      load: vi.fn(() => Promise.reject(new Error("audio decode failed"))),
      getAsset: vi.fn(),
    };
    const { app, pixiMock } = await setupRouteGraphics({ audioAsset });
    pixiMock.Assets.load.mockRejectedValue(new Error("texture fetch failed"));

    let thrownError;
    try {
      await app.loadAssets({
        click: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "audio/mpeg",
        },
        background: {
          source: "url",
          url: "https://cdn.example.test/background.png",
          type: "image/png",
        },
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError?.message).toBe(
      'Could not load 2 assets: audio "click", image "background". audio "click": Unsupported or damaged audio file.; image "background": Missing, inaccessible, or unsupported image file.',
    );
    expect(thrownError?.details?.failures).toEqual([
      expect.objectContaining({
        assetKey: "click",
        assetKind: "audio",
        cause: "audio decode failed",
      }),
      expect.objectContaining({
        assetKey: "background",
        assetKind: "image",
        cause: "texture fetch failed",
      }),
    ]);
  });

  it("does not reject video asset preload when browser defers media readiness", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const createdVideos = [];
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://route-graphics/video");
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, ...args) => {
        const element = originalCreateElement(tagName, ...args);

        if (tagName === "video") {
          createdVideos.push(element);
          Object.defineProperty(element, "readyState", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "networkState", {
            value: 3,
            configurable: true,
          });
          Object.defineProperty(element, "error", {
            value: {
              code: 4,
              message: "No supported source was found",
            },
            configurable: true,
          });
          Object.defineProperty(element, "currentSrc", {
            value: "blob:http://route-graphics/video",
            configurable: true,
          });
          element.load = vi.fn(() => {
            queueMicrotask(() => {
              element.dispatchEvent(new Event("error"));
            });
          });
        }

        return element;
      });

    try {
      await app.loadAssets({
        introVideo: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "video/mp4",
        },
        outroVideo: {
          buffer: new Uint8Array([4, 5, 6]).buffer,
          type: "video/mp4",
        },
      });
    } finally {
      createElement.mockRestore();
      createObjectURL.mockRestore();
    }

    expect(createdVideos).toHaveLength(2);
    expect(pixiMock.Assets.cache.set).toHaveBeenCalledWith(
      "introVideo",
      expect.objectContaining({
        source: expect.any(Object),
      }),
    );
    expect(pixiMock.Assets.cache.set).toHaveBeenCalledWith(
      "outroVideo",
      expect.objectContaining({
        source: expect.any(Object),
      }),
    );
  });

  it("completes render when a lazy video fails after being tracked", async () => {
    const eventHandler = vi.fn();
    const { app } = await setupRouteGraphics({
      initOptions: {
        eventHandler,
      },
      pluginsFactory: async () => {
        const { videoPlugin } =
          await import("../src/plugins/elements/video/index.js");

        return {
          elements: [videoPlugin],
          animations: [],
          audio: [],
        };
      },
    });
    const createdVideos = [];
    const originalHTMLVideoElement = globalThis.HTMLVideoElement;
    Object.defineProperty(globalThis, "HTMLVideoElement", {
      value: window.HTMLVideoElement,
      configurable: true,
    });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://route-graphics/video");
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, ...args) => {
        const element = originalCreateElement(tagName, ...args);

        if (tagName === "video") {
          createdVideos.push(element);
          Object.defineProperty(element, "readyState", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "videoWidth", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "videoHeight", {
            value: 0,
            configurable: true,
          });
          element.load = vi.fn();
          element.pause = vi.fn();
          element.play = vi.fn();
        }

        return element;
      });

    try {
      await app.loadAssets({
        introVideo: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "video/mp4",
        },
      });

      app.render({
        id: "failed-video-state",
        elements: [
          {
            id: "intro",
            type: "video",
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            src: "introVideo",
          },
        ],
      });

      expect(eventHandler).not.toHaveBeenCalledWith("renderComplete", {
        id: "failed-video-state",
        aborted: false,
      });

      createdVideos[0].dispatchEvent(new window.Event("error"));

      expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
        id: "failed-video-state",
        aborted: false,
      });
    } finally {
      Object.defineProperty(globalThis, "HTMLVideoElement", {
        value: originalHTMLVideoElement,
        configurable: true,
      });
      createElement.mockRestore();
      createObjectURL.mockRestore();
    }
  });

  it("updates lazy video texture when first mounted after frame data is ready", async () => {
    const { app, pixiMock } = await setupRouteGraphics({
      pluginsFactory: async () => {
        const { videoPlugin } =
          await import("../src/plugins/elements/video/index.js");

        return {
          elements: [videoPlugin],
          animations: [],
          audio: [],
        };
      },
    });
    const createdVideos = [];
    const originalHTMLVideoElement = globalThis.HTMLVideoElement;
    Object.defineProperty(globalThis, "HTMLVideoElement", {
      value: window.HTMLVideoElement,
      configurable: true,
    });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://route-graphics/video");
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, ...args) => {
        const element = originalCreateElement(tagName, ...args);

        if (tagName === "video") {
          createdVideos.push(element);
          Object.defineProperty(element, "readyState", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "videoWidth", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "videoHeight", {
            value: 0,
            configurable: true,
          });
          element.load = vi.fn();
          element.pause = vi.fn();
          element.play = vi.fn();
        }

        return element;
      });

    try {
      await app.loadAssets({
        introVideo: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "video/mp4",
        },
      });

      const texture = pixiMock.Assets.cache.get("introVideo");
      expect(texture.source.update).not.toHaveBeenCalled();

      Object.defineProperty(createdVideos[0], "readyState", {
        value: window.HTMLMediaElement.HAVE_CURRENT_DATA,
        configurable: true,
      });
      Object.defineProperty(createdVideos[0], "videoWidth", {
        value: 640,
        configurable: true,
      });
      Object.defineProperty(createdVideos[0], "videoHeight", {
        value: 360,
        configurable: true,
      });

      app.render({
        id: "video-state",
        elements: [
          {
            id: "intro",
            type: "video",
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            src: "introVideo",
          },
        ],
      });

      const sprite = app.findElementByLabel("intro");

      expect(texture.source.width).toBe(640);
      expect(texture.source.height).toBe(360);
      expect(texture.source.update).toHaveBeenCalled();
      expect(sprite.width).toBe(320);
      expect(sprite.height).toBe(180);
    } finally {
      Object.defineProperty(globalThis, "HTMLVideoElement", {
        value: originalHTMLVideoElement,
        configurable: true,
      });
      createElement.mockRestore();
      createObjectURL.mockRestore();
    }
  });

  it("preserves video sprite dimensions when lazy frame data resizes the texture", async () => {
    const { app, pixiMock } = await setupRouteGraphics({
      pluginsFactory: async () => {
        const { videoPlugin } =
          await import("../src/plugins/elements/video/index.js");

        return {
          elements: [videoPlugin],
          animations: [],
          audio: [],
        };
      },
    });
    const createdVideos = [];
    const originalHTMLVideoElement = globalThis.HTMLVideoElement;
    Object.defineProperty(globalThis, "HTMLVideoElement", {
      value: window.HTMLVideoElement,
      configurable: true,
    });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:http://route-graphics/video");
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName, ...args) => {
        const element = originalCreateElement(tagName, ...args);

        if (tagName === "video") {
          createdVideos.push(element);
          Object.defineProperty(element, "readyState", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "videoWidth", {
            value: 0,
            configurable: true,
          });
          Object.defineProperty(element, "videoHeight", {
            value: 0,
            configurable: true,
          });
          element.load = vi.fn();
          element.pause = vi.fn();
          element.play = vi.fn();
        }

        return element;
      });

    try {
      await app.loadAssets({
        introVideo: {
          buffer: new Uint8Array([1, 2, 3]).buffer,
          type: "video/mp4",
        },
      });

      app.render({
        id: "video-state",
        elements: [
          {
            id: "intro",
            type: "video",
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            src: "introVideo",
          },
        ],
      });

      const sprite = app.findElementByLabel("intro");
      const texture = pixiMock.Assets.cache.get("introVideo");

      expect(sprite.width).toBe(320);
      expect(sprite.height).toBe(180);
      expect(texture.source.width).toBe(1);
      expect(texture.source.height).toBe(1);

      Object.defineProperty(createdVideos[0], "readyState", {
        value: window.HTMLMediaElement.HAVE_CURRENT_DATA,
        configurable: true,
      });
      Object.defineProperty(createdVideos[0], "videoWidth", {
        value: 1920,
        configurable: true,
      });
      Object.defineProperty(createdVideos[0], "videoHeight", {
        value: 1080,
        configurable: true,
      });

      createdVideos[0].dispatchEvent(new window.Event("loadeddata"));

      expect(texture.source.width).toBe(1920);
      expect(texture.source.height).toBe(1080);
      expect(texture.orig.width).toBe(1920);
      expect(texture.orig.height).toBe(1080);
      expect(sprite.width).toBe(320);
      expect(sprite.height).toBe(180);
      expect(sprite.scale.x).toBeCloseTo(320 / 1920);
      expect(sprite.scale.y).toBeCloseTo(180 / 1080);
    } finally {
      Object.defineProperty(globalThis, "HTMLVideoElement", {
        value: originalHTMLVideoElement,
        configurable: true,
      });
      createElement.mockRestore();
      createObjectURL.mockRestore();
    }
  });

  it("updates the visible stage background graphic color", async () => {
    const { app, pixiMock } = await setupRouteGraphics();
    const appInstance = pixiMock.__getLastApplication();
    const backgroundGraphic = appInstance.stage.children[0];

    expect(backgroundGraphic.lastFill).toBe(0x000000);

    app.updatedBackgroundColor(0xff0000);

    expect(backgroundGraphic.lastFill).toBe(0xff0000);
    expect(appInstance.renderer.background.color).toBe(0xff0000);
  });

  it("supports manual animation playback time sampling", async () => {
    const { app } = await setupRouteGraphics({
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    app.render({
      id: "baseline",
      elements: [
        {
          id: "preview-rect",
          type: "rect",
          x: 0,
          y: 20,
          width: 40,
          height: 40,
          fill: "#FFFFFF",
        },
      ],
    });

    app.setAnimationPlaybackMode("manual");
    app.render({
      id: "animated",
      elements: [
        {
          id: "preview-rect",
          type: "rect",
          x: 100,
          y: 20,
          width: 40,
          height: 40,
          fill: "#FFFFFF",
        },
      ],
      animations: [
        {
          id: "move-rect",
          targetId: "preview-rect",
          type: "update",
          tween: {
            x: {
              keyframes: [{ duration: 400, value: 100, easing: "linear" }],
            },
          },
        },
      ],
    });

    app.setAnimationTime(150);

    expect(app.findElementByLabel("preview-rect")?.x).toBeCloseTo(37.5);
  });

  it("forwards authored timeline events through the public event handler", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: { eventHandler },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);
        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });
    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "timeline-event-baseline",
      elements: [
        {
          id: "event-rect",
          type: "rect",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          fill: "#FFFFFF",
        },
      ],
    });
    eventHandler.mockClear();

    app.render({
      id: "timeline-event-active",
      elements: [
        {
          id: "event-rect",
          type: "rect",
          x: 100,
          y: 0,
          width: 20,
          height: 20,
          fill: "#FFFFFF",
        },
      ],
      animations: [
        {
          id: "eventful-update",
          targetId: "event-rect",
          type: "update",
          gsap: {
            profile: "portable-v1",
            steps: [
              {
                kind: "to",
                values: { x: 100 },
                duration: 100,
                easing: "linear",
              },
              {
                kind: "emit",
                event: "halfway",
                payload: { source: "public-api" },
                start: { time: 50 },
              },
            ],
          },
        },
      ],
    });
    frameTick({ deltaMS: 60 });

    expect(eventHandler).toHaveBeenCalledWith("timelineEvent", {
      id: "eventful-update",
      event: "halfway",
      payload: { source: "public-api" },
      time: 50,
      direction: "forward",
      iteration: [0],
    });
  });

  it("exposes per-animation player controls on the public renderer", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: { eventHandler },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);
        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });
    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "controlled-baseline",
      elements: [
        {
          id: "controlled-rect",
          type: "rect",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          fill: "#FFFFFF",
        },
      ],
    });
    eventHandler.mockClear();
    app.render({
      id: "controlled-active",
      elements: [
        {
          id: "controlled-rect",
          type: "rect",
          x: 100,
          y: 0,
          width: 20,
          height: 20,
          fill: "#FFFFFF",
        },
      ],
      animations: [
        {
          id: "controlled-update",
          targetId: "controlled-rect",
          type: "update",
          gsap: {
            profile: "portable-v1",
            steps: [
              {
                kind: "to",
                values: { x: 100 },
                duration: 100,
                easing: "linear",
              },
            ],
          },
        },
      ],
    });

    expect(app.pauseAnimation("controlled-update")).toBe(true);
    frameTick({ deltaMS: 20 });
    expect(app.findElementByLabel("controlled-rect")?.x).toBe(0);

    expect(app.setAnimationSpeed("controlled-update", 2)).toBe(true);
    expect(app.resumeAnimation("controlled-update")).toBe(true);
    frameTick({ deltaMS: 25 });
    expect(app.findElementByLabel("controlled-rect")?.x).toBeCloseTo(50);

    expect(app.seekAnimation("controlled-update", 75)).toBe(true);
    expect(app.findElementByLabel("controlled-rect")?.x).toBeCloseTo(75);
    expect(app.setAnimationProgress("controlled-update", 0.25)).toBe(true);
    expect(app.findElementByLabel("controlled-rect")?.x).toBeCloseTo(25);
    expect(app.getAnimationState("controlled-update")).toMatchObject({
      id: "controlled-update",
      currentTime: 25,
      duration: 100,
      direction: "forward",
      controlSpeed: 2,
    });

    expect(app.reverseAnimation("controlled-update")).toBe(true);
    frameTick({ deltaMS: 13 });

    expect(app.getAnimationState("controlled-update")).toBeNull();
    expect(app.findElementByLabel("controlled-rect")?.x).toBe(0);
    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "controlled-active",
      aborted: false,
    });
  });

  it("animates rect styles through the public tween interface", async () => {
    const { app } = await setupRouteGraphics({
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    app.render({
      id: "rect-style-baseline",
      elements: [
        {
          id: "panel",
          type: "rect",
          x: 0,
          y: 0,
          width: 40,
          height: 20,
          fill: "#ff0000",
          border: { width: 2, color: "#ffffff", alpha: 1 },
          cornerRadius: 0,
        },
      ],
    });

    app.setAnimationPlaybackMode("manual");
    app.render({
      id: "rect-style-animated",
      elements: [
        {
          id: "panel",
          type: "rect",
          x: 0,
          y: 0,
          width: 80,
          height: 60,
          fill: "#0000ff",
          border: { width: 6, color: "#00ff00", alpha: 0.5 },
          cornerRadius: {
            topLeft: 10,
            topRight: 20,
            bottomRight: 30,
            bottomLeft: 40,
          },
        },
      ],
      animations: [
        {
          id: "panel-style",
          targetId: "panel",
          type: "update",
          tween: {
            width: { auto: { duration: 500 } },
            height: { auto: { duration: 500 } },
            fill: {
              color: { auto: { duration: 500 } },
            },
            border: {
              width: { auto: { duration: 500 } },
              color: { auto: { duration: 500 } },
              alpha: { auto: { duration: 500 } },
            },
            cornerRadius: {
              topLeft: { auto: { duration: 500 } },
              topRight: { auto: { duration: 500 } },
              bottomRight: { auto: { duration: 500 } },
              bottomLeft: { auto: { duration: 500 } },
            },
          },
        },
      ],
    });

    app.setAnimationTime(250);

    const panel = app.findElementByLabel("panel");
    expect(panel.pathCommands.slice(0, 2)).toEqual([
      ["moveTo", 5, 0],
      ["lineTo", 50, 0],
    ]);
    expect(panel.pathCommands).toContainEqual([
      "quadraticCurveTo",
      60,
      40,
      45,
      40,
    ]);
    expect(panel.lastFill).toEqual([0.5, 0, 0.5, 1]);
    expect(panel.lastStroke).toEqual({
      color: [0.5, 1, 0.5, 1],
      alpha: 0.75,
      width: 4,
    });
  });

  it("continues persistent update animations across unrelated renders without restarting", async () => {
    const { app, pixiMock } = await setupRouteGraphics({
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "baseline",
      elements: [
        {
          id: "bg",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "front",
          type: "rect",
          x: 120,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
    });

    app.render({
      id: "persistent-update-1",
      elements: [
        {
          id: "bg",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "front",
          type: "rect",
          x: 120,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
      animations: [
        {
          id: "bg-breathe",
          targetId: "bg",
          type: "update",
          playback: {
            continuity: "persistent",
          },
          tween: {
            scaleX: {
              initialValue: 1,
              keyframes: [{ duration: 1000, value: 2, easing: "linear" }],
            },
            scaleY: {
              initialValue: 1,
              keyframes: [{ duration: 1000, value: 2, easing: "linear" }],
            },
          },
        },
      ],
    });

    frameTick({ deltaMS: 400 });
    expect(app.findElementByLabel("bg")?.scale.x).toBeCloseTo(1.4);
    expect(app.findElementByLabel("bg")?.scale.y).toBeCloseTo(1.4);

    app.render({
      id: "persistent-update-2",
      elements: [
        {
          id: "bg",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "front",
          type: "rect",
          x: 180,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
      animations: [
        {
          id: "bg-breathe",
          targetId: "bg",
          type: "update",
          playback: {
            continuity: "persistent",
          },
          tween: {
            scaleX: {
              initialValue: 1,
              keyframes: [{ duration: 1000, value: 2, easing: "linear" }],
            },
            scaleY: {
              initialValue: 1,
              keyframes: [{ duration: 1000, value: 2, easing: "linear" }],
            },
          },
        },
      ],
    });

    expect(app.findElementByLabel("bg")?.scale.x).toBeCloseTo(1.4);
    expect(app.findElementByLabel("bg")?.scale.y).toBeCloseTo(1.4);

    frameTick({ deltaMS: 100 });
    expect(app.findElementByLabel("bg")?.scale.x).toBeCloseTo(1.5);
    expect(app.findElementByLabel("bg")?.scale.y).toBeCloseTo(1.5);
  });

  it("emits renderComplete immediately for persistent update playback", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: {
        eventHandler,
      },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "baseline",
      elements: [
        {
          id: "bg",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
      ],
    });

    eventHandler.mockClear();

    app.render({
      id: "persistent-update-finish",
      elements: [
        {
          id: "bg",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
      ],
      animations: [
        {
          id: "bg-breathe",
          targetId: "bg",
          type: "update",
          playback: {
            continuity: "persistent",
          },
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 300, value: 1, easing: "linear" }],
            },
          },
        },
      ],
    });

    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "persistent-update-finish",
      aborted: false,
    });

    const eventCountAfterRender = eventHandler.mock.calls.length;
    frameTick({ deltaMS: 300 });

    expect(eventHandler.mock.calls).toHaveLength(eventCountAfterRender);
  });

  it("emits renderComplete immediately while a render-scoped update keeps looping", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: {
        eventHandler,
      },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "loop-baseline",
      elements: [
        {
          id: "ambient",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
      ],
    });

    eventHandler.mockClear();

    app.render({
      id: "loop-active",
      elements: [
        {
          id: "ambient",
          type: "rect",
          x: 100,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
      ],
      animations: [
        {
          id: "ambient-drift",
          targetId: "ambient",
          type: "update",
          playback: {
            speed: 2,
            loop: true,
          },
          tween: {
            x: {
              initialValue: 0,
              keyframes: [{ duration: 1000, value: 100, easing: "linear" }],
            },
          },
        },
      ],
    });

    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "loop-active",
      aborted: false,
    });

    const eventCountAfterRender = eventHandler.mock.calls.length;

    frameTick({ deltaMS: 250 });
    expect(app.findElementByLabel("ambient")?.x).toBeCloseTo(50);

    frameTick({ deltaMS: 250 });
    expect(app.findElementByLabel("ambient")?.x).toBeCloseTo(0);
    expect(eventHandler.mock.calls).toHaveLength(eventCountAfterRender);

    frameTick({ deltaMS: 125 });
    expect(app.findElementByLabel("ambient")?.x).toBeCloseTo(25);
    expect(eventHandler.mock.calls).toHaveLength(eventCountAfterRender);
  });

  it("emits renderComplete for infinity introduced by a nested GSAP group", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: { eventHandler },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);
        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });
    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "nested-infinite-baseline",
      elements: [
        {
          id: "nested-infinite-rect",
          type: "rect",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          fill: "#FFFFFF",
        },
      ],
    });
    eventHandler.mockClear();

    app.render({
      id: "nested-infinite-active",
      elements: [
        {
          id: "nested-infinite-rect",
          type: "rect",
          x: 100,
          y: 0,
          width: 20,
          height: 20,
          fill: "#FFFFFF",
        },
      ],
      animations: [
        {
          id: "nested-infinite-update",
          targetId: "nested-infinite-rect",
          type: "update",
          gsap: {
            profile: "portable-v1",
            steps: [
              {
                kind: "sequence",
                repeat: "infinite",
                steps: [
                  {
                    kind: "to",
                    values: { x: 100 },
                    duration: 100,
                    easing: "linear",
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "nested-infinite-active",
      aborted: false,
    });
    frameTick({ deltaMS: 50 });
    expect(app.findElementByLabel("nested-infinite-rect")?.x).toBeCloseTo(50);
  });

  it("continues a persistent loop across unrelated renders and cancels it when omitted", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: {
        eventHandler,
      },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    const frameTick = getAutoAnimationTick(pixiMock);
    const loopingAnimation = {
      id: "persistent-loop",
      targetId: "ambient",
      type: "update",
      playback: {
        continuity: "persistent",
        loop: true,
      },
      tween: {
        x: {
          initialValue: 0,
          keyframes: [{ duration: 1000, value: 100, easing: "linear" }],
        },
      },
    };

    app.render({
      id: "persistent-loop-baseline",
      elements: [
        {
          id: "ambient",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "sibling",
          type: "rect",
          x: 200,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
    });

    app.render({
      id: "persistent-loop-active",
      elements: [
        {
          id: "ambient",
          type: "rect",
          x: 100,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "sibling",
          type: "rect",
          x: 200,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
      animations: [loopingAnimation],
    });

    frameTick({ deltaMS: 750 });
    expect(app.findElementByLabel("ambient")?.x).toBeCloseTo(75);

    app.render({
      id: "persistent-loop-carried",
      elements: [
        {
          id: "ambient",
          type: "rect",
          x: 100,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "sibling",
          type: "rect",
          x: 240,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
      animations: [loopingAnimation],
    });

    expect(app.findElementByLabel("ambient")?.x).toBeCloseTo(75);

    frameTick({ deltaMS: 500 });
    expect(app.findElementByLabel("ambient")?.x).toBeCloseTo(25);

    eventHandler.mockClear();
    app.render({
      id: "persistent-loop-stopped",
      elements: [
        {
          id: "ambient",
          type: "rect",
          x: 100,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
      ],
    });

    expect(app.findElementByLabel("ambient")?.x).toBeCloseTo(100);
    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "persistent-loop-stopped",
      aborted: false,
    });
  });

  it("does not abort or re-complete persistent updates after a later render adopts them", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: {
        eventHandler,
      },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "baseline",
      elements: [
        {
          id: "bg",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "front",
          type: "rect",
          x: 120,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
    });

    eventHandler.mockClear();

    app.render({
      id: "persistent-update-old",
      elements: [
        {
          id: "bg",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "front",
          type: "rect",
          x: 120,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
      animations: [
        {
          id: "bg-breathe",
          targetId: "bg",
          type: "update",
          playback: {
            continuity: "persistent",
          },
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
            },
          },
        },
      ],
    });

    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "persistent-update-old",
      aborted: false,
    });

    frameTick({ deltaMS: 400 });
    eventHandler.mockClear();

    app.render({
      id: "persistent-update-new",
      elements: [
        {
          id: "bg",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "front",
          type: "rect",
          x: 180,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
      animations: [
        {
          id: "bg-breathe",
          targetId: "bg",
          type: "update",
          playback: {
            continuity: "persistent",
          },
          tween: {
            alpha: {
              initialValue: 0,
              keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
            },
          },
        },
      ],
    });

    expect(eventHandler).not.toHaveBeenCalledWith("renderComplete", {
      id: "persistent-update-old",
      aborted: true,
    });
    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "persistent-update-new",
      aborted: false,
    });

    const eventCountAfterAdoption = eventHandler.mock.calls.length;
    frameTick({ deltaMS: 600 });

    expect(eventHandler.mock.calls).toHaveLength(eventCountAfterAdoption);
    expect(eventHandler).not.toHaveBeenCalledWith("renderComplete", {
      id: "persistent-update-old",
      aborted: false,
    });
  });

  it("continues persistent transition overlays across unrelated renders without restarting", async () => {
    const { app, pixiMock } = await setupRouteGraphics({
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "baseline",
      elements: [
        {
          id: "front",
          type: "rect",
          x: 120,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
    });

    app.render({
      id: "persistent-transition-1",
      elements: [
        {
          id: "scene",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "front",
          type: "rect",
          x: 120,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
      animations: [
        {
          id: "scene-fade",
          targetId: "scene",
          type: "transition",
          playback: {
            continuity: "persistent",
          },
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    frameTick({ deltaMS: 400 });
    let overlay = findTransitionOverlay(pixiMock);
    expect(overlay?.children).toHaveLength(1);
    expect(overlay?.children[0].alpha).toBeCloseTo(0.4);

    app.render({
      id: "persistent-transition-2",
      elements: [
        {
          id: "scene",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
        {
          id: "front",
          type: "rect",
          x: 180,
          y: 0,
          width: 40,
          height: 40,
          fill: "#999999",
        },
      ],
      animations: [
        {
          id: "scene-fade",
          targetId: "scene",
          type: "transition",
          playback: {
            continuity: "persistent",
          },
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    overlay = findTransitionOverlay(pixiMock);
    expect(overlay?.children[0].alpha).toBeCloseTo(0.4);

    frameTick({ deltaMS: 100 });
    overlay = findTransitionOverlay(pixiMock);
    expect(overlay?.children[0].alpha).toBeCloseTo(0.5);
  });

  it("does not abort or re-complete persistent transitions after a later render adopts them", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: {
        eventHandler,
      },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "baseline",
      elements: [],
    });

    eventHandler.mockClear();

    app.render({
      id: "persistent-transition-old",
      elements: [
        {
          id: "scene",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
      ],
      animations: [
        {
          id: "scene-fade",
          targetId: "scene",
          type: "transition",
          playback: {
            continuity: "persistent",
          },
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "persistent-transition-old",
      aborted: false,
    });

    frameTick({ deltaMS: 400 });
    eventHandler.mockClear();

    app.render({
      id: "persistent-transition-new",
      elements: [
        {
          id: "scene",
          type: "rect",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fill: "#FFFFFF",
        },
      ],
      animations: [
        {
          id: "scene-fade",
          targetId: "scene",
          type: "transition",
          playback: {
            continuity: "persistent",
          },
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    expect(eventHandler).not.toHaveBeenCalledWith("renderComplete", {
      id: "persistent-transition-old",
      aborted: true,
    });
    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "persistent-transition-new",
      aborted: false,
    });

    const eventCountAfterAdoption = eventHandler.mock.calls.length;
    frameTick({ deltaMS: 600 });

    expect(eventHandler.mock.calls).toHaveLength(eventCountAfterAdoption);
    expect(eventHandler).not.toHaveBeenCalledWith("renderComplete", {
      id: "persistent-transition-old",
      aborted: false,
    });
  });

  it("preserves pending persistent transitions across later renders before async mount resolves", async () => {
    let resolveAdd;
    const addPromise = new Promise((resolve) => {
      resolveAdd = resolve;
    });

    const { app, pixiMock } = await setupRouteGraphics({
      pluginsFactory: async ({ pixiMock: activePixiMock }) => {
        const asyncNodePlugin = {
          type: "async-node",
          parse: ({ state }) => state,
          add: vi.fn(({ parent, element, signal }) =>
            addPromise.then(() => {
              if (signal?.aborted || parent.destroyed) {
                return;
              }

              const container = new activePixiMock.Container();
              container.label = element.id;
              parent.addChild(container);
            }),
          ),
          update: vi.fn(),
          delete: vi.fn(),
        };

        return {
          elements: [asyncNodePlugin],
          animations: [],
          audio: [],
        };
      },
    });

    const frameTick = getAutoAnimationTick(pixiMock);

    app.render({
      id: "persistent-async-old",
      elements: [
        {
          id: "delayed-scene",
          type: "async-node",
        },
      ],
      animations: [
        {
          id: "scene-enter",
          targetId: "delayed-scene",
          type: "transition",
          playback: {
            continuity: "persistent",
          },
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    app.render({
      id: "persistent-async-new",
      elements: [
        {
          id: "delayed-scene",
          type: "async-node",
        },
      ],
      animations: [
        {
          id: "scene-enter",
          targetId: "delayed-scene",
          type: "transition",
          playback: {
            continuity: "persistent",
          },
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 1000, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    resolveAdd();
    await addPromise;

    await vi.waitFor(() => {
      const mounted = app.findElementByLabel("delayed-scene");
      const overlay = findTransitionOverlay(pixiMock);

      expect(mounted).not.toBeNull();
      expect(mounted?.visible).toBe(false);
      expect(overlay).not.toBeNull();
    });

    frameTick({ deltaMS: 200 });

    const overlay = findTransitionOverlay(pixiMock);
    expect(overlay?.children[0].alpha).toBeCloseTo(0.2);
  });

  it("applies remembered manual time to transitions that start asynchronously", async () => {
    let resolveAdd;
    const addPromise = new Promise((resolve) => {
      resolveAdd = resolve;
    });

    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: {
        animationPlaybackMode: "manual",
      },
      pluginsFactory: async ({ pixiMock: activePixiMock }) => {
        const asyncTransitionPlugin = {
          type: "async-node",
          parse: ({ state }) => state,
          add: vi.fn(({ parent, element, signal }) =>
            addPromise.then(() => {
              if (signal?.aborted || parent.destroyed) {
                return;
              }

              const container = new activePixiMock.Container();
              container.label = element.id;
              parent.addChild(container);
            }),
          ),
          update: vi.fn(),
          delete: vi.fn(),
        };

        return {
          elements: [asyncTransitionPlugin],
          animations: [],
          audio: [],
        };
      },
    });

    app.render({
      id: "async-transition",
      elements: [
        {
          id: "delayed-scene",
          type: "async-node",
        },
      ],
      animations: [
        {
          id: "scene-enter",
          targetId: "delayed-scene",
          type: "transition",
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 400, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    app.setAnimationTime(200);

    resolveAdd();
    await addPromise;

    const appInstance = pixiMock.__getLastApplication();

    await vi.waitFor(() => {
      const mounted = app.findElementByLabel("delayed-scene");
      const overlay = appInstance.stage.children.at(-1);

      expect(mounted).not.toBeNull();
      expect(mounted?.visible).toBe(false);
      expect(overlay.children).toHaveLength(1);
      expect(overlay.children[0].alpha).toBeCloseTo(0.5);
    });
  });

  it("keeps same-id prev-only transitions pending until time advances", async () => {
    const eventHandler = vi.fn();
    const { app, pixiMock } = await setupRouteGraphics({
      initOptions: {
        eventHandler,
      },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    app.render({
      id: "baseline",
      elements: [
        {
          id: "shared-rect",
          type: "rect",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          fill: "#FFFFFF",
          alpha: 1,
        },
      ],
    });

    eventHandler.mockClear();

    app.render({
      id: "same-id-prev-only",
      elements: [
        {
          id: "shared-rect",
          type: "rect",
          x: 0,
          y: 0,
          width: 120,
          height: 80,
          fill: "#FFFFFF",
          alpha: 1,
        },
      ],
      animations: [
        {
          id: "shared-slide-out",
          targetId: "shared-rect",
          type: "transition",
          prev: {
            tween: {
              translateX: {
                initialValue: 0,
                keyframes: [{ duration: 1000, value: -1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    expect(eventHandler).not.toHaveBeenCalledWith("renderComplete", {
      id: "same-id-prev-only",
      aborted: false,
    });

    app.setAnimationTime(200);

    const appInstance = pixiMock.__getLastApplication();
    const overlay = appInstance.stage.children.at(-1);

    expect(overlay.children).toHaveLength(1);
    expect(overlay.children[0].x).toBeLessThan(0);
    expect(eventHandler).not.toHaveBeenCalledWith("renderComplete", {
      id: "same-id-prev-only",
      aborted: false,
    });
  });

  it("does not abort pending async adds when re-rendering the same state", async () => {
    let resolveAdd;
    const addPromise = new Promise((resolve) => {
      resolveAdd = resolve;
    });

    const { app } = await setupRouteGraphics({
      pluginsFactory: async ({ pixiMock: activePixiMock }) => {
        const asyncNodePlugin = {
          type: "async-node",
          parse: ({ state }) => state,
          add: vi.fn(({ parent, element, signal }) =>
            addPromise.then(() => {
              if (signal?.aborted || parent.destroyed) {
                return;
              }

              const container = new activePixiMock.Container();
              container.label = element.id;
              parent.addChild(container);
            }),
          ),
          update: vi.fn(),
          delete: vi.fn(),
        };

        return {
          elements: [asyncNodePlugin],
          animations: [],
          audio: [],
        };
      },
    });

    const sharedState = {
      id: "async-same-state",
      elements: [
        {
          id: "delayed-node",
          type: "async-node",
        },
      ],
    };

    app.render(sharedState);
    app.render(sharedState);

    resolveAdd();
    await addPromise;

    await vi.waitFor(() => {
      expect(app.findElementByLabel("delayed-node")).not.toBeNull();
    });
  });

  it("uses the live plugin when superseding an async cross-type transition", async () => {
    let resolveAdd;
    const addPromise = new Promise((resolve) => {
      resolveAdd = resolve;
    });
    let previousPlugin;
    let nextPlugin;

    const { app } = await setupRouteGraphics({
      pluginsFactory: async ({ pixiMock }) => {
        previousPlugin = {
          type: "sync-node",
          parse: ({ state }) => state,
          add: vi.fn(({ parent, element }) => {
            const child = new pixiMock.Container();
            child.label = element.id;
            parent.addChild(child);
          }),
          update: vi.fn(),
          delete: vi.fn(({ parent, element }) => {
            const child = parent.children.find(
              (candidate) => candidate.label === element.id,
            );
            if (!child) return;
            parent.removeChild(child);
            child.destroy();
          }),
        };
        nextPlugin = {
          type: "async-node",
          parse: ({ state }) => state,
          add: vi.fn(({ parent, element, signal }) =>
            addPromise.then(() => {
              if (signal?.aborted || parent.destroyed) return;
              const child = new pixiMock.Container();
              child.label = element.id;
              parent.addChild(child);
            }),
          ),
          update: vi.fn(),
          delete: vi.fn(() => {
            throw new Error("used the pending type instead of the live type");
          }),
        };

        return {
          elements: [previousPlugin, nextPlugin],
          animations: [],
          audio: [],
        };
      },
    });

    app.render({
      id: "cross-type-initial",
      elements: [{ id: "character", type: "sync-node" }],
    });
    app.render({
      id: "cross-type-pending",
      elements: [{ id: "character", type: "async-node" }],
      animations: [
        {
          id: "character-transition",
          targetId: "character",
          type: "transition",
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 300, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    expect(nextPlugin.add).toHaveBeenCalledTimes(1);
    expect(() =>
      app.render({
        id: "cross-type-removed",
        elements: [],
      }),
    ).not.toThrow();
    expect(previousPlugin.delete).toHaveBeenCalledTimes(1);
    expect(nextPlugin.delete).not.toHaveBeenCalled();

    resolveAdd();
    await addPromise;
    await vi.waitFor(() => {
      expect(app.findElementByLabel("character")).toBeNull();
    });
  });

  it("adopts an async cross-type replacement retained by a newer render", async () => {
    let resolveDelete;
    const deleteOperation = new Promise((resolve) => {
      resolveDelete = resolve;
    });
    let nextPlugin;

    const { app } = await setupRouteGraphics({
      pluginsFactory: async ({ pixiMock }) => {
        const { containerPlugin } =
          await import("../src/plugins/elements/container/index.js");
        const createChild = (parent, element) => {
          const child = new pixiMock.Container();
          child.label = element.id;
          child.value = element.value;
          parent.addChild(child);
        };
        const previousPlugin = {
          type: "previous-node",
          parse: ({ state }) => state,
          add: vi.fn(({ parent, element }) => {
            createChild(parent, element);
          }),
          update: vi.fn(),
          delete: vi.fn(({ parent, element }) =>
            deleteOperation.then(() => {
              const child = parent.children.find(
                (candidate) => candidate.label === element.id,
              );
              if (!child) return;
              parent.removeChild(child);
              child.destroy();
            }),
          ),
        };
        nextPlugin = {
          type: "next-node",
          parse: ({ state }) => state,
          add: vi.fn(({ parent, element }) => {
            createChild(parent, element);
          }),
          update: vi.fn(),
          delete: vi.fn(),
        };
        const siblingPlugin = {
          type: "sibling-node",
          parse: ({ state }) => state,
          add: vi.fn(({ parent, element }) => {
            createChild(parent, element);
          }),
          update: vi.fn(({ parent, nextElement }) => {
            const child = parent.children.find(
              (candidate) => candidate.label === nextElement.id,
            );
            if (child) child.value = nextElement.value;
          }),
          delete: vi.fn(),
        };

        return {
          elements: [
            containerPlugin,
            previousPlugin,
            nextPlugin,
            siblingPlugin,
          ],
          animations: [],
          audio: [],
        };
      },
    });

    const createGroup = (childType) => ({
      id: "group",
      type: "container",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      children: [
        {
          id: "background",
          type: childType,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ],
    });

    app.render({
      id: "deferred-replacement-initial",
      elements: [
        createGroup("previous-node"),
        { id: "sibling", type: "sibling-node", value: 0 },
      ],
    });
    app.render({
      id: "deferred-replacement-pending",
      elements: [
        createGroup("next-node"),
        { id: "sibling", type: "sibling-node", value: 0 },
      ],
    });
    app.render({
      id: "deferred-replacement-adopted",
      elements: [
        createGroup("next-node"),
        { id: "sibling", type: "sibling-node", value: 1 },
      ],
    });

    expect(nextPlugin.add).not.toHaveBeenCalled();

    resolveDelete();
    await deleteOperation;

    await vi.waitFor(() => {
      expect(nextPlugin.add).toHaveBeenCalledTimes(1);
      expect(app.findElementByLabel("background")).not.toBeNull();
    });
  });

  it("emits renderComplete for a next-only transition in debug snapshot mode", async () => {
    const eventHandler = vi.fn();

    const { app } = await setupRouteGraphics({
      initOptions: {
        debug: true,
        eventHandler,
      },
      pluginsFactory: async () => {
        const [{ rectPlugin }, { tweenPlugin }] = await Promise.all([
          import("../src/plugins/elements/rect/index.js"),
          import("../src/plugins/animations/tween/index.js"),
        ]);

        return {
          elements: [rectPlugin],
          animations: [tweenPlugin],
          audio: [],
        };
      },
    });

    app.render({
      id: "baseline",
      elements: [
        {
          id: "baseline-rect",
          type: "rect",
          x: 80,
          y: 80,
          width: 120,
          height: 80,
          fill: "#4D4D4D",
        },
      ],
    });

    eventHandler.mockClear();

    app.render({
      id: "animation-only",
      elements: [
        {
          id: "fade-rect",
          type: "rect",
          x: 160,
          y: 100,
          width: 120,
          height: 80,
          fill: "#FFFFFF",
          alpha: 1,
        },
      ],
      animations: [
        {
          id: "fade-in",
          targetId: "fade-rect",
          type: "transition",
          next: {
            tween: {
              alpha: {
                initialValue: 0,
                keyframes: [{ duration: 600, value: 1, easing: "linear" }],
              },
            },
          },
        },
      ],
    });

    expect(eventHandler).not.toHaveBeenCalledWith("renderComplete", {
      id: "animation-only",
      aborted: false,
    });

    window.dispatchEvent(
      new CustomEvent("snapShotKeyFrame", {
        detail: { deltaMS: 700 },
      }),
    );

    expect(eventHandler).toHaveBeenCalledWith("renderComplete", {
      id: "animation-only",
      aborted: false,
    });
  });

  it("emits renderComplete once per render when an element completes synchronously", async () => {
    let routeGraphicsApp;
    const eventHandler = vi.fn((eventName, payload) => {
      if (
        eventName === "renderComplete" &&
        payload?.aborted !== true &&
        payload?.id === "sync-complete-1"
      ) {
        routeGraphicsApp.render({
          id: "sync-complete-2",
          elements: [
            {
              id: "sync-complete-line-2",
              type: "sync-complete",
            },
          ],
        });
      }
    });

    const { app } = await setupRouteGraphics({
      initOptions: {
        eventHandler,
      },
      pluginsFactory: async ({ pixiMock }) => {
        const syncCompletePlugin = {
          type: "sync-complete",
          parse: ({ state }) => state,
          add: ({ parent, element, completionTracker }) => {
            const container = new pixiMock.Container();
            container.label = element.id;
            parent.addChild(container);
            const version = completionTracker.getVersion();
            completionTracker.track(version);
            completionTracker.complete(version);
          },
          update: () => {},
          delete: () => {},
        };

        return {
          elements: [syncCompletePlugin],
          animations: [],
          audio: [],
        };
      },
    });

    routeGraphicsApp = app;

    app.render({
      id: "sync-complete-1",
      elements: [
        {
          id: "sync-complete-line-1",
          type: "sync-complete",
        },
      ],
    });

    const renderCompleteEvents = eventHandler.mock.calls.filter(
      ([eventName, payload]) =>
        eventName === "renderComplete" && payload?.aborted !== true,
    );

    expect(renderCompleteEvents).toEqual([
      ["renderComplete", { id: "sync-complete-1", aborted: false }],
      ["renderComplete", { id: "sync-complete-2", aborted: false }],
    ]);
  });
});
