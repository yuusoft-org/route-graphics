/**
 * Update function for Rectangle elements
 * @typedef {import('../types.js').RectASTNode} RectASTNode
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @param {Container} container - The parent container to search in
 * @param {RectASTNode} prevRect - Previous rect state
 * @param {RectASTNode} nextRect - Next rect state
 */
export function updateRect(container, prevRect, nextRect) {
    const rectElement = container.children.find(child => child.label === prevRect.id);

    
    if (rectElement) {
        rectElement.clear();

        rectElement.rect(nextRect.x, nextRect.y, nextRect.width, nextRect.height)
            .fill(nextRect.fill);

        if (nextRect.border) {
            rectElement.stroke({
                color: nextRect.border.color,
                alpha: nextRect.border.alpha,
                width: nextRect.border.width
            });
        }
        
        rectElement.zIndex = nextRect.zIndex;
    }
}