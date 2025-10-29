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
export default function renderText(parent,textASTNode){
    const text = new Text({
        text: textASTNode.text,
        style: {
            fill: textASTNode.style.fill,
            fontFamily: textASTNode.style.fontFamily,
            fontSize: textASTNode.style.fontSize,
            wordWrap: textASTNode.style.wordWrap,
            breakWords: textASTNode.style.breakWords,
            wordWrapWidth: textASTNode.style.wordWrapWidth
        },
        label: textASTNode.id
    })

    text.x = textASTNode.x
    text.y = textASTNode.y
    text.zIndex = textASTNode.zIndex
    
    parent.addChild(text)
}   