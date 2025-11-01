import { Sprite, Texture } from "pixi.js";

/**
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').SpriteASTNode} SpriteASTNode
 */

/**
 *
 * @param {Container} parent
 * @param {SpriteASTNode} spriteASTNode
 */
export async function renderSprite(parent, spriteASTNode) {
  const {
    id,
    x,
    y,
    width,
    height,
    url,
    alpha,
    zIndex
  } = spriteASTNode;
  const texture = url ? Texture.from(url) : Texture.EMPTY;
  const sprite = new Sprite(texture);

  sprite.x = x;
  sprite.y = y;

  sprite.width = width;
  sprite.height = height;

  sprite.alpha = alpha;

  sprite.zIndex = zIndex;

  sprite.label = id;

  parent.addChild(sprite);
}
