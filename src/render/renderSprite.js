import { Assets, Sprite } from "pixi.js";

/**
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').SpriteASTNode} SpriteASTNode
 */

/**
 *
 * @param {SpriteASTNode} spriteASTNode
 * @param {Container} parent
 */
export async function renderSprite(spriteASTNode, parent) {
    const {
        id,
        x,
        y,
        width,
        height,
        url,
        alpha,
        originX,
        originY,
        zIndex
    } = spriteASTNode;
    const texture = await Assets.load(url);
    const sprite = new Sprite(texture);

    sprite.x = x;
    sprite.y = y;

    sprite.width = width;
    sprite.height = height;

    sprite.alpha = alpha;

    // sprite.pivot.set(originX, originY);

    sprite.zIndex = zIndex;

    sprite.label = id;

    parent.addChild(sprite);
}