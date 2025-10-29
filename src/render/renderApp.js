
import { renderRect } from './renderRect.js';
import renderText from './renderText.js';
import { renderSprite } from './renderSprite.js';
import { renderContainer } from './renderContainer.js';
import { diffElements } from './common.js';
import { deleteRect } from '../delete/deleteRect.js';
import { deleteText } from '../delete/deleteText.js';
import { deleteContainer } from '../delete/deleteContainer.js';
import { deleteSprite } from '../delete/deleteSprite.js';
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
export function renderApp(app,parent,prevASTTree,nextASTTree){
    // const parsedASTTree = ASTTree.map(node=>{
    //     switch(node.type){
    //         case "rect":
    //             return parseRect(node)
    //         case "container":
    //             return parseContainer(node)
    //         case "text":
    //             return parseText(node)
    //         case "sprite":
    //             return parseSprite(node)
    //     }
    // })
    const {toAddElement,toDeleteElement,toUpdateElement} = diffElements(prevASTTree,nextASTTree)
    for (const element of toDeleteElement){
        switch(element.type){
            case "rect":
                deleteRect(parent,element)
                break;
            case "text":
                deleteText(parent,element)
                break;
            case "container":
                deleteContainer(parent,element)
                break;
            case "sprite":
                deleteSprite(parent,element)
                break;
            default:
        }
    }

    for (const element of toAddElement) {
        switch(element.type){
            case "rect":
                renderRect(parent,element)
                break;
            case "text":
                renderText(parent,element)
                break;
            case "container":
                renderContainer(parent,element)
                break;
            case "sprite":
                renderSprite(parent,element)
                break;
            default:
        }
    }
}