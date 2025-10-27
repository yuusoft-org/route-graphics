import { Container } from "pixi.js";
import { renderRect } from './renderRect.js';
import renderText from './renderText.js';
import { renderSprite } from './renderSprite.js';

/**
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').ContainerASTNode} ContainerASTNode
 */

/**
 *
 * @param {ContainerASTNode} containerASTNode
 * @param {Container} parent
 */
export function renderContainer(containerASTNode, parent) {
    const {
        id,
        x,
        y,
        width,
        height,
        children,
        scroll,
        originX,
        originY,
        rotation,
        zIndex
    } = containerASTNode;

    const container = new Container();

    container.x = x;
    container.y = y;

    container.width = width;
    container.height = height;

    container.pivot.set(originX, originY);

    if (rotation !== undefined) {
        container.rotation = (rotation * Math.PI) / 180;
    }

    container.zIndex = zIndex;

    container.label = id;

    for (const child of children) {
        switch (child.type) {
            case "rect":
                renderRect(child, container);
                break;
            case "text":
                renderText(child, container);
                break;
            case "sprite":
                renderSprite(child, container);
                break;
            case "container":
                renderContainer(child, container);
                break;
            default:
                throw new Error("Unkown types")
        }
    }

    parent.addChild(container);
}