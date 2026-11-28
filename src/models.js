// Models people make themselves (#131, #132, #133): the model file format, its checks, the guide file a
// chat assistant is given with photos of a piece of furniture, search across everything that can be
// placed, and community models shared through the public repository's issues.
//
// A model is plain data: a name, a category, a size and a list of simple parts (boxes, rounded boxes,
// cylinders), each with a colour and an optional tilt. Nothing in a model file can run.

export const MODEL_SCHEMA = 'nidorama.model/1';

/** Broad kinds of thing, for My models and for sharing with the community: [id, name, examples]. */
export const MODEL_CATEGORIES = [
  ['seating', 'Seating', 'sofas, armchairs, chairs, stools, benches, beanbags'],
  ['tables', 'Tables and desks', 'dining, coffee and side tables, desks, consoles'],
  ['beds', 'Beds and bedroom', 'beds, cots, bedside tables, dressers'],
  ['storage', 'Shelves and storage', 'shelving, bookcases, cabinets, wardrobes, drawers, racks, tubs'],
  ['kitchen', 'Kitchen and dining', 'islands, benches, bar stools, pantry, small appliances'],
  ['bathroom', 'Bathroom and laundry', 'vanities, baths, washing machines, baskets, airers'],
  ['lighting', 'Lamps and lighting', 'floor and table lamps, pendants, fans with lights'],
  ['appliances', 'Appliances', 'fridges, heaters, air purifiers, vacuums'],
  ['electronics', 'TVs, computers and electronics', 'TVs, speakers, consoles, routers, screens'],
  ['office', 'Office and study', 'office chairs, filing, printers, whiteboards'],
  ['kids', 'Kids, nursery and toys', 'toy boxes, play tents, change tables, high chairs'],
  ['decor', 'Decor, art and mirrors', 'pictures, mirrors, rugs, clocks, screens'],
  ['plants', 'Plants and planters', 'pot plants, planters, indoor trees'],
  ['knickknacks', 'Knick-knacks', 'ornaments, vases, candles, books, trophies, little things'],
  ['music', 'Music and instruments', 'pianos, guitars on stands, drum kits, amps, records'],
  ['fitness', 'Fitness and sport', 'treadmills, bikes, weights, racks, surfboards'],
  ['hobbies', 'Hobbies and games', 'pool tables, arcade machines, sewing, crafts, aquariums'],
  ['pets', 'Pets', 'pet beds, kennels, cat towers, cages, tanks'],
  ['garage', 'Garage, tools and workshop', 'workbenches, tool chests, garage shelving, mowers'],
  ['outdoor', 'Outdoor and garden', 'outdoor furniture, barbecues, sheds, play equipment'],
  ['vehicles', 'Cars, bikes and vehicles', 'cars, motorbikes, bikes, scooters, prams'],
  ['structure', 'Structure and fittings', 'stairs, columns, fireplaces, built-ins, doors'],
  ['other', 'Something else', ''],
];
export const categoryName = (id) => MODEL_CATEGORIES.find((c) => c[0] === id)?.[1] || 'Something else';

const HEX = /^#[0-9a-f]{6}$/i;
/** Shapes a part can have besides a box (drawn by shapes.js): cylinders and cones can lie down (axis), cones have end widths, wedges a slope. */
export const SHAPES = ['cylinder', 'sphere', 'dome', 'cone', 'wedge'];
const PART_OPTS = ['shape', 'radius', 'opacity', 'axis', 'top', 'bottom', 'slope', 'tilt', 'name', 'cut'];
const optsOf = (p) => Object.fromEntries(PART_OPTS.filter((k) => p[k] != null).map((k) => [k, Array.isArray(p[k]) ? [...p[k]] : p[k]]));
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const r3 = (v) => Math.round(v * 1000) / 1000;
const rad = (d) => (d * Math.PI) / 180;

