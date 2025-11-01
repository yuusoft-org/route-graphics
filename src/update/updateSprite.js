import { Texture } from "pixi.js";

/**
 * Update function for Sprite elements
 * @typedef {import('../types.js').SpriteASTNode} SpriteASTNode
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @param {Container} container - The parent container to search in
 * @param {SpriteASTNode} prevAST - Previous sprite state
 * @param {SpriteASTNode} nextAST - Next sprite state
 */
export async function updateSprite(container, prevAST, nextAST) {
    const spriteElement = container.children.find(child => child.label === prevAST.id);

    if (spriteElement) {
        if (prevAST.url !== nextAST.url) {
            const texture = nextAST.url ? Texture.from(nextAST.url) : Texture.EMPTY;
            spriteElement.texture = texture;
        }

        spriteElement.x = nextAST.x;
        spriteElement.y = nextAST.y;
        spriteElement.width = nextAST.width;
        spriteElement.height = nextAST.height;

        spriteElement.alpha = nextAST.alpha;
        spriteElement.zIndex = nextAST.zIndex;
    }
}
