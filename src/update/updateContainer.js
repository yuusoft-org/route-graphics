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
 * @param {ContainerASTNode} prevContainer - Previous container state
 * @param {ContainerASTNode} nextContainer - Next container state
 * @param {import('pixi.js').Application} app - The PixiJS application
 */
export function updateContainer(app, parentContainer, prevContainer, nextContainer) {
    const oldContainerElement = parentContainer.children.find(child => child.label === prevContainer.id);

    if (oldContainerElement) {
        const oldIndex = parentContainer.children.indexOf(oldContainerElement);

        const newContainerElement = new Container();

        newContainerElement.x = nextContainer.x;
        newContainerElement.y = nextContainer.y;
        newContainerElement.width = nextContainer.width;
        newContainerElement.height = nextContainer.height;
        newContainerElement.zIndex = nextContainer.zIndex;
        newContainerElement.label = nextContainer.id;

        const children = [...oldContainerElement.children];
        children.forEach(child => {
            newContainerElement.addChild(child);
        });

        parentContainer.removeChild(oldContainerElement);
        oldContainerElement.destroy({children: true});
        parentContainer.addChildAt(newContainerElement, Math.min(oldIndex, parentContainer.children.length));

        if(JSON.stringify(prevContainer.children) !== JSON.stringify(nextContainer.children)) {
            renderApp(app, newContainerElement, prevContainer.children, nextContainer.children);
        }
    }
}