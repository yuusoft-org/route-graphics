
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
    sortContainerChildren(parent,nextASTTree)
}

function sortContainerChildren(container, nextAST){
    container.children.sort((a, b) => {
        const aElement = nextAST.find(
            (element) => element.id === a.label,
        );
        const bElement = nextAST.find(
            (element) => element.id === b.label,
        );

        if (aElement && bElement) {
            // First, sort by zIndex if specified
            const aZIndex = aElement.zIndex ?? 0;
            const bZIndex = bElement.zIndex ?? 0;
            if (aZIndex !== bZIndex) {
            return aZIndex - bZIndex;
            }

            // If zIndex is the same or not specified, maintain order from nextState.elements
            const aIndex = nextAST.findIndex(
                (element) => element.id === a.label,
            );
            const bIndex = nextAST.findIndex(
                (element) => element.id === b.label,
            );
            return aIndex - bIndex;
        }

        // Keep elements that aren't in nextState.elements at their current position
        if (!aElement && !bElement) return 0;
        if (!aElement) return -1;
        if (!bElement) return 1;
    });
}