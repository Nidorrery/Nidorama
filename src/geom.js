// Plan-space geometry helpers (metres, x east, y south).
export const snap = (v, step = 0.05) => Math.round(v / step) * step;
export const round = (v, dp = 3) => +v.toFixed(dp);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from p to segment ab, and the parameter along it (0..1). */
export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return { d: Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)), t };
}

/** Rotate p about c by deg (positive = east → south, i.e. clockwise seen from above). */
export function rotateAbout(p, c, deg) {
  const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  const x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs];
}

export const centreOf = (o) => [(o.bounds.min[0] + o.bounds.max[0]) / 2, (o.bounds.min[1] + o.bounds.max[1]) / 2];

/** Footprint corners of an object, with its rotation applied. */
export function objectCorners(o) {
  const { min, max } = o.bounds, c = centreOf(o);
  return [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]].map((p) => rotateAbout(p, c, o.rotation || 0));
}

export function pointInObject(p, o) {
  const q = rotateAbout(p, centreOf(o), -(o.rotation || 0));
  return q[0] >= o.bounds.min[0] && q[0] <= o.bounds.max[0] && q[1] >= o.bounds.min[1] && q[1] <= o.bounds.max[1];
}

export function polyBounds(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Bounding box of everything drawn on a level. */
export function levelBounds(level) {
  const pts = [];
  for (const r of level.rooms || []) pts.push(...r.polygon);
  for (const w of level.walls || []) pts.push(...(w.bulge ? wallPoints(w) : [w.a, w.b]));
  for (const o of level.objects || []) pts.push(...objectCorners(o));
  if (level.footprint) pts.push(level.footprint.min, level.footprint.max);
  if (!pts.length) return { x0: -3, y0: -3, x1: 3, y1: 3, empty: true };
  return polyBounds(pts);
}

// ---------- walls: straight, or curved (#52) ----------
// A curved wall has `bulge`: how far (metres) its middle bows out from the straight line a → b,
// positive to the right when walking from a to b. Positions along a wall are arc lengths from a.
/** The arc of a curved wall, or null for a straight one: centre, radius, sweep (radians, signed), chord. */
export function wallArc(w) {
  const c = dist(w.a, w.b), raw = +w.bulge || 0;
  if (c < 1e-6 || Math.abs(raw) < 0.005) return null;
  const s = Math.max(-c / 2, Math.min(c / 2, raw)); // at most a half circle
  const ux = (w.b[0] - w.a[0]) / c, uy = (w.b[1] - w.a[1]) / c, nx = -uy, ny = ux;
  const R = (c * c / 4 + s * s) / (2 * Math.abs(s));
  const k = s - Math.sign(s) * R;
  const centre = [(w.a[0] + w.b[0]) / 2 + nx * k, (w.a[1] + w.b[1]) / 2 + ny * k];
  return { centre, R, sweep: -Math.sign(s) * 4 * Math.atan((2 * Math.abs(s)) / c), chord: c };
}
export function wallLength(w) {
  const arc = wallArc(w);
  return arc ? arc.R * Math.abs(arc.sweep) : dist(w.a, w.b);
}
/** The point `t` metres along a wall from its start (it carries on past either end). */
export function wallAt(w, t) {
  const arc = wallArc(w);
  if (!arc) {
    const c = dist(w.a, w.b) || 1;
    return [w.a[0] + ((w.b[0] - w.a[0]) / c) * t, w.a[1] + ((w.b[1] - w.a[1]) / c) * t];
  }
  const ang = (t / arc.R) * Math.sign(arc.sweep), cs = Math.cos(ang), sn = Math.sin(ang);
  const x = w.a[0] - arc.centre[0], y = w.a[1] - arc.centre[1];
  return [arc.centre[0] + x * cs - y * sn, arc.centre[1] + x * sn + y * cs];
}
/** Unit direction of travel at `t` metres along a wall. */
export function wallDir(w, t) {
  const p = wallAt(w, t - 0.005), q = wallAt(w, t + 0.005), l = dist(p, q) || 1;
  return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
}
/** A wall as a run of points between t0 and t1 (two for a straight wall; about one every 7° for a curved one). */
export function wallPoints(w, t0 = 0, t1 = wallLength(w)) {
  const arc = wallArc(w);
  const n = arc ? Math.max(1, Math.ceil(Math.abs(t1 - t0) / arc.R / 0.12)) : 1;
  return Array.from({ length: n + 1 }, (_, i) => wallAt(w, t0 + ((t1 - t0) * i) / n));
}
/** Nearest place on a wall to p: distance from it, and how far along the wall (metres). */
export function wallNearest(p, w) {
  const pts = wallPoints(w);
  let best = { d: Infinity, t: 0 }, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = dist(pts[i - 1], pts[i]), r = distToSeg(p, pts[i - 1], pts[i]);
    if (r.d < best.d) best = { d: r.d, t: run + r.t * len };
    run += len;
  }
  if (pts.length > 2) best.t *= wallLength(w) / (run || 1); // chords are a touch shorter than the arc
  return best;
}
/** Direction of a straight line a → b as a compass angle: 0° = north (up the plan), 90° = east. */
export const bearing = (a, b) => ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI + 360) % 360;
