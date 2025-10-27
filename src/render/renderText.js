import { Text } from 'pixi.js'

/**
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').TextASTNode} TextASTNode
 */


/**
 * 
 * @param {TextASTNode} textASTNode
 * @param {Container} parent 
 */
export default function renderText(textASTNode,parent){
    const text = new Text({
        text: textASTNode.text,
        style: textASTNode.style,
        wordWrap: textASTNode.breakWords,
        wordWrapWidth: textASTNode.wordWrapWidth,
        label: textASTNode.id
    })

    text.x = textASTNode.x
    text.y = textASTNode.y
    text.zIndex = textASTNode.zIndex
    
    parent.addChild(text)
}   