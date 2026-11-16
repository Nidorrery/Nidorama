// The library of homes (the user's data) and this device's settings.
// Homes are plain nidorama.home/1 files: created in the app or imported. Nothing is built in.
// Saved on the device, and mirrored into Home Assistant (per-user data) so other devices get them.
import { buildSample } from './sample.js';
import { upgradeFile, oldKey, carryOver } from './legacy.js'; // first: it brings settings across before they are read
import { uid, makeObject, CATALOG } from './catalog.js';
import { getBlob, putBlob, blobToDataURL, dataURLToBlob } from './blobs.js';
import { share, remote, listAssets, getJSON, putJSON } from './remote.js';

const LIB_KEY = 'nidorama.library';
const DEV_KEY = 'nidorama.settings';
const HA_KEY = 'nidorama.library';

const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch { return fallback; } };

/** Per-device settings: connection, look, and what this screen opens on. */
export const device = Object.assign(
  { haUrl: '', token: '', dayNight: 'auto', style: 'illustrated', idleDim: false, keepAwake: false, start: null, last: null },
  read(DEV_KEY, {}),
);
export const saveDevice = () => { try { localStorage.setItem(DEV_KEY, JSON.stringify(device)); } catch {} };

export const lib = { homes: [], deleted: {} };
/** Load the library. It lives in IndexedDB (room for photos); older installs are moved over from localStorage. */
export async function initStore() {
  await carryOver(async () => !(await getBlob(LIB_KEY)), putBlob).catch(() => {});
  let saved = await getBlob(LIB_KEY);
  if (!saved) { saved = read(LIB_KEY, null); if (saved) await putBlob(LIB_KEY, saved).catch(() => {}); }
  if (saved) Object.assign(lib, { homes: saved.homes || [], deleted: saved.deleted || {} });
}
const persist = () => putBlob(LIB_KEY, JSON.parse(JSON.stringify(lib))).catch((e) => console.warn('Could not save library', e));
/** Write the library to the device now and wait for it (before a reload; saves are otherwise delayed a moment). */
export const saveNow = () => { clearTimeout(saveTimer); return persist(); };

const listeners = new Set();
export const onLibraryChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (why) => { for (const fn of listeners) fn(why); };

let saveTimer, pushToHA = null;
export function saveLibrary(why = 'edit') {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist();
    pushToHA?.();
    pushHousehold();
  }, 300);
  emit(why);
}

// ---------- creating ----------
export function newLevel(name = 'Ground floor') {
  return { id: uid('level'), name, elevation: 0, ceilingHeight: 2.4, walls: [], rooms: [], floors: [], voids: [], stairs: [], objects: [], lights: [], roomControls: {} };
}
export function newHome(name = 'My home') {
  const home = { schema: 'nidorama.home/1', id: uid('home'), name, units: 'metres', axes: 'x east, y south, z up from finished floor', homeAssistant: {}, levels: [newLevel()], pages: [], updatedAt: Date.now() };
  lib.homes.push(home);
  saveLibrary('homes');
  return home;
}

/** A small furnished example, so the app can be explored before drawing anything. */
export function sampleHome() {
  const home = buildSample();
  lib.homes.push(home);
  saveLibrary('homes');
  return home;
}
/** The sample as file text, without adding it to this device (for the "plan from a sketch" guide). */
export const sampleFile = () => JSON.stringify(buildSample(), null, 1);

