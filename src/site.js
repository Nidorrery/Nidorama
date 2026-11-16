// The whole site (#111, #112): a home can have several buildings (the house, a granny flat, a shed),
// each with its own levels and its own roof, standing in one yard. The yard is a dashboard of its
// own: a level with `site: true`, edited like any plan (areas for lawn and paving, furniture,
// fences, buttons, a widget panel), on which the buildings are placed.
import { levelBounds, polyBounds } from './geom.js';
import { uid } from './catalog.js';

export const MAIN = 'main';
export const ROOF_TYPES = [['gable', 'Gable'], ['hip', 'Hip'], ['skillion', 'Skillion (one slope)'], ['flat', 'Flat']];
export const ROOF_MATERIALS = { tiles: ['Terracotta tiles', '#9b5a45'], charcoal: ['Charcoal tiles', '#4a4c52'], metal: ['Metal', '#7d868c'], slate: ['Slate', '#3f454d'], light: ['Light metal', '#c9cdd0'] };

/** The buildings of a home. Homes made before buildings existed have one, the main house, holding every level. */
export function buildingsOf(home) {
  if (!home.buildings?.length) home.buildings = [{ id: MAIN, name: 'Main house', x: 0, y: 0, rot: 0 }];
  return home.buildings;
}
export const buildingOf = (L) => L.building || MAIN;
export const siteOf = (home) => home.levels.find((L) => L.site) || null;
/** A building's levels, lowest first, each with the height its floor sits at. */
export function levelsOf(home, id) {
  let z = 0;
  return home.levels.filter((L) => !L.site && buildingOf(L) === id).map((L) => {
    const at = L.elevation > 0 ? L.elevation : z;
    z = at + (L.ceilingHeight || 2.4) + 0.3;
    return { level: L, z: at };
  });
}
/** Where a building's roof sits and what it covers, in the building's own plan coordinates. */
export function roofFrame(home, b) {
  const lv = levelsOf(home, b.id);
  if (!lv.length) return null;
  const loft = lv.find((x) => x.level.loft), tops = lv.filter((x) => !x.level.loft), top = tops.at(-1) || lv.at(-1);
  // The outline: the outside walls of the top level, else all its walls, else its areas.
  const L = (tops.at(-1) || lv[0]).level;
  const ext = L.walls.filter((w) => w.exterior);
  const pts = (ext.length ? ext : L.walls).flatMap((w) => [w.a, w.b]);
  const indoor = L.rooms.filter((r) => !r.outdoor).flatMap((r) => r.polygon);
  const box = pts.length ? polyBounds(pts) : indoor.length ? polyBounds(indoor) : levelBounds(L);
  const e = b.roof?.extend || {};
  const over = b.roof?.overhang ?? 0.5;
  const rect = [box.x0 - over - (e.w || 0), box.y0 - over - (e.n || 0), box.x1 + over + (e.e || 0), box.y1 + over + (e.s || 0)];
  const eave = loft ? loft.z + 0.5 : top.z + (top.level.ceilingHeight || 2.4) + 0.05;
  return { rect, eave };
}
/** A plan point of a building, in site coordinates. */
export function toSite(b, p) {
  const r = ((b.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [b.x + p[0] * c - p[1] * s, b.y + p[0] * s + p[1] * c];
}
/** Make the whole-site dashboard for a home, with a lawn around its buildings. */
export function makeSite(home) {
  buildingsOf(home);
  const pts = [];
  for (const b of home.buildings) for (const { level } of levelsOf(home, b.id)) {
    const bb = levelBounds(level);
    if (!bb.empty) for (const p of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]]) pts.push(toSite(b, p));
  }
  const bb = pts.length ? polyBounds(pts) : { x0: 0, y0: 0, x1: 10, y1: 8 }, m = 4;
  const [x0, y0, x1, y1] = [bb.x0 - m, bb.y0 - m, bb.x1 + m, bb.y1 + m];
  return { id: uid('level'), name: 'Whole site', site: true, homeView: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, zoom: 1, az: 30 }, elevation: 0, ceilingHeight: 2.4, walls: [], floors: [], voids: [], stairs: [], objects: [], lights: [], roomControls: {}, buttons: [],
    rooms: [{ id: uid('yard'), name: 'Yard', outdoor: true, floor: 'grass', polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], labelAt: [x0 + 1.5, y0 + 1] }] };
}
