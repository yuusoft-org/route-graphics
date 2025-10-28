
import { renderRect } from './renderRect.js';
import renderText from './renderText.js';
import { renderSprite } from './renderSprite.js';
import { renderContainer } from './renderContainer.js';
import { parseRect } from '../parser/parseRect.js'
import { parseText } from '../parser/parseText.js'
import { parseContainer } from '../parser/parseContainer.js'
import { parseSprite } from '../parser/parseSprite.js'
/**
 * @typedef {import('../types.js').Application} Application
 * @typedef {import('../types.js').ASTNode} ASTNode
 * @typedef {import('../types.js').Container} Container
 */


/**
 * @param {Application} app
 * @param {Container} parent 
 * @param {ASTNode[]} ASTTree 
*/
export function renderApp(app,parent,ASTTree){
    const parsedASTTree = ASTTree.map(node=>{
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
    for (let index = 0; index < parsedASTTree.length; index++) {
        const element = parsedASTTree[index];
        
        switch(element.type){
            case "rect":
                renderRect(element,parent)
                break;
            case "text":
                renderText(element,parent)
                break;
            case "container":
                renderContainer(element,parent)
                break;
            case "sprite":
                renderSprite(element,parent)
                break;
            default:
        }
    }
}