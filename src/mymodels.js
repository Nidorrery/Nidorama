// My models (#131): the models a person has made or changed. They belong to the person, not to a
// home: kept on this device, and with the add-on in a folder of their own Home Assistant user, so the
// same person finds them on every device they sign in on. Placing one puts a copy of its shape in
// the home, as with catalogue furniture, so the household sees what was placed.
import { device, saveDevice } from './store.js';
import { remote, addon, getJSON, putJSON } from './remote.js';
import { cleanModel } from './models.js';

let userId = null, listeners = new Set();
export const myModels = () => (device.models || []).filter((m) => !device.modelsGone?.[m.id]);
export const onMyModels = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { saveDevice(); for (const fn of listeners) fn(); push(); };

/** Keep a model (new, or a newer version of one already kept). Returns the kept copy. */
export function keepModel(m) {
  const kept = { ...structuredClone(m), updated: Date.now() };
  delete kept.url; delete kept.inHome; // a community or household model kept here is the person's own copy from now on
  const list = (device.models ||= []);
  const i = list.findIndex((x) => x.id === kept.id);
  if (i >= 0) list[i] = kept; else list.unshift(kept);
  if (device.modelsGone) delete device.modelsGone[kept.id];
  changed();
  return kept;
}
export function forgetModel(id) {
  device.models = (device.models || []).filter((m) => m.id !== id);
  (device.modelsGone ||= {})[id] = Date.now();
  changed();
}

// ---------- with the add-on, per Home Assistant user ----------
const file = () => `${userId}/models.json`;
let pushing = null;
function push() {
  if (!userId || !remote.base) return;
  clearTimeout(pushing);
  pushing = setTimeout(() => putJSON('mymodels', file(), { models: device.models || [], gone: device.modelsGone || {} }), 800);
}
/** After signing in to Home Assistant: learn who this is, then merge their models here and there (newest wins). */
export async function syncMyModels(conn) {
  const ok = (id) => (/^[\w-]{4,64}$/.test(id || '') ? id : null);
  userId = null;
  // Opened through Home Assistant (ingress): the add-on is told who is signed in. Signed in with an own token: ask Home Assistant.
  if (remote.base) try { userId = ok((await (await addon('whoami')).json()).id); } catch {}
  if (!userId && !window.__NIDORAMA_ADDON__) try { userId = ok((await conn._request({ type: 'auth/current_user' }))?.id); } catch {}
  if (!userId || !remote.base) return;
  const theirs = (await getJSON('mymodels', file())) || { models: [], gone: {} };
  const gone = { ...(theirs.gone || {}), ...(device.modelsGone || {}) };
  const byId = new Map();
  for (const m of [...(theirs.models || []), ...(device.models || [])]) {
    try {
      const c = { ...cleanModel(m), updated: m.updated || 0 };
      if (gone[c.id] && gone[c.id] >= c.updated) continue;
      if (!byId.has(c.id) || byId.get(c.id).updated < c.updated) byId.set(c.id, c);
    } catch {}
  }
  device.models = [...byId.values()].sort((a, b) => b.updated - a.updated);
  device.modelsGone = gone;
  saveDevice();
  for (const fn of listeners) fn();
  push();
}
