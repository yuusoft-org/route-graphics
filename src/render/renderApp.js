
import { renderRect } from './renderRect.js';
import renderText from './renderText.js';
import { renderSprite } from './renderSprite.js';
import { renderContainer } from './renderContainer.js';
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
    
    for (let index = 0; index < ASTTree.length; index++) {
        const element = ASTTree[index];
        
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