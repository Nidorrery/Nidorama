// "My models": furniture the user makes, kept in the home file (`home.catalog`) in the same form as the
// built-in CATALOG, so placing, resizing, recolouring, rotating, lights and renders work on them unchanged.
// Phase 1 of the model maker: save a placed piece as a model, place it again, update every placed copy.
import { uid, PART_OPTIONS } from './catalog.js';
import { round } from './geom.js';

export const MY_CAT = 'My models';
const MAX_ITEMS = 200, MAX_PARTS = 200;
const HEX = /^#[0-9a-f]{6}$/i;
export const SHAPES = ['cylinder', 'sphere', 'dome', 'cone', 'wedge'];
const SLOPES = ['front', 'back', 'left', 'right'];
const num = (v, lo, hi, fallback = null) => (v === '' || v == null || !Number.isFinite(+v) ? fallback : Math.min(hi, Math.max(lo, +v)));
const frac = (v) => Math.round(v * 1e4) / 1e4; // fractions need more places than metres

/** One part `[x0, y0, z0, x1, y1, z1, colour, options]` checked and tidied, or null. */
function cleanPart(p) {
  if (!Array.isArray(p) || p.length < 7) return null;
  const c = p.slice(0, 6).map((v) => num(v, -1, 2));
  if (c.some((v) => v == null) || c[3] <= c[0] || c[4] <= c[1] || c[5] <= c[2]) return null;
  const color = HEX.test(p[6]) ? p[6].toLowerCase() : '#cfc8bd';
  const o = p[7] && typeof p[7] === 'object' ? p[7] : {}, opts = {};
  if (SHAPES.includes(o.shape)) opts.shape = o.shape;
  const radius = num(o.radius, 0, 1); if (radius) opts.radius = radius; // only boxes use it; kept on others as given
  const opacity = num(o.opacity, 0, 1); if (opacity != null) opts.opacity = opacity;
  if (['cylinder', 'cone'].includes(opts.shape) && ['x', 'y'].includes(o.axis)) opts.axis = o.axis;
  if (opts.shape === 'cone') {
    const top = num(o.top, 0, 1), bottom = num(o.bottom, 0, 1);
    if (top != null && top !== 0) opts.top = frac(top);
    if (bottom != null && bottom !== 1) opts.bottom = frac(bottom);
  }
  if (opts.shape === 'wedge' && SLOPES.includes(o.slope) && o.slope !== 'front') opts.slope = o.slope;
  return Object.keys(opts).length ? [...c.map(frac), color, opts] : [...c.map(frac), color];
}

/** A model from a home file, checked and tidied (files can come from anywhere), or null if it is not one. */
export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object' || !/^my-[\w-]{1,60}$/.test(raw.id || '')) return null;
  const size = Array.isArray(raw.size) ? raw.size.slice(0, 3).map((v) => num(v, 0.01, 50)) : [];
  if (size.length !== 3 || size.some((v) => v == null)) return null;
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).slice(0, MAX_PARTS).map(cleanPart).filter(Boolean);
  if (!parts.length) return null;
  const item = { id: raw.id, name: String(raw.name || 'My model').trim().slice(0, 60) || 'My model', cat: MY_CAT, size: size.map((v) => round(v)), parts, rev: Math.max(1, Math.floor(num(raw.rev, 1, 1e9, 1))) };
  const z = num(raw.z, -5, 10); if (z) item.z = round(z);
  const lz = num(raw.light?.z, -5, 10); if (lz != null) item.light = { z: round(lz) };
  return item;
}
/** A home's models, checked (unknown or broken entries dropped, one per id). */
export function cleanCatalog(list) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const item = cleanItem(raw);
    if (item && !seen.has(item.id) && out.length < MAX_ITEMS) { seen.add(item.id); out.push(item); }
  }
  return out;
}

/**
 * A placed object turned back into a model: its parts as fractions of its box. Placed parts are stored
 * unturned (the angle is kept apart, in `rotation`), so the model faces the usual way: back to the north.
 * `light` = the object's light fixture, if it has one.
 */
