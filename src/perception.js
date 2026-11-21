/**
 * Turn a rolling history of per-frame marker sightings into stable placements.
 * A marker must be seen in `minHits` of the last `window` frames, so one bad
 * frame cannot make a component appear or disappear.
 */

export const MAT_CORNER_IDS = new Set([100, 101, 102, 103]);

export function stabilize(frames, { minHits = 3, window = 5 } = {}) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const tail = frames.slice(-window);
  const hits = new Map();
  for (const frame of tail) {
    for (const s of frame) {
      if (MAT_CORNER_IDS.has(s.markerId)) continue;
      const seen = hits.get(s.markerId) ?? { count: 0, last: null };
      seen.count += 1;
      seen.last = s;
      hits.set(s.markerId, seen);
    }
  }
  return [...hits.entries()]
    .filter(([, v]) => v.count >= minHits)
    .map(([markerId, v]) => ({ markerId, x: v.last.x, y: v.last.y, theta_deg: v.last.theta_deg ?? 0, hits: v.count }));
}
