// The model maker (#131): make a piece of furniture from simple parts, or change one already in the
// home (its shape, or just its colours). The 3D view, its handles and snapping, the extra shapes, mirror
// copy, four legs, the whole model's size and height, and "it is a light" come from ElCapitanDre's
// prototype (public issue #3, pull request #4).
//
// In the view: drag empty space to turn it, pinch or scroll to zoom, tap a part to choose it. The chosen
// part's body moves it across, its arrows move it along one direction, the dots on its faces resize it;
// faces snap to other parts and the floor, else to the grid. Drawn only when something changes.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { h, nodes, icon, seg, numField, textField, len, imperial } from './ui.js';
import { MODEL_CATEGORIES, fitModel, tiltMesh, mirrorPart, legsUnder, scaleModel, movePartAxis, resizePartFace } from './models.js';
import { partGeometry } from './shapes.js';
import { cutter, partKey } from './cuts.js';

const PALETTE = ['#f4f1ea', '#d9cbb3', '#c9a873', '#8a5a3b', '#5e3d29', '#3d4246', '#1f2421', '#8a9096', '#3f6fb5', '#7f9a8a', '#4f7f46', '#c0392b', '#e0a43c', '#d98aa0'];
const SHAPES = [['box', 'Box'], ['round', 'Rounded'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere'], ['dome', 'Dome'], ['cone', 'Cone'], ['wedge', 'Wedge']];
const shapeOf = (p) => p.shape || (p.radius ? 'round' : 'box');
const LIES = [['', 'Upright'], ['x', 'Left to right'], ['y', 'Front to back']];
const SLOPES = [['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']];
const coneEnds = (axis) => (axis === 'x' ? ['Right end', 'Left end'] : axis === 'y' ? ['Front end', 'Back end'] : ['Top', 'Bottom']);
const MAX_PARTS = 80;
const r3 = (v) => Math.round(v * 1000) / 1000;
/** What numbers and drags snap to: centimetres, or inches on a device set to imperial. */
const STEPS = () => (imperial() ? [[0.0127, '½ in'], [0.0508, '2 in']] : [[0.01, '1 cm'], [0.05, '5 cm']]);

/**
 * Open the maker. `model` is changed only on a copy; `onSave(model)` gets the finished model (fitted, from 0).
 * `actions` are extra buttons beside Save: [{ label, icon, run(model) }]. Leaving with unsaved changes asks first.
 */
export function openModelMaker({ model, heading, hint, saveLabel = 'Save to My models', onSave, actions = [] }) {
  let m = structuredClone(model), sel = m.parts.length ? 0 : -1, paintAll = false, dirty = false, step = STEPS()[0][0];
  const past = [], future = [];
  const app = document.getElementById('app');
  const viewBox = h('div', { class: 'maker-view', 'aria-label': 'The model: drag empty space to turn it, tap a part to choose it, drag the chosen part or its arrows to move it, its dots to resize it' });
  const strip = h('div', { class: 'maker-parts' });
  const adds = h('div', { class: 'maker-adds' });
  const insp = h('div', { class: 'maker-insp' });
  const dims = h('div', { class: 'maker-dims' });
  const undoBtn = h('button', { class: 'round small', 'aria-label': 'Undo', title: 'Undo', onclick: () => step_(past, future) }, icon('undo'));
  const redoBtn = h('button', { class: 'round small', 'aria-label': 'Redo', title: 'Redo', onclick: () => step_(future, past) }, icon('redo'));
  const nameIn = h('input', { type: 'text', class: 'maker-name', value: m.name, 'aria-label': 'Name', onchange: (e) => commit(() => (m.name = e.target.value.trim() || 'My model')) });
  const catSel = h('select', { 'aria-label': 'What kind of thing it is', onchange: (e) => commit(() => (m.category = e.target.value)) },
    MODEL_CATEGORIES.map(([id, name]) => h('option', { value: id, selected: id === m.category }, name)));
  const root = h('div', { class: 'maker', role: 'dialog', 'aria-label': heading || 'Model maker' },
    h('div', { class: 'maker-head' }, h('button', { class: 'round small', 'aria-label': 'Close', title: 'Close', onclick: () => leave() }, icon('close')), nameIn,
      h('button', { class: 'round small', 'aria-label': 'Fit the view', title: 'Fit view', onclick: () => view.fit(m) }, icon('expand')), undoBtn, redoBtn),
    hint ? h('p', { class: 'hint maker-hint' }, hint) : null,
    h('div', { class: 'maker-body' }, h('div', { class: 'maker-left' }, viewBox, dims, strip, adds), insp),
    h('div', { class: 'maker-foot' },
      h('label', { class: 'maker-cat' }, h('span', {}, 'Kind'), catSel),
      ...actions.map((a) => h('button', { class: 'wide ghost', onclick: () => a.run(finished()) }, a.icon ? icon(a.icon) : null, a.label)),
      h('button', { class: 'wide primary', onclick: () => { if (!m.parts.length) return void alert('The model needs at least one part.'); const f = finished(); close(); onSave?.(f); } }, icon('check'), saveLabel)));
  app.append(root);

  // ---------- history: every change can be undone; a drag is one step ----------
  const snap = () => JSON.stringify({ m, sel });
  function commit(fn, { refit = false } = {}) {
    const before = snap();
    fn();
    if (snap() === before) return;
    past.push(before); if (past.length > 80) past.shift();
    future.length = 0; dirty = true;
    draw(refit);
  }
  function step_(from, to) { if (!from.length) return; to.push(snap()); ({ m, sel } = JSON.parse(from.pop())); dirty = true; draw(); }
  const finished = () => fitModel(structuredClone({ ...m, name: (m.name || '').trim() || 'My model' }));
  const leave = () => { if (!dirty || confirm('Leave the model maker without saving your changes?')) close(); };

  let dragFrom = null;
  const view = preview(viewBox, {
    pick: (i) => { sel = i; draw(); },
    snapping: () => ({ tol: step >= 0.04 ? 0.04 : 0.02, step }),
    dragStart: () => { dragFrom = snap(); },
    drag: (fn) => { fn(m, sel); view.update(m, sel); },
    dragEnd: () => {
      const before = dragFrom; dragFrom = null;
      if (before == null || before === snap()) return;
      past.push(before); if (past.length > 80) past.shift();
      future.length = 0; dirty = true; draw();
    },
  });

  // ---------- the chosen part ----------
  function addPart(shape) {
    commit(() => {
      const size = m.parts.length ? fitModel(structuredClone(m)).size : [0, 0, 0];
      const p = { name: `${(SHAPES.find((s) => s[0] === (shape || 'box')) || ['', 'Box'])[1]} ${m.parts.length + 1}`, min: [r3(size[0] + 0.05), 0, 0], max: [r3(size[0] + 0.35), 0.3, 0.3], color: m.parts[sel]?.color || '#c9a873' };
      if (shape === 'cut') { p.cut = true; p.name = `Cut-out ${m.parts.length + 1}`; } else if (shape && shape !== 'round') p.shape = shape;
      if (shape === 'round') p.radius = 0.03;
      m.parts.push(p);
      sel = m.parts.length - 1;
    });
  }
  function inspector() {
    const p = m.parts[sel], full = m.parts.length >= MAX_PARTS;
    const whole = wholeModel();
    if (!p) return [h('p', { class: 'hint' }, m.parts.length ? 'Tap a part on the model, or in the strip, to change it.' : 'Add a shape to begin.'), ...whole];
    const set = (fn) => commit(() => fn(m.parts[sel]));
    const size = [0, 1, 2].map((k) => p.max[k] - p.min[k]);
    const snapTo = (v) => r3(Math.round(v / step) * step);
    const resize = (k, v) => set((q) => { q.max[k] = r3(q.min[k] + Math.max(0.005, v)); });
    const move = (k, v) => set((q) => { const w = q.max[k] - q.min[k]; q.min[k] = r3(v); q.max[k] = r3(v + w); });
    const shape = shapeOf(p);
    const used = [...new Set(m.parts.map((q) => q.color))];
    // Painting from the picker: the parts change colour live while choosing (not kept in undo), then once for undo when chosen.
    const chosen = m.parts.map((q, i) => i === sel || (paintAll && q.color === p.color));
    const paint = (c) => { m.parts.forEach((q, i) => { if (chosen[i] && q._was) { q.color = q._was; delete q._was; } }); commit(() => { m.parts.forEach((q, i) => { if (chosen[i]) q.color = c; }); }); };
    const preview = (c) => { m.parts.forEach((q, i) => { if (chosen[i]) { q._was ||= q.color; q.color = c; } }); view.update(m, sel); };
    const tilt = p.tilt || [0, 0, 0];
    const setTilt = (k, v) => set((q) => { const t = [...(q.tilt || [0, 0, 0])]; t[k] = Math.round(v * 10) / 10; if (t.some((x) => x)) q.tilt = t; else delete q.tilt; });
    const [endA, endB] = coneEnds(p.axis);
    return nodes(
      textField('Part name', p.name || '', (v) => set((q) => (q.name = v || q.name))),
      h('div', { class: 'maker-sub' }, 'Colour'),
      h('div', { class: 'swatches' },
        [...used, ...PALETTE.filter((c) => !used.includes(c))].slice(0, 16).map((c) => h('button', { class: 'swatch-btn' + (c === p.color ? ' on' : ''), style: `background:${c}`, 'aria-label': `Colour ${c}`, onclick: () => paint(c) })),
        h('span', { class: 'colbtn' }, h('input', { type: 'color', value: p.color, 'aria-label': 'Any colour', oninput: (e) => preview(e.target.value), onchange: (e) => paint(e.target.value) }))),
      seg([[false, 'This part'], [true, 'Every part this colour']], paintAll, (v) => { paintAll = v; draw(); }),
      h('div', { class: 'maker-sub' }, 'Shape'),
      h('div', { class: 'seg wrap' }, SHAPES.map(([v, label]) => h('button', { class: v === shape ? 'on' : '', onclick: () => set((q) => {
        for (const k of ['shape', 'radius', 'axis', 'top', 'bottom', 'slope']) delete q[k];
        if (v === 'round') q.radius = r3(Math.min(0.03, ...size.map((s) => s / 3)));
        else if (v !== 'box') q.shape = v;
      }) }, label))),
      shape === 'round' ? numField('Rounding', p.radius, (v) => set((q) => (q.radius = r3(Math.max(0.002, v)))), { min: 0.002, max: 2, step: 0.005 }) : null,
      shape === 'cylinder' || shape === 'cone' ? h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Lies'), seg(LIES, p.axis || '', (v) => set((q) => { if (v) q.axis = v; else delete q.axis; }))) : null,
      shape === 'cone' ? h('div', { class: 'fields' },
        numField(`${endA} width`, Math.round((p.top ?? 0) * 100), (v) => set((q) => { const t = Math.min(100, Math.max(0, v)) / 100; if (t) q.top = t; else delete q.top; }), { min: 0, max: 100, step: 5, unit: '%' }),
        numField(`${endB} width`, Math.round((p.bottom ?? 1) * 100), (v) => set((q) => { const b = Math.min(100, Math.max(0, v)) / 100; if (b !== 1) q.bottom = b; else delete q.bottom; }), { min: 0, max: 100, step: 5, unit: '%' })) : null,
      shape === 'wedge' ? h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Slopes down to the'), seg(SLOPES, p.slope || 'front', (v) => set((q) => { if (v === 'front') delete q.slope; else q.slope = v; }))) : null,
      h('div', { class: 'maker-sub' }, 'Size'),
      h('div', { class: 'fields' }, numField('Width', size[0], (v) => resize(0, snapTo(v)), { min: 0.005, max: 20, step }), numField('Depth', size[1], (v) => resize(1, snapTo(v)), { min: 0.005, max: 20, step }), numField('Height', size[2], (v) => resize(2, snapTo(v)), { min: 0.005, max: 20, step })),
      h('div', { class: 'maker-sub' }, 'Place'),
      h('div', { class: 'fields' }, numField('From left', p.min[0], (v) => move(0, snapTo(v)), { min: -20, max: 20, step }), numField('From back', p.min[1], (v) => move(1, snapTo(v)), { min: -20, max: 20, step }), numField('Off floor', p.min[2], (v) => move(2, snapTo(v)), { min: -20, max: 20, step })),
      h('div', { class: 'maker-sub' }, 'Tilt', h('span', { class: 'sub' }, ' for sloped backs and parts at an angle')),
      h('div', { class: 'fields' }, numField('Lean back', tilt[0], (v) => setTilt(0, v), { min: -180, max: 180, step: 1, unit: '°' }), numField('Lean right', tilt[1], (v) => setTilt(1, v), { min: -180, max: 180, step: 1, unit: '°' }), numField('Turn', tilt[2], (v) => setTilt(2, v), { min: -180, max: 180, step: 1, unit: '°' })),
      numField('See-through', p.opacity == null ? 0 : Math.round((1 - p.opacity) * 100), (v) => set((q) => { if (v <= 0) delete q.opacity; else q.opacity = Math.round(100 - Math.min(95, v)) / 100; }), { step: 5, min: 0, max: 95, unit: '%' }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!p.cut, onchange: (e) => set((q) => { if (e.target.checked) q.cut = true; else delete q.cut; }) }), 'Cut out: removes its shape from the parts it overlaps'),
      p.cut ? h('p', { class: 'hint' }, 'Shown in red here, and not drawn on the plan. A box over half a cylinder makes a half-round bench; over three quarters, a corner bath.') : null,
      h('div', { class: 'maker-tools' },
        h('button', { class: 'chip small', disabled: full, onclick: () => commit(() => { const q = structuredClone(m.parts[sel]); q.min[0] = r3(q.min[0] + 0.05); q.max[0] = r3(q.max[0] + 0.05); q.name = `${q.name || 'Part'} copy`; m.parts.push(q); sel = m.parts.length - 1; }) }, icon('copy'), 'Copy'),
        h('button', { class: 'chip small', disabled: full, title: 'A copy on the other side of the model, flipped left ↔ right', onclick: () => commit(() => { sel = mirrorPart(m, sel); }) }, icon('rotate'), 'Mirror copy'),
        h('button', { class: 'chip small', disabled: full || p.min[2] < 0.02, title: 'Four legs from the floor up to the underside of this part', onclick: () => commit(() => legsUnder(m, sel)) }, icon('plus'), 'Four legs under it'),
        h('button', { class: 'chip small danger', onclick: () => commit(() => { m.parts.splice(sel, 1); sel = Math.min(sel, m.parts.length - 1); }) }, icon('trash'), 'Delete')),
      ...whole);
  }
  /** The whole model: its size, how high it is placed, whether it is a light, and what numbers snap to. */
  function wholeModel() {
    const f = m.parts.length ? fitModel(structuredClone(m)) : null;
    return [
      h('div', { class: 'msep' }),
      h('div', { class: 'maker-sub' }, 'The whole model'),
      f ? h('div', { class: 'fields' }, ...['Width', 'Depth', 'Height'].map((label, k) => numField(label, f.size[k], (v) => commit(() => scaleModel(m, k, r3(Math.max(0.01, v))), { refit: true }), { min: 0.01, max: 50, step }))) : null,
      numField('Placed at height', m.z || 0, (v) => commit(() => { if (v) m.z = r3(v); else delete m.z; }), { min: -5, max: 10, step }),
      h('p', { class: 'hint' }, 'For things on a wall, like a TV, a shelf or a mirror.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!m.light, onchange: (e) => commit(() => { if (e.target.checked) m.light = { z: r3((f?.size[2] || 0.5) * 0.8) }; else delete m.light; }) }), 'It is a light (it glows, and can be connected to a light)'),
      m.light ? numField('Bulb height in the model', m.light.z, (v) => commit(() => (m.light.z = r3(v))), { min: -5, max: 10, step }) : null,
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Numbers snap to'), seg(STEPS(), step, (v) => { step = v; draw(); })),
    ];
  }
  // Redrawing the inspector while its colour picker is open would close the picker (#4 feedback): wait until it closes.
  const pickerOpen = () => document.activeElement?.matches?.('input[type="color"]') && insp.contains(document.activeElement);
  insp.addEventListener('focusout', (e) => { if (e.target.matches?.('input[type="color"]')) setTimeout(() => draw(), 0); });
  function draw(refit = false) {
    undoBtn.disabled = !past.length; redoBtn.disabled = !future.length;
    if (nameIn.value !== m.name && document.activeElement !== nameIn) nameIn.value = m.name;
    catSel.value = m.category;
    const f = m.parts.length ? fitModel(structuredClone(m)) : null;
    dims.textContent = f ? `${len(f.size[0])} wide · ${len(f.size[1])} deep · ${len(f.size[2])} high · ${m.parts.length} part${m.parts.length === 1 ? '' : 's'}` : 'No parts yet';
    strip.replaceChildren(...m.parts.map((p, i) => h('button', { class: 'chip small' + (i === sel ? ' on' : ''), onclick: () => { sel = i; draw(); } }, h('i', { class: 'dot', style: `background:${p.color}` }), p.name || `Part ${i + 1}`)));
    strip.querySelector('.on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const full = m.parts.length >= MAX_PARTS;
    adds.replaceChildren(h('span', { class: 'sub' }, 'Add'), ...[['box', 'Box'], ['round', 'Rounded'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere'], ['cone', 'Cone'], ['wedge', 'Wedge'], ['cut', 'Cut-out']].map(([s, label]) =>
      h('button', { class: 'chip small', disabled: full, onclick: () => addPart(s) }, icon('plus'), label)));
    if (!pickerOpen()) insp.replaceChildren(...inspector());
    view.update(m, sel, refit);
  }
  function close() { view.dispose(); root.remove(); }
  draw();
  return { close };
}

/** The 3D view: the model drawn with the same shapes as the plan, with handles on the chosen part. */
function preview(host, hooks) {
  const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)]; // model x, y, z in view space
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement, readout = h('div', { class: 'maker-readout', hidden: true });
  canvas.classList.add('maker-canvas');
  host.append(canvas, readout);
  const scene = new THREE.Scene(), group = new THREE.Group(), handles = new THREE.Group();
  const sun = new THREE.DirectionalLight('#fff4e6', 2.2);
  sun.position.set(-2, 5, 4);
  scene.add(new THREE.HemisphereLight('#ffffff', '#6f6a63', 2.1), sun, group, handles);
  const grid = new THREE.GridHelper(6, 60, '#7d847f', '#4a514d');
  grid.material.transparent = true; grid.material.opacity = 0.4;
  scene.add(grid);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  const controls = new OrbitControls(cam, canvas);
  controls.maxPolarAngle = Math.PI * 0.495;
  // Handles keep the same size on screen whatever the zoom; dots on faces turned away are hidden and cannot be grabbed.
  const render = () => {
    for (const k of handles.children) {
      k.scale.setScalar(cam.position.distanceTo(k.position) * 0.016);
      const n = k.userData.normal;
      k.visible = !n || n.dot(cam.position.clone().sub(k.position)) > 0;
    }
    renderer.render(scene, cam);
  };
  controls.addEventListener('change', render);
  let meshes = [], fitted = false, off = [0, 0], last = null;
  const size = () => { const w = host.clientWidth || 300, hh = host.clientHeight || 300; renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); render(); };
  const ro = new ResizeObserver(size);
  ro.observe(host);
  const dispose = (o) => o.traverse((x) => { if (!x.userData?.sharedGeometry) x.geometry?.dispose(); x.material?.dispose?.(); });
  const clear = () => { for (const g of [group, handles]) for (const o of [...g.children]) { dispose(o); g.remove(o); } meshes = []; };
  let dragging = false; // while a part is dragged, cuts wait until it is let go (worked out again on the drop)
  // Model → view: x → x, y (to the front) → z, z (up) → y; `off` centres the model on the grid (fixed between fits, so nothing jumps while dragging).
  const toView = (x, y, z) => new THREE.Vector3(x - off[0], z, y - off[1]);
  function fit(m) {
    const xs = m.parts.flatMap((p) => [p.min[0], p.max[0]]), ys = m.parts.flatMap((p) => [p.min[1], p.max[1]]);
    off = xs.length ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] : [0, 0];
    update(m, last?.sel ?? -1, false, true);
    const b = new THREE.Box3(); for (const mesh of meshes) b.expandByObject(mesh);
    if (b.isEmpty()) b.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const mid = b.getCenter(new THREE.Vector3()), rad = Math.max(0.3, b.getSize(new THREE.Vector3()).length() / 2);
    controls.target.copy(mid);
    cam.position.copy(mid).add(new THREE.Vector3(-0.6, 0.55, 1).normalize().multiplyScalar(rad / Math.sin((cam.fov * Math.PI) / 360) * 1.15));
    cam.near = rad / 100; cam.far = rad * 100; cam.updateProjectionMatrix();
    controls.update();
    render();
  }
  const handleMat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const pickMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  /** A handle: what is seen, with a bigger invisible ball around it that is easy to hit with a finger. */
  function handle(kind, pos, extra) {
    const g = new THREE.Group();
    const look = kind === 'arrow' ? new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 20), handleMat('#F2B544')) : new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), handleMat('#ffffff'));
    if (kind === 'arrow' && extra.axis === 0) look.rotation.z = -Math.PI / 2;
    if (kind === 'arrow' && extra.axis === 1) look.rotation.x = Math.PI / 2;
    if (kind !== 'arrow') { const ring = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), handleMat('#F2B544')); ring.renderOrder = 3; g.add(ring); }
    look.renderOrder = 4;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), pickMat());
    hit.userData = { handle: kind, ...extra };
    g.add(look, hit);
    g.position.copy(pos);
    if (kind === 'face') g.userData.normal = AXES[extra.axis].clone().multiplyScalar(extra.side === 'max' ? 1 : -1);
    handles.add(g);
    return hit;
  }
  let hits = [];
  function update(m, sel, refit = false, noFit = false) {
    last = { m, sel };
    clear();
    const at = (mesh, p) => { mesh.position.copy(toView((p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2)); tiltMesh(THREE, mesh, p.tilt); return mesh; };
    const ok = (p) => [0, 1, 2].every((k) => p.max[k] - p.min[k] > 0);
    // Cut-outs (#141): shown as see-through red so they can be chosen and dragged; they cut the solid parts they overlap.
    const cut = cutter(THREE, m.parts.filter((p) => p.cut && ok(p)).map((p) => { const mesh = at(new THREE.Mesh(partGeometry(p, p.max[0] - p.min[0], p.max[2] - p.min[2], p.max[1] - p.min[1])), p); return { geometry: mesh.geometry, position: mesh.position, quaternion: mesh.quaternion, key: partKey(p) }; }));
    m.parts.forEach((p, i) => {
      const w = p.max[0] - p.min[0], d = p.max[1] - p.min[1], hh = p.max[2] - p.min[2];
      if (w <= 0 || d <= 0 || hh <= 0) return;
      const geo = partGeometry(p, w, hh, d);
      const on = i === sel;
      const mat = p.cut
        ? new THREE.MeshBasicMaterial({ color: '#ff5a5a', transparent: true, opacity: on ? 0.32 : 0.18, depthWrite: false })
        : new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.8, transparent: p.opacity != null, opacity: p.opacity ?? 1, emissive: on ? '#F2B544' : '#000000', emissiveIntensity: on ? 0.18 : 0 });
      const mesh = at(new THREE.Mesh(geo, mat), p);
      if (!p.cut && !dragging) cut(mesh, partKey(p));
      mesh.userData.part = i;
      group.add(mesh);
      meshes.push(mesh);
      if (on || p.cut) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: p.cut ? '#ff5a5a' : '#F2B544', depthTest: false, transparent: true, opacity: on ? 1 : 0.6 }));
        edges.renderOrder = 2;
        mesh.add(edges);
      }
    });
    // The chosen part's handles: a dot on each face (resize along that axis), and an arrow beyond its right face, front face and top (move).
    hits = [];
    const p = m.parts[sel];
    if (p) {
      const c = [0, 1, 2].map((k) => (p.min[k] + p.max[k]) / 2);
      for (const k of [0, 1, 2]) for (const side of ['min', 'max']) { const at = [...c]; at[k] = p[side][k]; hits.push(handle('face', toView(...at), { axis: k, side })); }
      for (const k of [0, 1, 2]) { const at = [...c]; at[k] = p.max[k] + Math.max(0.12, (p.max[k] - p.min[k]) * 0.25); hits.push(handle('arrow', toView(...at), { axis: k })); }
    }
    if (!noFit && (refit || !fitted)) { fitted = true; fit(m); } else render();
  }

  // ---------- pointer: handles and the chosen part first, otherwise the view turns ----------
  const ray = new THREE.Raycaster();
  const rayAt = (e) => { const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam); return ray.ray.clone(); };
  /** Where along a model axis (through `origin`, in view space) the pointer's ray passes closest. */
  const alongAxis = (r, origin, dir) => {
    const w0 = origin.clone().sub(r.origin), b = dir.dot(r.direction), d = dir.dot(w0), e = r.direction.dot(w0), den = 1 - b * b;
    return Math.abs(den) < 1e-4 ? null : (b * e - d) / den;
  };
  let down = null, drag = null;
  const say = (text) => { readout.hidden = !text; readout.textContent = text || ''; };
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    drag = null;
    if (!last || !last.m.parts[last.sel]) return;
    const r = rayAt(e);
    ray.ray.copy(r);
    const h0 = ray.intersectObjects(hits.filter((x) => x.parent.visible), false)[0]?.object.userData;
    const body = !h0 && ray.intersectObjects(meshes, false)[0];
    if (!h0 && body?.object.userData.part !== last.sel) return; // empty space or another part: the view turns (or a tap chooses it)
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    const p = last.m.parts[last.sel];
    const originOf = (axis) => toView(...[0, 1, 2].map((k) => (k === axis ? 0 : (p.min[k] + p.max[k]) / 2)));
    if (h0?.handle === 'face') drag = { kind: 'face', axis: h0.axis, side: h0.side, origin: originOf(h0.axis), start: p[h0.side][h0.axis] };
    else if (h0?.handle === 'arrow') drag = { kind: 'arrow', axis: h0.axis, origin: originOf(h0.axis), start: p.min[h0.axis] };
    else { const y = body.point.y; const at = r.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3()); drag = at && { kind: 'move', y, at, start: [p.min[0], p.min[1]] }; }
    if (drag) { drag.grab = drag.kind === 'move' ? null : alongAxis(r, drag.origin, AXES[drag.axis]); drag.started = false; }
  }, { capture: true });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !down) return;
    if (!drag.started) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return; drag.started = true; dragging = true; hooks.dragStart(); }
    const r = rayAt(e), { tol, step } = hooks.snapping();
    hooks.drag((m, sel) => {
      const p = m.parts[sel];
      if (drag.kind === 'move') {
        const at = r.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -drag.y), new THREE.Vector3());
        if (!at) return;
        const bits = [];
        for (const [k, delta] of [[0, at.x - drag.at.x], [1, at.z - drag.at.z]]) {
          const mv = movePartAxis(m, sel, k, drag.start[k], delta, tol, step);
          p.min[k] = mv.min; p.max[k] = mv.max;
          bits.push(`${k ? 'from the back' : 'from the left'} ${len(mv.min)}${mv.snapped ? ' ⟷' : ''}`);
        }
        say(bits.join(' · '));
      } else {
        const t = alongAxis(r, drag.origin, AXES[drag.axis]);
        if (t == null || drag.grab == null) return;
        const k = drag.axis;
        if (drag.kind === 'arrow') {
          const mv = movePartAxis(m, sel, k, drag.start, t - drag.grab, tol, step);
          p.min[k] = mv.min; p.max[k] = mv.max;
          say(`${['from the left', 'from the back', 'off the floor'][k]} ${len(mv.min)}${mv.snapped ? ' ⟷' : ''}`);
        } else {
          const mv = resizePartFace(m, sel, k, drag.side, drag.start + (t - drag.grab), tol, step);
          p.min[k] = mv.min; p.max[k] = mv.max;
          say(`${['width', 'depth', 'height'][k]} ${len(mv.max - mv.min)}${mv.snapped ? ' ⟷' : ''}`);
        }
      }
    });
  });
  canvas.addEventListener('pointerup', (e) => {
    const was = drag, tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 6;
    down = null; drag = null; controls.enabled = true; say(''); dragging = false;
    if (was?.started) return hooks.dragEnd();
    if (!tap) return;
    ray.ray.copy(rayAt(e));
    const hit = ray.intersectObjects(meshes, false)[0];
    hooks.pick(hit ? hit.object.userData.part : -1);
  });
  canvas.addEventListener('pointercancel', () => { dragging = false; if (drag?.started) hooks.dragEnd(); down = null; drag = null; controls.enabled = true; say(''); });
  // For automated tests: where a model point (metres) is on the screen.
  canvas.projectPoint = (x, y, z) => { const v = toView(x, y, z).project(cam), r = canvas.getBoundingClientRect(); return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]; };
  return {
    update, fit,
    dispose: () => { ro.disconnect(); controls.dispose(); clear(); renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove(); },
  };
}
