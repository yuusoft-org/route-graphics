const MANAGED_VIDEO_SPRITES_KEY = "__routeGraphicsManagedVideoSprites";
const managedVideoSpriteResizeHandlers = new WeakMap();

const getManagedVideoSpriteSet = (source) => {
  if (!source) {
    return null;
  }

  if (!source[MANAGED_VIDEO_SPRITES_KEY]) {
    source[MANAGED_VIDEO_SPRITES_KEY] = new Set();
  }

  return source[MANAGED_VIDEO_SPRITES_KEY];
};

export const registerManagedVideoSprite = (sprite) => {
  const source = sprite?.texture?.source;
  const sprites = getManagedVideoSpriteSet(source);

  if (!sprites) {
    return;
  }

  sprites.add(sprite);

  if (typeof sprite.once === "function") {
    sprite.once("destroyed", () => {
      source?.[MANAGED_VIDEO_SPRITES_KEY]?.delete(sprite);
    });
  }
};

export const setManagedVideoSpriteResizeHandler = (sprite, handler) => {
  if (!sprite) {
    return;
  }

  if (typeof handler === "function") {
    managedVideoSpriteResizeHandlers.set(sprite, handler);
  } else {
    managedVideoSpriteResizeHandlers.delete(sprite);
  }
};

export const requestManagedVideoTextureUpdate = (sprite) => {
  const runtime = sprite?.texture?.source?.__routeGraphicsVideoTextureRuntime;

  return runtime?.requestUpdate?.() ?? false;
};

export const hasManagedVideoTextureDimensions = (sprite) => {
  const texture = sprite?.texture;
  const source = texture?.source;
  const resource = source?.resource;
  const width = texture?.orig?.width ?? source?.width;
  const height = texture?.orig?.height ?? source?.height;
  const exposesVideoDimensions =
    resource != null &&
    ("videoWidth" in Object(resource) || "videoHeight" in Object(resource));

  if (exposesVideoDimensions) {
    return (
      Number.isFinite(resource.videoWidth) &&
      resource.videoWidth > 0 &&
      Number.isFinite(resource.videoHeight) &&
      resource.videoHeight > 0 &&
      width === resource.videoWidth &&
      height === resource.videoHeight
    );
  }

  return (
    Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
  );
};

export const unregisterManagedVideoSprite = (
  sprite,
  source = sprite?.texture?.source,
) => {
  source?.[MANAGED_VIDEO_SPRITES_KEY]?.delete(sprite);
};

export const clearManagedVideoSprites = (source) => {
  const sprites = source?.[MANAGED_VIDEO_SPRITES_KEY];

  if (sprites) {
    sprites.clear();
  }

  if (source) {
    source[MANAGED_VIDEO_SPRITES_KEY] = undefined;
  }
};

export const captureManagedVideoSpriteSizes = (source) => {
  const sprites = source?.[MANAGED_VIDEO_SPRITES_KEY];

  if (!sprites?.size) {
    return null;
  }

  const sizes = new Map();

  for (const sprite of sprites) {
    if (!sprite || sprite.destroyed || sprite.texture?.source !== source) {
      sprites.delete(sprite);
      continue;
    }

    const width = sprite.width;
    const height = sprite.height;

    if (Number.isFinite(width) && Number.isFinite(height)) {
      sizes.set(sprite, { width, height });
    }
  }

  return sizes.size > 0 ? sizes : null;
};

export const restoreManagedVideoSpriteSizes = (sizes) => {
  if (!sizes) {
    return;
  }

  for (const [sprite, size] of sizes) {
    if (!sprite || sprite.destroyed) {
      continue;
    }

    if (Number.isFinite(size.width)) {
      sprite.width = size.width;
    }

    if (Number.isFinite(size.height)) {
      sprite.height = size.height;
    }

    managedVideoSpriteResizeHandlers.get(sprite)?.();
  }
};
