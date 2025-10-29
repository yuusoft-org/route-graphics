import { Graphics } from "pixi.js";

/**
 * @typedef {import('../types.js').Container} Container
 * @typedef {import('../types.js').RectASTNode} RectASTNode
 */


/**
 * 
 * @param {Container} parent 
 * @param {RectASTNode} rectASTNode
 */
export function renderRect(parent,rectASTNode){
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
    
    if(border){
        rect.stroke({
            color: border.color,
            alpha: border.alpha,
            width: border.width
        })
    }

    rect.label = id
    // rect.pivot.set(originX,originY)
    // rect.rotation = (rotation * Math.PI) / 180
    rect.zIndex = zIndex 
    
    parent.addChild(rect)
}