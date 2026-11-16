// The whole site (#111, #112, #114, #115). Every plan dashboard of a home is one piece of the
// property: it stands on a floor (Ground, Level 1 … Level 40) and is placed in the yard on its own
// (`place` {x, y, rot}: where its plan's 0, 0 sits and how far it is turned). A roof is a dashboard
// too (`roof: true`), holding roof pieces (`roofs`); any level can carry roof pieces, and then it is
// the space under the roof (a loft you can walk in). The yard itself is the dashboard with `site: true`.
import { levelBounds, polyBounds } from './geom.js';
import { uid } from './catalog.js';

export const MAX_FLOOR = 40;
export const ROOF_TYPES = [['gable', 'Gable'], ['hip', 'Hip'], ['skillion', 'Skillion (one slope)'], ['flat', 'Flat']];
export const ROOF_MATERIALS = { tiles: ['Terracotta tiles', '#9b5a45'], charcoal: ['Charcoal tiles', '#4a4c52'], metal: ['Metal', '#7d868c'], slate: ['Slate', '#3f454d'], light: ['Light metal', '#c9cdd0'] };

export const floorName = (f) => (f ? `Level ${f}` : 'Ground');
export const siteOf = (home) => home.levels.find((L) => L.site) || null;
export const planLevels = (home) => home.levels.filter((L) => !L.site);
export const placeOf = (L) => L.place || { x: 0, y: 0, rot: 0 };
export const floorOf = (L) => L.floor || 0;
export const piecesOf = (L) => L.roofs || [];

/** A new roof piece: a rectangle (centre, width, depth, turn) with its roof settings. */
export function newPiece(at = [0, 0], w = 6, d = 4, rest = {}) {
  return { id: uid('roof'), x: at[0], y: at[1], w, d, rot: 0, type: 'gable', pitch: 25, overhang: 0.5, material: 'charcoal', ...rest };
}

/** Bring a home made before #115 to floors and placements. Buildings become placements of their levels, and each
 *  building's roof becomes a roof dashboard on the floor above (or roof pieces on its loft). Runs once; safe to repeat. */
export function upgradeSite(home) {
  if (!home || home.siteV >= 2) return home;
  const buildings = home.buildings?.length ? home.buildings : [{ id: 'main', x: 0, y: 0, rot: 0 }];
  for (const b of buildings) {
    const levels = home.levels.filter((L) => !L.site && (L.building || 'main') === b.id);
    levels.forEach((L, i) => { L.floor ??= i; L.place ??= { x: b.x || 0, y: b.y || 0, rot: b.rot || 0 }; });
    const r = b.roof;
    if (r && r.type && r.type !== 'none' && levels.length) {
      const loft = levels.find((L) => L.loft), tops = levels.filter((L) => !L.loft), top = tops.at(-1) || levels.at(-1);
      const box = outlineBox(top), e = r.extend || {}, over = r.overhang ?? 0.5;
      if (!box.empty) {
        const x0 = box.x0 - (e.w || 0), x1 = box.x1 + (e.e || 0), y0 = box.y0 - (e.n || 0), y1 = box.y1 + (e.s || 0);
        const piece = newPiece([(x0 + x1) / 2, (y0 + y1) / 2], x1 - x0, y1 - y0, { type: r.type, pitch: r.pitch ?? 25, overhang: over, material: r.material || 'tiles', ...(r.turn ? { turn: true } : {}) });
        if (loft) (loft.roofs ||= []).push(piece);
        else home.levels.push(roofLevel(b.name && b.name !== 'Main house' ? `${b.name} roof` : 'Roof', floorOf(top) + 1, { ...placeOf(top) }, [piece]));
      }
    }
  }
  for (const L of home.levels) { delete L.building; delete L.loft; }
  delete home.buildings;
  home.siteV = 2;
  return home;
}
/** A roof dashboard: no walls of its own, only roof pieces, and hidden from the dashboard list (#116). */
export function roofLevel(name, floor, place, roofs = []) {
  return { id: uid('level'), name, roof: true, hideList: true, floor, place, elevation: 0, ceilingHeight: 2.4, walls: [], rooms: [], floors: [], voids: [], stairs: [], objects: [], lights: [], roomControls: {}, buttons: [], roofs, viewButtonsAdded: true, dragButtonAdded: true, navFixed: true };
}

