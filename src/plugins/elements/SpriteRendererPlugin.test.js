import { describe, expect, test, vi } from "vitest";
import { Container, Sprite } from "pixi.js";

import { SpriteRendererPlugin } from "./SpriteRendererPlugin";

describe("SpriteRendererPlugin.add", () => {
  test("basics", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();

    const app = {
      screen: {
        x: 1920,
        y: 1080,
      },
    };

    plugin.add(
      // @ts-ignore
      app,
      {
        parent: container,
        element: {
          id: "test",
          type: "sprite",
          url: "/localhost:3000/test.png",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          xa: 0.5,
          ya: 0.5,
        },
        transitions: [],
        getTransitionByType: () => {},
      },
    );

    expect(container.children.length).toEqual(1);

    const firstChild = container.children[0];
    expect(firstChild).toBeInstanceOf(Sprite);
    expect(firstChild.label).toEqual("test");
    expect(firstChild.x).toEqual(0);
    expect(firstChild.y).toEqual(0);
    expect(firstChild.width).toEqual(100);
    expect(firstChild.height).toEqual(100);
    // @ts-ignore
    expect(firstChild.anchor.x).toEqual(0.5);
    // @ts-ignore
    expect(firstChild.anchor.y).toEqual(0.5);
    // TODO assert url
  });

  test("xp and yp", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();

    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    plugin.add(
      // @ts-ignore
      app,
      {
        parent: container,
        element: {
          id: "test",
          type: "sprite",
          url: "/localhost:3000/test.png",
          xp: 0.5,
          yp: 0.5,
        },
        transitions: [],
        getTransitionByType: () => {},
      },
    );

    expect(container.children.length).toEqual(1);

    const firstChild = container.children[0];
    expect(firstChild).toBeInstanceOf(Sprite);
    expect(firstChild.label).toEqual("test");
    expect(firstChild.x).toEqual(1920 / 2);
    expect(firstChild.y).toEqual(1080 / 2);
  });

  test("test transitions with event add", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();
    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };
    const transitionPlugin = {
      add: () => {},
    };
    const addSpy = vi.spyOn(transitionPlugin, "add");
    plugin.add(
      // @ts-ignore
      app,
      {
        parent: container,
        element: {
          id: "test",
          type: "sprite",
          url: "/localhost:3000/test.png",
          xp: 0.5,
          yp: 0.5,
        },
        transitions: [
          {
            elementId: "test",
            event: "add",
            type: "test",
          },
        ],
        getTransitionByType: () => transitionPlugin,
      },
    );
    expect(container.children.length).toEqual(1);
    const firstChild = container.children[0];
    expect(firstChild).toBeInstanceOf(Sprite);
    expect(firstChild.label).toEqual("test");
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  test("test transitions with event remove", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();
    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };
    const transitionPlugin = {
      add: () => {},
    };
    const addSpy = vi.spyOn(transitionPlugin, "add");
    plugin.add(
      // @ts-ignore
      app,
      {
        parent: container,
        element: {
          id: "test",
          type: "sprite",
          url: "/localhost:3000/test.png",
          xp: 0.5,
          yp: 0.5,
        },
        transitions: [
          {
            elementId: "test",
            event: "remove",
            type: "test",
          },
        ],
        getTransitionByType: () => transitionPlugin,
      },
    );
    expect(container.children.length).toEqual(1);
    const firstChild = container.children[0];
    expect(firstChild).toBeInstanceOf(Sprite);
    expect(firstChild.label).toEqual("test");
    expect(addSpy).toHaveBeenCalledTimes(0);
  });

  test("test transitions not found", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();
    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    expect(() => {
      plugin.add(
        // @ts-ignore
        app,
        {
          parent: container,
          element: {
            id: "test",
            type: "sprite",
            url: "/localhost:3000/test.png",
            xp: 0.5,
            yp: 0.5,
          },
          transitions: [
            {
              elementId: "test",
              event: "add",
              type: "test",
            },
          ],
          getTransitionByType: () => undefined,
        },
      );
    }).toThrowError("Transition class not found for type test");
  });
});

describe("SpriteRendererPlugin.remove", () => {
  test("basics", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();
    const sprite = new Sprite();
    sprite.label = "test1";
    const sprite2 = new Sprite();
    sprite2.label = "test2";
    container.addChild(sprite);
    container.addChild(sprite2);
    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    await plugin.remove(
      // @ts-ignore
      app,
      {
        parent: container,
        element: {
          id: "test1",
        },
        transitions: [],
        getTransitionByType: () => {},
      },
    );

    expect(container.children.length).toEqual(1);
    const firstChild = container.children[0];
    expect(firstChild).toBeInstanceOf(Sprite);
    expect(firstChild.label).toEqual("test2");
  });

  test("not found", () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();

    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    expect(async () => {
      await plugin.remove(
        // @ts-ignore
        app,
        {
          parent: container,
          element: {
            id: "test1",
          },
          transitions: [],
          getTransitionByType: () => {},
        },
      );
    }).rejects.toThrowError("Sprite with id test1 not found");
  });

  test("with transition", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();
    const sprite = new Sprite();
    sprite.label = "test1";
    container.addChild(sprite);

    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    const transitionPlugin = {
      remove: () => {},
    };
    const removeSpy = vi.spyOn(transitionPlugin, "remove");
    await plugin.remove(
      // @ts-ignore
      app,
      {
        parent: container,
        element: {
          id: "test1",
        },
        transitions: [
          {
            elementId: "test1",
            event: "remove",
            type: "test",
          },
        ],
        getTransitionByType: () => transitionPlugin,
      },
    );
    expect(container.children.length).toEqual(0);
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  test("transition not found", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();
    const sprite = new Sprite();
    sprite.label = "test1";
    container.addChild(sprite);

    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    expect(async () => {
      await plugin.remove(
        // @ts-ignore
        app,
        {
          parent: container,
          element: {
            id: "test1",
          },
          transitions: [
            {
              elementId: "test1",
              event: "remove",
              type: "test",
            },
          ],
          getTransitionByType: () => undefined,
        },
      );
    }).rejects.toThrowError("Transition class not found for type test");
  });
});

describe("SpriteRendererPlugin.update", () => {
  test("basics", async () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();
    const sprite = new Sprite();
    sprite.label = "test1";
    sprite.x = 0;
    container.addChild(sprite);
    const sprite2 = new Sprite();
    sprite2.label = "test2";
    container.addChild(sprite2);
    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    await plugin.update(
      // @ts-ignore
      app,
      {
        parent: container,
        prevElement: {
          id: "test1",
        },
        nextElement: {
          id: "test1",
          url: "/localhost:3000/test.png",
          x: 100,
        },
        transitions: [],
        getTransitionByType: () => {},
      },
    );

    expect(container.children.length).toEqual(2);
    const firstChild = container.children[1];
    expect(firstChild).toBeInstanceOf(Sprite);
    expect(firstChild.label).toEqual("test1");
    expect(firstChild.x).toEqual(100);
  });

  test("sprite not found", () => {
    const plugin = new SpriteRendererPlugin();
    const container = new Container();
    const sprite = new Sprite();
    sprite.label = "test1";
    container.addChild(sprite);

    const app = {
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    expect(async () => {
      await plugin.update(
        // @ts-ignore
        app,
        {
          parent: container,
          prevElement: {
            id: "test0",
          },
          nextElement: {
            id: "test0",
            url: "/localhost:3000/test.png",
            x: 100,
          },
          transitions: [],
          getTransitionByType: () => undefined,
        },
      );
    }).rejects.toThrowError("Sprite with id test0 not found");
  });
});
