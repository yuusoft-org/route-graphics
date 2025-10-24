/**
 * @typedef {import('../types').PositionAfterAnchorOptions} PositionAfterAnchorOptions
 * @typedef {import('../types').PositionAfterAnchor} PositionAfterAnchor
 */


/**
 *
 * @param {PositionAfterAnchorOptions} options
 * @returns {PositionAfterAnchor}
 */
export function calculatePositionAfterAnchor({
    positionX = 0,
    positionY = 0,
    width,
    height,
    anchorX = 0,
    anchorY = 0
}){
    if(!(typeof width ==="number") || !(typeof height === "number")){
        throw new Error("Input Error: Width or height is missing")
    }
    const origin = {
        x: width * anchorX,
        y: height * anchorY
    }

    const offSetX= positionX - origin.x;
    const offSetY= positionY - origin.y;
    return {
        x: offSetX,
        y: offSetY,
        originX: origin.x,
        originY: origin.y 
    };
}