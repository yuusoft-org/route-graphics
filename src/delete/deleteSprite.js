import { Container } from "pixi.js";
/**
 * @typedef {import('../types.js').ASTNode} ASTNode
 */

/**
 *
 * @param {Container} container
 * @param {ASTNode} deletedASTNode
 */
export function deleteSprite(container,deletedASTNode){
    const sprite = container.getChildByLabel(deletedASTNode.id)

    if(sprite){
        sprite.destroy()
    }
}