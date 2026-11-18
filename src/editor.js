// The designer: draw walls (by tapping or by exact length), rooms, doors and windows, place and edit
// furniture, and connect things to Home Assistant entities. Works on the level currently shown.
import { h, nodes, icon, seg, numField, textField, selectField, entityField, menuItem, modal, pickEntity, pickIcon, iconOf, entityName, pickFile, toast, len, imperial } from './ui.js';
import { mutate, undo, redo, canUndo, canRedo, newLevel, savePhoto } from './store.js';
import { putBlob, delBlob, shrinkPhoto } from './blobs.js';
import { pickModel } from './modelpicker.js';
import { TAP_ACTIONS, SWIPE_WHATS, gestureFor } from './gestures.js';
import { stepsEditor } from './steps.js';
import { share } from './remote.js';
import { roomControlsOf, renderPage } from './dashboard.js';
import { controlRow, editControl, newControl } from './controls.js';
import { CATALOG, CATEGORIES, FLOOR_MATERIALS, makeObject, uid } from './catalog.js';
import { snap, round, dist, distToSeg, pointInPoly, pointInObject, objectCorners, centreOf, rotateAbout, polyBounds, wallLength, wallAt, wallDir, wallPoints, wallNearest, bearing } from './geom.js';
import { thumb } from './thumbs.js';
import { FINISHES, SWATCHES, finishName, finishColor } from './finishes.js';
import { MY_CAT, cleanCatalog, itemFromObject, copiesOf, toDraft, blankDraft, mirroredOptions } from './mymodels.js';
import { openModelMaker } from './modelmaker.js';
import { haDashboards, frameGuide, insideHA } from './webpanel.js';
import { dotColour, dotKindOf } from './themes.js';
import { boundsOf, ROOF_TYPES, ROOF_MATERIALS, MAX_FLOOR, floorName, planLevels, placeOf, floorOf, floorsOf, piecesOf, pieceCorners, newPiece, outlineBox, outsideCorners, toSite, fromSite, across, floorBelow } from './site.js';

const rot = (v, deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r); return [v[0] * c - v[1] * sn, v[0] * sn + v[1] * c]; };
const centroid = (pts) => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
const snapAngle = (a, step = 15) => ((Math.round(a / step) * step) % 360 + 360) % 360;

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs, text) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
};
const fmt = (m) => len(m);
const OPENINGS = {
  door: { label: 'Door', width: 0.82, sill: 0, head: 2.04, style: 'hinged' },
  window: { label: 'Window', width: 1.2, sill: 0.9, head: 2.1, style: 'fixed' },
  slider: { label: 'Sliding glass door', width: 2.4, sill: 0, head: 2.1, style: 'sliding' },
  opening: { label: 'Open doorway', width: 0.9, sill: 0, head: 2.1 },
};
// How a door or window is drawn (#53, #54). Openings with no style are plain gaps / plain glass.
const DOOR_STYLES = [['hinged', 'Hinged'], ['double', 'Double'], ['sliding', 'Sliding'], ['none', 'Not drawn']];
const WINDOW_STYLES = [['fixed', 'Fixed'], ['sliding', 'Sliding'], ['double-hung', 'Double-hung'], ['grid', 'Grid'], ['none', 'Plain glass']];
const stylesFor = (type) => (type === 'door' ? DOOR_STYLES : type === 'window' ? WINDOW_STYLES : null);
const openingName = (o) => OPENINGS[o.type]?.label || o.type;

// ---------- operations on the home file ----------
export function moveObject(L, o, dx, dy, dz = 0) {
  const sh = (p) => { p[0] = round(p[0] + dx); p[1] = round(p[1] + dy); p[2] = round(p[2] + dz); };
  sh(o.bounds.min); sh(o.bounds.max);
  for (const p of o.parts) { sh(p.min); sh(p.max); }
  for (const l of L.lights) if (l.fixture === o.id && l.position) sh(l.position);
  const c = centreOf(o);
  o.room = L.rooms.find((r) => pointInPoly(c, r.polygon))?.id || o.room || null;
  for (const l of L.lights) if (l.fixture === o.id) l.room = o.room;
}
export function resizeObject(L, o, sx, sy, sz) {
  const c = centreOf(o), z0 = o.bounds.min[2];
  const sc = (p) => { p[0] = round(c[0] + (p[0] - c[0]) * sx); p[1] = round(c[1] + (p[1] - c[1]) * sy); p[2] = round(z0 + (p[2] - z0) * sz); };
  sc(o.bounds.min); sc(o.bounds.max);
  for (const p of o.parts) { sc(p.min); sc(p.max); }
  for (const l of L.lights) if (l.fixture === o.id && l.position) sc(l.position);
}
export function rotateObject(L, o, deg) {
  const c = centreOf(o);
  o.rotation = (((o.rotation || 0) + deg) % 360 + 360) % 360;
  for (const l of L.lights) {
    if (l.fixture !== o.id || !l.position) continue;
    const p = rotateAbout(l.position, c, deg);
    l.position[0] = round(p[0]); l.position[1] = round(p[1]);
  }
}
/** Flip an object left ↔ right (a chaise moves to the other end of its sofa). */
export function mirrorObject(L, o) {
  const c = centreOf(o);
  for (const p of o.parts) { const a = p.min[0], b = p.max[0]; p.min[0] = round(2 * c[0] - b); p.max[0] = round(2 * c[0] - a); Object.assign(p, mirroredOptions(p)); }
  for (const l of L.lights) {
    if (l.fixture !== o.id || !l.position) continue;
    const q = rotateAbout(l.position, c, -(o.rotation || 0)), m = rotateAbout([2 * c[0] - q[0], q[1]], c, o.rotation || 0);
    l.position[0] = round(m[0]); l.position[1] = round(m[1]);
  }
}
function lightsOf(L, o) { return L.lights.filter((l) => l.fixture === o.id); }
/**
 * Give a placed copy a model's new shape and colours, keeping its place, angle, name, entity and lights. A copy
 * that was resized keeps that: its size relative to the model before (`old`) is carried over to the new one.
 */
function refitCopy(L, ob, item, old = null) {
  const b = ob.bounds, c = centreOf(ob), was = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const size = was.map((v, k) => (old ? round(item.size[k] * (v / old.size[k])) : v));
  const { object: fresh } = makeObject({ ...item, size, z: b.min[2] }, c[0], c[1], ob.room);
  ob.parts = fresh.parts;
  ob.bounds = fresh.bounds;
  if (item.light) for (const l of L.lights) if (l.fixture === ob.id && l.position) l.position[2] = round(b.min[2] + item.light.z * (size[2] / item.size[2]));
}

