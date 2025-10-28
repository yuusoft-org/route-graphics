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
    if(textASTNode.id === "zh-label-true")console.log(textASTNode)
    const text = new Text({
        text: textASTNode.text,
        style: textASTNode.style,
        label: textASTNode.id
    })

    text.x = textASTNode.x
    text.y = textASTNode.y
    text.zIndex = textASTNode.zIndex
    
    parent.addChild(text)
}   