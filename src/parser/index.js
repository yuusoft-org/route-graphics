import { parseContainer } from "./parseContainer"
import { parseRect } from "./parseRect"
import { parseSprite } from "./parseSprite"
import { parseText } from "./parseText"

/**
 * @typedef {import('../types.js').BaseElement} BaseElement
 * @typedef {import('../types.js').ASTNode} ASTNode
 */

/**
 * 
 * @param {BaseElement} JSONObject 
 * @returns {ASTNode}
 */
export default function parseJSONToAST(JSONObject){
    const parsedASTTree = JSONObject.map(node=>{
        switch(node.type){
            case "rect":
                return parseRect(node)
            case "container":
                return parseContainer(node)
            case "text":
                return parseText(node)
            case "sprite":
                return parseSprite(node)
        }
    })

    return parsedASTTree
}