export function itemFromObject(o, name, light = null, id = uid('my'), rev = 1) {
  const [x0, y0, z0] = o.bounds.min, [x1, y1, z1] = o.bounds.max;
  const w = x1 - x0 || 1, d = y1 - y0 || 1, h = z1 - z0 || 1;
  const parts = o.parts.map((p) => {
    const opts = optionsOf(p);
    return [(p.min[0] - x0) / w, (p.min[1] - y0) / d, (p.min[2] - z0) / h, (p.max[0] - x0) / w, (p.max[1] - y0) / d, (p.max[2] - z0) / h, p.color, opts];
  });
  return cleanItem({ id, name, size: [w, d, h], z: z0, light: light?.position ? { z: light.position[2] - z0 } : undefined, parts, rev });
}

/** A part's shape options (everything but its box and colour). */
export const optionsOf = (p) => Object.fromEntries(PART_OPTIONS.filter((k) => p[k] != null).map((k) => [k, p[k]]));
/** Part options flipped left ↔ right: a wedge sloping to the left now slopes to the right, a cone lying across points the other way. */
export function mirroredOptions(p) {
  const o = {};
  if (p.slope === 'left' || p.slope === 'right') o.slope = p.slope === 'left' ? 'right' : 'left';
  if (p.shape === 'cone' && p.axis === 'x') { o.top = p.bottom ?? 1; o.bottom = p.top ?? 0; }
  return o;
}

/** Every placed copy of a model, on every level of the home: [{ L, o }]. */
export function copiesOf(home, id) {
  const out = [];
  for (const L of home.levels || []) for (const o of L.objects || []) if (o.kind === id) out.push({ L, o });
  return out;
}

// ---------- the model maker's working copy (phase 2) ----------
// A draft is a model in metres, easier to edit than fractions: parts are { min: [x, y, z], max: [x, y, z],
// color, shape?, radius?, opacity? }, x to the right, y to the front, z up, the back-left floor corner at 0.
// Saving fits the model's box around its parts.
export const MAX_DRAFT_PARTS = 60;
const m3 = (v) => round(v, 3);
const box = (parts) => [0, 1, 2].map((k) => [Math.min(...parts.map((p) => p.min[k])), Math.max(...parts.map((p) => p.max[k]))]);

/** Any catalogue item (built-in or your own) as a draft. */
export function toDraft(item) {
  const [w, d, h] = item.size;
  const parts = item.parts.map(([a, b, c, e, f, g, color, opts = {}]) => ({
    min: [m3(a * w), m3(b * d), m3(c * h)], max: [m3(e * w), m3(f * d), m3(g * h)], color: String(color).toLowerCase(), ...optionsOf(opts),
  }));
  return { name: item.name, z: item.z || 0, light: item.light ? { z: item.light.z * h } : null, parts };
}
/** A new model: one box. */
export const blankDraft = () => ({ name: 'My model', z: 0, light: null, parts: [{ min: [0, 0, 0], max: [0.6, 0.6, 0.6], color: '#cfc8bd' }] });

/** The size of the box around a draft's parts: [width, depth, height]. */
export const draftSize = (dr) => (dr.parts.length ? box(dr.parts).map(([a, b]) => m3(b - a)) : [0, 0, 0]);

/** A draft as a model item (checked), its box fitted around its parts. Null if it has no usable part. */
export function fromDraft(dr, id = uid('my'), rev = 1) {
  const parts = dr.parts.filter((p) => [0, 1, 2].every((k) => p.max[k] - p.min[k] > 0.0005));
  if (!parts.length) return null;
  const b = box(parts), size = b.map(([a, e]) => e - a);
  const raw = {
    id, rev, name: dr.name, size, z: (dr.z || 0) + b[2][0], light: dr.light ? { z: dr.light.z - b[2][0] } : undefined,
    parts: parts.map((p) => [...[0, 1, 2].map((k) => (p.min[k] - b[k][0]) / size[k]), ...[0, 1, 2].map((k) => (p.max[k] - b[k][0]) / size[k]), p.color,
      optionsOf(p)]),
  };
  return cleanItem(raw);
}