/**
 * A part's tilt as a rotation in plan axes (x left → right, y back → front, z up), turned about the part's centre:
 * first about x by tilt[0] (positive: its top leans to the back), then about y by tilt[1] (its top leans to the
 * right), then about z by tilt[2] (it turns clockwise, seen from above). Rows of a 3 × 3 matrix.
 */
export function tiltMatrix(t) {
  const [a, b, c] = (t || [0, 0, 0]).map(rad);
  const X = [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const Y = [[Math.cos(b), 0, Math.sin(b)], [0, 1, 0], [-Math.sin(b), 0, Math.cos(b)]];
  const Z = [[Math.cos(c), -Math.sin(c), 0], [Math.sin(c), Math.cos(c), 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  return mul(Z, mul(Y, X));
}
/** Turn a three.js mesh by a part's tilt. Three.js has y up, so the plan's y and z are swapped. */
export function tiltMesh(THREE, mesh, tilt) {
  if (!tilt || !tilt.some((v) => v)) return;
  const R = tiltMatrix(tilt);
  const m = new THREE.Matrix4().set(R[0][0], R[0][2], R[0][1], 0, R[2][0], R[2][2], R[2][1], 0, R[1][0], R[1][2], R[1][1], 0, 0, 0, 0, 1);
  mesh.quaternion.setFromRotationMatrix(m);
}
/** The corners a part really reaches, after its tilt. */
export function partCorners(p) {
  const c = [0, 1, 2].map((i) => (p.min[i] + p.max[i]) / 2), hs = [0, 1, 2].map((i) => (p.max[i] - p.min[i]) / 2);
  const R = p.tilt ? tiltMatrix(p.tilt) : null, out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const v = [sx * hs[0], sy * hs[1], sz * hs[2]];
    const w = R ? R.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) : v;
    out.push([c[0] + w[0], c[1] + w[1], c[2] + w[2]]);
  }
  return out;
}

/** One part, checked: sizes in metres, a colour, and only the options the app knows. */
function cleanPart(p, i) {
  if (!p || typeof p !== 'object') return null;
  const min = [0, 1, 2].map((k) => num(p.min?.[k], -20, 20)), max = [0, 1, 2].map((k) => num(p.max?.[k], -20, 20));
  for (let k = 0; k < 3; k++) { if (max[k] < min[k]) [min[k], max[k]] = [max[k], min[k]]; if (max[k] - min[k] < 0.003) max[k] = min[k] + 0.003; }
  const out = { min: min.map(r3), max: max.map(r3), color: HEX.test(p.color || '') ? p.color.toLowerCase() : '#cfc8bd' };
  const name = String(p.name || p._part || '').trim().slice(0, 40);
  if (name) out.name = name;
  if (SHAPES.includes(p.shape)) out.shape = p.shape;
  if (p.radius) out.radius = r3(num(p.radius, 0, 2));
  if (['cylinder', 'cone'].includes(out.shape) && ['x', 'y'].includes(p.axis)) out.axis = p.axis;
  if (out.shape === 'cone') {
    const top = num(p.top, 0, 1, 0), bottom = num(p.bottom, 0, 1, 1);
    if (top) out.top = Math.round(top * 1000) / 1000;
    if (bottom !== 1) out.bottom = Math.round(bottom * 1000) / 1000;
  }
  if (out.shape === 'wedge' && ['back', 'left', 'right'].includes(p.slope)) out.slope = p.slope;
  if (p.cut === true) out.cut = true; // a cut-out: removes its shape from the parts it overlaps (#141)
  if (p.opacity != null && +p.opacity < 1) out.opacity = num(p.opacity, 0.05, 1, 1);
  if (Array.isArray(p.tilt) && p.tilt.some((v) => +v)) out.tilt = [0, 1, 2].map((k) => Math.round(num(p.tilt[k], -360, 360) * 10) / 10);
  if (!out.name) out.name = `Part ${i + 1}`;
  return out;
}
/** Make every part sit inside the model's box (from 0), and the size fit them; returns the model. */
export function fitModel(m) {
  if (!m.parts.length) { m.size = [0.1, 0.1, 0.1]; return m; }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const solid = m.parts.some((p) => !p.cut) ? m.parts.filter((p) => !p.cut) : m.parts; // a cut-out may reach past the model: it does not make it bigger
  for (const p of solid) for (const c of partCorners(p)) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c[k]); hi[k] = Math.max(hi[k], c[k]); }
  for (const p of m.parts) for (let k = 0; k < 3; k++) { p.min[k] = r3(p.min[k] - lo[k]); p.max[k] = r3(p.max[k] - lo[k]); }
  if (m.light) m.light.z = r3(num(m.light.z - lo[2], 0, 20));
  if (lo[2]) m.z = r3(num((m.z || 0) + lo[2], -5, 10)); // parts lifted off the floor: the whole model is placed higher instead
  if (!m.z) delete m.z;
  m.size = hi.map((v, k) => r3(Math.max(0.01, v - lo[k])));
  return m;
}
export const newModelId = () => `my-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** A model file (from a person, a chat assistant or the community), checked and tidied. Throws a readable error. */
export function cleanModel(raw) {
  if (typeof raw === 'string') {
    const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/); // a reply pasted with its code fence
    raw = JSON.parse((block ? block[1] : raw).replace(/,\s*([}\]])/g, '$1'));
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts)) throw new Error('This is not a Nidorama model file: it has no parts.');
  if (raw.schema && raw.schema !== MODEL_SCHEMA) throw new Error('This file is not a Nidorama model (it may be a home or a theme).');
  const parts = raw.parts.slice(0, 120).map(cleanPart).filter(Boolean);
  if (!parts.length) throw new Error('This model has no parts that can be drawn.');
  const m = {
    id: typeof raw.id === 'string' && /^[\w-]{3,60}$/.test(raw.id) ? raw.id : newModelId(),
    name: String(raw.name || 'My model').trim().slice(0, 60) || 'My model',
    category: MODEL_CATEGORIES.some((c) => c[0] === raw.category) ? raw.category : guessCategory(raw.category),
    parts,
  };
  if (raw.light && Number.isFinite(+raw.light.z)) m.light = { z: +raw.light.z };
  if (raw.z) m.z = num(raw.z, -5, 10);
  if (raw.by) m.by = String(raw.by).slice(0, 60);
  return fitModel(m);
}
/** Older or hand-written files may name a category in words. */
function guessCategory(word) {
  const w = String(word || '').toLowerCase();
  if (!w) return 'other';
  const hit = MODEL_CATEGORIES.find(([id, name, ex]) => `${id} ${name} ${ex}`.toLowerCase().includes(w) || w.includes(id));
  return hit ? hit[0] : 'other';
}
/** The file to save or share: only what makes the model, nothing about the home it came from. */
export function modelFile(m) {
  const { id, name, category, size, parts, light, z } = m;
  return JSON.stringify({ schema: MODEL_SCHEMA, id, name, category, size, ...(z ? { z } : {}), ...(light ? { light } : {}), parts }, null, 1);
}

/** A model as a catalogue item (fractions of its size), so it is placed like everything else. */
export function modelToItem(m) {
  const [w, d, hgt] = m.size;
  return {
    id: m.id, rev: m.updated || 0, name: m.name, cat: categoryName(m.category), size: [...m.size], mine: true,
    parts: m.parts.map((p) => [p.min[0] / w, p.min[1] / d, p.min[2] / hgt, p.max[0] / w, p.max[1] / d, p.max[2] / hgt, p.color, optsOf(p)]),
    ...(m.z ? { z: m.z } : {}),
    ...(m.light ? { light: { z: m.light.z } } : {}),
  };
}
/** A catalogue item as a model to change. */
export function itemToModel(item) {
  const [w, d, hgt] = item.size;
  return fitModel({
    id: newModelId(), name: item.name, category: guessCategory(item.cat),
    parts: item.parts.map(([a, b, c, e, f, g, color, o = {}], i) => ({ ...optsOf(o), name: o.name || `Part ${i + 1}`, min: [a * w, b * d, c * hgt], max: [e * w, f * d, g * hgt], color })),
    ...(item.z ? { z: item.z } : {}),
    ...(item.light ? { light: { z: item.light.z } } : {}),
  });
}
/** Something already placed in the home, as a model (its parts measured from its own back-left corner on the floor). */
export function objectToModel(o, lights = []) {
  const b = o.bounds, base = [b.min[0], b.min[1], b.min[2]];
  const m = {
    id: o.myModel || newModelId(), name: o.name || 'My model', category: 'other', size: [0, 1, 2].map((k) => b.max[k] - b.min[k]), ...(b.min[2] ? { z: b.min[2] } : {}),
    parts: o.parts.map((p, i) => ({ ...structuredClone(p), name: p.name || `Part ${i + 1}`, min: p.min.map((v, k) => r3(v - base[k])), max: p.max.map((v, k) => r3(v - base[k])) })),
  };
  const l = lights.find((q) => q.fixture === o.id && q.position);
  if (l) m.light = { z: r3(l.position[2] - base[2]) };
  return m;
}
/**
 * Put a model's shape on something already placed: it keeps its centre, angle, name, entity and lights.
 * `scale` keeps a copy that was resized at the same proportion to the model (every placed copy is updated when its
 * model changes). `keepZ`: keep its own height off the floor rather than the model's.
 */
export function applyModelToObject(L, o, m, { scale = [1, 1, 1], keepZ = false } = {}) {
  const cx = (o.bounds.min[0] + o.bounds.max[0]) / 2, cy = (o.bounds.min[1] + o.bounds.max[1]) / 2, z0 = keepZ ? o.bounds.min[2] : m.z || 0;
  const size = m.size.map((v, k) => r3(v * scale[k]));
  const base = [r3(cx - size[0] / 2), r3(cy - size[1] / 2), z0];
  o.bounds = { min: [...base], max: [0, 1, 2].map((k) => r3(base[k] + size[k])) };
  o.parts = m.parts.map((p) => ({ ...structuredClone(p), min: p.min.map((v, k) => r3(v * scale[k] + base[k])), max: p.max.map((v, k) => r3(v * scale[k] + base[k])) }));
  delete o.model;
  for (const l of L.lights) if (l.fixture === o.id && l.position && m.light) l.position[2] = r3(z0 + m.light.z * scale[2]);
}
/** How a placed copy is sized against the model it was placed from, per axis (1 = as made). */
export function scaleOf(o, old) {
  if (!old) return [1, 1, 1];
  return [0, 1, 2].map((k) => { const v = (o.bounds.max[k] - o.bounds.min[k]) / (old.size[k] || 1); return Math.abs(v - 1) < 0.01 ? 1 : v; });
}

// ---------- building in the maker (from pull request #4) ----------
const box = (parts) => [0, 1, 2].map((k) => [Math.min(...parts.map((p) => p.min[k])), Math.max(...parts.map((p) => p.max[k]))]);
/** Part options flipped left ↔ right: a wedge sloping to the left slopes to the right, a cone lying across points the other way, a tilt mirrors. */
export function mirroredOptions(p) {
  const o = {};
  if (p.slope === 'left' || p.slope === 'right') o.slope = p.slope === 'left' ? 'right' : 'left';
  if (p.shape === 'cone' && p.axis === 'x') { o.top = p.bottom ?? 1; o.bottom = p.top ?? 0; }
  if (p.tilt) o.tilt = [p.tilt[0], -p.tilt[1], -p.tilt[2]];
  return o;
}
/** A mirror copy of part i on the other side of the model (left ↔ right). Returns its index. */
export function mirrorPart(m, i) {
  const [[x0, x1]] = box(m.parts), p = structuredClone(m.parts[i]), a = p.min[0], e = p.max[0];
  p.min[0] = r3(x0 + x1 - e); p.max[0] = r3(x0 + x1 - a);
  Object.assign(p, mirroredOptions(p));
  if (p.top === 0) delete p.top; if (p.bottom === 1) delete p.bottom;
  p.name = /left/i.test(p.name || '') ? p.name.replace(/left/i, (w) => (w[0] === 'L' ? 'Right' : 'right')) : /right/i.test(p.name || '') ? p.name.replace(/right/i, (w) => (w[0] === 'R' ? 'Left' : 'left')) : `${p.name || 'Part'} (mirrored)`;
  m.parts.push(p);
  return m.parts.length - 1;
}
/** Four legs from the floor up to the underside of part i, at its corners. Returns how many were added. */
export function legsUnder(m, i, t = 0.05) {
  const p = m.parts[i], top = p.min[2];
  if (top < 0.02) return 0;
  const tx = Math.min(t, (p.max[0] - p.min[0]) / 3), ty = Math.min(t, (p.max[1] - p.min[1]) / 3);
  [[p.min[0], p.min[1], 'Back left'], [p.max[0] - tx, p.min[1], 'Back right'], [p.min[0], p.max[1] - ty, 'Front left'], [p.max[0] - tx, p.max[1] - ty, 'Front right']].forEach(([x, y, n]) => {
    m.parts.push({ name: `${n} leg`, min: [r3(x), r3(y), 0], max: [r3(x + tx), r3(y + ty), r3(top)], color: p.color, ...(p.shape === 'cylinder' && !p.axis ? { shape: 'cylinder' } : {}) });
  });
  return 4;
}
/** Resize the whole model along one axis (0 width, 1 depth, 2 height) to `size` metres. */
export function scaleModel(m, axis, size) {
  const [a, e] = box(m.parts)[axis], k = size / ((e - a) || 1);
  for (const p of m.parts) { p.min[axis] = r3(a + (p.min[axis] - a) * k); p.max[axis] = r3(a + (p.max[axis] - a) * k); }
  if (axis === 2 && m.light) m.light.z = r3(a + (m.light.z - a) * k);
}
/** The faces of every part except `skip` along one axis, and the floor for height: where a dragged face may snap. */
function edgesOf(m, skip, axis) {
  const out = axis === 2 ? [0] : [];
  m.parts.forEach((p, i) => { if (i !== skip) out.push(p.min[axis], p.max[axis]); });
  return out;
}
/** `v` snapped to the nearest of `targets` within `tol` metres, else to the `step` grid. Returns [value, snappedToAPart]. */
function snapValue(v, targets, tol, step) {
  let best = null, bd = tol;
  for (const t of targets) { const d = Math.abs(t - v); if (d <= bd) { bd = d; best = t; } }
  return best != null ? [r3(best), true] : [r3(Math.round(v / step) * step), false];
}
/** Part i moved by `delta` metres on one axis from `start`, snapping its nearer face to other parts (else its low face to the grid). */
export function movePartAxis(m, i, axis, start, delta, tol, step) {
  const p = m.parts[i], len = p.max[axis] - p.min[axis], lo = start + delta, hi = lo + len, targets = edgesOf(m, i, axis);
  const [sl, al] = snapValue(lo, targets, tol, step), [sh, ah] = snapValue(hi, targets, tol, step);
  let from = sl;
  if (ah && (!al || Math.abs(sh - hi) < Math.abs(sl - lo))) from = sh - len;
  if (axis === 2) from = Math.max(0, from); // not through the floor
  return { min: r3(from), max: r3(from + len), snapped: al || ah };
}
/** Part i with one face (`side` 'min' or 'max') dragged to `v` on one axis, snapping; never thinner than 5 mm. */
export function resizePartFace(m, i, axis, side, v, tol, step) {
  const p = m.parts[i], [s, snapped] = snapValue(v, edgesOf(m, i, axis), tol, step);
  return side === 'max' ? { min: p.min[axis], max: r3(Math.max(p.min[axis] + 0.005, s)), snapped } : { min: r3(Math.min(p.max[axis] - 0.005, s)), max: p.max[axis], snapped };
}

// ---------- search (#132) ----------
// Everyday words for the same things, so "couch" finds a sofa.
const ALSO = {
  sofa: 'couch lounge settee', armchair: 'chair recliner', chair: 'seat', stool: 'bar stool', bed: 'mattress bunk',
  fridge: 'refrigerator freezer', refrigerator: 'fridge', tv: 'television telly screen', television: 'tv telly',
  shelf: 'shelves shelving bookshelf bookcase rack', shelving: 'shelf shelves rack', bookshelf: 'shelf shelves bookcase',
  cabinet: 'cupboard', cupboard: 'cabinet wardrobe pantry', wardrobe: 'closet cupboard', drawers: 'dresser chest',
  lamp: 'light', light: 'lamp', pendant: 'light', desk: 'table workstation', table: 'desk bench', bench: 'counter benchtop',
  rug: 'mat carpet', plant: 'pot tree', bbq: 'barbecue grill', barbecue: 'bbq grill', toilet: 'loo wc', bath: 'tub bathtub',
  washer: 'washing machine laundry', dryer: 'laundry', oven: 'stove cooktop range', microwave: 'oven', ac: 'air conditioner aircon',
  car: 'vehicle ute', bike: 'bicycle', piano: 'keyboard', tools: 'toolbox workbench', ornament: 'knick knack decoration',
};
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
/** Does a catalogue item (or model) match what was typed? Every word typed must start one of its words. */
export function matches(item, query) {
  const q = words(query);
  if (!q.length) return true;
  const own = words(`${item.name} ${item.cat || ''} ${item.id || ''}`);
  const all = new Set(own);
  for (const w of own) for (const x of words(ALSO[w] || ALSO[w.replace(/s$/, '')] || '')) all.add(x);
  return q.every((w) => [...all].some((x) => x.startsWith(w) || (w.length > 3 && x.startsWith(w.replace(/s$/, '')))));
}

// ---------- community models (#133) ----------
// Shared models live as issues in the public repository. Sharing opens a new issue with the model in it;
// the owner reviews it and adds the label below, and from then on everyone can find it in Furnish.
export const COMMUNITY_REPO = 'Nidorrery/Nidorama';
export const COMMUNITY_LABEL = 'community-model';
export const COMMUNITY_LICENCE = 'CC0 1.0 (anyone may use, change and share it, no conditions)';
const CACHE = 'nidorama.community';
let community = null;
try { community = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch {}
export const communityCached = () => community?.models || [];
/** The approved community models, from the public repository (or what was fetched last time, offline). */
export async function fetchCommunity(force = false) {
  if (!force && community && Date.now() - community.at < 10 * 60 * 1000) return community.models;
  try {
    const r = await fetch(`https://api.github.com/repos/${COMMUNITY_REPO}/issues?labels=${COMMUNITY_LABEL}&state=all&per_page=100`, { headers: { accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const models = [];
    for (const is of await r.json()) {
      try {
        const m = cleanModel(is.body || '');
        m.id = `community-${is.number}`;
        m.by = is.user?.login || 'someone';
        m.url = is.html_url;
        m.updated = Date.parse(is.updated_at) || 0;
        models.push(m);
      } catch {}
    }
    community = { at: Date.now(), models };
    try { localStorage.setItem(CACHE, JSON.stringify(community)); } catch {}
    return models;
  } catch (e) {
    if (community) return community.models;
    throw e;
  }
}
/** The address that opens a new issue sharing the model, or { url, copy } when the model is too big for an address. */
export function communityShare(m, { category, about }) {
  const file = JSON.stringify(JSON.parse(modelFile({ ...m, category })));
  const head = [`**${m.name}**`, `Category: ${categoryName(category)}`, `Size: ${m.size.map((v) => v.toFixed(2)).join(' × ')} m (width × depth × height), ${m.parts.length} parts`,
    about ? `\n${about.trim().slice(0, 500)}` : '', `\nShared from the Nidorama app. Licence: ${COMMUNITY_LICENCE}.`].filter(Boolean).join('\n');
  const title = `Community model: ${m.name}`;
  const base = `https://github.com/${COMMUNITY_REPO}/issues/new?title=${encodeURIComponent(title)}&body=`;
  const full = `${head}\n\n\`\`\`json\n${file}\n\`\`\`\n`;
  if (base.length + encodeURIComponent(full).length < 7800) return { url: base + encodeURIComponent(full) };
  return { url: base + encodeURIComponent(`${head}\n\n(The model file was copied: paste it below, between the two lines of three backticks.)\n\n\`\`\`json\n\n\`\`\`\n`), copy: file };
}

