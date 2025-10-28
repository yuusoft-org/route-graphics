/**
 * @typedef {import('../types.js').ASTNode} ASTNode
 */

/**
 * 
 * @param {string} id 
 * @param {ASTNode} ASTNode
 * @returns {ASTNode} 
 */
export function getASTChild(id,ASTNode){
    if(ASTNode.id === id) return ASTNode

    if(ASTNode.type === "container"){
        for(const child of ASTNode.children){
            const returnChild = getASTChild(id,child)
            if(returnChild) return returnChild
        }
    }

    return null;
}