/** The box around a level's outside walls (else all its walls, else its indoor areas), in its own plan. */
export function outlineBox(L) {
  const ext = L.walls.filter((w) => w.exterior);
  const pts = (ext.length ? ext : L.walls).flatMap((w) => [w.a, w.b]);
  if (pts.length) return polyBounds(pts);
  const indoor = L.rooms.filter((r) => !r.outdoor).flatMap((r) => r.polygon);
  if (indoor.length) return polyBounds(indoor);
  return { x0: 0, y0: 0, x1: 0, y1: 0, empty: true };
}
/** A level's outside corners (wall ends of its outside walls), for snapping one floor onto another. */
export function outsideCorners(L) {
  const ext = L.walls.filter((w) => w.exterior);
  return (ext.length ? ext : L.walls).flatMap((w) => [w.a, w.b]);
}
/** The four corners of a roof piece, without its overhang (or with `grow` metres added all round). */
export function pieceCorners(p, grow = 0) {
  const r = ((p.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), hw = p.w / 2 + grow, hd = p.d / 2 + grow;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [p.x + u * c - v * s, p.y + u * s + v * c]);
}
/** Everything a level covers in its own plan: its walls, areas and furniture, and its roof pieces. */
export function boundsOf(L) {
  const b = levelBounds(L), pts = piecesOf(L).flatMap((p) => pieceCorners(p, p.overhang ?? 0.5));
  if (!pts.length) return b;
  if (!b.empty) pts.push([b.x0, b.y0], [b.x1, b.y1]);
  return polyBounds(pts);
}

/** A plan point of a level, in site coordinates, and back. */
export function toSite(place, p) {
  const r = ((place.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [(place.x || 0) + p[0] * c - p[1] * s, (place.y || 0) + p[0] * s + p[1] * c];
}
export function fromSite(place, q) {
  const r = ((place.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), dx = q[0] - (place.x || 0), dy = q[1] - (place.y || 0);
  return [dx * c + dy * s, -dx * s + dy * c];
}
/** A point of level `a`'s plan, in level `b`'s plan (through where both are placed on the site). */
export const across = (a, b, p) => fromSite(placeOf(b), toSite(placeOf(a), p));

/** The floors of a home, lowest first: [{ floor, z, levels }]. A floor's height follows the tallest ceiling of the
 *  floor below, unless it is given an exact height (`home.floorHeights[floor]`). */
export function floorsOf(home) {
  const plans = planLevels(home), top = Math.max(0, ...plans.map(floorOf)), out = [];
  let z = 0;
  for (let f = 0; f <= top; f++) {
    const levels = plans.filter((L) => floorOf(L) === f);
    const set = home.floorHeights?.[f];
    if (set != null && set !== '') z = Number(set);
    out.push({ floor: f, z, levels });
    const rooms = levels.filter((L) => !L.roof);
    z += (rooms.length ? Math.max(...rooms.map((L) => L.ceilingHeight || 2.4)) : 2.4) + 0.3;
  }
  return out;
}
/** The height a level's floor sits at on the site. */
export function levelZ(home, L) {
  if (L.elevation > 0) return L.elevation;
  return floorsOf(home).find((x) => x.floor === floorOf(L))?.z || 0;
}
/** Where a level's roof pieces start, above its own floor: a roof dashboard's sit on the walls of the floor below;
 *  a level with rooms under its roof pieces is a loft, so its pieces start half a metre up. */
export const eaveOf = (L) => (L.roof || !L.walls.length ? -0.25 : 0.5);

/** The plan levels on the floor below a level (what it stands on). */
export const floorBelow = (home, L) => planLevels(home).filter((x) => x !== L && floorOf(x) === floorOf(L) - 1);

/** Make the whole-site dashboard for a home, with a lawn around everything on it. */
export function makeSite(home) {
  upgradeSite(home);
  const pts = [];
  for (const L of planLevels(home)) {
    const bb = boundsOf(L);
    if (!bb.empty) for (const p of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]]) pts.push(toSite(placeOf(L), p));
  }
  const bb = pts.length ? polyBounds(pts) : { x0: 0, y0: 0, x1: 10, y1: 8 }, m = 4;
  const [x0, y0, x1, y1] = [bb.x0 - m, bb.y0 - m, bb.x1 + m, bb.y1 + m];
  return { id: uid('level'), name: 'Whole site', site: true, homeView: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoom: 1, az: 30 }, elevation: 0, ceilingHeight: 2.4, walls: [], floors: [], voids: [], stairs: [], objects: [], lights: [], roomControls: {}, buttons: [],
    rooms: [{ id: uid('yard'), name: 'Yard', outdoor: true, floor: 'grass', polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], labelAt: [x0 + 1.5, y0 + 1] }] };
}
