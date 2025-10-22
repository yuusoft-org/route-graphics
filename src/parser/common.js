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
    positionX,
    positionY,
    width,
    height,
    anchorX,
    anchorY
}){
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