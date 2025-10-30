/**
 * Update function for Text elements
 * @typedef {import('../types.js').TextASTNode} TextASTNode
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @param {Container} container - The parent container to search in
 * @param {TextASTNode} prevText - Previous text state
 * @param {TextASTNode} nextText - Next text state
 */
export function updateText(container, prevText, nextText) {
    const textElement = container.children.find(child => child.label === prevText.id);

    if (textElement) {
        textElement.text = nextText.text;

        textElement.style = {
            fill: nextText.style.fill,
            fontFamily: nextText.style.fontFamily,
            fontSize: nextText.style.fontSize,
            wordWrap: nextText.style.wordWrap,
            breakWords: nextText.style.breakWords,
            wordWrapWidth: nextText.style.wordWrapWidth
        };

        textElement.x = nextText.x;
        textElement.y = nextText.y;
        textElement.zIndex = nextText.zIndex;
    }
}