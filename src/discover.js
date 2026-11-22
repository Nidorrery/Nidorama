// Finding Home Assistant on this network (#134), so a new phone in a home that already has Nidorama can
// join it in a tap. The Android app listens for Home Assistant's own announcement on the local network;
// every version also tries the usual addresses. Nothing leaves the local network.
import { discoverHomeAssistant } from './native.js';

const USUAL = ['http://homeassistant.local:8123', 'http://homeassistant:8123'];
const clean = (u) => String(u || '').trim().replace(/\/+$/, '');

/** Does something answer at this address? (Home Assistant serves its manifest to anyone; the reply itself is not read.) */
async function answers(url) {
  try { await fetch(`${url}/manifest.json`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(2500) }); return true; } catch { return false; }
}

/** Home Assistant servers found: [{ name, url }], each address once. `extra`: addresses to try too (e.g. the one typed before). */
export async function findHomeAssistant(extra = []) {
  const [announced, probed] = await Promise.all([
    discoverHomeAssistant(),
    Promise.all([...new Set([...extra.map(clean).filter(Boolean), ...USUAL])].map(async (url) => ((await answers(url)) ? { name: '', url } : null))),
  ]);
  const out = [], seen = new Set();
  for (const a of announced) {
    const url = clean(/^https?:\/\/(192\.168|10\.|172\.(1[6-9]|2\d|3[01])|[\w-]+\.local)/.test(a.internal_url || '') ? a.internal_url : a.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ name: a.location_name || a.name || 'Home Assistant', url });
  }
  // An announced server may also answer at a usual address: show it once.
  for (const p of probed) if (p && !seen.has(p.url) && !(out.length && USUAL.includes(p.url))) { seen.add(p.url); out.push({ name: 'Home Assistant', url: p.url }); }
  return out;
}