export class Editor {
  constructor({ view, stage, panel, ctx }) {
    Object.assign(this, { view, stage, panel, ctx });
    this.active = false;
    this.tool = 'select';
    this.sel = null;
    this.step = 0.05;
    this.btnGrid = 0.25; // buttons snap to this grid (metres) so they line up
    this.wall = { start: null, first: null, exterior: true, length: 3 };
    this.area = null; // points of an area being tapped out
    this.vertex = null; // the selected point of the selected area
    this.openStyle = { door: 'hinged', window: 'fixed' };
    this.cat = 'Seating';
    this.placing = null;
    this.overlay = s('svg', { class: 'edit-overlay' });
    this.drag = null;
    this.cursor = null;
    window.addEventListener('keydown', (e) => {
      if (!this.active || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelection();
      else if (e.key === 'Escape') { this.wall.start = null; this.placing = null; this.select(null); }
    });
  }
  get home() { return this.ctx.home(); }
  get level() { return this.ctx.level(); }

  start() {
    this.active = true;
    this.tool = 'select';
    this.sel = null;
    this.stage.append(this.overlay);
    this.renderPanel();
    this.draw();
  }
  stop() {
    this.active = false;
    this.overlay.remove();
    this.wall.start = null;
    this.placing = null;
    this.area = null;
  }

  /** Apply a change to the home file, redraw the model and refresh the inspector. */
  change(fn, { panel = true } = {}) {
    mutate(this.home, () => fn(this.level));
    this.refresh(panel);
  }
  refresh(panel = true) {
    this.view.load(this.home, this.level, { keepView: true });
    this.ctx.changed();
    if (panel) this.renderPanel();
    this.draw();
  }
  undo() { if (undo()) { this.sel = null; this.refresh(); } }
  redo() { if (redo()) { this.sel = null; this.refresh(); } }

  select(sel) {
    this.sel = sel;
    this.vertex = null;
    this.renderPanel();
    this.draw();
  }
  selected() {
    const L = this.level, x = this.sel;
    if (!x || !L) return null;
    if (x.type === 'opening') return L.walls.find((w) => w.id === x.wall)?.openings?.find((o) => o.id === x.id) || null;
    if (x.type === 'piece') return piecesOf(L).find((p) => p.id === x.id) || null;
    if (x.type === 'place') return this.home.levels.find((q) => q.id === x.id && !q.site) || null;
    const list = { object: L.objects, wall: L.walls, room: L.rooms, light: L.lights, button: L.buttons || [] }[x.type];
    return list.find((i) => i.id === x.id) || null;
  }
  deleteSelection() {
    const x = this.sel, item = this.selected();
    if (!item) return;
    this.sel = null;
    this.change((L) => {
      if (x.type === 'object') { L.objects = L.objects.filter((o) => o !== item); L.lights = L.lights.filter((l) => l.fixture !== item.id); }
      if (x.type === 'wall') L.walls = L.walls.filter((w) => w !== item);
      if (x.type === 'opening') { const w = L.walls.find((q) => q.id === x.wall); w.openings = w.openings.filter((o) => o !== item); }
      if (x.type === 'light') L.lights = L.lights.filter((l) => l !== item);
      if (x.type === 'button') L.buttons = L.buttons.filter((b) => b !== item);
      if (x.type === 'piece') L.roofs = L.roofs.filter((p) => p.id !== item.id);
      if (x.type === 'room') { L.rooms = L.rooms.filter((r) => r !== item); delete L.roomControls[item.id]; L.lights = L.lights.filter((l) => !(l.kind === 'ceiling' && l.room === item.id)); }
    });
  }

  // ---------- pointer ----------
  planPoint(e) {
    const r = this.view.canvas.getBoundingClientRect();
    return this.view.unproject(e.clientX - r.left, e.clientY - r.top) || [0, 0];
  }
  px(m) { return m * this.view.pxPerMetre; }

  hits(p) {
    const L = this.level, out = [];
    for (const b of L.buttons || []) if (b.at && !b.dock && dist(p, b.at) < 26 / this.view.pxPerMetre) out.push({ type: 'button', id: b.id });
    for (const l of L.lights) if (l.position && !l.fixture && dist(p, l.position) < 0.2) out.push({ type: 'light', id: l.id });
    const objs = L.objects.filter((o) => pointInObject(p, o)).sort((a, b) => b.bounds.max[2] - a.bounds.max[2] || (a.bounds.max[0] - a.bounds.min[0]) * (a.bounds.max[1] - a.bounds.min[1]) - (b.bounds.max[0] - b.bounds.min[0]) * (b.bounds.max[1] - b.bounds.min[1]));
    for (const o of objs) out.push({ type: 'object', id: o.id });
    for (const q of piecesOf(L)) if (pointInPoly(p, pieceCorners(q, q.overhang ?? 0.5))) out.push({ type: 'piece', id: q.id });
    if (L.site) for (const x of [...planLevels(this.home)].sort((a, b) => floorOf(b) - floorOf(a))) { const f = this.footCorners(x); if (f && pointInPoly(p, f)) out.push({ type: 'place', id: x.id }); }
    for (const w of L.walls) {
      const r = wallNearest(p, w);
      if (r.d >= w.thickness / 2 + 12 / this.view.pxPerMetre) continue;
      const o = (w.openings || []).find((q) => r.t >= q.offset && r.t <= q.offset + q.width);
      if (o) out.push({ type: 'opening', id: o.id, wall: w.id });
      out.push({ type: 'wall', id: w.id });
    }
    for (const r of L.rooms) if (pointInPoly(p, r.polygon)) out.push({ type: 'room', id: r.id });
    return out;
  }

  /** Snap a point to wall ends, then to the grid; optionally line it up with `from`. */
  snapPoint(p, from = null, skipWall = null) {
    const L = this.level, tol = 14 / this.view.pxPerMetre;
    for (const w of L.walls) for (const e of [w.a, w.b]) if (w !== skipWall && dist(p, e) < tol) return [...e];
    for (const r of L.rooms) for (const e of r.polygon) if (dist(p, e) < tol) return [...e];
    let q = [snap(p[0]), snap(p[1])];
    if (from) {
      if (Math.abs(q[0] - from[0]) < tol) q[0] = from[0];
      if (Math.abs(q[1] - from[1]) < tol) q[1] = from[1];
    }
    return q.map((v) => round(v));
  }

  /** The door or window under a plan point, if any. */
  openingAt(p) {
    for (const w of this.level.walls) {
      const r = wallNearest(p, w);
      if (r.d >= w.thickness / 2 + 12 / this.view.pxPerMetre) continue;
      const o = (w.openings || []).find((q) => r.t >= q.offset && r.t <= q.offset + q.width);
      if (o) return { w, o, t: r.t };
    }
    return null;
  }
  /** Where a wall drawn from `from` towards p ends: on an existing corner if p is at one, otherwise at any angle, catching on every 45° (#52). */
  wallEnd(from, p) {
    const tol = 14 / this.view.pxPerMetre;
    for (const w of this.level.walls) for (const e of [w.a, w.b]) if (dist(p, e) < tol && dist(e, from) > 0.02) return [...e];
    const dx = p[0] - from[0], dy = p[1] - from[1], len = snap(Math.hypot(dx, dy));
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const near = Math.round(ang / 45) * 45;
    if (Math.abs(ang - near) < 7) ang = near;
    const r = (ang * Math.PI) / 180;
    return [round(from[0] + Math.cos(r) * len), round(from[1] + Math.sin(r) * len)];
  }

  down(e) {
    const p = this.planPoint(e);
    this.drag = { p0: p, sx: e.clientX, sy: e.clientY, moved: false, kind: 'pan' };
    if (this.tool === 'wall') { // drag out a wall to the length wanted; a tap still places corners one by one
      const w = this.wall, near = w.start && dist(p, w.start) < 24 / this.view.pxPerMetre;
      Object.assign(this.drag, { kind: 'wallDraw', a: near ? w.start : this.snapPoint(p) });
      return;
    }
    if (this.tool === 'select') { // a door or window can be grabbed and slid along its wall straight away
      const hit = this.openingAt(p);
      if (hit && !(this.sel?.type === 'wall' && this.sel.id === hit.w.id && [hit.w.a, hit.w.b].some((q) => dist(q, p) < 16 / this.view.pxPerMetre))) {
        const fresh = !(this.sel?.type === 'opening' && this.sel.id === hit.o.id);
        if (fresh) { this.sel = { type: 'opening', id: hit.o.id, wall: hit.w.id }; this.vertex = null; this.renderPanel(); this.draw(); }
        Object.assign(this.drag, { kind: 'opening', wall: hit.w, grab: hit.t - hit.o.offset, fresh });
        return;
      }
    }
    // Any button on the plan can be grabbed and dragged straight away.
    if (this.tool === 'select') {
      const L = this.level, k = this.view.pxPerMetre;
      const bh = (L.buttons || []).find((b) => b.at && !b.dock && dist(p, b.at) < (22 * (b.scale || 1) + 6) / k);
      if (bh) {
        this.sel = { type: 'button', id: bh.id };
        Object.assign(this.drag, { kind: 'button', orig: [...bh.at] });
        this.renderPanel();
        this.draw();
        return;
      }
    }
    if (this.tool === 'roof') { Object.assign(this.drag, { kind: 'roofRect', a: this.snapPoint(p) }); return; }
    const item = this.selected();
    if (this.tool === 'select' && item && (this.sel.type === 'piece' || this.sel.type === 'place')) {
      const tol = 18 / this.view.pxPerMetre;
      if (this.sel.type === 'piece') {
        const cs = pieceCorners(item), ci = cs.findIndex((c) => dist(c, p) < tol);
        if (ci >= 0) return void Object.assign(this.drag, { kind: 'pieceCorner', ci, orig: { ...item }, opp: cs[(ci + 2) % 4] });
        if (dist(this.turnHandle(cs), p) < tol) return void Object.assign(this.drag, { kind: 'pieceTurn', orig: { ...item } });
        if (pointInPoly(p, pieceCorners(item, item.overhang ?? 0.5))) return void Object.assign(this.drag, { kind: 'pieceMove', orig: { ...item } });
      } else {
        const f = this.footCorners(item);
        if (f && dist(this.turnHandle(f), p) < tol) return void Object.assign(this.drag, { kind: 'placeTurn', orig: { ...placeOf(item) }, centre: centroid(f) });
        if (f && pointInPoly(p, f)) return void Object.assign(this.drag, { kind: 'placeMove', orig: { ...placeOf(item) } });
      }
    }
    if (this.tool === 'select' && item) {
      const tol = 16 / this.view.pxPerMetre;
      if (this.sel.type === 'room') {
        const poly = item.polygon.map((v) => [...v]);
        const i = item.polygon.findIndex((v) => dist(v, p) < tol);
        if (i >= 0) Object.assign(this.drag, { kind: 'vertex', i, poly });
        else { // the + in the middle of an edge: a new point, which can be dragged at once
          const k = item.polygon.findIndex((v, j) => { const q = item.polygon[(j + 1) % item.polygon.length]; return dist([(v[0] + q[0]) / 2, (v[1] + q[1]) / 2], p) < tol; });
          if (k >= 0) {
            const q = item.polygon[(k + 1) % item.polygon.length], v = item.polygon[k];
            item.polygon.splice(k + 1, 0, [round((v[0] + q[0]) / 2), round((v[1] + q[1]) / 2)]);
            Object.assign(this.drag, { kind: 'vertex', i: k + 1, poly, inserted: true });
            this.draw();
          }
        }
      } else if (this.sel.type === 'wall') {
        const end = dist(item.a, p) < tol ? 'a' : dist(item.b, p) < tol ? 'b' : null;
        if (end) Object.assign(this.drag, { kind: 'wallEnd', end, orig: [...item[end]] });
        else if (dist(wallAt(item, wallLength(item) / 2), p) < tol) Object.assign(this.drag, { kind: 'wallCurve' });
      }
      if (this.drag.kind === 'pan' && this.sel.type === 'object' && pointInObject(p, item)) Object.assign(this.drag, { kind: 'object', c0: centreOf(item) });
      if (this.sel.type === 'button' && item.at && !item.dock && dist(p, item.at) < 30 / this.view.pxPerMetre) Object.assign(this.drag, { kind: 'button', orig: [...item.at] });
      if (this.drag.kind === 'pan' && this.sel.type === 'light' && item.position && dist(p, item.position) < tol) Object.assign(this.drag, { kind: 'light', orig: [...item.position] });
    }
    if (this.tool === 'room') Object.assign(this.drag, { kind: 'room', a: this.snapPoint(p) });
  }

  move(e) {
    const p = this.planPoint(e);
    this.cursor = p;
    const d = this.drag;
    if (!d) { if ((this.tool === 'wall' && this.wall.start) || this.area) this.draw(); return; }
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
    d.moved = true;
    const item = this.selected();
    if (d.kind === 'pan') {
      this.view.panBy(e.clientX - (d.lx ?? d.sx), e.clientY - (d.ly ?? d.sy));
      d.lx = e.clientX; d.ly = e.clientY;
    } else if (d.kind === 'object') {
      d.dx = snap(p[0] - d.p0[0]); d.dy = snap(p[1] - d.p0[1]);
      this.view.nudgeObject(item.id, d.c0[0] + d.dx, d.c0[1] + d.dy);
    } else if (d.kind === 'vertex') {
      item.polygon[d.i] = this.snapPoint(p, item.polygon[(d.i + 1) % item.polygon.length]);
    } else if (d.kind === 'wallDraw') {
      d.b = this.wallEnd(d.a, p);
    } else if (d.kind === 'opening') {
      const o = item, len = wallLength(d.wall);
      d.off = round(Math.max(0, Math.min(len - o.width, snap(wallNearest(p, d.wall).t - d.grab))));
    } else if (d.kind === 'wallCurve') {
      const c = dist(item.a, item.b) || 1, ux = (item.b[0] - item.a[0]) / c, uy = (item.b[1] - item.a[1]) / c;
      const side = (p[0] - item.a[0]) * -uy + (p[1] - item.a[1]) * ux; // how far p is to the right of the straight line
      d.bulge = Math.abs(side) < 0.08 ? 0 : round(Math.max(-c / 2, Math.min(c / 2, snap(side))));
    } else if (d.kind === 'wallEnd') {
      d.pos = this.snapPoint(p, item[d.end === 'a' ? 'b' : 'a'], item);
    } else if (d.kind === 'button') {
      d.pos = [round(snap(p[0], this.btnGrid)), round(snap(p[1], this.btnGrid))];
    } else if (d.kind === 'light') {
      d.pos = [snap(p[0]), snap(p[1])];
    } else if (d.kind === 'room' || d.kind === 'roofRect') d.b = this.snapPoint(p);
    else if (d.kind === 'pieceMove') d.piece = { ...d.orig, x: round(d.orig.x + snap(p[0] - d.p0[0])), y: round(d.orig.y + snap(p[1] - d.p0[1])) };
    else if (d.kind === 'pieceCorner') { // the opposite corner stays put
      const q = this.snapPoint(p), v = rot([q[0] - d.opp[0], q[1] - d.opp[1]], -(d.orig.rot || 0));
      const w = Math.max(0.5, Math.abs(v[0])), dd = Math.max(0.5, Math.abs(v[1])), half = rot([Math.sign(v[0] || 1) * w / 2, Math.sign(v[1] || 1) * dd / 2], d.orig.rot || 0);
      d.piece = { ...d.orig, w: round(w), d: round(dd), x: round(d.opp[0] + half[0]), y: round(d.opp[1] + half[1]) };
    } else if (d.kind === 'pieceTurn') d.piece = { ...d.orig, rot: snapAngle((Math.atan2(p[1] - d.orig.y, p[0] - d.orig.x) * 180) / Math.PI + 90) };
    else if (d.kind === 'placeMove') d.place = this.snapPlace(item, { ...d.orig, x: round(d.orig.x + snap(p[0] - d.p0[0])), y: round(d.orig.y + snap(p[1] - d.p0[1])) });
    else if (d.kind === 'placeTurn') { // turn about the middle of its footprint, in 15° steps
      const r = snapAngle((Math.atan2(p[1] - d.centre[1], p[0] - d.centre[0]) * 180) / Math.PI + 90), local = fromSite(d.orig, d.centre), at = rot(local, r);
      d.place = { x: round(d.centre[0] - at[0]), y: round(d.centre[1] - at[1]), rot: r };
    }
    this.draw();
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const p = this.planPoint(e), item = this.selected();
    if (d.kind === 'vertex' && !d.moved && !d.inserted) { // a tap on a point selects it (to type its place, or remove it)
      this.vertex = d.i;
      this.renderPanel();
      this.draw();
      return;
    }
    if (d.kind === 'wallDraw' && d.moved) {
      if (d.b && dist(d.a, d.b) > 0.1) {
        const w = this.wall;
        if (w.start !== d.a) w.first = d.a;
        w.start = d.a;
        this.addWall(d.a, d.b);
      }
      this.draw();
      return;
    }
    if (d.moved || d.inserted) {
      if (d.kind === 'object' && (d.dx || d.dy)) this.change((L) => moveObject(L, L.objects.find((o) => o.id === item.id), d.dx, d.dy), { panel: false });
      else if (d.kind === 'opening' && d.off != null) {
        const sel = this.sel;
        this.change((L) => (L.walls.find((w) => w.id === sel.wall).openings.find((o) => o.id === sel.id).offset = d.off));
      } else if (d.kind === 'wallCurve' && d.bulge != null) {
        this.change((L) => { const w = L.walls.find((q) => q.id === item.id); if (d.bulge) w.bulge = d.bulge; else delete w.bulge; });
      } else if (d.kind === 'vertex') {
        const moved = item.polygon.map((v) => [...v]);
        item.polygon = d.poly; // restore, then commit through mutate so it can be undone
        this.vertex = d.i;
        this.change((L) => {
          const r = L.rooms.find((q) => q.id === item.id);
          r.polygon = moved;
          const n = r.polygon.length, j = [(d.i + 1) % n, (d.i + n - 1) % n].find((k) => dist(r.polygon[k], r.polygon[d.i]) < 0.03);
          if (j != null && n > 3) { r.polygon.splice(d.i, 1); this.vertex = null; } // dropped onto a neighbour: remove the point
          const b = polyBounds(r.polygon);
          r.labelAt = [round((b.x0 + b.x1) / 2), round((b.y0 + b.y1) / 2)];
        });
      } else if (d.kind === 'wallEnd' && d.pos) {
        this.change((L) => {
          for (const w of L.walls) for (const k of ['a', 'b']) if (dist(w[k], d.orig) < 0.011) w[k] = [...d.pos];
        });
      } else if (d.kind === 'light' && d.pos) {
        this.change((L) => { const l = L.lights.find((q) => q.id === item.id); l.position[0] = d.pos[0]; l.position[1] = d.pos[1]; l.room = L.rooms.find((r) => pointInPoly(d.pos, r.polygon))?.id || l.room; }, { panel: false });
      } else if (d.kind === 'button' && d.pos) {
        const vb = this.view.bounds, off = d.pos[0] < vb.x0 - 0.4 || d.pos[0] > vb.x1 + 0.4 || d.pos[1] < vb.y0 - 0.4 || d.pos[1] > vb.y1 + 0.4;
        if (off && this.ctx.freePosAt) this.change((L) => { const btn = L.buttons.find((q) => q.id === item.id); delete btn.at; btn.dock = true; btn.pos = this.ctx.freePosAt(e.clientX, e.clientY); });
        else this.change((L) => (L.buttons.find((q) => q.id === item.id).at = [...d.pos]), { panel: false });
      } else if (d.piece) {
        this.change((L) => Object.assign(L.roofs.find((q) => q.id === d.piece.id), d.piece));
      } else if (d.place) {
        const id = this.sel.id;
        this.change(() => (this.home.levels.find((q) => q.id === id).place = d.place));
      } else if (d.kind === 'roofRect' && d.b && Math.abs(d.b[0] - d.a[0]) > 0.4 && Math.abs(d.b[1] - d.a[1]) > 0.4) {
        const piece = newPiece([round((d.a[0] + d.b[0]) / 2), round((d.a[1] + d.b[1]) / 2)], round(Math.abs(d.b[0] - d.a[0])), round(Math.abs(d.b[1] - d.a[1])));
        this.tool = 'select'; this.sel = { type: 'piece', id: piece.id };
        this.change((L) => (L.roofs ||= []).push(piece));
      } else if (d.kind === 'room' && d.b && Math.abs(d.b[0] - d.a[0]) > 0.3 && Math.abs(d.b[1] - d.a[1]) > 0.3) {
        const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]), y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
        this.addArea([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      }
      this.draw();
      return;
    }
    // a tap
    if (d.kind === 'opening') { if (!d.fresh) this.select({ type: 'wall', id: d.wall.id }); return; } // tap again: the wall it is in
    if (this.tool === 'wall') return this.wallTap(this.wall.start ? this.wallEnd(this.wall.start, p) : this.snapPoint(p));
    if (this.tool === 'room') return this.areaTap(this.snapPoint(p));
    if (this.tool === 'select' && this.sel?.type === 'wall' && item) { // tap the length or the angle shown on the wall to type it
      const [mx, my] = this.view.project(...wallAt(item, wallLength(item) / 2)), r = this.view.canvas.getBoundingClientRect();
      const tx = e.clientX - r.left, ty = e.clientY - r.top;
      if (Math.abs(tx - mx) < 46 && Math.abs(ty - my) < 30) { this.focus = ty < my ? 'Length' : 'Angle'; this.renderPanel(); return; }
    }
    if (this.tool === 'roof') return;
    if (this.tool === 'door' || this.tool === 'window') return this.addOpeningAt(p, this.tool);
    if (this.tool === 'button') return this.addButton([round(snap(p[0], this.btnGrid)), round(snap(p[1], this.btnGrid))]);
    if (this.tool === 'furniture' && this.placing) return this.place(this.placing, [snap(p[0]), snap(p[1])]);
    if (this.tool === 'select' || this.tool === 'furniture') {
      const hits = this.hits(p);
      const key = (x) => x && `${x.type}:${x.id}`;
      const i = hits.findIndex((x) => key(x) === key(this.sel));
      this.tool = 'select';
      this.select(hits.length ? hits[(i + 1) % hits.length] : null); // tapping again cycles to what is underneath
    }
  }

  // ---------- roofs and the site (#114, #115) ----------
  /** A plan level's footprint on the site: the turned box around everything on it. */
  footCorners(L, place = placeOf(L)) {
    const b = boundsOf(L);
    if (b.empty) return null;
    return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map((q) => toSite(place, q));
  }
  /** Where the round turning handle of a box sits: just outside the middle of its first edge. */
  turnHandle(cs) {
    const m = [(cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2], c = centroid(cs), len = dist(m, c) || 1, k = 30 / this.view.pxPerMetre;
    return [m[0] + ((m[0] - c[0]) / len) * k, m[1] + ((m[1] - c[1]) / len) * k];
  }
  /** Snap a level's place so its outside corners meet those of the floor below, when one comes close. */
  snapPlace(L, place) {
    const mine = outsideCorners(L).map((q) => toSite(place, q)), tol = Math.max(0.3, 16 / this.view.pxPerMetre);
    let best = null;
    for (const B of floorBelow(this.home, L)) for (const q of outsideCorners(B).map((x) => toSite(placeOf(B), x)))
      for (const m of mine) { const dd = dist(m, q); if (dd < tol && (!best || dd < best.d)) best = { d: dd, dx: q[0] - m[0], dy: q[1] - m[1] }; }
    return best ? { ...place, x: round(place.x + best.dx), y: round(place.y + best.dy) } : place;
  }
  /** A roof piece over the outside walls of another dashboard, lined up with it (#114, #117). */
  coverWith(id) {
    const L = this.level, src = this.home.levels.find((x) => x.id === id);
    if (!src) return;
    const b = outlineBox(src);
    if (b.empty) return void toast('That dashboard has no walls to cover yet.');
    const c = across(src, L, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
    const piece = newPiece([round(c[0]), round(c[1])], round(b.x1 - b.x0), round(b.y1 - b.y0), { rot: snapAngle((placeOf(src).rot || 0) - (placeOf(L).rot || 0), 1) });
    this.tool = 'select'; this.sel = { type: 'piece', id: piece.id };
    this.change((lv) => (lv.roofs ||= []).push(piece));
    this.view.bounds = null; this.refit();
  }
  roofToolPanel() {
    const L = this.level, home = this.home, others = planLevels(home).filter((x) => x !== L && x.walls.length);
    const below = floorBelow(home, L).find((x) => x.walls.length);
    if (!others.some((x) => x.id === this.coverFrom)) this.coverFrom = (below || others[0])?.id;
    return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, 'Drag out a rectangle on the plan for each part of the roof (an L-shaped house is two pieces that meet). Then drag its corners to size it and its round handle to turn it.'),
      others.length ? [
        h('label', { class: 'field wide-field' }, h('span', {}, 'Or cover the outside walls of'),
          h('select', { onchange: (e) => (this.coverFrom = e.target.value) }, others.map((x) => h('option', { value: x.id, selected: x.id === this.coverFrom }, `${x.name} (${floorName(floorOf(x))})`)))),
        h('button', { class: 'wide primary', onclick: () => this.coverWith(this.coverFrom) }, icon('roof'), 'Add a roof over them')] : null,
      L.roof || !L.walls.length ? null : h('p', { class: 'hint' }, 'Roof pieces on a level with walls make it a loft: the roof starts half a metre above this floor. For a roof with nothing to walk in under it, use Add roof in the dashboard list.'));
  }
  pieceInspector(p) {
    const edit = (fn) => this.change((L) => fn(L.roofs.find((q) => q.id === p.id)));
    const flat = p.type === 'flat';
    return h('div', { class: 'stack' },
      h('h3', {}, 'Roof piece'),
      h('label', { class: 'field wide-field' }, h('span', {}, 'Type'),
        h('select', { onchange: (e) => edit((q) => (q.type = e.target.value)) }, ROOF_TYPES.map(([v, l]) => h('option', { value: v, selected: v === p.type }, l)))),
      h('div', { class: 'fields' },
        numField('Width', p.w, (v) => edit((q) => (q.w = v)), { min: 0.5, max: 100, step: 0.1 }),
        numField('Depth', p.d, (v) => edit((q) => (q.d = v)), { min: 0.5, max: 100, step: 0.1 })),
      h('div', { class: 'fields' },
        flat ? null : numField('Pitch', p.pitch ?? 25, (v) => edit((q) => (q.pitch = v)), { min: 3, max: 60, step: 1, unit: '°' }),
        numField('Overhang', p.overhang ?? 0.5, (v) => edit((q) => (q.overhang = v)), { min: 0, max: 2, step: 0.05 }),
        numField('Turn', p.rot || 0, (v) => edit((q) => (q.rot = ((v % 360) + 360) % 360)), { min: -360, max: 360, step: 15, unit: '°' })),
      h('label', { class: 'field wide-field' }, h('span', {}, 'Material'),
        h('select', { onchange: (e) => edit((q) => (q.material = e.target.value)) }, Object.entries(ROOF_MATERIALS).map(([k, [n]]) => h('option', { value: k, selected: k === (p.material || 'tiles') }, n)))),
      flat ? null : h('button', { class: 'wide ghost', onclick: () => edit((q) => (q.turn = !q.turn)) }, icon('rotate'), 'Turn the ridge 90°'),
      h('div', { class: 'btns' },
        h('button', { class: 'wide', onclick: () => { const c = { ...structuredClone(p), id: uid('roof'), x: round(p.x + 1), y: round(p.y + 1) }; this.sel = { type: 'piece', id: c.id }; this.change((L) => L.roofs.push(c)); } }, icon('copy'), 'Duplicate'),
        h('button', { class: 'wide ghost danger', onclick: () => this.deleteSelection() }, icon('trash'), 'Delete')),
      h('p', { class: 'hint' }, 'Drag the corners to resize it, the round handle to turn it, or the middle to move it.'));
  }
  /** Where a dashboard stands on the whole site (#115). */
  placeInspector(L) {
    const edit = (fn) => { const id = L.id; this.change(() => { const x = this.home.levels.find((q) => q.id === id); x.place = { ...placeOf(x) }; fn(x.place, x); }); };
    const pl = placeOf(L);
    return h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, L.name), h('div', { class: 'sub' }, floorName(floorOf(L)) + (L.roof ? ' · roof' : ''))),
        h('button', { class: 'chip small', onclick: () => this.ctx.openLevel?.(L.id) }, icon('edit'), 'Open')),
      this.floorSelect(L, (f) => edit((_, x) => (x.floor = f))),
      h('div', { class: 'fields' },
        numField('East', pl.x || 0, (v) => edit((q) => (q.x = v)), { min: -500, max: 500, step: 0.1 }),
        numField('South', pl.y || 0, (v) => edit((q) => (q.y = v)), { min: -500, max: 500, step: 0.1 }),
        numField('Turn', pl.rot || 0, (v) => edit((q) => (q.rot = ((v % 360) + 360) % 360)), { min: -360, max: 360, step: 15, unit: '°' })),
      h('div', { class: 'btns' }, ...[['left', -1, 0], ['up', 0, -1], ['down', 0, 1], ['chevron', 1, 0]].map(([ic, dx, dy]) =>
        h('button', { class: 'round small', 'aria-label': `Move ${L.name} ${{ left: 'west', up: 'north', down: 'south', chevron: 'east' }[ic]}`, onclick: () => edit((q) => { q.x = round((q.x || 0) + dx * 0.25); q.y = round((q.y || 0) + dy * 0.25); }) }, icon(ic))),
        h('button', { class: 'round small', 'aria-label': `Turn ${L.name}`, onclick: () => edit((q) => (q.rot = ((q.rot || 0) + 90) % 360)) }, icon('rotate'))),
      h('p', { class: 'hint' }, 'Drag it on the plan; its outside corners catch on those of the floor below. The round handle turns it in 15° steps.'));
  }
  floorSelect(L, set) {
    return h('label', { class: 'field wide-field' }, h('span', {}, 'Floor'),
      h('select', { onchange: (e) => set(Number(e.target.value)) }, Array.from({ length: MAX_FLOOR + 1 }, (_, f) => h('option', { value: f, selected: f === floorOf(L) }, floorName(f)))));
  }

  // ---------- walls ----------
  wallTap(p) {
    const w = this.wall;
    if (!w.start) { w.start = p; w.first = p; this.renderPanel(); this.draw(); return; }
    if (dist(w.start, p) < 0.05) return;
    this.addWall(w.start, p);
  }
  addWall(a, b) {
    const w = this.wall;
    const id = uid('w');
    this.change((L) => L.walls.push({ id, a: a.map((v) => round(v)), b: b.map((v) => round(v)), thickness: w.exterior ? 0.2 : 0.1, height: L.ceilingHeight || 2.4, exterior: w.exterior, openings: [] }));
    w.start = dist(b, w.first) < 0.02 ? null : b; // closing the loop ends the chain
    this.renderPanel();
    this.draw();
  }
  addWallByLength(dir, len) {
    const w = this.wall;
    if (len != null) w.length = len;
    const from = w.start || [0, 0];
    if (!w.start) w.first = from;
    const v = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[dir];
    this.wall.start = from;
    this.addWall(from, [round(from[0] + v[0] * w.length), round(from[1] + v[1] * w.length)]);
    const b = this.level.walls.at(-1)?.b;
    if (b) { const [sx, sy] = this.view.project(b[0], b[1]); const c = this.view.canvas; if (sx < 40 || sy < 40 || sx > c.clientWidth - 40 || sy > c.clientHeight - 40) { this.view.bounds = null; this.refit(); } }
  }
  refit() {
    this.view.load(this.home, this.level, {});
    this.draw();
  }
  /** Set a wall's straight-line length and / or compass angle: its far end moves, with any walls joined to it. */
  setWall(wall, { len, angle }) {
    this.change((L) => {
      const w = L.walls.find((q) => q.id === wall.id), old = [...w.b];
      const l = len ?? dist(w.a, w.b), r = ((angle ?? bearing(w.a, w.b)) * Math.PI) / 180;
      const nb = [round(w.a[0] + Math.sin(r) * l), round(w.a[1] - Math.cos(r) * l)];
      for (const o of L.walls) for (const k of ['a', 'b']) if (dist(o[k], old) < 0.011) o[k] = [...nb];
    });
  }
  addOpeningAt(p, kind) {
    const L = this.level;
    let best = null;
    for (const w of L.walls) { const r = wallNearest(p, w); if (r.d < 0.5 && (!best || r.d < best.d)) best = { ...r, w }; }
    if (!best) return;
    const def = OPENINGS[kind], len = wallLength(best.w);
    const width = Math.min(def.width, Math.max(0.3, len - 0.1));
    const offset = round(Math.max(0.05, Math.min(len - width - 0.05, snap(best.t - width / 2))));
    const id = best.w.id, oid = uid('o'), style = this.openStyle[kind];
    this.tool = 'select';
    this.sel = { type: 'opening', id: oid, wall: id };
    this.change((Lv) => Lv.walls.find((w) => w.id === id).openings.push({ id: oid, type: kind, style, offset, width: round(width), sill: def.sill, head: Math.min(def.head, best.w.height) }));
  }

  // ---------- rooms ----------
  /** An area: a floor outline of any shape, with as many points as wanted. It has no walls of its own (#52). */
  addArea(polygon) {
    const id = uid('room'), b = polyBounds(polygon);
    this.area = null;
    this.change((L) => L.rooms.push({ id, name: `Area ${L.rooms.length + 1}`, polygon: polygon.map((q) => [round(q[0]), round(q[1])]), floor: 'timber-oak', labelAt: [round((b.x0 + b.x1) / 2), round((b.y0 + b.y1) / 2)] }), { panel: false });
    this.tool = 'select';
    this.select({ type: 'room', id });
  }
  /** Tap out an area point by point; tapping the first point again closes it. */
  areaTap(p) {
    const a = this.area;
    if (!a) this.area = [p];
    else if (a.length >= 3 && dist(a[0], p) < 0.02) return this.addArea(a);
    else if (dist(a.at(-1), p) > 0.02) a.push(p);
    this.renderPanel();
    this.draw();
  }
  wallsAround(L, room, exterior = true) {
    const pts = room.polygon;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const exists = L.walls.some((w) => (dist(w.a, a) < 0.02 && dist(w.b, b) < 0.02) || (dist(w.a, b) < 0.02 && dist(w.b, a) < 0.02));
      if (!exists) L.walls.push({ id: uid('w'), a: [...a], b: [...b], thickness: exterior ? 0.2 : 0.1, height: L.ceilingHeight || 2.4, exterior, openings: [] });
    });
  }
  setMainLight(room, entity) {
    this.change((L) => {
      const rc = (L.roomControls[room.id] ||= {});
      if (entity) rc.mainLight = entity; else delete rc.mainLight;
      L.lights = L.lights.filter((l) => !(l.kind === 'ceiling' && l.room === room.id));
      if (entity) L.lights.push({ id: uid('light'), name: 'Main light', room: room.id, kind: 'ceiling', entity });
    });
  }

  // ---------- buttons (controls placed on the plan, or docked beside it) ----------
  async addButton(at) {
    const entity = await pickEntity({ title: at ? 'What does this button control?' : 'Button beside the plan: what does it control?' });
    if (!entity) return;
    const id = uid('btn');
    this.tool = 'select';
    this.sel = { type: 'button', id };
    this.change((L) => (L.buttons ||= []).push({ id, name: entityName(entity), entity, size: this.btnSize || 'small', ...(at ? { at } : { dock: true }) }));
  }

  // ---------- furniture ----------
  place(item, at) {
    const room = this.level.rooms.find((r) => pointInPoly(at, r.polygon))?.id || null;
    const { object, light } = makeObject(item, at[0], at[1], room);
    if (item.model) object.model = item.model;
    this.placing = null;
    this.tool = 'select';
    this.sel = { type: 'object', id: object.id };
    this.change((L) => { L.objects.push(object); if (light) L.lights.push(light); });
  }
  /** Swap what an object looks like for another catalogue item, keeping its name, entity, lights, place and angle. */
  replaceLook(o, item) {
    this.change((L) => {
      const ob = L.objects.find((q) => q.id === o.id), c = centreOf(ob);
      const { object: fresh } = makeObject(item, c[0], c[1], ob.room);
      Object.assign(ob, { parts: fresh.parts, bounds: fresh.bounds, kind: item.id });
      const z = item.light ? (item.z || 0) + item.light.z : fresh.bounds.max[2];
      for (const l of L.lights) if (l.fixture === ob.id && l.position) l.position = [round(c[0]), round(c[1]), round(z)];
    });
  }
  chooseLook(o) {
    let cat = this.allItems().find((i) => i.id === o.kind)?.cat || this.cat;
    const cats = this.myItems().length ? [...CATEGORIES, MY_CAT] : CATEGORIES;
    const body = h('div', { class: 'menu' });
    const close = modal(body);
    const draw = () => body.replaceChildren(...nodes(
      h('div', { class: 'panel-head' }, h('h2', {}, `Change the look of ${o.name}`), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('p', { class: 'hint' }, 'Only the shape and colours change. Its name, connected entity, light, position and angle are kept.'),
      h('div', { class: 'cats' }, cats.map((c) => h('button', { class: 'chip small' + (c === cat ? ' on' : ''), onclick: () => { cat = c; draw(); } }, c))),
      h('div', { class: 'look-list' }, this.itemsIn(cat).map((i) => this.catItem(i, i.id === o.kind, () => { close(); this.replaceLook(o, i); }, 'Use this look')))));
    draw();
  }
  /**
   * "Gestures": what tap, hold and each swipe do for this item. `host` is where the settings live,
   * `main` the item's own entity (used when a gesture names none), `save(fn)` applies a change.
   * `swipes: false` for buttons (they are tapped, not swiped).
   */
  gesturesPanel(host, main, save, { swipes = true } = {}) {
    const g = host.gestures || {};
    const set = (kind, patch) => save((x) => { x.gestures = { ...(x.gestures || {}) }; x.gestures[kind] = { ...(x.gestures[kind] || {}), ...patch }; if (!x.gestures[kind].entity) delete x.gestures[kind].entity; });
    const reset = (kind) => save((x) => { if (!x.gestures) return; delete x.gestures[kind]; if (!Object.keys(x.gestures).length) delete x.gestures; });
    const row = (kind, label, options, key) => {
      const cur = gestureFor(g, kind, main), custom = !!g[kind];
      return h('div', { class: 'gesture' },
        h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, label), h('div', { class: 'sub' }, custom ? 'set for this item' : 'automatic')),
          h('select', { 'aria-label': `${label}: what it does`, onchange: (e) => set(kind, { [key]: e.target.value }) }, options.map(([v, l]) => h('option', { value: v, selected: v === cur[key] }, l))),
          custom ? h('button', { class: 'round small', 'aria-label': `${label}: back to automatic`, title: 'Back to automatic', onclick: () => reset(kind) }, icon('undo')) : null),
        cur[key] === 'steps' ? stepsEditor(g[kind]?.steps || [], main, (fn) => save((x) => { x.gestures = { ...(x.gestures || {}) }; const gk = (x.gestures[kind] = { ...(x.gestures[kind] || {}), action: 'steps' }); gk.steps = [...(gk.steps || [])]; fn(gk.steps); }))
          : cur[key] !== 'none' ? entityField(`${label} controls`, g[kind]?.entity || '', (v) => set(kind, { entity: v || '' }), null, main ? `This item (${main})` : 'Choose an entity') : null);
    };
    return [
      h('h3', {}, 'Gestures'),
      h('p', { class: 'hint' }, 'Choose what each touch does and which entity it controls — for example tap switches the whole group while hold opens just this lamp; or on a ceiling fan with a light, swipe up and down for the fan and sideways for the light.'),
      row('tap', 'Tap', TAP_ACTIONS, 'action'),
      row('hold', 'Hold', TAP_ACTIONS, 'action'),
      swipes ? row('swipeX', 'Swipe sideways', SWIPE_WHATS, 'what') : null,
      swipes ? row('swipeY', 'Swipe up and down', SWIPE_WHATS, 'what') : null,
    ];
  }

  /** Store a chosen model (on the device and in the Home Assistant folder) and return what to put on an object. */
  async keepModel(m) {
    const id = uid('m');
    await putBlob(`model/${id}`, m.blob);
    share(`model/${id}`, m.blob);
    return { id, name: m.name, source: m.source };
  }
  async useModel(o) {
    const m = await pickModel({ title: `3D model for ${o.name}` });
    if (m) await this.applyModel(o, m);
  }
  /** Give an object a model (from a library, a file or a scan): it takes the model's real size. */
  async applyModel(o, m) {
    const model = await this.keepModel(m);
    this.sel = { type: 'object', id: o.id };
    this.change((L) => {
      const ob = L.objects.find((q) => q.id === o.id), b = ob.bounds;
      ob.model = model;
      if (m.size) resizeObject(L, ob, m.size[0] / (b.max[0] - b.min[0]), m.size[1] / (b.max[1] - b.min[1]), m.size[2] / (b.max[2] - b.min[2]));
    });
  }
  /** A model with nowhere to go yet (a scan shared into the app): tap the plan to place it. */
  async placeGiven(m) {
    const model = await this.keepModel(m);
    this.placing = { id: 'model', name: m.name, cat: 'Models', size: m.size || [1, 1, 1], parts: [[0, 0, 0, 1, 1, 1, '#cfc8bd']], model };
    this.tool = 'furniture';
    this.renderPanel();
  }
  /** Furnish with a library model: choose it, then tap the plan to place it. */
  async placeModel() {
    const m = await pickModel({ title: 'Add a 3D model' });
    if (!m) return;
    const model = await this.keepModel(m);
    this.placing = { id: 'model', name: m.name, cat: 'Models', size: m.size || [1, 1, 1], parts: [[0, 0, 0, 1, 1, 1, '#cfc8bd']], model };
    this.tool = 'furniture';
    this.renderPanel();
  }
  duplicate(o) {
    const copy = structuredClone(o);
    copy.id = uid(o.kind || 'obj');
    const lights = lightsOf(this.level, o).map((l) => ({ ...structuredClone(l), id: uid('light'), fixture: copy.id }));
    this.sel = { type: 'object', id: copy.id };
    this.change((L) => { L.objects.push(copy); L.lights.push(...lights); moveObject(L, copy, 0.3, 0.3); });
  }

  // ---------- overlay ----------
  draw() {
    if (!this.active || !this.view.pxPerMetre) return;
    const v = this.view, L = this.level, o = this.overlay;
    const P = (p) => v.project(p[0], p[1], 0);
    const kids = [];
    const line = (a, b, cls) => { const [x1, y1] = P(a), [x2, y2] = P(b); kids.push(s('line', { x1, y1, x2, y2, class: cls })); };
    const poly = (pts, cls) => kids.push(s('polygon', { points: pts.map((p) => P(p).join(',')).join(' '), class: cls }));
    const dot = (p, cls, r = 7) => { const [cx, cy] = P(p); kids.push(s('circle', { cx, cy, r, class: cls })); };
    const label = (p, text, cls = 'dim', dy = -8) => { const [x, y] = P(p); kids.push(s('text', { x, y: y + dy, class: cls, 'text-anchor': 'middle' }, text)); };
    const pl = (pts, cls) => kids.push(s('polyline', { points: pts.map((p) => P(p).join(',')).join(' '), class: cls }));
    const deg = (a, b) => `${Math.round(bearing(a, b) * 10) / 10}°`;
    /** The plan symbol of a door or window (#53, #54), at `off` metres along its wall. */
    const opening = (w, op, off, cls) => {
      const t0 = off, t1 = off + op.width, th = w.thickness / 2;
      const at = (t, lat = 0) => { const q = wallAt(w, t), dd = wallDir(w, t); return [q[0] - dd[1] * lat, q[1] + dd[0] * lat]; };
      const run = (a, b, lat) => wallPoints(w, a, b).map((q, i, all) => at(a + ((b - a) * i) / (all.length - 1), lat));
      pl([at(t0, -th), at(t0, th)], cls); pl([at(t1, -th), at(t1, th)], cls);
      if (op.type === 'door' && op.style && op.style !== 'none') {
        const side = op.swing === -1 ? -1 : 1, end = op.hinge === 'end';
        const leaf = (hinge, along, width) => { // the leaf standing open, and the arc it sweeps
          const hp = at(hinge), dd = wallDir(w, hinge), pts = [];
          for (let a = 0; a <= 90; a += 15) { const r = (a * Math.PI) / 180; pts.push([hp[0] + (dd[0] * along * Math.cos(r) - dd[1] * side * Math.sin(r)) * width, hp[1] + (dd[1] * along * Math.cos(r) + dd[0] * side * Math.sin(r)) * width]); }
          pl([hp, pts.at(-1)], cls); pl(pts, cls + ' thin');
        };
        if (op.style === 'double') { leaf(t0, 1, op.width / 2); leaf(t1, -1, op.width / 2); }
        else if (op.style === 'sliding') { const a = end ? t0 + op.width * 0.85 : t0 - op.width * 0.85; pl(run(a, a + op.width, side * (th + 0.04)), cls); pl(run(t0, t1, 0), cls + ' thin'); }
        else leaf(end ? t1 : t0, end ? -1 : 1, op.width);
      } else if (op.type === 'window') { pl(run(t0, t1, -th), cls + ' thin'); pl(run(t0, t1, th), cls + ' thin'); pl(run(t0, t1, 0), cls); }
      else if (op.type === 'slider') { const m = (t0 + t1) / 2; pl(run(t0, m + 0.08, -th / 3), cls); pl(run(m - 0.08, t1, th / 3), cls); }
      else pl(run(t0, t1, 0), cls + ' thin');
    };
    // metre grid
    const w = v.canvas.clientWidth, hgt = v.canvas.clientHeight;
    const c = [v.unproject(0, 0), v.unproject(w, 0), v.unproject(w, hgt), v.unproject(0, hgt)].filter(Boolean);
    if (c.length === 4 && v.pxPerMetre > 14) {
      const b = polyBounds(c);
      for (let x = Math.floor(b.x0); x <= b.x1; x++) line([x, b.y0], [x, b.y1], x === 0 ? 'grid axis' : 'grid');
      for (let y = Math.floor(b.y0); y <= b.y1; y++) line([b.x0, y], [b.x1, y], y === 0 ? 'grid axis' : 'grid');
    }
    const item = this.selected(), d = this.drag;
    // The floor below, faintly, so a level or a roof can be lined up with it (#114, #115).
    if (!L.site) for (const B of floorBelow(this.home, L)) for (const wl of B.walls) if (wl.exterior || !B.walls.some((q) => q.exterior)) line(across(B, L, wl.a), across(B, L, wl.b), 'below');
    // The whole site: every dashboard's footprint, so it can be picked, dragged and turned.
    if (L.site) for (const x of planLevels(this.home)) {
      const on = this.sel?.type === 'place' && this.sel.id === x.id, f = this.footCorners(x, on && d?.place ? d.place : placeOf(x));
      if (!f) continue;
      poly(f, 'foot' + (on ? ' sel' : ''));
      label(centroid(f), x.name, on ? 'dim live' : 'dim', 4);
      if (on) { const t = this.turnHandle(f); line([(f[0][0] + f[1][0]) / 2, (f[0][1] + f[1][1]) / 2], t, 'sel'); dot(t, 'handle turn'); }
    }
    // Roof pieces: outline with the overhang, the walls' line inside it, and the ridge.
    for (const q0 of piecesOf(L)) {
      const on = this.sel?.type === 'piece' && this.sel.id === q0.id, q = on && d?.piece ? d.piece : q0;
      const inner = pieceCorners(q), outer = pieceCorners(q, q.overhang ?? 0.5);
      poly(outer, 'roofp' + (on ? ' sel' : '')); pl([...inner, inner[0]], 'roofp inner');
      if (q.type !== 'flat') {
        const alongX = (q.w >= q.d) !== !!q.turn, half = alongX ? q.w / 2 : q.d / 2, side = alongX ? q.d / 2 : q.w / 2, o = q.overhang ?? 0.5;
        const inset = q.type === 'hip' ? Math.min(side + o, half + o) : 0;
        const ends = q.type === 'skillion' ? [[-half - o, side + o], [half + o, side + o]] : [[-half - o + inset, 0], [half + o - inset, 0]];
        const pts = ends.map((e) => { const v = rot(alongX ? e : [e[1], e[0]], q.rot || 0); return [q.x + v[0], q.y + v[1]]; });
        line(pts[0], pts[1], 'ridge');
      }
      if (on) {
        inner.forEach((c) => dot(c, 'handle'));
        const t = this.turnHandle(inner); line([(inner[0][0] + inner[1][0]) / 2, (inner[0][1] + inner[1][1]) / 2], t, 'sel'); dot(t, 'handle turn');
        label([q.x, q.y], `${fmt(q.w)} × ${fmt(q.d)}${q.rot ? ` · ${q.rot}°` : ''}`, 'dim live', 4);
      }
    }
    if (d?.kind === 'roofRect' && d.b) {
      poly([d.a, [d.b[0], d.a[1]], d.b, [d.a[0], d.b[1]]], 'preview fill');
      label([(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], `${len(Math.abs(d.b[0] - d.a[0]))} × ${len(Math.abs(d.b[1] - d.a[1]))}`, 'dim live');
    }
    if (d?.kind === 'button' && d.moved && d.pos) { // the grid the button snaps to, around it
      const g = this.btnGrid, n = Math.max(2, Math.min(12, Math.round(1.5 / g)));
      for (let i = -n; i <= n; i++) {
        line([d.pos[0] + i * g, d.pos[1] - n * g], [d.pos[0] + i * g, d.pos[1] + n * g], 'grid snap');
        line([d.pos[0] - n * g, d.pos[1] + i * g], [d.pos[0] + n * g, d.pos[1] + i * g], 'grid snap');
      }
    }
    const showDims = this.tool === 'wall' || this.sel?.type === 'wall';
    const selOpening = this.sel?.type === 'opening' ? item : null;
    for (const wl of L.walls) {
      if ((showDims && wl !== item) || (selOpening && wl.id === this.sel.wall)) label(wallAt(wl, wallLength(wl) / 2), fmt(wallLength(wl)));
      for (const op of wl.openings || []) if (op !== selOpening) opening(wl, op, op.offset, 'open');
    }
    if (selOpening) {
      const wl = L.walls.find((q) => q.id === this.sel.wall), off = d?.kind === 'opening' && d.off != null ? d.off : selOpening.offset;
      opening(wl, selOpening, off, 'open sel');
      label(wallAt(wl, off + selOpening.width / 2), `${openingName(selOpening)} · ${fmt(selOpening.width)}`, 'dim live', -16);
      if (d?.kind === 'opening' && d.off != null) label(wallAt(wl, off / 2), fmt(off), 'dim');
    }
    for (const l of L.lights) if (l.position) dot(l.position, 'lightdot' + (l.entity ? ' linked' : ''), 5);
    for (const ob of L.objects) if (ob.entity) dot(centreOf(ob), 'lightdot linked', 5);
    if (item && this.sel.type === 'object') {
      const dx = d?.kind === 'object' ? d.dx || 0 : 0, dy = d?.kind === 'object' ? d.dy || 0 : 0;
      poly(objectCorners(item).map((p) => [p[0] + dx, p[1] + dy]), 'sel');
    } else if (item && this.sel.type === 'wall') {
      const a = d?.kind === 'wallEnd' && d.pos && d.end === 'a' ? d.pos : item.a, b = d?.kind === 'wallEnd' && d.pos && d.end === 'b' ? d.pos : item.b;
      const shown = { a, b, bulge: d?.kind === 'wallCurve' && d.bulge != null ? d.bulge : item.bulge }, mid = wallAt(shown, wallLength(shown) / 2);
      pl(wallPoints(shown), 'sel thick');
      dot(a, 'handle'); dot(b, 'handle'); dot(mid, 'handle curve', 5);
      // its length and angle: tap either to type it
      label(mid, fmt(dist(a, b)), 'dim live', -12);
      label(mid, shown.bulge ? `curve ${fmt(shown.bulge)}` : deg(a, b), 'dim live', 24);
    } else if (item && this.sel.type === 'room') {
      poly(item.polygon, 'sel room');
      item.polygon.forEach((p, i) => {
        const q = item.polygon[(i + 1) % item.polygon.length], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        dot(p, 'handle' + (i === this.vertex ? ' picked' : ''));
        if (!d) { dot(m, 'handle add', 6); const [x, y] = P(m); kids.push(s('text', { x, y: y + 4, class: 'plus', 'text-anchor': 'middle' }, '+')); }
        label(m, fmt(dist(p, q)), 'dim', -12);
      });
    } else if (item && this.sel.type === 'button' && item.at && !item.dock) dot(d?.kind === 'button' && d.pos ? d.pos : item.at, 'sel', 30);
    else if (item && this.sel.type === 'light' && item.position) dot(d?.kind === 'light' && d.pos ? d.pos : item.position, 'handle');
    if (this.tool === 'wall' && this.wall.start) {
      dot(this.wall.start, 'handle');
      if (this.cursor && d?.kind !== 'wallDraw') { const q = this.wallEnd(this.wall.start, this.cursor); line(this.wall.start, q, 'preview'); label([(this.wall.start[0] + q[0]) / 2, (this.wall.start[1] + q[1]) / 2], `${fmt(dist(this.wall.start, q))} · ${deg(this.wall.start, q)}`, 'dim live'); }
    }
    if (d?.kind === 'wallDraw' && d.moved && d.b) {
      dot(d.a, 'handle');
      line(d.a, d.b, 'preview');
      label([(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], `${fmt(dist(d.a, d.b))} · ${deg(d.a, d.b)}`, 'dim live');
    }
    if (this.area) { // an area being tapped out
      const pts = this.cursor && this.tool === 'room' ? [...this.area, this.snapPoint(this.cursor)] : this.area;
      pl(pts, 'preview');
      this.area.forEach((q, i) => dot(q, 'handle' + (i === 0 ? ' picked' : '')));
    }
    if (d?.kind === 'room' && d.b) {
      poly([d.a, [d.b[0], d.a[1]], d.b, [d.a[0], d.b[1]]], 'preview fill');
      label([(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2], `${len(Math.abs(d.b[0] - d.a[0]))} × ${len(Math.abs(d.b[1] - d.a[1]))}`, 'dim live');
    }
    o.replaceChildren(...kids);
  }

  // ---------- panel ----------
  renderPanel() {
    if (!this.active) return;
    const tools = [['wall', 'wall', 'Wall'], ['room', 'room', 'Area'], ['door', 'door', 'Door'], ['window', 'window', 'Window'], ['furniture', 'sofa', 'Furnish'], ['button', 'target', 'Button'], ...(this.level?.site ? [] : [['roof', 'roof', 'Roof']])];
    // Plan | Widgets (#94): what the panel is editing. Not while an area is selected (the panel is then that
    // room's), unless that area is where this device starts.
    const picked = this.tool === 'select' ? this.selected() : null;
    const tabs = this.tool === 'select' && (!picked || (this.sel?.type === 'room' && this.ctx.startsHere?.(picked.id)));
    if (!tabs) this.panelTab = 'plan';
    const widgets = tabs && this.panelTab === 'widgets';
    const body = h('div', { class: 'panel-body editor' },
      tabs ? h('div', { class: 'edit-tabs' }, seg([['plan', 'Plan'], ['widgets', 'Widgets']], this.panelTab || 'plan', (v) => { this.panelTab = v; this.renderPanel(); })) : null,
      h('div', { class: 'panel-head' }, h('h2', {}, widgets ? 'Widget panel' : 'Design'),
        widgets ? null : h('button', { class: 'round small' + (this.tool === 'select' ? ' on' : ''), 'aria-label': 'Select', title: 'Select', 'aria-pressed': String(this.tool === 'select'), onclick: () => { this.tool = 'select'; this.wall.start = null; this.placing = null; this.area = null; this.renderPanel(); this.draw(); } }, icon('cursor')),
        h('button', { class: 'round small', 'aria-label': 'Undo', disabled: !canUndo(), onclick: () => this.undo() }, icon('undo')),
        h('button', { class: 'round small', 'aria-label': 'Redo', disabled: !canRedo(), onclick: () => this.redo() }, icon('redo'))),
      widgets ? null : h('div', { class: 'toolbar' }, tools.map(([id, ic, label]) => h('button', { class: 'tool' + (this.tool === id ? ' on' : ''), 'aria-pressed': this.tool === id ? 'true' : 'false', onclick: () => { this.tool = id; this.wall.start = null; this.placing = null; this.area = null; if (id !== 'select') this.sel = null; this.renderPanel(); this.draw(); } }, icon(ic), h('span', {}, label)))),
      widgets ? this.widgetsTab() : this.toolPanel());
    this.panel.replaceChildren(body);
    if (this.focus) { // asked for by tapping a wall's length or angle on the plan
      const want = this.focus, field = [...body.querySelectorAll('label.field')].find((l) => l.firstElementChild?.textContent === want)?.querySelector('input');
      this.focus = null;
      if (field) { field.scrollIntoView({ block: 'center' }); field.focus(); field.select(); }
    }
  }

  toolPanel() {
    const t = this.tool;
    if (t === 'wall') return this.wallPanel();
    if (t === 'room') return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, this.area
        ? `${this.area.length} point${this.area.length === 1 ? '' : 's'} so far. Keep tapping to add points; tap the first point (or Finish) to close the area.`
        : 'An area is a part of the home you tap to zoom in and see its controls. Make one for each room, or for any single spot you want as its own place to control.'),
      this.area ? h('div', { class: 'btns' },
        h('button', { class: 'wide', disabled: this.area.length < 3, onclick: () => this.addArea(this.area) }, icon('check'), 'Finish area'),
        h('button', { class: 'wide ghost', onclick: () => { this.area = null; this.renderPanel(); this.draw(); } }, 'Cancel')) : null,
      null);
    if (t === 'door' || t === 'window') return h('div', { class: 'stack' },
      h('div', { class: 'seg wrap' }, stylesFor(t).map(([v, l]) => h('button', { class: v === this.openStyle[t] ? 'on' : '', onclick: () => { this.openStyle[t] = v; this.renderPanel(); } }, l))));
    if (t === 'furniture') return this.furniturePanel();
    if (t === 'roof') return this.roofToolPanel();
    if (t === 'button') return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, 'A button controls any Home Assistant entity: a fan, heater, air conditioner, blind, scene, script… Tap the plan where it should sit (for example in the room it belongs to), then choose what it controls.'),
      this.gridSeg(),
      h('button', { class: 'wide', onclick: () => this.addButton(null) }, icon('plus'), 'Add a button beside the plan'),
      h('div', { class: 'sub' }, 'View buttons (turn the view, go to the home view):'),
      h('div', { class: 'btns' }, [['left', 'rotateL', 'Turn left'], ['right', 'rotate', 'Turn right'], ['home', 'compass', 'Home view']].map(([v, ic, name]) =>
        h('button', { class: 'wide ghost', onclick: () => { const id = uid('btn'); this.tool = 'select'; this.sel = { type: 'button', id }; this.change((L) => (L.buttons ||= []).push({ id, view: v, name, dock: true })); } }, icon(ic), name))),
      this.screenGridSeg(),
      h('p', { class: 'hint' }, 'Buttons beside the plan suit things for the whole floor, such as underfloor heating. For your own drop-down menus use More → Customise menus.'));
    const item = this.selected();
    if (!item) return this.levelPanel();
    return { object: () => this.objectPanel(item), wall: () => this.wallInspector(item), opening: () => this.openingInspector(item, this.level.walls.find((w) => w.id === this.sel.wall)), room: () => this.roomInspector(item), light: () => this.lightInspector(item), button: () => this.buttonInspector(item), piece: () => this.pieceInspector(item), place: () => this.placeInspector(item) }[this.sel.type]();
  }

  wallTypeSeg() {
    return h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Wall type'),
      seg([[true, 'Outside 20 cm'], [false, 'Inside 10 cm']], this.wall.exterior, (v) => { this.wall.exterior = v; this.renderPanel(); }));
  }
  /** The Wall tool (#110): draw on the plan, or choose a shape and give its exact measurements. */
  wallPanel() {
    const w = this.wall, shape = (this.wallShape ||= 'straight');
    const m = (this.wallSize ||= { length: 3, width: 3, radius: 2, arc: 3, diameter: 3 });
    const num = (label, key, opts = {}) => numField(label, m[key], (v) => (m[key] = v), { min: 0.1, max: 100, step: 0.1, ...opts });
    const fields = {
      straight: [num('Length', 'length')],
      square: [h('div', { class: 'fields' }, num('Length', 'length'), num('Width', 'width'))],
      round: [h('div', { class: 'fields' }, num('Radius', 'radius'), num('Length along the curve', 'arc'))],
      circle: [num('Inner diameter', 'diameter')],
    }[shape];
    return h('div', { class: 'stack' },
      seg([['straight', 'Straight'], ['square', 'Square'], ['round', 'Round'], ['circle', 'Circle']], shape, (v) => { this.wallShape = v; this.renderPanel(); }),
      ...fields,
      h('button', { class: 'wide primary', onclick: () => this.addShape() }, icon('plus'), { straight: 'Add wall', square: 'Add square', round: 'Add curved wall', circle: 'Add circle' }[shape]),
      this.wallTypeSeg(),
      w.start ? h('div', { class: 'btns' },
        h('button', { class: 'wide', onclick: () => { w.start = null; this.renderPanel(); this.draw(); } }, icon('check'), 'Finish'),
        w.first && dist(w.first, w.start) > 0.05 ? h('button', { class: 'wide', onclick: () => this.addWall(w.start, w.first) }, 'Close shape') : null) : null);
  }
  /** Which floor of the home this dashboard is, and whether it is a roof (#115, #114). */
  floorFields() {
    const L = this.level;
    return h('div', { class: 'stack' },
      this.floorSelect(L, (f) => this.change((lv) => (lv.floor = f))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!L.roof, onchange: (e) => this.change((lv) => { if (e.target.checked) lv.roof = true; else delete lv.roof; }) }),
        'This dashboard is a roof (nothing to walk in under it)'));
  }
  /** The whole-site dashboard (#115): its floors, the dashboards on each, and where each one stands. */
  sitePanel() {
    const home = this.home, floors = floorsOf(home).filter((F) => F.levels.length);
    const setHeight = (f, v) => this.change(() => { const fh = (this.home.floorHeights ||= {}); if (v == null) delete fh[f]; else fh[f] = v; });
    return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, 'Every plan dashboard stands on a floor. Tap one on the plan to select it, drag it into place (its outside corners catch on the floor below) and turn it with its round handle. Draw lawn, paving and the pool here as areas, fences with the Wall tool, and outdoor things from Furnish.'),
      floors.map((F) => h('div', { class: 'site-building' },
        h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, floorName(F.floor)), h('div', { class: 'sub' }, `${fmt(F.z)} above the ground`))),
        F.floor ? h('div', { class: 'fields' },
          numField('Height', F.z, (v) => setHeight(F.floor, v), { min: 0, max: 200, step: 0.05 }),
          home.floorHeights?.[F.floor] != null ? h('button', { class: 'chip small', onclick: () => setHeight(F.floor, null) }, 'Automatic') : null) : null,
        F.levels.map((x) => h('div', { class: 'row' },
          h('button', { class: 'row-label link', onclick: () => this.select({ type: 'place', id: x.id }) }, h('div', {}, x.name), h('div', { class: 'sub' }, x.roof ? 'roof' : `${x.walls.length} walls`)),
          h('button', { class: 'chip small', onclick: () => this.ctx.openLevel?.(x.id) }, icon('edit'), 'Open'))))),
      h('p', { class: 'hint' }, 'Add a level or a roof under the home in the dashboard list (edit mode).'));
  }
  /** Add the chosen shape from the last corner (or 0, 0). Straight and Round go east; turn them afterwards with the wall's Angle. */
  addShape() {
    const w = this.wall, m = this.wallSize, from = w.start || [0, 0], R = round;
    const wall = (a, b, bulge) => ({ id: uid('w'), a: [R(a[0]), R(a[1])], b: [R(b[0]), R(b[1])], thickness: w.exterior ? 0.2 : 0.1, exterior: w.exterior, openings: [], ...(bulge ? { bulge: R(bulge) } : {}) });
    const list = [];
    if (this.wallShape === 'square') {
      const [x, y] = from, L = m.length, W = m.width;
      list.push(wall([x, y], [x + L, y]), wall([x + L, y], [x + L, y + W]), wall([x + L, y + W], [x, y + W]), wall([x, y + W], [x, y]));
    } else if (this.wallShape === 'round') {
      // An arc of the given radius and length along the curve, as one curved wall (at most a half circle).
      const r = m.radius, th = Math.min(m.arc / r, Math.PI), chord = 2 * r * Math.sin(th / 2), sag = r * (1 - Math.cos(th / 2));
      list.push(wall(from, [from[0] + chord, from[1]], sag));
    } else if (this.wallShape === 'circle') {
      // Two half circles; the wall's centre line sits half a wall outside the inner diameter.
      const t = w.exterior ? 0.2 : 0.1, r = m.diameter / 2 + t / 2, c = [from[0] + r, from[1] + r];
      list.push(wall([c[0] - r, c[1]], [c[0] + r, c[1]], r), wall([c[0] + r, c[1]], [c[0] - r, c[1]], r));
    } else {
      if (!w.start) w.first = from;
      return this.addWallByLength('e', m.length);
    }
    this.change((L) => { for (const x of list) L.walls.push({ ...x, height: L.ceilingHeight || 2.4 }); });
    w.start = null;
    this.view.bounds = null;
    this.refit();
    this.renderPanel();
  }

  furniturePanel() {
    return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, this.placing ? `Tap the plan to place the ${this.placing.name.toLowerCase()}.` : 'Choose something, then tap the plan to place it.'),
      h('button', { class: 'wide', onclick: () => this.placeModel() }, icon('cube'), 'Realistic 3D models…'),
      h('div', { class: 'cats' }, [...CATEGORIES, MY_CAT].map((c) => h('button', { class: 'chip small' + (c === this.cat ? ' on' : ''), onclick: () => { this.cat = c; this.renderPanel(); } }, c))),
      this.cat === MY_CAT ? h('div', { class: 'btns' },
        h('button', { class: 'wide', onclick: () => this.makeModel(blankDraft()) }, icon('plus'), 'New model'),
        h('button', { class: 'wide', onclick: () => this.pickStart() }, icon('copy'), 'Start from a piece')) : null,
      this.cat === MY_CAT && !this.myItems().length ? h('p', { class: 'hint' }, 'Nothing here yet. Make a model from boxes and cylinders, start from a built-in piece, or choose "Save as my model" on something already placed. Your models are kept in this home, on every device it is shared with.') : null,
      h('div', { class: 'catalog' }, this.itemsIn(this.cat).map((i) => this.catItem(i, this.placing?.id === i.id, () => { this.placing = i; this.renderPanel(); }, 'Place it',
        i.cat === MY_CAT ? h('button', { class: 'round small cat-edit', 'aria-label': `Change ${i.name} in the model maker`, title: 'Change this model', onclick: () => this.editModel(i) }, icon('edit')) : null))));
  }
  /** One catalogue item: its picture (tap it to see it bigger) and its name (tap to choose it). */
  catItem(i, on, pick, action, extra = null) {
    const pic = thumb(i);
    return h('div', { class: 'cat-item' + (on ? ' on' : '') },
      h('button', { class: 'thumb', 'aria-label': `See the ${i.name.toLowerCase()} bigger`, title: 'See it bigger', onclick: () => this.showItem(i, pick, action) },
        pic ? h('img', { src: pic, alt: '', width: 56, height: 56 }) : h('span', { class: 'swatch', style: `background:${i.parts.at(-1)[6]}` })),
      h('button', { class: 'cat-pick', onclick: pick }, h('span', { class: 'grow' }, i.name, h('span', { class: 'sub' }, `${len(i.size[0])} × ${len(i.size[1])}${i.light ? ' · light' : ''}`))),
      extra);
  }
  showItem(i, pick, action) {
    const pic = thumb(i, 300);
    const close = modal(h('div', { class: 'menu item-preview' },
      h('div', { class: 'panel-head' }, h('h2', {}, i.name), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      pic ? h('img', { src: pic, alt: `What the ${i.name.toLowerCase()} looks like`, width: 300, height: 300 }) : null,
      h('p', { class: 'hint' }, `${len(i.size[0])} wide · ${len(i.size[1])} deep · ${len(i.size[2])} high${i.light ? ' · can be a light' : ''}. Size and colours can be changed after it is placed.`),
      h('button', { class: 'wide primary', onclick: () => { close(); pick(); } }, icon('check'), action),
      i.cat === MY_CAT ? h('button', { class: 'wide', onclick: () => { close(); this.editModel(i); } }, icon('edit'), 'Change this model') : null,
      i.cat === MY_CAT ? h('button', { class: 'wide ghost danger', onclick: () => { close(); this.removeModel(i); } }, icon('trash'), 'Remove from My models') : null));
  }

  // ---------- My models: furniture of your own, kept in the home file ----------
  myItems() { return cleanCatalog(this.home.catalog); }
  allItems() { return [...CATALOG, ...this.myItems()]; }
  itemsIn(cat) { return cat === MY_CAT ? this.myItems() : CATALOG.filter((i) => i.cat === cat); }
  /** Save a placed piece as a model of your own. `update`: it is a copy of one already; change that model and every placed copy. */
  saveAsModel(o, update = false) {
    const old = update ? this.myItems().find((i) => i.id === o.kind) : null;
    const name = old ? old.name : prompt('Name of your model', o.name)?.trim();
    if (!name) return;
    const item = itemFromObject(o, name, lightsOf(this.level, o).find((l) => l.position), old?.id, (old?.rev || 0) + 1);
    if (!item) return void alert('This piece cannot be saved as a model.');
    this.change((L) => {
      const list = cleanCatalog(this.home.catalog), i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      this.home.catalog = list;
      if (old) { for (const { L: lv, o: ob } of copiesOf(this.home, item.id)) if (ob.id !== o.id) refitCopy(lv, ob, item, old); }
      else L.objects.find((q) => q.id === o.id).kind = item.id; // the piece it was made from is its first copy
    });
  }
  /** Open the model maker. `old`: the model being changed (saving updates it and every placed copy). */
  makeModel(draft, old = null) {
    openModelMaker({
      draft, id: old?.id, rev: (old?.rev || 0) + 1, title: old ? `Change "${old.name}"` : 'New model',
      onSave: (item) => {
        this.change(() => {
          const list = cleanCatalog(this.home.catalog), i = list.findIndex((x) => x.id === item.id);
          if (i >= 0) list[i] = item; else list.push(item);
          this.home.catalog = list;
          if (old) for (const { L, o } of copiesOf(this.home, item.id)) refitCopy(L, o, item, old);
        });
        if (!old && this.tool === 'furniture') { this.cat = MY_CAT; this.placing = item; this.renderPanel(); }
        const n = old ? copiesOf(this.home, item.id).length : 0;
        toast(old ? `"${item.name}" saved${n ? `, and ${n} placed cop${n === 1 ? 'y' : 'ies'} updated` : ''}.` : `"${item.name}" saved. Tap the plan to place it.`);
      },
    });
  }
  editModel(item) { this.makeModel(toDraft(item), item); }
  /** Start a new model from a built-in piece. */
  pickStart() {
    let cat = this.cat === MY_CAT ? CATEGORIES[0] : this.cat;
    const body = h('div', { class: 'menu' }), close = modal(body);
    const draw = () => body.replaceChildren(...nodes(
      h('div', { class: 'panel-head' }, h('h2', {}, 'Start from a built-in piece'), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
      h('p', { class: 'hint' }, 'You get a copy to change. The built-in piece stays as it is.'),
      h('div', { class: 'cats' }, CATEGORIES.map((c) => h('button', { class: 'chip small' + (c === cat ? ' on' : ''), onclick: () => { cat = c; draw(); } }, c))),
      h('div', { class: 'look-list' }, CATALOG.filter((i) => i.cat === cat).map((i) => this.catItem(i, false, () => { close(); this.makeModel({ ...toDraft(i), name: `My ${i.name.toLowerCase()}` }); }, 'Start from this')))));
    draw();
  }
  removeModel(item) {
    if (!confirm(`Remove "${item.name}" from My models? Pieces already placed stay as they are.`)) return;
    if (this.placing?.id === item.id) this.placing = null;
    this.change(() => { this.home.catalog = cleanCatalog(this.home.catalog).filter((x) => x.id !== item.id); });
  }

  levelPanel() {
    const home = this.home, L = this.level;
    return h('div', { class: 'stack' },
      this.ctx.startButton?.(null),
      h('p', { class: 'hint' }, L.walls.length + L.rooms.length + L.objects.length ? 'Tap something on the plan to edit it. Tap again to reach what is underneath. Drag empty space to move the view.' : 'This level is empty. Start with the Wall or Area tool.'),
      textField('Level name', L.name, (v) => v && this.change((lv) => (lv.name = v))),
      L.site ? null : numField('Ceiling height', L.ceilingHeight || 2.4, (v) => this.change((lv) => (lv.ceilingHeight = v)), { min: 1.8, max: 6, step: 0.05 }),
      L.site ? this.sitePanel() : this.floorFields(),
      h('div', { class: 'btns' },
        h('button', { class: 'wide', onclick: () => this.refit() }, icon('expand'), 'Fit view'),
        h('button', { class: 'wide', onclick: () => this.ctx.addLevel(false) }, icon('layers'), 'Add level')),
      h('div', { class: 'btns' },
        h('button', { class: 'wide ghost', onclick: () => this.ctx.addLevel(true) }, icon('copy'), 'New level from these walls'),
        home.levels.length > 1 ? h('button', { class: 'wide ghost danger', onclick: () => this.ctx.deleteLevel() }, icon('trash'), 'Delete level') : null),
      h('div', { class: 'msep' }),
      h('h3', {}, 'Whole home'),
      textField('Home name', home.name, (v) => v && this.change(() => (this.home.name = v))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!L.private, onchange: (e) => this.change((lv) => { if (e.target.checked) lv.private = true; else delete lv.private; }) }), 'Only I see this floor plan (not shared with the home)'),
      h('p', { class: 'hint' }, 'Your own menus and shortcuts: More → Settings → Customise menus. Buttons for a room or the whole floor: the Button tool above.'));
  }

  objectPanel(o) {
    const L = this.level, b = o.bounds;
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const edit = (fn) => this.change((lv) => fn(lv, lv.objects.find((q) => q.id === o.id)));
    const mv = (dx, dy) => edit((lv, ob) => moveObject(lv, ob, dx * this.step, dy * this.step));
    const arrow = (ic, dx, dy, label) => h('button', { class: 'round', 'aria-label': `Move ${label}`, onclick: () => mv(dx, dy) }, icon(ic));
    const colours = [...new Set(o.parts.map((p) => p.color))];
    const lights = lightsOf(L, o);
    return h('div', { class: 'stack' },
      textField('Name', o.name, (v) => edit((lv, ob) => (ob.name = v))),
      h('div', { class: 'movepad' },
        h('div', { class: 'dpad' }, arrow('up', 0, -1, 'north'), h('div', {}, arrow('left', -1, 0, 'west'), arrow('chevron', 1, 0, 'east')), arrow('down', 0, 1, 'south')),
        h('div', { class: 'stack' },
          seg(imperial() ? [[0.0127, '½″'], [0.0508, '2″'], [0.3048, '1′']] : [[0.01, '1 cm'], [0.05, '5 cm'], [0.25, '25 cm']], this.step, (v) => { this.step = v; this.renderPanel(); }),
          h('div', { class: 'btns' },
            h('button', { class: 'wide', 'aria-label': 'Rotate left 22.5 degrees', onclick: () => edit((lv, ob) => rotateObject(lv, ob, -22.5)) }, icon('rotateL'), '22.5°'),
            h('button', { class: 'wide', 'aria-label': 'Rotate right 22.5 degrees', onclick: () => edit((lv, ob) => rotateObject(lv, ob, 22.5)) }, icon('rotate'), '22.5°')),
          h('div', { class: 'btns' },
            h('button', { class: 'wide', 'aria-label': 'Smaller', onclick: () => edit((lv, ob) => resizeObject(lv, ob, 1 / 1.1, 1 / 1.1, 1 / 1.1)) }, icon('minus'), 'Size'),
            h('button', { class: 'wide', 'aria-label': 'Bigger', onclick: () => edit((lv, ob) => resizeObject(lv, ob, 1.1, 1.1, 1.1)) }, icon('plus'), 'Size')))),
      h('div', { class: 'fields' },
        numField('Width', size[0], (v) => edit((lv, ob) => resizeObject(lv, ob, v / size[0], 1, 1)), { min: 0.02, max: 50 }),
        numField('Depth', size[1], (v) => edit((lv, ob) => resizeObject(lv, ob, 1, v / size[1], 1)), { min: 0.02, max: 50 }),
        numField('Height', size[2], (v) => edit((lv, ob) => resizeObject(lv, ob, 1, 1, v / size[2])), { min: 0.01, max: 10 }),
        numField('Off floor', b.min[2], (v) => edit((lv, ob) => moveObject(lv, ob, 0, 0, v - b.min[2])), { min: -5, max: 10 }),
        numField('Angle', o.rotation || 0, (v) => edit((lv, ob) => rotateObject(lv, ob, v - (ob.rotation || 0))), { min: 0, max: 360, step: 22.5, unit: '°' })),
      /^sofa-chaise-[lr]$/.test(o.kind || '')
        ? h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Chaise on the'),
          seg([['l', 'Left'], ['r', 'Right']], o.kind.at(-1), (v) => v !== o.kind.at(-1) && edit((lv, ob) => { mirrorObject(lv, ob); ob.kind = `sofa-chaise-${v}`; })))
        : h('button', { class: 'wide ghost', onclick: () => edit((lv, ob) => mirrorObject(lv, ob)) }, icon('rotate'), 'Flip left ↔ right'),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Colours'),
        colours.map((c) => h('span', { class: 'colbtn' }, h('input', { type: 'color', value: c, 'aria-label': 'Colour', onchange: (e) => edit((lv, ob) => { for (const p of ob.parts) if (p.color === c) p.color = e.target.value; }) })))),
      o.model ? null : (() => {
        const mine = this.myItems().find((i) => i.id === o.kind), others = mine ? copiesOf(this.home, mine.id).length - 1 : 0;
        return mine
          ? h('div', { class: 'stack' }, h('button', { class: 'wide ghost', onclick: () => this.editModel(mine) }, icon('edit'), `Change "${mine.name}" in the model maker`), h('div', { class: 'btns' },
            h('button', { class: 'wide ghost', onclick: () => this.saveAsModel(o, true) }, icon('cube'), others ? `Update "${mine.name}" and ${others} other cop${others === 1 ? 'y' : 'ies'}` : `Update "${mine.name}"`),
            h('button', { class: 'wide ghost', onclick: () => this.saveAsModel(o) }, icon('plus'), 'Save as a new model')))
          : h('button', { class: 'wide ghost', onclick: () => this.saveAsModel(o) }, icon('cube'), 'Save as my model');
      })(),
      h('div', { class: 'msep' }),
      h('h3', {}, 'Make it yours'),
      o.photo
        ? [h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, 'Covered with your photo'), h('div', { class: 'sub' }, o.photo.mode === 'tile' ? 'repeated like fabric or timber' : 'shown once, like a picture or rug')),
            seg([['fit', 'Once'], ['tile', 'Repeat']], o.photo.mode || 'fit', (v) => edit((lv, ob) => (ob.photo.mode = v)))),
          o.photo.mode === 'tile' ? numField('One photo covers', o.photo.size || 0.5, (v) => edit((lv, ob) => (ob.photo.size = v)), { min: 0.05, max: 10 }) : null,
          h('button', { class: 'wide ghost danger', onclick: () => edit((lv, ob) => delete ob.photo) }, icon('trash'), 'Remove photo')]
        : [h('p', { class: 'hint' }, 'Photograph the real thing — the sofa fabric, the rug, a painting, the bench top — and wrap it on this shape.'),
          this.photoButtons((id) => edit((lv, ob) => (ob.photo = { id, mode: size[2] < 0.06 || size[1] < 0.08 || /tv|artwork|rug/.test(ob.kind || '') ? 'fit' : 'tile', size: 0.5 })))],
      o.model
        ? h('button', { class: 'wide ghost danger', onclick: () => { delBlob(`model/${o.model.id}`); edit((lv, ob) => delete ob.model); } }, icon('trash'), `Remove 3D model (${o.model.name || 'model'})`)
        : [h('button', { class: 'wide ghost', onclick: () => this.useModel(o) }, icon('cube'), 'Use a 3D model'),
          this.ctx.experimental?.() ? h('button', { class: 'wide ghost', onclick: () => this.ctx.scan(o) }, icon('camera'), 'Scan the real one (Scaniverse, experimental)') : null,
          h('p', { class: 'hint' }, 'Pick a realistic model from a library, or a .glb scan of your own piece. The item takes the model\'s real size and keeps its name, entity and place.')],
      h('div', { class: 'msep' }),
      lights.length
        ? lights.map((l) => [
          entityField(lights.length > 1 ? `Light: ${l.name}` : 'Light entity (its glow on the plan)', l.entity, (v) => this.change((lv) => (lv.lights.find((q) => q.id === l.id).entity = v)), ['light', 'switch']),
          textField('Name in the room panel', l.name, (v) => this.change((lv) => (lv.lights.find((q) => q.id === l.id).name = v))),
          l.entity ? this.dotRow(l.dot, 'light', (v) => this.change((lv) => { const x = lv.lights.find((q) => q.id === l.id); if (v) x.dot = v; else delete x.dot; })) : null]).concat([
          h('button', { class: 'wide ghost', onclick: () => this.change((lv) => { const ob = lv.objects.find((q) => q.id === o.id); const first = lv.lights.find((q) => q.fixture === o.id); if (first?.entity && !ob.entity) ob.entity = first.entity; lv.lights = lv.lights.filter((q) => q.fixture !== o.id); }) }, icon('bulb'), 'Stop being a light (keep its entity)')])
        : [
          entityField('Entity (tap toggles, hold for details)', o.entity || '', (v) => edit((lv, ob) => (v ? (ob.entity = v) : delete ob.entity))),
          o.entity ? this.dotRow(o.dot, dotKindOf(o.entity), (v) => edit((lv, ob) => { if (v) ob.dot = v; else delete ob.dot; })) : null,
          h('button', { class: 'wide ghost', onclick: () => this.change((lv) => lv.lights.push({ id: uid('light'), name: o.name, room: o.room, fixture: o.id, position: [...centreOf(o), round(b.max[2])], entity: o.entity || '', dimmable: true })) }, icon('bulb'), 'Make this a light (glows, dims)')],
      h('div', { class: 'msep' }),
      this.gesturesPanel(o, lights[0]?.entity || o.entity || '', (fn) => edit((lv, ob) => fn(ob))),
      h('div', { class: 'msep' }),
      h('button', { class: 'wide', onclick: () => this.chooseLook(o) }, icon('sofa'), 'Change how it looks'),
      h('div', { class: 'btns' },
        h('button', { class: 'wide', onclick: () => this.duplicate(o) }, icon('copy'), 'Duplicate'),
        h('button', { class: 'wide danger', onclick: () => this.deleteSelection() }, icon('trash'), 'Delete')));
  }

  /** Which face of a wall is which (#129): for an outside wall, the face away from the middle of the home is
   *  Outside; for an inside wall, each face is named after the room it looks into. Faces: r (right of a→b), l. */
  wallFaces(w) {
    const L = this.level, mid = wallAt(w, wallLength(w) / 2), d = wallDir(w, wallLength(w) / 2), right = [-d[1], d[0]];
    const probe = (k) => [mid[0] + right[0] * k * (w.thickness / 2 + 0.25), mid[1] + right[1] * k * (w.thickness / 2 + 0.25)];
    const roomAt = (p) => L.rooms.find((r) => !r.outdoor && pointInPoly(p, r.polygon))?.name;
    if (w.exterior) {
      const ext = L.walls.filter((q) => q.exterior).flatMap((q) => [q.a, q.b]), c = ext.length ? [ext.reduce((a, q) => a + q[0], 0) / ext.length, ext.reduce((a, q) => a + q[1], 0) / ext.length] : mid;
      const rightOut = (mid[0] - c[0]) * right[0] + (mid[1] - c[1]) * right[1] > 0;
      return rightOut ? [['r', 'Outside'], ['l', 'Inside']] : [['l', 'Outside'], ['r', 'Inside']];
    }
    return [['r', roomAt(probe(1)) ? `Facing ${roomAt(probe(1))}` : 'One side'], ['l', roomAt(probe(-1)) ? `Facing ${roomAt(probe(-1))}` : 'Other side']];
  }
  /** Finishes of the two faces of a wall, each with "apply to" (#129). */
  finishPanel(w) {
    const faces = this.wallFaces(w), sides = w.sides || {};
    const setFace = (k, v) => this.change((lv) => { const x = lv.walls.find((q) => q.id === w.id); x.sides = { ...(x.sides || {}), [k]: { ...(x.sides?.[k] || {}), ...v } }; });
    const applyTo = (k, label, scope) => {
      const val = structuredClone(sides[k] || { finish: 'paint' });
      this.change((lv) => {
        for (const x of lv.walls) {
          if (scope === 'outside' && !x.exterior) continue;
          if (scope === 'room') {
            const near = this.facesOf(lv, x).filter(([, name]) => name === label);
            for (const [kk] of near) x.sides = { ...(x.sides || {}), [kk]: structuredClone(val) };
            continue;
          }
          const f = this.facesOf(lv, x).find(([, name]) => name === 'Outside');
          if (f) x.sides = { ...(x.sides || {}), [f[0]]: structuredClone(val) };
        }
      });
      toast(scope === 'outside' ? 'Every outside wall now has this finish outside.' : `Every wall of ${label.replace('Facing ', '')} now has this finish.`);
    };
    return h('details', { class: 'finishes', open: !!w.sides },
      h('summary', {}, 'Finishes', h('span', { class: 'sub' }, faces.map(([k]) => finishName(sides[k]?.finish)).join(' · '))),
      faces.map(([k, label]) => {
        const sd = sides[k] || {}, f = sd.finish || 'paint', def = FINISHES.find((x) => x[0] === f);
        return h('div', { class: 'stack face' },
          h('div', { class: 'sub' }, label),
          h('label', { class: 'field wide-field' }, h('span', {}, 'Finish'),
            h('select', { onchange: (e) => setFace(k, { finish: e.target.value, color: SWATCHES[e.target.value]?.[0] }) }, FINISHES.map(([id, name]) => h('option', { value: id, selected: id === f }, name)))),
          def?.[3] !== false || SWATCHES[f]?.length > 1 ? h('div', { class: 'swatches' },
            (SWATCHES[f] || []).map((c) => h('button', { class: 'swatch-btn' + (c === finishColor(sd) ? ' on' : ''), style: `background:${c}`, 'aria-label': `Colour ${c}`, onclick: () => setFace(k, { finish: f, color: c }) })),
            h('span', { class: 'colbtn' }, h('input', { type: 'color', value: finishColor(sd), 'aria-label': 'Any colour', onchange: (e) => setFace(k, { finish: f, color: e.target.value }) }))) : null,
          h('div', { class: 'btns' },
            label === 'Outside' ? h('button', { class: 'wide ghost', onclick: () => applyTo(k, label, 'outside') }, 'Use on every outside wall') : null,
            label.startsWith('Facing ') || label === 'Inside' ? h('button', { class: 'wide ghost', onclick: () => applyTo(k, label === 'Inside' ? this.insideName(w, k) : label, 'room') }, label === 'Inside' ? 'Use on this room\'s walls' : `Use on every wall of ${label.replace('Facing ', '')}`) : null));
      }));
  }
  /** Faces of any wall of a level, named as wallFaces names them (used to apply a finish to many walls). */
  facesOf(lv, x) { const as = { level: lv }; return this.wallFaces.call(as, x).map(([k, name]) => [k, name === 'Inside' ? this.insideName.call(as, x, k) : name]); }
  /** The room an outside wall's inside face looks into, as "Facing <room>". */
  insideName(w, k) {
    const L = this.level, mid = wallAt(w, wallLength(w) / 2), d = wallDir(w, wallLength(w) / 2), s = k === 'r' ? 1 : -1;
    const p = [mid[0] - d[1] * s * (w.thickness / 2 + 0.25), mid[1] + d[0] * s * (w.thickness / 2 + 0.25)];
    const r = L.rooms.find((q) => !q.outdoor && pointInPoly(p, q.polygon));
    return r ? `Facing ${r.name}` : 'Inside';
  }
  wallInspector(w) {
    const len = dist(w.a, w.b), run = wallLength(w);
    const edit = (fn) => this.change((lv) => fn(lv.walls.find((q) => q.id === w.id)));
    const add = (k) => { const d = OPENINGS[k], width = Math.min(d.width, run - 0.1), oid = uid('o'); this.sel = { type: 'opening', id: oid, wall: w.id }; edit((x) => x.openings.push({ id: oid, type: k, ...(d.style ? { style: this.openStyle[k] || d.style } : {}), offset: round(Math.max(0, (run - width) / 2)), width: round(width), sill: d.sill, head: Math.min(d.head, x.height) })); };
    return h('div', { class: 'stack' },
      h('h3', {}, w.name || 'Wall'),
      h('div', { class: 'fields' },
        numField('Length', len, (v) => this.setWall(w, { len: v }), { min: 0.1, max: 200 }),
        numField('Angle', Math.round(bearing(w.a, w.b) * 10) / 10, (v) => this.setWall(w, { angle: v }), { min: 0, max: 360, step: 1, unit: '°' }),
        numField('Curve', w.bulge || 0, (v) => edit((x) => { if (Math.abs(v) < 0.005) delete x.bulge; else x.bulge = round(v); }), { min: -round(len / 2), max: round(len / 2), step: 0.05 }),
        numField('Thickness', w.thickness, (v) => edit((x) => (x.thickness = v)), { min: 0.02, max: 1, step: 0.01 }),
        numField('Height', w.height, (v) => edit((x) => (x.height = v)), { min: 0.1, max: 10 })),
      h('p', { class: 'hint' }, `Type a length or an angle (0° points up the plan, 90° to the right), or tap them on the wall. The far end moves, with any walls joined to it. Curve bows the wall: it is how far the middle sits from the straight line (0 = straight, minus = the other way); you can also drag the small middle handle.${w.bulge ? ` Along the curve it is ${fmt(run)}.` : ''}`),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!w.exterior, onchange: (e) => edit((x) => (x.exterior = e.target.checked)) }), 'Outside wall'),
      this.finishPanel(w),
      (w.openings || []).length ? h('h3', {}, 'Doors and windows in this wall') : null,
      (w.openings || []).map((o) => h('div', { class: 'row' },
        h('button', { class: 'row-label linkish', onclick: () => this.select({ type: 'opening', id: o.id, wall: w.id }) }, h('div', {}, openingName(o)), h('div', { class: 'sub' }, `${fmt(o.width)} wide, ${fmt(o.offset)} from the start`)),
        h('button', { class: 'round small', 'aria-label': `Edit this ${openingName(o).toLowerCase()}`, onclick: () => this.select({ type: 'opening', id: o.id, wall: w.id }) }, icon('edit')),
        h('button', { class: 'round small', 'aria-label': `Delete this ${openingName(o).toLowerCase()}`, onclick: () => edit((x) => (x.openings = x.openings.filter((q) => q.id !== o.id))) }, icon('trash')))),
      h('div', { class: 'btns' },
        ...['door', 'window', 'slider'].map((k) => h('button', { class: 'wide ghost', onclick: () => add(k) }, icon('plus'), k === 'slider' ? 'Slider' : OPENINGS[k].label))),
      h('button', { class: 'wide danger', onclick: () => this.deleteSelection() }, icon('trash'), 'Delete wall'));
  }

  /** A door or window, edited like furniture (#53, #54): slide it, size it, choose its style. */
  openingInspector(o, w) {
    const len = wallLength(w), styles = stylesFor(o.type), name = openingName(o);
    const edit = (fn) => this.change((lv) => { const x = lv.walls.find((q) => q.id === w.id); fn(x.openings.find((q) => q.id === o.id), x); });
    const fit = (x) => { x.width = round(Math.max(0.1, Math.min(len, x.width))); x.offset = round(Math.max(0, Math.min(len - x.width, x.offset))); };
    const slide = (dir) => edit((x) => { x.offset += dir * this.step; fit(x); });
    const widen = (dir) => edit((x) => { x.offset -= (dir * 0.1) / 2; x.width += dir * 0.1; fit(x); });
    const drawn = !!o.style && o.style !== 'none';
    return h('div', { class: 'stack' },
      h('h3', {}, name),
      selectField('Kind', o.type, [...Object.entries(OPENINGS).map(([k, d]) => [k, d.label]), ...(OPENINGS[o.type] ? [] : [[o.type, o.type]])], (v) => edit((x) => { x.type = v; const d = OPENINGS[v]; x.sill = d.sill; x.head = Math.min(d.head, w.height); if (d.style) x.style = this.openStyle[v] || d.style; else delete x.style; })),
      styles ? h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Style'),
        h('div', { class: 'seg wrap' }, styles.map(([v, l]) => h('button', { class: v === (o.style || 'none') ? 'on' : '', onclick: () => { this.openStyle[o.type] = v === 'none' ? this.openStyle[o.type] : v; edit((x) => (x.style = v)); } }, l)))) : null,
      h('div', { class: 'movepad' },
        h('div', { class: 'dpad' }, h('div', {},
          h('button', { class: 'round', 'aria-label': `Slide the ${name.toLowerCase()} towards the start of the wall`, onclick: () => slide(-1) }, icon('left')),
          h('button', { class: 'round', 'aria-label': `Slide the ${name.toLowerCase()} towards the end of the wall`, onclick: () => slide(1) }, icon('chevron')))),
        h('div', { class: 'stack' },
          seg(imperial() ? [[0.0127, '½″'], [0.0508, '2″'], [0.3048, '1′']] : [[0.01, '1 cm'], [0.05, '5 cm'], [0.25, '25 cm']], this.step, (v) => { this.step = v; this.renderPanel(); }),
          h('div', { class: 'btns' },
            h('button', { class: 'wide', 'aria-label': 'Narrower', onclick: () => widen(-1) }, icon('minus'), 'Width'),
            h('button', { class: 'wide', 'aria-label': 'Wider', onclick: () => widen(1) }, icon('plus'), 'Width')))),
      h('div', { class: 'fields' },
        numField('From wall start', o.offset, (v) => edit((x) => { x.offset = v; fit(x); }), { min: 0, max: len }),
        numField('Width', o.width, (v) => edit((x) => { x.width = v; fit(x); }), { min: 0.1, max: len }),
        o.type === 'window' ? numField('Sill height', o.sill, (v) => edit((x) => (x.sill = Math.min(v, x.head - 0.1))), { min: 0, max: w.height }) : null,
        numField('Top', o.head, (v) => edit((x) => (x.head = Math.max(v, x.sill + 0.1))), { min: 0.1, max: w.height })),
      o.type === 'door' && drawn ? h('div', { class: 'btns' },
        o.style !== 'double' ? h('button', { class: 'wide ghost', onclick: () => edit((x) => { if (x.hinge === 'end') delete x.hinge; else x.hinge = 'end'; }) }, icon('rotate'), o.style === 'sliding' ? 'Slide the other way' : 'Hinge on the other side') : null,
        h('button', { class: 'wide ghost', onclick: () => edit((x) => { if (x.swing === -1) delete x.swing; else x.swing = -1; }) }, icon('rotateL'), o.style === 'sliding' ? 'Other face of the wall' : 'Open the other way')) : null,
      drawn && o.type !== 'opening' ? h('div', { class: 'row' }, h('div', { class: 'row-label' }, o.type === 'door' ? 'Door colour' : 'Frame and trim colour'),
        h('span', { class: 'colbtn' }, h('input', { type: 'color', value: o.color || '#f3f0ea', 'aria-label': o.type === 'door' ? 'Door colour' : 'Frame and trim colour', onchange: (e) => edit((x) => (x.color = e.target.value)) }))) : null,
      drawn && o.type === 'door' ? h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, 'Trim colour'), h('div', { class: 'sub' }, o.trim ? 'the frame around the doorway' : 'no frame drawn')),
        o.trim ? h('button', { class: 'chip small', onclick: () => edit((x) => delete x.trim) }, 'None') : null,
        h('span', { class: 'colbtn' }, h('input', { type: 'color', value: o.trim || '#f3f0ea', 'aria-label': 'Trim colour', onchange: (e) => edit((x) => (x.trim = e.target.value)) }))) : null,
      drawn && o.type !== 'opening' ? h('button', { class: 'wide ghost', onclick: () => { const same = o.type === 'door' ? (q) => q.type === 'door' : (q) => q.type !== 'door' && q.type !== 'opening'; this.change((lv) => { for (const wl of lv.walls) for (const q of wl.openings || []) if (same(q)) { q.color = o.color; if (o.type === 'door') { if (o.trim) q.trim = o.trim; else delete q.trim; } } }); toast(o.type === 'door' ? 'Every door on this level now has these colours.' : 'Every window on this level now has this colour.'); } }, o.type === 'door' ? 'Use these colours on every door' : 'Use this colour on every window') : null,
      h('p', { class: 'hint' }, 'Drag it on the plan to slide it along its wall. Tap it again to select the wall it is in.'),
      h('div', { class: 'btns' },
        h('button', { class: 'wide', onclick: () => { const id = uid('o'); this.sel = { type: 'opening', id, wall: w.id }; edit((x, wl) => { const c = { ...structuredClone(x), id }; c.offset = x.offset + x.width + 0.1 + c.width <= len ? x.offset + x.width + 0.1 : Math.max(0, x.offset - x.width - 0.1); fit(c); wl.openings.push(c); }); } }, icon('copy'), 'Duplicate'),
        h('button', { class: 'wide danger', onclick: () => this.deleteSelection() }, icon('trash'), 'Delete')));
  }

  roomInspector(r) {
    const L = this.level, rc = L.roomControls[r.id] || {};
    const edit = (fn) => this.change((lv) => fn(lv.rooms.find((q) => q.id === r.id), lv));
    const editRC = (fn) => this.change((lv) => fn((lv.roomControls[r.id] ||= {})));
    const b = polyBounds(r.polygon);
    const pt = this.vertex != null ? r.polygon[this.vertex] : null;
    const isRect = r.polygon.length === 4 && r.polygon.every((p) => (p[0] === b.x0 || p[0] === b.x1) && (p[1] === b.y0 || p[1] === b.y1));
    const setRect = (w, d) => edit((x) => { x.polygon = [[b.x0, b.y0], [round(b.x0 + w), b.y0], [round(b.x0 + w), round(b.y0 + d)], [b.x0, round(b.y0 + d)]]; x.labelAt = [round(b.x0 + w / 2), round(b.y0 + d / 2)]; });
    const list = (key, label, domains) => [
      ...(rc[key] || []).map((x, i) => h('div', { class: 'row' },
        h('div', { class: 'row-label' }, h('div', {}, x.name), h('div', { class: 'sub' }, x.entity)),
        h('button', { class: 'round small', 'aria-label': `Remove ${x.name}`, onclick: () => editRC((c) => { c[key].splice(i, 1); if (!c[key].length) delete c[key]; }) }, icon('trash')))),
      entityField(label, '', (v) => { if (!v) return; const name = prompt('Name shown on the button', v.split('.')[1].replace(/_/g, ' ')); if (name != null) editRC((c) => (c[key] ||= []).push({ entity: v, name: name || v })); }, domains)];
    return h('div', { class: 'stack' },
      this.ctx.startButton?.(r.id),
      textField('Area name', r.name, (v) => v && edit((x) => (x.name = v))),
      selectField('Floor', r.floor, Object.entries(FLOOR_MATERIALS).map(([k, m]) => [k, m.label]), (v) => edit((x) => { x.floor = v; x.floorPainted = true; })),
      r.floorPhoto
        ? [numField('Your floor photo covers', r.floorPhoto.size || 2, (v) => edit((x) => (x.floorPhoto.size = v)), { min: 0.1, max: 20 }),
          h('button', { class: 'wide ghost danger', onclick: () => edit((x) => delete x.floorPhoto) }, icon('trash'), 'Remove floor photo')]
        : [h('p', { class: 'hint' }, 'Or use your real floor: photograph it straight down, then say how much floor the photo shows.'),
          this.photoButtons((id) => edit((x) => (x.floorPhoto = { id, size: 2 })))],
      isRect ? h('div', { class: 'fields' },
        numField('Width', b.x1 - b.x0, (v) => setRect(v, b.y1 - b.y0), { min: 0.3, max: 100 }),
        numField('Depth', b.y1 - b.y0, (v) => setRect(b.x1 - b.x0, v), { min: 0.3, max: 100 })) : null,
      h('p', { class: 'hint' }, `${r.polygon.length} points. Drag a point to move it. Tap + in the middle of an edge to add a point there. Tap a point to select it, then remove it or type where it is.`),
      pt ? h('div', { class: 'opening' },
        h('div', { class: 'row' }, h('div', { class: 'row-label' }, `Point ${this.vertex + 1} of ${r.polygon.length}`),
          h('button', { class: 'chip small', disabled: r.polygon.length <= 3, onclick: () => { const i = this.vertex; this.vertex = null; edit((x) => { x.polygon.splice(i, 1); const nb = polyBounds(x.polygon); x.labelAt = [round((nb.x0 + nb.x1) / 2), round((nb.y0 + nb.y1) / 2)]; }); } }, icon('trash'), 'Remove point')),
        h('div', { class: 'fields' },
          numField('Across', pt[0], (v) => edit((x) => (x.polygon[this.vertex][0] = round(v)))),
          numField('Down', pt[1], (v) => edit((x) => (x.polygon[this.vertex][1] = round(v)))))) : null,
      h('button', { class: 'wide ghost', onclick: () => edit((x, lv) => this.wallsAround(lv, x, this.wall.exterior)) }, icon('wall'), 'Build walls around this area'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!r.outdoor, onchange: (e) => edit((x) => (e.target.checked ? (x.outdoor = true) : delete x.outdoor)) }), 'Outdoors (deck, balcony, garden)'),
      h('div', { class: 'msep' }),
      h('h3', {}, 'Room panel'),
      h('p', { class: 'hint' }, 'The buttons shown when this room is selected. Tap the pencil on one to change what it controls, the controls it shows (brightness, speeds, temperature, modes…) and its sub-buttons.'),
      entityField('Main light (also lights the room on the plan)', rc.mainLight || '', (v) => this.setMainLight(r, v), ['light', 'switch']),
      this.panelEditor(r),
      h('button', { class: 'wide danger', onclick: () => this.deleteSelection() }, icon('trash'), 'Delete area'));
  }

  /** Two buttons that take or choose a photo, shrink it, store it, and hand back its id. */
  photoButtons(onPhoto) {
    const go = async (camera) => {
      const file = await pickFile('image/*', camera);
      if (!file) return;
      try { onPhoto(await savePhoto(await shrinkPhoto(file))); } catch (e) { alert(`Could not use that photo. ${e.message || ''}`); }
    };
    return h('div', { class: 'btns' },
      h('button', { class: 'wide ghost', onclick: () => go(true) }, icon('camera'), 'Take photo'),
      h('button', { class: 'wide ghost', onclick: () => go(false) }, icon('image'), 'Choose photo'));
  }
  /** The grid that buttons beside the plan snap to (in screen points), shown as dots while editing. */
  screenGridSeg() {
    const g = this.level.screenGrid || 24;
    return h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, 'Grid beside the plan'), h('div', { class: 'sub' }, 'Buttons snap to it')),
      seg([[12, 'Fine'], [24, 'Medium'], [48, 'Large']], g, (v) => this.change((lv) => (lv.screenGrid = v))));
  }
  gridSeg() {
    return h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Snap to grid'),
      seg([[0.05, 'Fine'], [0.25, imperial() ? len(0.25) : '25 cm'], [0.5, imperial() ? len(0.5) : '50 cm'], [1, imperial() ? len(1) : '1 m']], this.btnGrid, (v) => { this.btnGrid = v; this.renderPanel(); }));
  }
  buttonInspector(b) {
    const edit = (fn) => this.change((lv) => fn(lv.buttons.find((q) => q.id === b.id)));
    const centre = () => { const v = this.view.bounds; return [round((v.x0 + v.x1) / 2), round((v.y0 + v.y1) / 2)]; };
    return h('div', { class: 'stack' },
      h('h3', {}, 'Button'),
      textField('Name', b.name, (v) => v && edit((x) => (x.name = v))),
      b.view ? null : h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'What it does'),
        seg([[false, 'A device'], [true, 'Opens an app']], !!b.app, (v) => edit((x) => { if (v) { x.app = x.app || 'ha'; x.icon ||= x.app === 'ma' ? 'music' : x.app === 'homey' ? 'home' : 'ha'; } else delete x.app; }))),
      b.view ? h('p', { class: 'hint' }, { left: 'Turns the view 45° to the left.', right: 'Turns the view 45° to the right.', home: 'Goes to this floor plan\'s home view.', fit: 'Shows the whole plan.' }[b.view])
        : b.app ? h('label', { class: 'field wide-field' }, h('span', {}, 'App to open'),
          h('select', { onchange: (e) => edit((x) => { x.app = e.target.value; x.icon = { ha: 'ha', ma: 'music', homey: 'home' }[x.app] || x.icon; if (!x.name || /^(Home Assistant|Music Assistant|Homey)$/.test(x.name)) x.name = { ha: 'Home Assistant', ma: 'Music Assistant', homey: 'Homey' }[x.app]; }) },
            [['ha', 'Home Assistant'], ['ma', 'Music Assistant'], ['homey', 'Homey']].map(([v, l]) => h('option', { value: v, selected: v === b.app }, l + ((this.ctx.apps?.() || []).some((a) => a.id === v) ? '' : ' (not connected here)')))))
        : entityField('Controls (tap toggles or runs, hold for details)', b.entity, (v) => v && edit((x) => (x.entity = v))),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Shows'),
        h('select', { 'aria-label': 'What the button shows', onchange: (e) => { this.btnSize = e.target.value; edit((x) => (x.size = e.target.value)); } },
          [['small', 'Icon only'], ['expand', 'Icon, opens its controls when tapped'], ['large', 'Name and controls']].map(([v, l]) => h('option', { value: v, selected: v === (b.size || 'small') }, l)))),
      b.size === 'expand' ? h('p', { class: 'hint' }, 'A tap opens the controls (such as the temperature and − / +) for a few seconds, then it closes again. While heating or cooling is on, the set temperature shows beside the icon.') : null,
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, 'Size'), h('div', { class: 'sub' }, `${Math.round((b.scale || 1) * 100)}%`)),
        h('button', { class: 'round small', 'aria-label': 'Smaller button', disabled: (b.scale || 1) <= 0.6, onclick: () => edit((x) => { x.scale = Math.max(0.6, +((x.scale || 1) - 0.15).toFixed(2)); if (x.scale === 1) delete x.scale; }) }, '−'),
        h('button', { class: 'round small', 'aria-label': 'Bigger button', disabled: (b.scale || 1) >= 3, onclick: () => edit((x) => { x.scale = Math.min(3, +((x.scale || 1) + 0.15).toFixed(2)); if (x.scale === 1) delete x.scale; }) }, '+')),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Icon'),
        h('button', { class: 'round', 'aria-label': 'Choose icon', onclick: async () => { const ic = await pickIcon({ current: b.icon, suggested: iconOf({ entity: b.entity }) }); if (ic != null) edit((x) => { if (ic) x.icon = ic; else delete x.icon; }); } }, icon(iconOf(b)))),
      b.dock ? null : this.gridSeg(),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Where'),
        seg([[false, 'On the plan'], [true, 'Beside the plan']], !!b.dock, (v) => edit((x) => { if (v) { x.dock = true; } else { delete x.dock; x.at ||= centre(); } }))),
      b.view || b.app ? null : this.gesturesPanel(b, b.entity, (fn) => edit((x) => fn(x)), { swipes: false }),
      b.view || b.app ? null : this.groupEditor(b, edit),
      h('p', { class: 'hint' }, b.dock ? (b.pos ? 'Placed beside the plan. Drag it to move it (it snaps to the grid); drop it on the strip at the top to put it back there.' : 'In the strip above the plan. Drag it anywhere around the plan to give it its own place.') : 'Drag it on the plan to move it.'),
      b.dock ? this.screenGridSeg() : null,
      h('button', { class: 'wide danger', onclick: () => this.deleteSelection() }, icon('trash'), 'Delete button'));
  }

  /** A button that fans out a row of other buttons (#100). */
  groupEditor(b, edit) {
    const g = b.group;
    if (!g) return h('div', { class: 'stack' }, h('div', { class: 'msep' }), h('h3', {}, 'Group'),
      h('p', { class: 'hint' }, 'Make this button open a row of more buttons, which fold back behind it again.'),
      h('button', { class: 'wide ghost', onclick: () => edit((x) => (x.group = { dir: 'right', tap: 'toggle', items: [] })) }, icon('plus'), 'Make it a group'));
    const items = g.items || [];
    const editItem = (fn) => edit((x) => fn(x.group.items));
    return h('div', { class: 'stack' }, h('div', { class: 'msep' }), h('h3', {}, 'Group'),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Opens'),
        seg([['left', 'Left'], ['up', 'Up'], ['down', 'Down'], ['right', 'Right']], g.dir || 'right', (v) => edit((x) => (x.group.dir = v)))),
      h('label', { class: 'field wide-field' }, h('span', {}, 'Tapping this button'),
        h('select', { onchange: (e) => edit((x) => (x.group.tap = e.target.value)) },
          [['toggle', 'Opens and closes the row'], ['own', 'Does its own action; a double tap opens and closes the row']].map(([v, l]) => h('option', { value: v, selected: (g.tap || 'toggle') === v }, l)))),
      h('p', { class: 'hint' }, 'The row folds back when this button is used again, or after 30 seconds without a touch. Using a button in the row keeps it open.'),
      items.map((it, i) => h('div', { class: 'row' },
        h('button', { class: 'round small', 'aria-label': `Icon for ${it.name}`, onclick: async () => { const ic = await pickIcon({ current: it.icon, suggested: iconOf({ entity: it.entity }) }); if (ic != null) editItem((l) => { if (ic) l[i].icon = ic; else delete l[i].icon; }); } }, icon(iconOf(it))),
        h('div', { class: 'row-label' }, h('div', {}, it.name), h('div', { class: 'sub' }, it.entity)),
        h('button', { class: 'round small', 'aria-label': `Move ${it.name} earlier`, disabled: i === 0, onclick: () => editItem((l) => l.splice(i - 1, 0, l.splice(i, 1)[0])) }, icon('up')),
        h('button', { class: 'round small', 'aria-label': `Remove ${it.name}`, onclick: () => editItem((l) => l.splice(i, 1)) }, icon('trash')))),
      h('button', { class: 'wide ghost', onclick: async () => { const v = await pickEntity({ title: 'Add a button to the group' }); if (v) editItem((l) => l.push({ id: uid('gb'), entity: v, name: entityName(v) || v })); } }, icon('plus'), 'Add a button to the group'),
      h('button', { class: 'wide ghost danger', onclick: () => edit((x) => delete x.group) }, icon('undo'), 'Stop being a group'));
  }

  /** Give the level a widget panel of its own (#71). It starts with the rooms and All lights off. */
  makePanelPage() {
    this.change((lv) => (lv.panelPage = { id: uid('page'), name: 'Panel', sections: [
      { id: uid('s'), title: 'Rooms', tiles: lv.rooms.filter((r) => !(lv.roomList?.hidden || []).includes(r.id)).map((r) => ({ id: uid('c'), kind: 'room', room: r.id, name: r.name })) },
      { id: uid('s'), title: 'Whole floor', tiles: [{ id: uid('c'), kind: 'alloff', name: 'All lights off', w: 2, h: 1 }] }] }));
  }
  /** The Widgets side of the panel in edit mode (#94): the widgets shown when no room is selected, edited in place. */
  widgetsTab() {
    const L = this.level, mode = L.panelView?.kind || 'widgets';
    const pick = seg([['widgets', 'Widgets'], ['web', 'Web page'], ['ha', 'Home Assistant']], mode, (v) => {
      if (v === 'widgets') this.change((lv) => delete lv.panelView);
      else this.change((lv) => (lv.panelView = v === 'ha' ? { kind: 'ha', path: '/lovelace' } : { kind: 'web', url: '' }));
      if (v === 'ha' && !insideHA()) frameGuide(this.level.panelView, () => this.renderPanel());
    });
    if (mode !== 'widgets') return h('div', { class: 'stack' }, pick, this.webTab(L));
    return h('div', { class: 'stack' }, pick, this.widgetsOnly());
  }
  /** The panel as a web page or a Home Assistant dashboard (#118). */
  webTab(L) {
    const v = L.panelView;
    if (v.kind === 'web') return h('div', { class: 'stack' },
      textField('Web address', v.url || '', (u) => this.change((lv) => (lv.panelView.url = /^[a-z]+:\/\//i.test(u.trim()) || !u.trim() ? u.trim() : `https://${u.trim()}`)), { placeholder: 'https://…', inputmode: 'url' }),
      h('p', { class: 'hint' }, 'The page fills the panel when no room is selected. Some sites do not allow being shown inside another app; they then stay blank.'));
    const box = h('div', { class: 'stack' }, h('p', { class: 'hint' }, 'Finding your dashboards…'));
    haDashboards().then((list) => box.replaceChildren(...nodes(
      h('label', { class: 'field wide-field' }, h('span', {}, 'Dashboard'),
        h('select', { onchange: (e) => this.change((lv) => (lv.panelView.path = e.target.value)) },
          (list.some((d) => d.path === v.path) ? list : [...list, { path: v.path, title: v.path }]).map((d) => h('option', { value: d.path, selected: d.path === v.path }, d.title)))),
      textField('Or its address in Home Assistant', v.path || '', (u) => u.trim() && this.change((lv) => (lv.panelView.path = '/' + u.trim().replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, ''))), { placeholder: '/lovelace/0' }),
      insideHA() ? h('p', { class: 'hint' }, 'Inside the Home Assistant add-on nothing needs setting up.') : h('button', { class: 'wide', onclick: () => frameGuide(this.level.panelView, () => this.renderPanel()) }, icon('help'), 'How to allow it in Home Assistant'))));
    return box;
  }
  widgetsOnly() {
    const L = this.level;
    if (!L.panelPage) return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, 'With no room selected, this panel shows the list of rooms. You can fill it with widgets of your own instead: anything, in sections, tabs and a grid.'),
      h('button', { class: 'wide primary', onclick: () => this.makePanelPage() }, icon('grid'), 'Use widgets in this panel'),
      this.roomListEditor());
    const empty = !L.panelPage.sections.some((x) => (x.tiles || []).length);
    return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, empty ? 'No widgets here, so the panel shows the list of rooms. Add a widget to make it your own.' : 'These show beside the plan when no room is selected. Tap one to change it; hold and drag to move it.'),
      renderPage(this.home, L.panelPage, { editing: true, embedded: true, actions: this.ctx.actions?.(), rooms: L.rooms, rerender: () => this.renderPanel() }),
      empty ? this.roomListEditor() : null);
  }

  /** The list of a room's panel buttons, editable in place. The first change copies the starting set into the home file. */
  panelEditor(r) {
    const list = roomControlsOf(this.level, r.id);
    const custom = !!this.level.roomPanels?.[r.id];
    const editPanel = (fn) => this.change((lv) => {
      const p = ((lv.roomPanels ||= {})[r.id] ||= { controls: structuredClone(roomControlsOf(lv, r.id)) });
      fn(p.controls);
    });
    const open = (c) => {
      const find = (cs) => cs.find((x) => x.id === c.id);
      const ed = editControl(c, {
        title: `Button in ${r.name}`, sizes: false,
        save: (fn) => { editPanel((cs) => fn(find(cs))); Object.assign(c, find(roomControlsOf(this.level, r.id)) || c); },
        remove: () => editPanel((cs) => cs.splice(cs.findIndex((x) => x.id === c.id), 1)),
        move: (dir) => { editPanel((cs) => { const i = cs.findIndex((x) => x.id === c.id), j = i + dir; if (j >= 0 && j < cs.length) cs.splice(j, 0, cs.splice(i, 1)[0]); }); ed.redraw(); },
      });
    };
    return [
      list.map((c) => controlRow(c, { editing: true, edit: (x) => open(structuredClone(x)) })),
      !list.length ? h('p', { class: 'hint' }, 'No buttons yet.') : null,
      h('div', { class: 'btns' },
        h('button', { class: 'wide ghost', onclick: async () => { const v = await pickEntity({ title: `Add a button to ${r.name}` }); if (v) { const c = newControl(v); editPanel((cs) => cs.push(c)); open(structuredClone(c)); } } }, icon('plus'), 'Add button'),
        h('button', { class: 'wide ghost', onclick: () => { const n = prompt('Name of the group', 'Lamps'); if (n) { const c = { ...newControl('', n.trim()), subs: [] }; editPanel((cs) => cs.push(c)); open(structuredClone(c)); } } }, icon('plus'), 'Add group')),
      custom ? h('button', { class: 'wide ghost', onclick: () => { if (confirm('Go back to the automatic buttons for this room?')) this.change((lv) => delete lv.roomPanels[r.id]); } }, icon('undo'), 'Reset to automatic') : null,
    ];
  }

  /** The room list shown beside the plan: order, which rooms appear, and what each row tells you. */
  roomListEditor() {
    const L = this.level, cfg = L.roomList || {};
    const order = [...(cfg.order || []).map((id) => L.rooms.find((r) => r.id === id)).filter(Boolean), ...L.rooms.filter((r) => !(cfg.order || []).includes(r.id))];
    const edit = (fn) => this.change((lv) => fn((lv.roomList ||= {}), lv));
    if (!L.rooms.length) return null;
    return [
      h('div', { class: 'msep' }),
      h('h3', {}, 'Room list'),
      h('p', { class: 'hint' }, 'The list of rooms shown beside the plan when no room is selected.'),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Each row shows'),
        seg([['lights', 'Lights on'], ['temperature', 'Temperature'], ['none', 'Nothing']], cfg.show || 'lights', (v) => edit((x) => (x.show = v)))),
      order.map((r, i) => h('div', { class: 'row' },
        h('div', { class: 'row-label' }, h('div', {}, r.name), (cfg.hidden || []).includes(r.id) ? h('div', { class: 'sub' }, 'hidden from the list') : null),
        h('button', { class: 'round small', 'aria-label': `Move ${r.name} up`, disabled: i === 0, onclick: () => edit((x) => { const ids = order.map((q) => q.id); ids.splice(i - 1, 0, ids.splice(i, 1)[0]); x.order = ids; }) }, icon('up')),
        h('button', { class: 'round small', 'aria-label': `Move ${r.name} down`, disabled: i === order.length - 1, onclick: () => edit((x) => { const ids = order.map((q) => q.id); ids.splice(i + 1, 0, ids.splice(i, 1)[0]); x.order = ids; }) }, icon('down')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !(cfg.hidden || []).includes(r.id), 'aria-label': `Show ${r.name} in the list`, onchange: (e) => edit((x) => { const hid = new Set(x.hidden || []); e.target.checked ? hid.delete(r.id) : hid.add(r.id); x.hidden = [...hid]; }) })))),
    ];
  }

  /** Nido styles: the colour of this entity's dot on the plan. Only here, in edit mode: on the plan, tap and hold keep their actions. */
  dotRow(own, kind, set) {
    return h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('div', {}, 'Dot colour'), h('div', { class: 'sub' }, own ? 'its own colour, in the Nido styles' : 'as set for its kind in Look and feel')),
      own ? h('button', { class: 'chip small', onclick: () => set(null) }, 'Default') : null,
      h('span', { class: 'colbtn' }, h('input', { type: 'color', value: own || dotColour(kind), 'aria-label': 'Dot colour', onchange: (e) => set(e.target.value) })));
  }
  lightInspector(l) {
    const edit = (fn) => this.change((lv) => fn(lv.lights.find((q) => q.id === l.id)));
    return h('div', { class: 'stack' },
      textField('Light name', l.name, (v) => edit((x) => (x.name = v))),
      entityField('Entity', l.entity, (v) => edit((x) => (x.entity = v)), ['light', 'switch']),
      l.entity ? this.dotRow(l.dot, 'light', (v) => edit((x) => { if (v) x.dot = v; else delete x.dot; })) : null,
      l.position ? numField('Height', l.position[2], (v) => edit((x) => (x.position[2] = v)), { min: 0, max: 10 }) : null,
      h('div', { class: 'msep' }),
      this.gesturesPanel(l, l.entity, (fn) => edit((x) => fn(x))),
      h('button', { class: 'wide danger', onclick: () => this.deleteSelection() }, icon('trash'), 'Delete light'));
  }
}

export { newLevel };
