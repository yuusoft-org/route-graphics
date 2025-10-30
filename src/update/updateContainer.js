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
    const oldContainerElement = parentContainer.children.find(child => child.label === prevAST.id);

    if (oldContainerElement) {
        const oldIndex = parentContainer.children.indexOf(oldContainerElement);

        const newContainerElement = new Container();

        newContainerElement.x = nextAST.x;
        newContainerElement.y = nextAST.y;
        newContainerElement.width = nextAST.width;
        newContainerElement.height = nextAST.height;
        newContainerElement.zIndex = nextAST.zIndex;
        newContainerElement.label = nextAST.id;

        const children = [...oldContainerElement.children];
        children.forEach(child => {
            newContainerElement.addChild(child);
        });

        parentContainer.removeChild(oldContainerElement);
        oldContainerElement.destroy({children: true});
        parentContainer.addChildAt(newContainerElement, Math.min(oldIndex, parentContainer.children.length));

        if(JSON.stringify(prevAST.children) !== JSON.stringify(nextAST.children)) {
            renderApp(app, newContainerElement, prevAST.children, nextAST.children);
        }
    }
}