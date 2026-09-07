import { Assets, Container, Texture, TextureSource } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { addVideo } from "../../src/plugins/elements/video/addVideo.js";
import { deleteVideo } from "../../src/plugins/elements/video/deleteVideo.js";

describe("video sprite lifecycle", () => {
  it.each(["deleteVideo", "sprite.destroy", "parent.destroy"])(
    "releases cached dynamic texture listeners through %s",
    (cleanup) => {
      const assetId = "video-lifecycle.mp4";
      const video = {
        videoWidth: 640,
        videoHeight: 360,
        pause: vi.fn(),
        play: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const texture = new Texture({
        source: new TextureSource({
          resource: video,
          width: 640,
          height: 360,
        }),
        dynamic: true,
      });
      const root = new Container();
      const onTextureUpdate = vi.fn();
      texture.on("update", onTextureUpdate);
      Assets.cache.set(assetId, texture);

      const mountVideo = (parent, id) => {
        const element = {
          id,
          type: "video",
          src: assetId,
          x: 0,
          y: 0,
          width: 320,
          height: 180,
          loop: true,
        };
        addVideo({ parent, element, animations: [], zIndex: 0 });
        return { element, sprite: parent.getChildByLabel(id) };
      };

      try {
        const { sprite: survivor } = mountVideo(root, "survivor");
        expect(texture.listenerCount("update")).toBe(2);

        for (let cycle = 0; cycle < 10; cycle++) {
          const parent = root.addChild(new Container());
          const { element, sprite } = mountVideo(parent, "removed-video");
          expect(sprite.texture).toBe(texture);
          expect(texture.listenerCount("update")).toBe(3);

          if (cleanup === "deleteVideo") {
            deleteVideo({ parent, element, animations: [] });
          } else if (cleanup === "sprite.destroy") {
            sprite.destroy();
          } else {
            parent.destroy({ children: true });
          }

          expect(sprite.destroyed).toBe(true);
          expect(texture.listenerCount("update")).toBe(2);
          expect(Assets.cache.get(assetId)).toBe(texture);
          expect(texture.destroyed).toBe(false);

          survivor.didViewUpdate = false;
          sprite.didViewUpdate = false;
          texture.update();
          expect(survivor.didViewUpdate).toBe(true);
          expect(sprite.didViewUpdate).toBe(false);
          expect(onTextureUpdate).toHaveBeenCalledTimes(cycle + 1);

          if (!parent.destroyed) parent.destroy({ children: true });
        }

        survivor.destroy();
        expect(texture.listenerCount("update")).toBe(1);
        texture.off("update", onTextureUpdate);
        expect(texture.listenerCount("update")).toBe(0);
      } finally {
        root.destroy({ children: true });
        Assets.cache.remove(assetId);
        texture.destroy(true);
      }
    },
  );
});
