/**
 * Update function for Text elements
 * @typedef {import('../types.js').TextASTNode} TextASTNode
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @param {Container} container - The parent container to search in
 * @param {TextASTNode} prevAST - Previous text state
 * @param {TextASTNode} nextAST - Next text state
 */
export function updateText(container, prevAST, nextAST) {
    const textElement = container.children.find(child => child.label === prevAST.id);

    if (textElement) {
        textElement.text = nextAST.text;

        textElement.style = {
            fill: nextAST.style.fill,
            fontFamily: nextAST.style.fontFamily,
            fontSize: nextAST.style.fontSize,
            wordWrap: nextAST.style.wordWrap,
            breakWords: nextAST.style.breakWords,
            wordWrapWidth: nextAST.style.wordWrapWidth
        };

        textElement.x = nextAST.x;
        textElement.y = nextAST.y;
        textElement.zIndex = nextAST.zIndex;
    }
}