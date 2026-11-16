// The 3D model library: ready-made furniture models from one or more sources.
//
//  • Poly Haven — a public catalogue of CC0 (public domain) models, fetched on demand.
//  • The user's own Home Assistant library — .glb files dropped into the Nidorama add-on's folder.
//  • Any other source, linked by the address of an index file (see docs/model-sources.md).
//
// Whatever the source, choosing a model gives the app one .glb file, which is then stored like
// any other imported model. Nothing is downloaded until the user picks something.

const PH_API = 'https://api.polyhaven.com';
const PH_CATEGORIES = ['furniture', 'seating', 'table', 'shelves', 'lighting', 'appliances', 'electronics', 'decorative', 'plants', 'office'];

/** Pack a .gltf with separate .bin and texture files into a single self-contained .glb. */
export async function packGLB(gltf, fetchFile) {
  gltf = structuredClone(gltf);
  const chunks = [];
  let length = 0;
  const push = (bytes) => { const at = length; chunks.push(bytes); length += bytes.byteLength; const pad = (4 - (length % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); length += pad; } return at; };
  const base = [];
  for (const b of gltf.buffers || []) base.push(push(new Uint8Array(await fetchFile(b.uri))));
  for (const v of gltf.bufferViews || []) { v.byteOffset = (v.byteOffset || 0) + base[v.buffer || 0]; v.buffer = 0; }
  for (const img of gltf.images || []) {
    if (!img.uri) continue;
    const bytes = new Uint8Array(await fetchFile(img.uri));
    img.mimeType ||= /\.png$/i.test(img.uri) ? 'image/png' : /\.webp$/i.test(img.uri) ? 'image/webp' : 'image/jpeg';
    (gltf.bufferViews ||= []).push({ buffer: 0, byteOffset: push(bytes), byteLength: bytes.byteLength });
    img.bufferView = gltf.bufferViews.length - 1;
    delete img.uri;
  }
  gltf.buffers = [{ byteLength: length }];
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (json.byteLength % 4)) % 4;
  const head = new DataView(new ArrayBuffer(20));
  head.setUint32(0, 0x46546c67, true); head.setUint32(4, 2, true); head.setUint32(8, 12 + 8 + json.byteLength + jsonPad + 8 + length, true);
  head.setUint32(12, json.byteLength + jsonPad, true); head.setUint32(16, 0x4e4f534a, true);
  const binHead = new DataView(new ArrayBuffer(8));
  binHead.setUint32(0, length, true); binHead.setUint32(4, 0x004e4942, true);
  return new Blob([head, json, new Uint8Array(jsonPad).fill(0x20), binHead, ...chunks], { type: 'model/gltf-binary' });
}

const getJSON = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`); return r.json(); };
const getBytes = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`Download failed (${r.status})`); return r.arrayBuffer(); };
const title = (s) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Poly Haven: public-domain (CC0) models. Free to use, redistribute and sell; no credit required. */
export const polyHaven = {
  id: 'polyhaven', name: 'Poly Haven', note: 'Free public-domain (CC0) models from polyhaven.com',
  async list() {
    // The whole catalogue (#60): every model Poly Haven has, things for a home first. Search finds the rest.
    const all = await getJSON(`${PH_API}/assets?t=models`);
    const homeRank = (a) => { const i = PH_CATEGORIES.findIndex((c) => a.categories?.includes(c)); return i < 0 ? 99 : i; };
    return Object.entries(all)
      .map(([id, a]) => ({
        id, name: a.name, thumb: a.thumbnail_url, rank: homeRank(a),
        category: title(PH_CATEGORIES.find((c) => c !== 'furniture' && a.categories?.includes(c)) || (a.categories?.includes('furniture') ? 'furniture' : a.categories?.[0] || 'other')),
        words: [a.name, id, ...(a.categories || []), ...(a.tags || [])].join(' ').toLowerCase(),
        size: a.dimensions?.length === 3 ? a.dimensions.map((d) => +(d / 1000).toFixed(3)) : null, // mm → m: width, depth, height
        load: async () => {
          const files = await getJSON(`${PH_API}/files/${id}`);
          const entry = (files.gltf?.['1k'] || files.gltf?.['2k'] || Object.values(files.gltf || {})[0])?.gltf; // 1k textures: about 1 MB a model
          if (!entry) throw new Error('This model has no glTF version.');
          return packGLB(await getJSON(entry.url), (uri) => {
            const f = entry.include?.[uri] || entry.include?.[decodeURIComponent(uri)];
            if (!f) throw new Error(`The model is missing ${uri}.`);
            return getBytes(f.url);
          });
        },
      }))
      .sort((a, b) => (a.rank < 99 ? 0 : 1) - (b.rank < 99 ? 0 : 1) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  },
};

/**
 * A source described by an index file:
 *   { "name": "...", "license": "...", "models": [{ "name", "category", "file": "sofa.glb", "thumb"?, "size"?: [w, d, h] }] }
 * `file` and `thumb` are relative to the index file's address (or absolute).
 */
export function indexSource(url, fetchOpts) {
  return {
    id: url, name: new URL(url, location.href).host || 'Linked library', note: url, url,
    async list() {
      const r = await fetch(url, fetchOpts);
      if (!r.ok) throw new Error(`The library at ${url} answered ${r.status}`);
      const idx = await r.json();
      this.name = idx.name || this.name;
      this.note = idx.license ? `${idx.license} · ${url}` : url;
      return (idx.models || []).map((m, i) => ({
        id: m.id || m.file || String(i), name: m.name || title((m.file || '').replace(/\.glb$/i, '').split('/').pop()), category: m.category || 'Models',
        thumb: m.thumb ? new URL(m.thumb, new URL(url, location.href)).href : null, size: m.size || null,
        load: async () => { const res = await fetch(new URL(m.file, new URL(url, location.href)).href, fetchOpts); if (!res.ok) throw new Error(`Download failed (${res.status})`); return res.blob(); },
      }));
    },
  };
}