// ---------- import / export ----------
/** Validate and tidy a parsed home file. Throws a readable error if it is not one. */
export function normalizeHome(data) {
  upgradeFile(data);
  if (!data || typeof data !== 'object' || !String(data.schema || '').startsWith('nidorama.home/')) {
    throw new Error('This is not a Nidorama home file (missing "schema": "nidorama.home/1").');
  }
  if (!Array.isArray(data.levels) || !data.levels.length) throw new Error('The home file has no levels.');
  const home = structuredClone(data);
  home.id ||= uid('home');
  home.name ||= 'Imported home';
  home.homeAssistant ||= {};
  home.pages ||= [];
  for (const L of home.levels) {
    L.id ||= uid('level');
    L.name ||= 'Level';
    for (const k of ['walls', 'rooms', 'floors', 'voids', 'stairs', 'objects', 'lights']) L[k] ||= [];
    L.roomControls ||= {};
    L.ceilingHeight ||= 2.4;
    for (const w of L.walls) { w.openings ||= []; w.thickness ||= 0.1; w.height ||= L.ceilingHeight; }
    for (const o of L.objects) o.rotation ||= 0;
  }
  home.updatedAt = Date.now();
  return home;
}

/** Add a home from file text. A home with the same id is replaced. Returns the home. */
/** Read a home file's text (tidied and checked) without adding it to this device. Throws a readable error. */
export function readHomeText(text) {
  let data;
  try { data = JSON.parse(text); }
  catch {
    // Text copied out of a chat often has words or code marks around the file: take what is between the first { and the last }.
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    try { data = JSON.parse(text.slice(a, b + 1)); }
    catch (e) { throw new Error(`This is not a complete home file: ${a < 0 ? 'there is no { … } in it' : e.message}. If it came from a chat assistant, ask it to send the whole file again.`); }
  }
  return normalizeHome(data);
}
/** Add a home from file text. A home with the same id is replaced. Returns the home. */
export async function importHome(text) {
  const home = readHomeText(text);
  for (const [id, dataURL] of Object.entries(home.photos || {})) await putBlob(`photo/${id}`, await dataURLToBlob(dataURL)).catch(() => {});
  delete home.photos;
  const i = lib.homes.findIndex((h) => h.id === home.id);
  if (i >= 0) lib.homes[i] = home; else lib.homes.push(home);
  delete lib.deleted[home.id];
  saveLibrary('homes');
  return home;
}

/** Photo ids a home uses (floors and furniture). */
export function homePhotoIds(home) {
  const ids = new Set();
  for (const L of home.levels) {
    for (const r of L.rooms) if (r.floorPhoto?.id) ids.add(r.floorPhoto.id);
    for (const o of L.objects) if (o.photo?.id) ids.add(o.photo.id);
  }
  return [...ids];
}
/** The home as file text, with the photos it uses embedded so the file is complete on its own. */
export async function exportHome(home) {
  const out = { ...home, photos: {} };
  for (const id of homePhotoIds(home)) {
    const b = await getBlob(`photo/${id}`);
    if (b instanceof Blob) out.photos[id] = await blobToDataURL(b);
  }
  if (!Object.keys(out.photos).length) delete out.photos;
  return JSON.stringify(out, null, 1);
}

// Photos are also mirrored into Home Assistant (one small entry each) so other devices get them.
let haConn = null;
export async function savePhoto(blob) {
  const id = uid('p');
  await putBlob(`photo/${id}`, blob);
  share(`photo/${id}`, blob);
  if (haConn) blobToDataURL(blob).then((value) => haConn.request({ type: 'frontend/set_user_data', key: `nidorama.photo.${id}`, value })).catch(() => {});
  return id;
}
/** Fetch a photo this device does not have from Home Assistant. Resolves true if it arrived. */
export async function fetchPhotoFromHA(id) {
  if (!haConn) return false;
  try {
    let res = await haConn.request({ type: 'frontend/get_user_data', key: `nidorama.photo.${id}` });
    if (typeof res?.value !== 'string') res = await haConn.request({ type: 'frontend/get_user_data', key: oldKey(`nidorama.photo.${id}`) });
    if (typeof res?.value !== 'string') return false;
    await putBlob(`photo/${id}`, await dataURLToBlob(res.value));
    return true;
  } catch { return false; }
}

export function deleteHome(id) {
  lib.homes = lib.homes.filter((h) => h.id !== id);
  lib.deleted[id] = Date.now();
  saveLibrary('homes');
}