// ---------- the guide file for a chat assistant ----------
const CHAIR = {
  name: 'Dining chair with arms',
  category: 'seating',
  parts: [
    { name: 'Front left leg', min: [0.02, 0.44, 0], max: [0.06, 0.48, 0.42], color: '#8a5a3b', shape: 'cylinder' },
    { name: 'Front right leg', min: [0.46, 0.44, 0], max: [0.5, 0.48, 0.42], color: '#8a5a3b', shape: 'cylinder' },
    { name: 'Back left leg', min: [0.02, 0.04, 0], max: [0.06, 0.08, 0.42], color: '#8a5a3b', shape: 'cylinder' },
    { name: 'Back right leg', min: [0.46, 0.04, 0], max: [0.5, 0.08, 0.42], color: '#8a5a3b', shape: 'cylinder' },
    { name: 'Rail between the front legs (a cylinder laid on its side)', min: [0.245, 0.445, 0.0], max: [0.275, 0.475, 0.42], color: '#8a5a3b', shape: 'cylinder', tilt: [0, 90, 0] },
    { name: 'Seat', min: [0, 0.02, 0.42], max: [0.52, 0.5, 0.46], color: '#8a5a3b', radius: 0.015 },
    { name: 'Seat cushion (soft, so well rounded)', min: [0.03, 0.05, 0.46], max: [0.49, 0.47, 0.51], color: '#d9cbb3', radius: 0.025 },
    { name: 'Left back post (leans back)', min: [0.02, 0.05, 0.45], max: [0.06, 0.09, 0.9], color: '#8a5a3b', tilt: [8, 0, 0] },
    { name: 'Right back post (leans back)', min: [0.46, 0.05, 0.45], max: [0.5, 0.09, 0.9], color: '#8a5a3b', tilt: [8, 0, 0] },
    { name: 'Curved top rail (rounded, leans back with the posts)', min: [0.04, 0.0, 0.76], max: [0.48, 0.05, 0.88], color: '#8a5a3b', radius: 0.02, tilt: [8, 0, 0] },
    { name: 'Back slat', min: [0.22, 0.03, 0.5], max: [0.3, 0.06, 0.76], color: '#8a5a3b', tilt: [8, 0, 0] },
    { name: 'Left arm (a cylinder laid front to back)', min: [0.02, 0.25, 0.47], max: [0.06, 0.29, 0.89], color: '#8a5a3b', shape: 'cylinder', tilt: [90, 0, 0] },
    { name: 'Right arm (a cylinder laid front to back)', min: [0.46, 0.25, 0.47], max: [0.5, 0.29, 0.89], color: '#8a5a3b', shape: 'cylinder', tilt: [90, 0, 0] },
    { name: 'Left arm support', min: [0.025, 0.42, 0.46], max: [0.055, 0.45, 0.68], color: '#8a5a3b', shape: 'cylinder' },
    { name: 'Right arm support', min: [0.465, 0.42, 0.46], max: [0.495, 0.45, 0.68], color: '#8a5a3b', shape: 'cylinder' },
  ],
};
/** The sample model file to hand a chat assistant with photos: a chair, with notes on every part of the format. */
export function guideFile() {
  const m = fitModel(structuredClone({ ...CHAIR, id: 'example-chair' }));
  return JSON.stringify({
    schema: MODEL_SCHEMA,
    _read_me: [
      'This is a Nidorama model file: one piece of furniture (or anything else in a home) made of simple shapes, so it can be placed on a 3D floor plan in the Nidorama app.',
      'To a chat assistant: the person has given you this file together with one or more photos of something they own. Write a NEW file in exactly this format that describes the thing in their photos. Reply with the whole file as JSON in one code block.',
      'Keep it simple: a tidy toy model, not a detailed scan. Usually 3 to 30 parts; never more than 80. Get the main shapes, the proportions and the colours right.',
      'Measurements are in metres. Use the real measurements if the person gave them. If not, estimate from familiar things in the photos (a door is about 2.04 m tall, a kitchen bench about 0.9 m high, a dining chair seat about 0.45 m high).',
      'Lines starting with _ are notes. The app ignores them; leave them out of your file or replace them with your own.',
    ],
    _axes: 'x runs from the left of the object to its right, y from its back (the side against the wall) to its front (the side facing the room), z from the floor up. [0, 0, 0] is the back-left corner on the floor.',
    _parts: 'Each part is a box from min [x, y, z] to max [x, y, z] in metres, with a colour as #rrggbb and a short name. Parts may touch and overlap.',
    _shapes: 'Straight things are boxes. Soft or rounded things: add "radius" (metres) to round the box corners, e.g. 0.02 for a seat edge, 0.08 for a puffy cushion. Every shape fills its part\'s box: "shape": "cylinder" (legs, poles, tins, pots), "sphere" (balls, round knobs), "dome" (half a ball: lamp tops, pouffes), "cone" (lampshades, tapered legs; "top" and "bottom" are each end\'s width as a share of the box, 0 to 1, default 0 and 1), "wedge" (ramps, sloped arms; "slope": "front", "back", "left" or "right" is the side that comes down to nothing). "axis": "x" lays a cylinder or cone left to right, "y" front to back.',
    _height: 'Something that hangs on a wall (a TV, a shelf, a mirror): add "z", the height off the floor in metres of the bottom of the model, and keep the parts measured from the model\'s own bottom.',
    _tilt: 'Anything sloped or lying down: "tilt": [a, b, c] in degrees turns the part about its own centre. a: its top leans towards the back (a chair back is about 8 to 15). b: its top leans to the right. c: it turns clockwise, seen from above. A cylinder lying from front to back is "tilt": [90, 0, 0]; lying from left to right is [0, 90, 0]. Give the box as it would be standing up before the tilt (for a lying cylinder, its length is its height).',
    _curves: 'Curves are made from rounded boxes, cylinders and small tilts: a curved chair back is a well rounded box leaning back; a curved arm is a cylinder lying down; a bend is two short parts at slightly different tilts.',
    _glass: '"opacity": 0.3 for glass or clear plastic.',
    _cut: '"cut": true makes a part a cut-out: it is not drawn, and removes its shape from the parts it overlaps. A box cutting away half of a cylinder makes a half-round bench; a quarter, a corner bath; a cylinder cut into a box, a basin.',
    _light: 'For a lamp, add "light": { "z": height of the bulb in metres } and the app will make it glow.',
    _category: `One of: ${MODEL_CATEGORIES.map((c) => c[0]).join(', ')}.`,
    _example: 'Below is an example: a timber dining chair with arms and a cushion, about 0.52 m wide, 0.5 m deep and 0.9 m high.',
    name: m.name, category: m.category, size: m.size, parts: m.parts,
  }, null, 1);
}
