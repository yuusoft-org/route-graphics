import { Container } from "pixi.js";
/**
 * @typedef {import('../types.js').ASTNode} ASTNode
 */

/**
 *
 * @param {Container} container
 * @param {ASTNode} deletedASTNode
 */
export function deleteRect(container,deletedASTNode){
    const rect = container.getChildByLabel(deletedASTNode.id)

    if(rect){
        rect.destroy()
    }
}