/** A copy of part i, moved a little to the right so it can be seen. */
export function duplicatePart(dr, i, dx = 0.05) {
  const p = structuredClone(dr.parts[i]);
  p.min[0] = m3(p.min[0] + dx); p.max[0] = m3(p.max[0] + dx);
  dr.parts.push(p);
  return dr.parts.length - 1;
}
/** A mirror copy of part i on the other side of the model (left ↔ right). */
export function mirrorPart(dr, i) {
  const [[x0, x1]] = box(dr.parts), p = structuredClone(dr.parts[i]), a = p.min[0], e = p.max[0];
  p.min[0] = m3(x0 + x1 - e); p.max[0] = m3(x0 + x1 - a);
  Object.assign(p, mirroredOptions(p));
  dr.parts.push(p);
  return dr.parts.length - 1;
}
/** Four legs from the floor up to the underside of part i, at its corners. Returns how many were added. */
export function legsUnder(dr, i, t = 0.05) {
  const p = dr.parts[i], top = p.min[2];
  if (top < 0.02) return 0;
  const tx = Math.min(t, (p.max[0] - p.min[0]) / 3), ty = Math.min(t, (p.max[1] - p.min[1]) / 3);
  for (const [x, y] of [[p.min[0], p.min[1]], [p.max[0] - tx, p.min[1]], [p.min[0], p.max[1] - ty], [p.max[0] - tx, p.max[1] - ty]]) {
    dr.parts.push({ min: [m3(x), m3(y), 0], max: [m3(x + tx), m3(y + ty), m3(top)], color: p.color, ...(p.shape === 'cylinder' && !p.axis ? { shape: 'cylinder' } : {}) });
  }
  return 4;
}
/** Resize the whole model along one axis (0 width, 1 depth, 2 height) to `size` metres. */
export function scaleDraft(dr, axis, size) {
  const [a, e] = box(dr.parts)[axis], k = size / ((e - a) || 1);
  for (const p of dr.parts) { p.min[axis] = m3(a + (p.min[axis] - a) * k); p.max[axis] = m3(a + (p.max[axis] - a) * k); }
  if (axis === 2 && dr.light) dr.light.z = m3(a + (dr.light.z - a) * k);
}

// ---------- dragging in the 3D view (phase 3) ----------
/** The faces of every part except `skip` along one axis (0 x, 1 y, 2 z), and the floor for height: where a dragged face may snap. */
export function edgesOf(dr, skip, axis) {
  const out = axis === 2 ? [0] : [];
  dr.parts.forEach((p, i) => { if (i !== skip) out.push(p.min[axis], p.max[axis]); });
  return out;
}
/** `v` snapped to the nearest of `targets` within `tol` metres, else to the `step` grid. Returns [value, snappedToAPart]. */
export function snapValue(v, targets, tol, step) {
  let best = null, bd = tol;
  for (const t of targets) { const d = Math.abs(t - v); if (d <= bd) { bd = d; best = t; } }
  return best != null ? [m3(best), true] : [m3(Math.round(v / step) * step), false];
}
/** Part i moved by `delta` metres on one axis, snapping its nearer face to other parts (else its low face to the grid). */
export function movePartAxis(dr, i, axis, delta, tol, step) {
  const p = dr.parts[i], len = p.max[axis] - p.min[axis], lo = p.min[axis] + delta, hi = lo + len, targets = edgesOf(dr, i, axis);
  const [sl, al] = snapValue(lo, targets, tol, step), [sh, ah] = snapValue(hi, targets, tol, step);
  let start = sl;
  if (ah && (!al || Math.abs(sh - hi) < Math.abs(sl - lo))) start = sh - len;
  if (axis === 2) start = Math.max(0, start); // not through the floor
  return { min: m3(start), max: m3(start + len), snapped: al || ah };
}
/** Part i with one face (`side` 'min' or 'max') dragged to `v` on one axis, snapping; never thinner than 5 mm. */
export function resizePartFace(dr, i, axis, side, v, tol, step) {
  const p = dr.parts[i], [s, snapped] = snapValue(v, edgesOf(dr, i, axis), tol, step);
  return side === 'max' ? { min: p.min[axis], max: m3(Math.max(p.min[axis] + 0.005, s)), snapped } : { min: m3(Math.min(p.max[axis] - 0.005, s)), max: p.max[axis], snapped };
}
