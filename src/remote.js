// The Nidorama add-on on the Home Assistant machine: shared folder for photos, models and renders,
// the user's own model library, and the render engine. Optional — the app works without it.
import { setRemoteFetcher } from './blobs.js';

export const remote = { base: null, headers: {}, info: null };
const FILES = { photo: ['photos', '.jpg'], model: ['models', '.glb'] };

/** Find the add-on: on the page's own address (ingress / add-on port), else beside Home Assistant on port 8765. */
export async function connectAddon({ haUrl, token, addonUrl }) {
  remote.base = null;
  remote.info = null;
  const candidates = [[new URL('api/nidorama/', location.href).href, {}]];
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (addonUrl) candidates.push([`${addonUrl.replace(/\/$/, '')}/api/nidorama/`, headers]);
  else if (haUrl) { try { const u = new URL(haUrl); candidates.push([`${u.protocol}//${u.hostname}:8765/api/nidorama/`, headers]); } catch {} }
  for (const [base, h] of candidates) {
    try {
      const r = await fetch(`${base}info`, { headers: h, signal: AbortSignal.timeout(4000) });
      if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) continue;
      const info = await r.json();
      if (!info.machine) continue;
      Object.assign(remote, { base, headers: h, info });
      break;
    } catch {}
  }
  setRemoteFetcher(remote.base ? fetchBlob : null);
  return remote.info;
}

export async function addon(pathname, opts = {}) {
  if (!remote.base) throw new Error('The Nidorama add-on is not reachable.');
  const r = await fetch(remote.base + pathname, { ...opts, headers: { ...remote.headers, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `The add-on answered ${r.status}`);
  return r;
}
export const getAsset = async (kind, name) => { try { return await (await addon(`assets/${kind}/${name}`)).blob(); } catch { return null; } };
export const putAsset = (kind, name, blob) => (remote.base ? addon(`assets/${kind}/${name}`, { method: 'PUT', body: blob }).catch((e) => console.warn('Could not save to Home Assistant', e)) : null);

export const listAssets = async (kind) => { try { return (await (await addon(`list/${kind}`)).json()).files || []; } catch { return []; } };
export const getJSON = async (kind, name) => { const b = await getAsset(kind, name); try { return b ? JSON.parse(await b.text()) : null; } catch { return null; } };
export const putJSON = (kind, name, value) => putAsset(kind, name, new Blob([JSON.stringify(value)], { type: 'application/json' }));

/** Used by the local store when a photo or model is not on this device. */
async function fetchBlob(key) {
  const [type, id] = key.split('/');
  const f = FILES[type];
  return f ? getAsset(f[0], id + f[1]) : null;
}
/** Copy a locally stored photo / model into the shared folder so every device gets it. */
export const share = (key, blob) => { const [type, id] = key.split('/'); const f = FILES[type]; return f ? putAsset(f[0], id + f[1], blob) : null; };

export const renderName = (homeId, levelId, night) => `${homeId}__${levelId}__${night ? 'night' : 'day'}`.replace(/[^\w-]/g, '-');
