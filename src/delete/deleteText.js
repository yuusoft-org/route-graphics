import { Container } from "pixi.js";
/**
 * @typedef {import('../types.js').ASTNode} ASTNode
 */

/**
 * 
 * @param {Container} container 
 * @param {ASTNode} deletedASTNode 
 */
export function deleteText(container,deletedASTNode){
    const text = container.getChildByLabel(deletedASTNode.id)

    if(text){
        text.destroy()
    }
}