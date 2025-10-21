/**
 *
 * @param {{
 *  x: number,
 *  y: number
 * }} position
 * @param {{
 *  width: number,
 *  height: number
 * }} dimensions
 * @param {{
 *  anchorX: number,
 *  anchorY: number
 * }} anchor
 *
 * @returns {{
 *  x: number,
 *  y: number
 * }}
 */
export function calculatePositionAfterAnchor(position, dimensions, anchor){
    const offSetX= position.x - (dimensions.width * anchor.anchorX);
    const offSetY= position.y - (dimensions.height * anchor.anchorY);
    return {
        x: offSetX,
        y: offSetY
    };
}