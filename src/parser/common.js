/**
 * @typedef {import('../types').PositionAfterAnchorOptions} PositionAfterAnchorOptions
 * @typedef {import('../types').PositionAfterAnchor} PositionAfterAnchor
 */

/**
 *
 * @param {PositionAfterAnchorOptions} options
 * @returns {PositionAfterAnchor}
 */
export function calculatePositionAfterAnchor({position, dimensions, anchor}){
    const offSetX= position.x - (dimensions.width * anchor.anchorX);
    const offSetY= position.y - (dimensions.height * anchor.anchorY);
    return {
        x: offSetX,
        y: offSetY
    };
}