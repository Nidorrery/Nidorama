// Local storage for bigger things than settings: the library of homes, the user's photos,
// imported 3D models and finished photo renders. Everything stays on the device (IndexedDB).
const DB = 'nidorama', STORE = 'blobs';
let dbp = null;
function db() {
  return (dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
export const getBlob = (key) => tx('readonly', (s) => s.get(key)).catch(() => undefined);
export const putBlob = (key, value) => tx('readwrite', (s) => s.put(value, key));
export const delBlob = (key) => tx('readwrite', (s) => s.delete(key)).catch(() => {});

let remoteFetcher = null;
/** Where to look for a photo or model that is not on this device (the add-on's shared folder). */
export const setRemoteFetcher = (fn) => { remoteFetcher = fn; };
/** A stored Blob: from this device, else fetched from the shared folder and kept. */
export async function loadBlob(key) {
  let b = await getBlob(key);
  if (!(b instanceof Blob) && remoteFetcher) {
    b = await remoteFetcher(key).catch(() => null);
    if (b instanceof Blob) await putBlob(key, b).catch(() => {});
  }
  return b instanceof Blob ? b : null;
}

const urls = new Map();
/** An object URL for a stored Blob (cached), or null if it is not on this device. */
export async function blobURL(key) {
  if (urls.has(key)) return urls.get(key);
  const b = await loadBlob(key);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(key, u);
  return u;
}
export const forgetURL = (key) => { const u = urls.get(key); if (u) URL.revokeObjectURL(u); urls.delete(key); };

export const blobToDataURL = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
export const dataURLToBlob = async (dataURL) => (await fetch(dataURL)).blob();

/** Shrink a photo so it is quick to draw and small to store (longest side `max` px, JPEG). */
export async function shrinkPhoto(file, max = 1024) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.86));
}
