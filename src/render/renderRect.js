import { Graphics } from "pixi.js";

/**
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').RectASTNode} RectASTNode
 */


/**
 * 
 * @param {RectASTNode} rectASTNode
 * @param {Container} parent 
 */
export function renderRect(rectASTNode,parent){
    const {
        id,
        x,
        y,
        width,
        height,
        fill,
        border,
        originX,
        originY,
        zIndex,
        rotation
    } = rectASTNode

    const rect = new Graphics()
        .rect(x,y,width,height)
        .fill(fill)
        .stroke({
            width: border.width,
            fill: border.color,
            alpha: border.alpha
        })

    rect.label = id
    rect.pivot.set(originX,originY)
    rect.rotation = (rotation * Math.PI) / 180
    rect.zIndex = zIndex 
    
    parent.addChild(rect)
}