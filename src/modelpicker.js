// "Choose a 3D model": browse the model sources, pick one, get a .glb and its real size.
import * as THREE from 'three';
import { parseGLB } from './gltf.js';
import { h, nodes, icon, modal, pickFile } from './ui.js';
import { device, saveDevice } from './store.js';
import { polyHaven, indexSource } from './library.js';
import { remote } from './remote.js';

/** The model sources switched on for this device. */
export function modelSources() {
  const out = [];
  if (remote.base) out.push(Object.assign(indexSource(`${remote.base}library`, { headers: remote.headers }), { id: 'ha', name: 'Your Home Assistant library', note: `.glb files in ${remote.info?.folder || '/share/nidorama'}/library` }));
  if (device.onlineLibrary !== false) out.push(polyHaven);
  for (const url of device.modelSources || []) out.push(indexSource(url));
  return out;
}

/** Real-world size of a .glb as [width, depth, height] in metres, or null if it cannot be read. */
export async function measureGLB(blob) {
  try {
    const gltf = await parseGLB(await blob.arrayBuffer());
    const s = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    const size = [s.x, s.z, s.y].map((v) => +v.toFixed(3));
    return size.every((v) => v > 0.01 && v < 30) ? size : null;
  } catch { return null; }
}

/** Resolves with { blob, name, size, source } or null. */
export function pickModel({ title = 'Choose a 3D model' } = {}) {
  return new Promise((resolve) => {
    const sources = modelSources();
    let src = sources[0] || null, cat = null, list = null, error = '', busy = '', done = false, limit = 120;
    // Search stays put while the results change under it, so typing is never interrupted.
    const search = h('input', { class: 'model-search', type: 'search', placeholder: 'Search: chair, lamp, plant, sofa…', 'aria-label': 'Search the models', autocomplete: 'off' });
    const results = h('div', {});
    search.addEventListener('input', () => { limit = 120; fill(); });
    const cache = new Map();
    const body = h('div', { class: 'menu modelpick' });
    const finish = (v) => { if (done) return; done = true; resolve(v); close(); };
    const close = modal(body, { onclose: () => finish(null) });
    const open = async (s) => {
      src = s; cat = null; limit = 120; list = cache.get(s.id) || null; error = '';
      draw();
      if (list) return;
      try { list = await s.list(); cache.set(s.id, list); } catch (e) { error = e.message || String(e); }
      if (src === s) draw();
    };
    const choose = async (m) => {
      busy = `Getting ${m.name}…`; draw();
      try {
        const blob = await m.load();
        finish({ blob, name: m.name, size: m.size || (await measureGLB(blob)), source: src.name });
      } catch (e) { busy = ''; error = `Could not get that model: ${e.message || e}`; draw(); }
    };
    const fromFile = async () => {
      const file = await pickFile('.glb,model/gltf-binary');
      if (file) finish({ blob: file, name: file.name.replace(/\.glb$/i, ''), size: await measureGLB(file), source: 'file' });
    };
    /** The categories and the models that match the search, under the search box. */
    function fill() {
      const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const found = list ? list.filter((m) => q.every((w) => (m.words || `${m.name} ${m.category}`.toLowerCase()).includes(w))) : [];
      const cats = [...new Set(found.map((m) => m.category))];
      if (cat && !cats.includes(cat)) cat = null;
      const shown = found.filter((m) => !cat || m.category === cat);
      results.replaceChildren(...nodes(
        cats.length > 1 ? h('div', { class: 'cats' }, h('button', { class: 'chip small' + (!cat ? ' on' : ''), onclick: () => { cat = null; limit = 120; fill(); } }, `All (${found.length})`),
          cats.map((c) => h('button', { class: 'chip small' + (c === cat ? ' on' : ''), onclick: () => { cat = c; limit = 120; fill(); } }, c))) : null,
        list && list.length && !shown.length ? h('p', { class: 'hint' }, `Nothing matches "${search.value.trim()}". Try one simpler word, such as chair, table or plant.`) : null,
        h('div', { class: 'model-grid' }, shown.slice(0, limit).map((m) => h('button', { class: 'model-card', disabled: !!busy, onclick: () => choose(m) },
          m.thumb ? h('img', { src: m.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'model-ph' }, icon('cube')),
          h('span', { class: 'model-name' }, m.name),
          m.size ? h('span', { class: 'sub' }, `${m.size[0].toFixed(2)} × ${m.size[1].toFixed(2)} m`) : null))),
        shown.length > limit ? h('button', { class: 'wide ghost', onclick: () => { limit += 120; fill(); } }, icon('down'), `Show more (${shown.length - limit} more)`) : null));
    }
    function draw() {
      body.replaceChildren(...nodes(
        h('div', { class: 'panel-head' }, h('h2', {}, title), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => finish(null) }, icon('close'))),
        h('div', { class: 'cats' }, sources.map((s) => h('button', { class: 'chip small' + (s === src ? ' on' : ''), onclick: () => open(s) }, s.name)),
          h('button', { class: 'chip small', onclick: fromFile }, icon('file'), 'From a file')),
        src ? h('p', { class: 'hint' }, list && src.id === 'polyhaven' ? `${src.note}. All ${list.length} of its models are here: things for a home come first, and search finds anything else.` : src.note) : h('p', { class: 'hint' }, 'No model library is switched on. Use a file, or turn a library on in More → Settings.'),
        busy ? h('p', { class: 'hint' }, busy) : null,
        error ? h('p', { class: 'hint bad' }, error) : null,
        src && !list && !error ? h('p', { class: 'hint' }, 'Loading the list…') : null,
        list && !list.length ? h('p', { class: 'hint' }, src.id === 'ha' ? 'No models yet. Copy .glb files into that folder on your Home Assistant machine and they appear here.' : 'This library is empty.') : null,
        list && list.length > 8 ? search : null,
        results));
      fill();
    }
    if (src) open(src); else draw();
  });
}

/** Settings rows for the model libraries. */
export function librarySettings(rerender) {
  const add = h('input', { type: 'url', placeholder: 'https://…/index.json', autocomplete: 'off' });
  return [
    h('h3', { class: 'pad' }, '3D model libraries'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: device.onlineLibrary !== false, onchange: (e) => { device.onlineLibrary = e.target.checked; saveDevice(); } }), 'Poly Haven: free public-domain models (downloads from polyhaven.com when you pick one)'),
    h('p', { class: 'hint' }, remote.base ? `Your own library: copy .glb files into ${remote.info?.folder || '/share/nidorama'}/library on the Home Assistant machine.` : 'Your own library: install the Nidorama add-on in Home Assistant, then copy .glb files into its library folder.'),
    (device.modelSources || []).map((url) => h('div', { class: 'row pad' }, h('div', { class: 'row-label' }, h('div', { class: 'sub' }, url)),
      h('button', { class: 'round small', 'aria-label': `Remove library ${url}`, onclick: () => { device.modelSources = device.modelSources.filter((u) => u !== url); saveDevice(); rerender(); } }, icon('trash')))),
    h('label', {}, 'Link another library (address of its index file)', add),
    h('button', { class: 'wide ghost', onclick: () => { const u = add.value.trim(); if (!/^https?:\/\/.+/.test(u)) return alert('Enter the full address of the library\'s index.json file.'); device.modelSources = [...new Set([...(device.modelSources || []), u])]; saveDevice(); rerender(); } }, icon('plus'), 'Link library'),
  ];
}
