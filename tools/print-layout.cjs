/** Print geometry: one place for the positions of every printed marker.
 *  The generator draws from it and the tests crop from it. */
const mm = 6.6666667;           // 1980 px / 297 mm

const TOKEN_MM = 45, TOKEN_PX = Math.round(TOKEN_MM * mm);
const SHEET = { w: 1980, h: 1400 };

module.exports = { mm, TOKEN_MM, TOKEN_PX, SHEET };