export const getHome = (id) => lib.homes.find((h) => h.id === id);

// ---------- the household's shared copy ----------
// Dashboards marked "Only me" (private) never leave the user's own storage. Everything else in a
// home is written to the Nidorama add-on's folder on the Home Assistant machine (homes/<id>.json),
// which every person and device in the household reads. No cloud is involved. Newest save wins.
const isShared = (d) => !d.private;
const sharedCopy = (home) => ({ ...home, pages: (home.pages || []).filter(isShared), levels: home.levels.filter(isShared) });
const pushed = new Map(); // home id → updatedAt last written to the shared folder
let pushTimer;
function pushHousehold() {
  clearTimeout(pushTimer);
  if (!remote.base) return;
  pushTimer = setTimeout(async () => {
    for (const home of lib.homes) {
      if (pushed.get(home.id) === home.updatedAt) continue;
      pushed.set(home.id, home.updatedAt);
      await putJSON('homes', `${home.id}.json`, sharedCopy(home));
    }
    if (Object.keys(lib.deleted).length) await putJSON('homes', '_deleted.json', lib.deleted);
  }, 800);
}
/** Bring in what others in the household changed, and hand over what this device changed. Resolves true if anything arrived. */
export async function syncHousehold() {
  if (!remote.base) return false;
  let changed = false;
  const files = await listAssets('homes');
  const gone = files.some((f) => f.name === '_deleted.json') ? (await getJSON('homes', '_deleted.json')) || {} : {};
  for (const [id, t] of Object.entries(gone)) {
    if (!(lib.deleted[id] >= t)) lib.deleted[id] = t;
    const local = getHome(id);
    if (local && (local.updatedAt || 0) < t) { lib.homes = lib.homes.filter((h) => h.id !== id); changed = true; }
  }
  for (const f of files) {
    if (!f.name.endsWith('.json') || f.name.startsWith('_')) continue;
    const id = f.name.slice(0, -5), local = getHome(id);
    if (local && f.modified <= (local.syncedAt || 0)) continue; // nothing new in the shared copy since we last looked
    const r = await getJSON('homes', f.name);
    if (!r?.levels || lib.deleted[r.id] > (r.updatedAt || 0)) continue;
    if (!local) {
      if (r.levels.length || (r.pages || []).length) { lib.homes.push({ ...r, syncedAt: f.modified }); pushed.set(r.id, r.updatedAt); changed = true; }
    } else if ((r.updatedAt || 0) > (local.updatedAt || 0)) {
      // Take the household's version, and keep this person's own private dashboards alongside it.
      const merged = { ...r, pages: [...(r.pages || []), ...(local.pages || []).filter((d) => d.private)], levels: [...r.levels, ...local.levels.filter((d) => d.private)], syncedAt: f.modified };
      lib.homes[lib.homes.indexOf(local)] = merged;
      pushed.set(r.id, r.updatedAt);
      changed = true;
    } else local.syncedAt = f.modified;
  }
  if (changed) { persist(); emit('sync'); }
  pushHousehold();
  return changed;
}

