import { renderApp } from '../render/renderApp.js';
import { Container } from "pixi.js";

/**
 * Update function for Container elements
 * @typedef {import('../types.js').ContainerASTNode} ContainerASTNode
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @param {Container} parentContainer - The parent container to search in
 * @param {ContainerASTNode} prevContainer - Previous container state
 * @param {ContainerASTNode} nextContainer - Next container state
 * @param {import('pixi.js').Application} app - The PixiJS application
 */
export function updateContainer(app, parentContainer, prevContainer, nextContainer) {
    const containerElement = parentContainer.children.find(child => child.label === prevContainer.id);
    console.log("Prev: ",JSON.stringify(prevContainer,null,2))
    console.log("Next: ",JSON.stringify(nextContainer,null,2))
    if (containerElement) {
        containerElement.x = nextContainer.x;
        containerElement.y = nextContainer.y;
        containerElement.width = nextContainer.width;
        containerElement.height = nextContainer.height;
        containerElement.zIndex = nextContainer.zIndex;


        if(JSON.stringify(prevContainer.children) !== JSON.stringify(nextContainer.children)) {
            renderApp(app, containerElement, prevContainer.children, nextContainer.children);
        }
    }
}