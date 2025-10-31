import { Container } from "pixi.js";
/**
 * @typedef {import('../types.js').ASTNode} ASTNode
 */

/**
 *
 * @param {Container} container
 * @param {ASTNode} deletedASTNode
 */
export function deleteContainer(container,deletedASTNode){
    const containerElement = container.getChildByLabel(deletedASTNode.id)

    if(containerElement){
        containerElement.destroy({children: true})
    }
}