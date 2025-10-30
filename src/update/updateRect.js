/**
 * Update function for Rectangle elements
 * @typedef {import('../types.js').RectASTNode} RectASTNode
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @param {Container} container - The parent container to search in
 * @param {RectASTNode} prevAST - Previous rect state
 * @param {RectASTNode} nextAST - Next rect state
 */
export function updateRect(container, prevAST, nextAST) {
    const rectElement = container.children.find(child => child.label === prevAST.id);

    
    if (rectElement) {
        rectElement.clear();

        rectElement.rect(nextAST.x, nextAST.y, nextAST.width, nextAST.height)
            .fill(nextAST.fill);

        if (nextAST.border) {
            rectElement.stroke({
                color: nextAST.border.color,
                alpha: nextAST.border.alpha,
                width: nextAST.border.width
            });
        }
        
        rectElement.zIndex = nextAST.zIndex;
    }
}