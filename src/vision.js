/**
 * Camera side of the integration: marker detection, mat pose, token frames.
 *
 * Input:  an ImageData-like object ({width, height, data}) — a canvas frame.
 * Output: { mat: {found, corners, homography}, markers: [{id, corners}] }
 *         and toFrame() -> [{markerId, x, y, theta_deg}] in mat coordinates.
 *
 * The four board markers (100-103) define the mat frame. Everything else in
 * this repository works in that frame: slots in shared/templates, drop targets,
 * placement tolerance. Board corners are inset from the mat edge, so the
 * reference points are the marker centres, not the paper corners.
 */

const DICTIONARY = 'ARUCO_MIP_36h12';
const CORNERS = { tl: 100, tr: 101, br: 102, bl: 103 };

/** Default mat geometry (mm) — must match tools/make-tokens.cjs. */
export const MAT_GEOMETRY = { w_mm: 420, h_mm: 297, margin_mm: 8, marker_mm: 60 };

export function cornerReference({ w_mm = 420, h_mm = 297, margin_mm = 8, marker_mm = 60 } = {}) {
  const c = margin_mm + marker_mm / 2;
  return {
    [CORNERS.tl]: [c / w_mm, c / h_mm],
    [CORNERS.tr]: [(w_mm - c) / w_mm, c / h_mm],
    [CORNERS.br]: [(w_mm - c) / w_mm, (h_mm - c) / h_mm],
    [CORNERS.bl]: [c / w_mm, (h_mm - c) / h_mm],
  };
}

const point = (p) => (Array.isArray(p) ? p : [p.x, p.y]);
const centre = (corners) => {
  const sum = corners.reduce((a, p) => { const [x, y] = point(p); return [a[0] + x, a[1] + y]; }, [0, 0]);
  return [sum[0] / corners.length, sum[1] / corners.length];
};

/** Solve a small dense linear system (Gaussian elimination with pivoting). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i === undefined ? 0 : i]);
}

/** 3x3 homography mapping four source points to four destination points. */
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

export function project(H, [x, y]) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  if (Math.abs(w) < 1e-12) return null;
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

/**
 * @param {object} opts
 * @param {Function} opts.Detector  AR.Detector constructor (injected so the module stays testable)
 * @param {object}  opts.geometry   mat geometry in mm
 */
export function createVision({ Detector, geometry = MAT_GEOMETRY, dictionary = DICTIONARY, maxHammingDistance = 6 } = {}) {
  const detector = Detector ? new Detector({ dictionaryName: dictionary, maxHammingDistance }) : null;
  const refs = cornerReference(geometry);

  function detectMarkers(image) {
    if (!detector) throw new Error('createVision needs a Detector (js-aruco2 AR.Detector)');
    return detector.detect(image).map((m) => ({ id: m.id, corners: m.corners.map((p) => [p.x, p.y]) }));
  }

  function solveMat(markers) {
    const byId = new Map(markers.map((m) => [m.id, m]));
    const quad = [];
    for (const id of [CORNERS.tl, CORNERS.tr, CORNERS.br, CORNERS.bl]) {
      const m = byId.get(id);
      if (!m) return { found: false, corners: null, homography: null, missing: id };
      quad.push(centre(m.corners));
    }
    const H = homography(quad, [refs[100], refs[101], refs[102], refs[103]]);
    if (!H) return { found: false, corners: quad, homography: null, missing: null };
    return { found: true, corners: quad, homography: H, missing: null };
  }

  function toFrame(markers, mat) {
    if (!mat || !mat.found) return [];
    const out = [];
    for (const m of markers) {
      if (m.id >= 100) continue;                       // board corners are not components
      const p = project(mat.homography, centre(m.corners));
      if (!p) continue;
      const [x, y] = p;
      if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) continue;   // off the mat
      const mm = [x * geometry.w_mm, y * geometry.h_mm];
      const a = project(mat.homography, m.corners[0]);
      const b = project(mat.homography, m.corners[1]);
      if (!a || !b) continue;
      const dx = (b[0] - a[0]) * geometry.w_mm;
      const dy = (b[1] - a[1]) * geometry.h_mm;
      out.push({ markerId: m.id, x, y, theta_deg: Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360) });
    }
    return out;
  }

  return {
    /** One camera frame in, one stabilizable sighting frame out. */
    frameFromImage(image) {
      const markers = detectMarkers(image);
      const mat = solveMat(markers);
      return { mat, markers, frame: toFrame(markers, mat) };
    },
    detectMarkers,
    solveMat,
    toFrame,
    cornerReference: () => refs,
  };
}
