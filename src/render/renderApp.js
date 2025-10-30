
import { renderRect } from './renderRect.js';
import renderText from './renderText.js';
import { renderSprite } from './renderSprite.js';
import { renderContainer } from './renderContainer.js';
import { diffElements } from './common.js';
import { deleteRect } from '../delete/deleteRect.js';
import { deleteText } from '../delete/deleteText.js';
import { deleteContainer } from '../delete/deleteContainer.js';
import { deleteSprite } from '../delete/deleteSprite.js';
import { updateRect } from '../update/updateRect.js';
import { updateText } from '../update/updateText.js';
import { updateSprite } from '../update/updateSprite.js';
import { updateContainer } from '../update/updateContainer.js';
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

    for (const {prev, next} of toUpdateElement) {
        switch(next.type) {
            case "rect":
                updateRect(parent, prev, next);
                break;
            case "text":
                updateText(parent, prev, next);
                break;
            case "container":
                updateContainer(app, parent, prev, next);
                break;
            case "sprite":
                updateSprite(parent, prev, next);
                break;
            default:
        }
    }
}