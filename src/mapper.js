/**
 * Detected tokens -> component instances, using an exercise template.
 * A token counts when it sits within `tolerance.pos_mm` of a slot and that slot
 * accepts its component ref. Orientation decides polarity for polarized parts.
 */

const mmDistance = (a, b, mat) => {
  const dx = (a.x - b.x) * mat.w_mm;
  const dy = (a.y - b.y) * mat.h_mm;
  return Math.hypot(dx, dy);
};

const angleDiff = (a, b) => {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return Math.min(d, 360 - d);
};

export function mapPlacements(placements, template, byMarker) {
  const mat = template.mat ?? { w_mm: 297, h_mm: 210 };
  const tol = template.tolerance ?? { pos_mm: 18, theta_deg: 30 };
  const rejected = [];
  const candidates = [];

  for (const p of placements) {
    const token = byMarker.get(p.markerId);
    if (!token) { rejected.push({ markerId: p.markerId, reason: 'unknown_token' }); continue; }
    if (p.x < -0.02 || p.x > 1.02 || p.y < -0.02 || p.y > 1.02) {
      rejected.push({ markerId: p.markerId, ref: token.ref, reason: 'off_mat' });
      continue;
    }
    let nearest = null;
    for (const slot of template.slots) {
      const d = mmDistance(p, slot, mat);
      if (d > tol.pos_mm) continue;
      if (!nearest || d < nearest.d) nearest = { slot, d };
    }
    if (!nearest) { rejected.push({ markerId: p.markerId, ref: token.ref, reason: 'no_slot_in_range' }); continue; }
    if (!nearest.slot.accepts.includes(token.ref)) {
      rejected.push({ markerId: p.markerId, ref: token.ref, reason: 'wrong_component_for_slot', slot: nearest.slot.instance });
      continue;
    }
    candidates.push({
      markerId: p.markerId, ref: token.ref, slot: nearest.slot, distanceMm: nearest.d,
      flipped: token.polarized && angleDiff(p.theta_deg ?? 0, nearest.slot.theta_deg ?? 0) > tol.theta_deg,
    });
  }

  // Two tokens in one slot: closest wins, the other is reported, never merged.
  const bySlot = new Map();
  for (const c of candidates) {
    const current = bySlot.get(c.slot.instance);
    if (!current || c.distanceMm < current.distanceMm) {
      if (current) rejected.push({ markerId: current.markerId, ref: current.ref, reason: 'crowded_slot', slot: c.slot.instance });
      bySlot.set(c.slot.instance, c);
    } else {
      rejected.push({ markerId: c.markerId, ref: c.ref, reason: 'crowded_slot', slot: c.slot.instance });
    }
  }

  const instances = [...bySlot.values()]
    .map((c) => {
      const token = byMarker.get(c.markerId);
      return {
        instance: c.slot.instance,
        ref: token.ref,
        markerId: c.markerId,
        type: token.simType,
        params: token.params,
        flipped: c.flipped,
        distanceMm: Math.round(c.distanceMm * 10) / 10,
      };
    })
    .sort((a, b) => template.slots.findIndex((s) => s.instance === a.instance) - template.slots.findIndex((s) => s.instance === b.instance));

  return { instances, rejected };
}
