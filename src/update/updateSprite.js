import { Assets } from "pixi.js";

/**
 * Update function for Sprite elements
 * @typedef {import('../types.js').SpriteASTNode} SpriteASTNode
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @param {Container} container - The parent container to search in
 * @param {SpriteASTNode} prevSprite - Previous sprite state
 * @param {SpriteASTNode} nextSprite - Next sprite state
 */
export async function updateSprite(container, prevSprite, nextSprite) {
    const spriteElement = container.children.find(child => child.label === prevSprite.id);

    if (spriteElement) {
        if (prevSprite.url !== nextSprite.url) {
            const texture = await Assets.load(nextSprite.url);
            spriteElement.texture = texture;
        }

        spriteElement.x = nextSprite.x;
        spriteElement.y = nextSprite.y;
        spriteElement.width = nextSprite.width;
        spriteElement.height = nextSprite.height;

        spriteElement.alpha = nextSprite.alpha;
        spriteElement.zIndex = nextSprite.zIndex;
    }
}