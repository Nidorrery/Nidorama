// Carrying data over from the app's earlier name.
//
// Nidorama was called Diorama until November 2026. This file is the only place in the app that
// still knows the old name: it brings a device's settings and library across, and reads home,
// theme and backup files made before the rename. Nothing here is needed by a fresh install, and
// the whole file can be deleted once nobody has data under the old name.
const OLD = 'diorama', NEW = 'nidorama';
const swap = (text) => text.split(OLD).join(NEW);

// Settings and the sign-in in progress (localStorage). Runs once, as the app starts.
try {
  for (const key of ['settings', 'haLogin', 'library']) {
    const was = localStorage.getItem(`${OLD}.${key}`);
    if (was != null && localStorage.getItem(`${NEW}.${key}`) == null) localStorage.setItem(`${NEW}.${key}`, was);
  }
} catch {}

/** A home, theme or backup file written under the old name: the same file with today's schema name. */
export function upgradeFile(data) {
  if (data && typeof data === 'object' && typeof data.schema === 'string' && data.schema.startsWith(`${OLD}.`)) data.schema = swap(data.schema);
  if (data?.schema === `${NEW}.backup/1`) for (const hm of data.homes || []) upgradeFile(hm);
  return data;
}

/** The key the old app used for the same thing in Home Assistant's per-user data. */
export const oldKey = (key) => key.split(NEW).join(OLD);

/**
 * The library, photos, models and renders (IndexedDB). If this device has an old store and the
 * new one is still empty, everything is copied across, re-keyed. `put(key, value)` writes to the new store.
 */
export async function carryOver(isEmpty, put) {
  if (!(await isEmpty())) return;
  const open = () => new Promise((resolve) => {
    let fresh = false;
    const req = indexedDB.open(OLD);
    req.onupgradeneeded = () => { fresh = true; };
    req.onsuccess = () => resolve(fresh || !req.result.objectStoreNames.contains('blobs') ? (req.result.close(), fresh && indexedDB.deleteDatabase(OLD), null) : req.result);
    req.onerror = () => resolve(null);
  });
  const old = await open().catch(() => null);
  if (!old) return;
  const rows = await new Promise((resolve) => {
    const out = [], cur = old.transaction('blobs').objectStore('blobs').openCursor();
    cur.onsuccess = () => { const c = cur.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
    cur.onerror = () => resolve(out);
  });
  old.close();
  for (const [key, value] of rows) {
    const k = typeof key === 'string' ? swap(key) : key;
    if (k === `${NEW}.library`) for (const hm of value?.homes || []) upgradeFile(hm);
    await put(k, value).catch(() => {});
  }
}
