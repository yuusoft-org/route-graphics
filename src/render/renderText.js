
/**
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').TextASTNode} TextASTNode
 */

import { Text, TextStyle } from 'pixi.js'

/**
 * 
 * @param {TextASTNode} textASTNode
 * @param {Container} parent 
 */
export default function renderText(textASTNode,parent){
    const text = new Text({
        text: textASTNode.text,
        style: textASTNode.style,
        label: textASTNode.id
    })

    text.x = textASTNode.x
    text.y = textASTNode.y

    parent.addChild(text)
}   