// ---------- undo ----------
const undoStack = [], redoStack = [];
/** Change a home through this so it is saved, synced and undoable. */
export function mutate(home, fn, { undoable = true } = {}) {
  if (undoable) {
    undoStack.push(JSON.stringify(home));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  fn(home);
  home.updatedAt = Date.now();
  saveLibrary('edit');
}
function swap(from, to) {
  const snap = from.pop();
  if (!snap) return null;
  const home = JSON.parse(snap);
  const i = lib.homes.findIndex((h) => h.id === home.id);
  if (i < 0) return null;
  to.push(JSON.stringify(lib.homes[i]));
  home.updatedAt = Date.now();
  lib.homes[i] = home;
  saveLibrary('undo');
  return home;
}
export const undo = () => swap(undoStack, redoStack);
export const redo = () => swap(redoStack, undoStack);
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

// ---------- sync through Home Assistant ----------
/** Merge with the copy kept in Home Assistant (newest version of each home wins), then keep it updated. */
export async function syncWithHA(conn) {
  pushToHA = null;
  haConn = null;
  if (!conn || conn.demo || !conn.request) return;
  haConn = conn;
  try {
    let res = await conn.request({ type: 'frontend/get_user_data', key: HA_KEY });
    if (!res?.value?.homes) { // nothing under today's name: look under the earlier one
      const was = await conn.request({ type: 'frontend/get_user_data', key: oldKey(HA_KEY) }).catch(() => null);
      if (was?.value?.homes) { for (const hm of was.value.homes) upgradeFile(hm); res = was; }
    }
    const remote = res?.value;
    let changed = false;
    if (remote?.homes) {
      Object.assign(lib.deleted, Object.fromEntries(Object.entries(remote.deleted || {}).filter(([id, t]) => !(lib.deleted[id] > t))));
      for (const rh of remote.homes) {
        const i = lib.homes.findIndex((h) => h.id === rh.id);
        if (lib.deleted[rh.id] > (rh.updatedAt || 0)) continue;
        if (i < 0) { lib.homes.push(rh); changed = true; }
        else if ((rh.updatedAt || 0) > (lib.homes[i].updatedAt || 0)) { lib.homes[i] = rh; changed = true; }
      }
      const before = lib.homes.length;
      lib.homes = lib.homes.filter((h) => !(lib.deleted[h.id] > (h.updatedAt || 0)));
      changed ||= lib.homes.length !== before;
    }
    pushToHA = () => conn.request({ type: 'frontend/set_user_data', key: HA_KEY, value: { homes: lib.homes, deleted: lib.deleted } }).catch((e) => console.warn('HA sync failed', e));
    if (changed) { persist(); emit('sync'); }
    pushToHA();
  } catch (e) { console.warn('HA sync unavailable', e); }
}

// ---------- entities ----------
/** Every HA entity a home refers to (for the demo connection and "all lights off"). */
export function homeEntities(home) {
  const ids = new Set();
  const add = (e) => e && ids.add(e);
  for (const L of home.levels) {
    for (const l of L.lights) add(l.entity);
    for (const o of L.objects) add(o.entity);
    for (const rc of Object.values(L.roomControls || {})) {
      add(rc.mainLight);
      for (const k of ['lampGroup', 'extras']) for (const e of rc[k] || []) add(e.entity);
      for (const k of ['temperature', 'fan', 'cover', 'climate']) add(rc[k]);
    }
  }
  const ha = home.homeAssistant || {};
  add(ha.heating); add(ha.automations?.entity); add(ha.automations?.action);
  const addControl = (c) => { add(c.entity); for (const sb of c.subs || []) add(sb.entity); };
  for (const p of home.pages || []) for (const s of p.sections || []) for (const t of s.tiles || []) addControl(t);
  for (const L of home.levels) for (const rp of Object.values(L.roomPanels || {})) for (const c of rp.controls || []) addControl(c);
  for (const i of home.more || []) { add(i.entity); add(i.stateEntity); }
  for (const m of home.menus || []) for (const i of m.items || []) add(i.entity);
  for (const L of home.levels) for (const b of L.buttons || []) { add(b.entity); for (const it of b.group?.items || []) add(it.entity); }
  for (const L of home.levels) for (const sec of L.panelPage?.sections || []) for (const t of sec.tiles || []) addControl(t);
  // devices that only appear inside a step list
  const steps = (list) => { for (const x of list || []) add(x.entity); };
  for (const p of [...(home.pages || []), ...home.levels.map((L) => L.panelPage).filter(Boolean)]) for (const sec of p.sections || []) for (const t of sec.tiles || []) steps(t.steps);
  for (const L of home.levels) for (const it of [...(L.buttons || []), ...L.objects]) for (const g of Object.values(it.gestures || {})) steps(g?.steps);
  return [...ids];
}
