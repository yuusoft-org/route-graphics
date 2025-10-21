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
    const offSetX= positionX - (width * anchorX);
    const offSetY= positionY - (height * anchorY);
    return {
        x: offSetX,
        y: offSetY
    };
}