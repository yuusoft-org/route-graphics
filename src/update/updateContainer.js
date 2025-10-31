import { Container } from "pixi.js";
import { renderApp } from '../render/renderApp.js';
import { deleteContainer } from "../delete/deleteContainer.js";

/**
 * Update function for Container elements
 * @typedef {import('../types.js').ContainerASTNode} ContainerASTNode
 * @typedef {import('pixi.js').Container} Container
 */

/**
 * @param {Container} parentContainer - The parent container to search in
 * @param {ContainerASTNode} prevAST - Previous container state
 * @param {ContainerASTNode} nextAST - Next container state
 * @param {import('pixi.js').Application} app - The PixiJS application
 */
export function updateContainer(app, parentContainer, prevAST, nextAST) {
    const containerElement = parentContainer.children.find(child => child.label === prevAST.id);

    if (containerElement) {
        containerElement.x = nextAST.x;
        containerElement.y = nextAST.y;
        containerElement.zIndex = nextAST.zIndex;
        containerElement.label = nextAST.id;


        if(JSON.stringify(prevAST.children) !== JSON.stringify(nextAST.children)) {
            renderApp(app, containerElement, prevAST.children, nextAST.children);
        }
    }
}