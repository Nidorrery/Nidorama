// The model maker (phases 2 to 4 of My models): make or change a model of your own from boxes, cylinders,
// spheres, domes, cones and wedges (see shapes.js),
// with a 3D view to turn around, tap parts in, and drag them: the chosen part's body moves it across, its
// arrows move it along one direction each (across, front to back, up), and the dots on its faces resize it. Dragged faces snap to other parts and to the floor. Works on a draft in metres (see mymodels.js); saving
// hands back a checked model item. One graphics context, drawn only when something changes (wall tablets).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { partGeometry } from './shapes.js';
import { h, nodes, icon, seg, numField, textField, imperial, len as showLen } from './ui.js';
import { MAX_DRAFT_PARTS, draftSize, fromDraft, duplicatePart, mirrorPart, legsUnder, scaleDraft, movePartAxis, resizePartFace } from './mymodels.js';

const SHAPES = [['box', 'Box'], ['round', 'Rounded'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere'], ['dome', 'Dome'], ['cone', 'Cone'], ['wedge', 'Wedge']];
const shapeOf = (p) => p.shape || (p.radius ? 'round' : 'box');
const shapeName = { box: 'Box', round: 'Rounded box', cylinder: 'Cylinder', sphere: 'Sphere', dome: 'Dome', cone: 'Cone', wedge: 'Wedge' };
const LIES = [['', 'Upright'], ['x', 'Left to right'], ['y', 'Front to back']];
const SLOPES = [['front', 'Front'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right']];
/** A cone's two ends, named for the way it lies. */
const coneEnds = (axis) => (axis === 'x' ? ['Right end', 'Left end'] : axis === 'y' ? ['Front end', 'Back end'] : ['Top', 'Bottom']);
const mm = (v) => Math.round(v * 1000) / 1000; // lengths are metres, kept to the millimetre
/** What numbers snap to, in metres: centimetres, or inches on a device set to imperial (lengths show in its units too). */
const STEPS = () => (imperial() ? [[0.0127, '½ in'], [0.0508, '2 in']] : [[0.01, '1 cm'], [0.05, '5 cm']]);

/**
 * Open the maker. `draft`: what to start from. `onSave(item)` gets the finished model; `id`/`rev` keep a model's
 * identity when it is being changed. Leaving with unsaved changes asks first.
 */
export function openModelMaker({ draft, id, rev = 1, title = 'Model maker', onSave }) {
  let dr = structuredClone(draft), sel = dr.parts.length ? 0 : -1, step = STEPS()[0][0], dirty = false;
  const past = [], future = [];
  const snapTo = (v) => mm(Math.round(v / step) * step);
  /** Every change goes through here, so it can be undone. */
  const change = (fn, { refit = false } = {}) => {
    const before = JSON.stringify({ dr, sel });
    fn(dr);
    if (JSON.stringify({ dr, sel }) === before) return; // nothing changed (a field left without a new value): no undo step
    past.push(before); if (past.length > 80) past.shift();
    future.length = 0;
    dirty = true;
    redraw(refit);
  };
  const back = (from, to) => { if (!from.length) return; to.push(JSON.stringify({ dr, sel })); ({ dr, sel } = JSON.parse(from.pop())); dirty = true; redraw(); };

  const side = h('div', { class: 'mm-side' });
  const viewHost = h('div', { class: 'mm-view', 'aria-label': '3D view of the model: drag empty space to turn it, tap a part to choose it, drag the chosen part or its arrows to move it, its dots to resize it' });
  // A drag changes the part live; it becomes one undo step when the finger lifts.
  let dragFrom = null;
  const view = preview(viewHost, {
    pick: (i) => { sel = i; redraw(); },
    snapping: () => ({ tol: step >= 0.04 ? 0.04 : 0.02, step }),
    dragStart: () => { dragFrom = JSON.stringify({ dr, sel }); },
    drag: (fn) => { fn(dr, sel); view.update(dr, sel); },
    dragEnd: () => {
      const before = dragFrom; dragFrom = null;
      if (before == null || before === JSON.stringify({ dr, sel })) return;
      past.push(before); if (past.length > 80) past.shift();
      future.length = 0; dirty = true; redraw();
    },
  });
  const wrap = h('div', { class: 'modal-wrap mm-wrap' }, h('div', { class: 'modal modelmaker', role: 'dialog', 'aria-label': title },
    h('div', { class: 'panel-head' }, h('h2', {}, title), h('button', { class: 'round small', 'aria-label': 'Close', onclick: () => leave() }, icon('close'))),
    h('div', { class: 'mm-main' }, h('div', { class: 'mm-left' }, viewHost,
      h('div', { class: 'btns mm-viewbtns' },
        h('button', { class: 'chip small', onclick: () => view.fit(dr) }, icon('expand'), 'Fit view'),
        h('button', { class: 'chip small', 'aria-label': 'Undo', onclick: () => back(past, future) }, icon('undo')),
        h('button', { class: 'chip small', 'aria-label': 'Redo', onclick: () => back(future, past) }, icon('redo')))), side)));
  document.getElementById('app').append(wrap);
  const close = () => { view.dispose(); wrap.remove(); };
  const leave = () => { if (!dirty || confirm('Leave the model maker without saving your changes?')) close(); };
  const save = () => {
    const item = fromDraft(dr, id, rev);
    if (!item) return void alert('The model needs at least one part with a width, depth and height.');
    if (onSave(item) !== false) close();
  };

  function partFields(p) {
    const set = (fn) => change(() => fn(p));
    const pos = (k, label) => numField(label, p.min[k], (v) => set(() => { const w = p.max[k] - p.min[k]; p.min[k] = snapTo(v); p.max[k] = mm(p.min[k] + w); }), { step, min: -10, max: 50 });
    const len = (k, label) => numField(label, mm(p.max[k] - p.min[k]), (v) => set(() => { p.max[k] = mm(p.min[k] + Math.max(0.005, snapTo(v))); }), { step, min: 0.005, max: 50 });
    const shape = shapeOf(p);
    return [
      h('div', { class: 'stack mm-shape' }, h('div', { class: 'row-label' }, 'Shape'), h('div', { class: 'seg wrap' }, SHAPES.map(([v, label]) => h('button', { class: v === shape ? 'on' : '', onclick: () => set(() => {
        for (const k of ['shape', 'radius', 'axis', 'top', 'bottom', 'slope']) delete p[k];
        if (v === 'round') p.radius = mm(Math.max(0.01, Math.min(0.05, Math.min(...[0, 1, 2].map((k) => p.max[k] - p.min[k])) / 4)));
        else if (v !== 'box') p.shape = v;
      }) }, label)))),
      shape === 'cylinder' || shape === 'cone' ? h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Lies'), seg(LIES, p.axis || '', (v) => set(() => { if (v) p.axis = v; else delete p.axis; }))) : null,
      shape === 'cone' ? h('div', { class: 'fields' },
        numField(`${coneEnds(p.axis)[0]} width`, Math.round((p.top ?? 0) * 100), (v) => set(() => { if (v > 0) p.top = v / 100; else delete p.top; }), { step: 5, min: 0, max: 100, unit: '%' }),
        numField(`${coneEnds(p.axis)[1]} width`, Math.round((p.bottom ?? 1) * 100), (v) => set(() => { if (v < 100) p.bottom = v / 100; else delete p.bottom; }), { step: 5, min: 0, max: 100, unit: '%' })) : null,
      shape === 'wedge' ? h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Slopes down to the'), seg(SLOPES, p.slope || 'front', (v) => set(() => { if (v === 'front') delete p.slope; else p.slope = v; }))) : null,
      h('div', { class: 'fields' }, pos(0, 'From the left'), pos(1, 'From the back'), pos(2, 'Off the floor'), len(0, 'Width'), len(1, 'Depth'), len(2, 'Height')),
      h('div', { class: 'fields' },
        shape === 'round' ? numField('Rounding', p.radius, (v) => set(() => { p.radius = mm(Math.max(0.001, v)); }), { step: 0.005, min: 0.001, max: 1 }) : null,
        numField('See-through', p.opacity == null ? 0 : Math.round((1 - p.opacity) * 100), (v) => set(() => { if (v <= 0) delete p.opacity; else p.opacity = Math.round(100 - Math.min(95, v)) / 100; }), { step: 5, min: 0, max: 95, unit: '%' }),
        h('label', { class: 'field' }, h('span', {}, 'Colour'), h('span', { class: 'colbtn' }, h('input', { type: 'color', value: p.color, 'aria-label': 'Colour of this part', onchange: (e) => set(() => { p.color = e.target.value; }) })))),
      h('div', { class: 'btns mm-tools' },
        h('button', { class: 'chip small', onclick: () => change(() => { sel = duplicatePart(dr, sel); }), disabled: dr.parts.length >= MAX_DRAFT_PARTS }, icon('copy'), 'Duplicate'),
        h('button', { class: 'chip small', onclick: () => change(() => { sel = mirrorPart(dr, sel); }), disabled: dr.parts.length >= MAX_DRAFT_PARTS }, icon('rotate'), 'Mirror copy'),
        h('button', { class: 'chip small', title: 'Four legs from the floor up to the underside of this part', onclick: () => change(() => legsUnder(dr, sel)), disabled: p.min[2] < 0.02 || dr.parts.length > MAX_DRAFT_PARTS - 4 }, icon('plus'), 'Legs under it'),
        h('button', { class: 'chip small danger', onclick: () => change(() => { dr.parts.splice(sel, 1); sel = Math.min(sel, dr.parts.length - 1); }) }, icon('trash'), 'Delete')),
    ];
  }

  function redraw(refit = false) {
    view.update(dr, sel, refit);
    const size = draftSize(dr), p = dr.parts[sel];
    const add = (shape) => change(() => {
      const [w, d] = size, s = 0.3;
      dr.parts.push({ min: [mm(w / 2 - s / 2), mm(Math.max(0, d / 2 - s / 2)), 0], max: [mm(w / 2 + s / 2), mm(Math.max(0, d / 2 - s / 2) + s), s], color: '#cfc8bd', ...(shape ? { shape } : {}) });
      sel = dr.parts.length - 1;
    });
    const full = dr.parts.length >= MAX_DRAFT_PARTS;
    side.replaceChildren(...nodes(
      textField('Name', dr.name, (v) => change(() => { dr.name = v || 'My model'; })),
      h('h3', {}, 'The whole model'),
      dr.parts.length ? h('div', { class: 'fields' },
        ...['Width', 'Depth', 'Height'].map((label, k) => numField(label, size[k], (v) => change(() => scaleDraft(dr, k, mm(Math.max(0.01, v))), { refit: true }), { step, min: 0.01, max: 50 })),
        numField('Placed at height', dr.z || 0, (v) => change(() => { dr.z = mm(v); }), { step, min: -5, max: 10 })) : null,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!dr.light, onchange: (e) => change(() => { dr.light = e.target.checked ? { z: mm(size[2] * 0.8) } : null; }) }), 'It is a light (it can glow and be connected to a light)'),
      dr.light ? numField('Bulb height in the model', dr.light.z, (v) => change(() => { dr.light.z = mm(v); }), { step, min: -5, max: 10 }) : null,
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, 'Numbers snap to'), seg(STEPS(), step, (v) => { step = v; redraw(); })),
      h('h3', {}, `Parts (${dr.parts.length}${full ? ', the most a model can have' : ''})`),
      h('div', { class: 'mm-parts' }, dr.parts.map((q, i) => h('button', { class: 'chip small' + (i === sel ? ' on' : ''), onclick: () => { sel = i; redraw(); } },
        h('span', { class: 'mm-swatch', style: `background:${q.color}` }), `${i + 1} · ${shapeName[shapeOf(q)]}`))),
      h('div', { class: 'btns mm-add' }, [[null, 'Box'], ['cylinder', 'Cylinder'], ['sphere', 'Sphere'], ['cone', 'Cone'], ['wedge', 'Wedge']].map(([shape, label]) =>
        h('button', { class: 'chip small', onclick: () => add(shape), disabled: full }, icon('plus'), label))),
      p ? [h('h3', {}, `Part ${sel + 1}`), ...partFields(p)] : h('p', { class: 'hint' }, 'Add a shape to start.'),
      h('div', { class: 'btns mm-foot' },
        h('button', { class: 'wide ghost', onclick: () => leave() }, 'Cancel'),
        h('button', { class: 'wide primary', onclick: save }, icon('check'), 'Save model'))));
  }
  redraw(true);
}

/** The 3D view: the draft drawn with the same shapes as the plan. Dragging empty space turns it, a tap chooses a part. */
function preview(host, hooks) {
  const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)]; // model x, y, z in view space
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement, readout = h('div', { class: 'mm-readout', hidden: true });
  host.append(canvas, readout);
  const scene = new THREE.Scene(), group = new THREE.Group(), handles = new THREE.Group();
  const sun = new THREE.DirectionalLight('#fff4e6', 2.2);
  sun.position.set(-2, 5, 4);
  scene.add(new THREE.HemisphereLight('#ffffff', '#8c8378', 2.1), sun, group, handles);
  const grid = new THREE.GridHelper(6, 60, '#9a958c', '#cfcac2');
  grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(grid);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  const controls = new OrbitControls(cam, canvas);
  controls.maxPolarAngle = Math.PI * 0.495;
  // Handles keep the same size on screen, whatever the zoom.
  // Dots on faces turned away from the camera are hidden (and cannot be grabbed), so only the ones in front show.
  const draw = () => {
    for (const k of handles.children) {
      k.scale.setScalar(cam.position.distanceTo(k.position) * 0.016);
      const n = k.userData.normal;
      k.visible = !n || n.dot(cam.position.clone().sub(k.position)) > 0;
    }
    renderer.render(scene, cam);
  };
  controls.addEventListener('change', draw);
  let meshes = [], fitted = false, off = [0, 0], last = null;
  const size = () => { const w = host.clientWidth || 300, hh = host.clientHeight || 300; renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); draw(); };
  const ro = new ResizeObserver(size);
  ro.observe(host);

  const dispose = (o) => o.traverse((x) => { x.geometry?.dispose(); x.material?.dispose?.(); });
  const clear = () => { for (const g of [group, handles]) for (const o of [...g.children]) { dispose(o); g.remove(o); } meshes = []; };
  // Model → view: x → x, y (to the front) → z, z (up) → y; `off` centres the model on the grid (fixed between fits, so nothing jumps while dragging).
  const toView = (x, y, z) => new THREE.Vector3(x - off[0], z, y - off[1]);
  function fit(dr) {
    const xs = dr.parts.flatMap((p) => [p.min[0], p.max[0]]), ys = dr.parts.flatMap((p) => [p.min[1], p.max[1]]);
    off = xs.length ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] : [0, 0];
    update(dr, last?.sel ?? -1, false, true);
    const b = new THREE.Box3(); for (const m of meshes) b.expandByObject(m);
    if (b.isEmpty()) b.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const mid = b.getCenter(new THREE.Vector3()), rad = Math.max(0.3, b.getSize(new THREE.Vector3()).length() / 2);
    controls.target.copy(mid);
    cam.position.copy(mid).add(new THREE.Vector3(0.6, 0.55, 1).normalize().multiplyScalar(rad / Math.sin((cam.fov * Math.PI) / 360) * 1.15));
    cam.near = rad / 100; cam.far = rad * 100; cam.updateProjectionMatrix();
    controls.update();
    draw();
  }
  const handleMat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const pickMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  /** A handle: what is seen, with a bigger invisible ball around it that is easy to hit with a finger. */
  function handle(kind, pos, extra) {
    const g = new THREE.Group();
    const look = kind === 'arrow' ? new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 20), handleMat('#e07b16')) : new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), handleMat('#ffffff'));
    if (kind === 'arrow' && extra.axis === 0) look.rotation.z = -Math.PI / 2; // cones point up: turn them to point right, or to the front
    if (kind === 'arrow' && extra.axis === 1) look.rotation.x = Math.PI / 2;
    if (kind !== 'arrow') { const ring = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), handleMat('#e07b16')); ring.renderOrder = 3; g.add(ring); }
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
  function update(dr, sel, refit = false, noFit = false) {
    last = { dr, sel };
    clear();
    dr.parts.forEach((p, i) => {
      const w = p.max[0] - p.min[0], d = p.max[1] - p.min[1], hh = p.max[2] - p.min[2];
      if (w <= 0 || d <= 0 || hh <= 0) return;
      const geo = partGeometry(p, w, hh, d);
      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.8, transparent: p.opacity != null, opacity: p.opacity ?? 1,
        emissive: i === sel ? '#ff9a3c' : '#000000', emissiveIntensity: i === sel ? 0.12 : 0 });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(toView((p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2));
      m.userData.part = i;
      group.add(m);
      meshes.push(m);
      if (i === sel) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: '#e07b16', depthTest: false, transparent: true }));
        edges.renderOrder = 2;
        m.add(edges);
      }
    });
    // The chosen part's handles: a dot on each face (resize along that axis), and an arrow beyond its right face,
    // its front face and its top (move along that axis).
    hits = [];
    const p = dr.parts[sel];
    if (p) {
      const c = [0, 1, 2].map((k) => (p.min[k] + p.max[k]) / 2);
      for (const k of [0, 1, 2]) for (const side of ['min', 'max']) {
        const at = [...c]; at[k] = p[side][k];
        hits.push(handle('face', toView(...at), { axis: k, side }));
      }
      for (const k of [0, 1, 2]) {
        const at = [...c]; at[k] = p.max[k] + Math.max(0.12, (p.max[k] - p.min[k]) * 0.25);
        hits.push(handle('arrow', toView(...at), { axis: k }));
      }
    }
    if (!noFit && (refit || !fitted)) { fitted = true; fit(dr); } else draw();
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
  const cm = (v) => (imperial() ? showLen(v) : `${Math.round(v * 1000) / 10} cm`); // the readout: centimetres, or feet and inches
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    drag = null;
    if (!last || !last.dr.parts[last.sel]) return;
    const r = rayAt(e);
    ray.ray.copy(r);
    const h0 = ray.intersectObjects(hits.filter((x) => x.parent.visible), false)[0]?.object.userData;
    const body = !h0 && ray.intersectObjects(meshes, false)[0];
    if (!h0 && body?.object.userData.part !== last.sel) return; // empty space or another part: the view turns (or a tap chooses it)
    controls.enabled = false; // runs before the view's own handler (capture), so it does not turn
    canvas.setPointerCapture(e.pointerId);
    const p = last.dr.parts[last.sel];
    if (h0?.handle === 'face') drag = { kind: 'face', axis: h0.axis, side: h0.side, origin: toView(...[0, 1, 2].map((k) => (k === h0.axis ? 0 : (p.min[k] + p.max[k]) / 2))), start: p[h0.side][h0.axis] };
    else if (h0?.handle === 'arrow') drag = { kind: 'arrow', axis: h0.axis, origin: toView(...[0, 1, 2].map((k) => (k === h0.axis ? 0 : (p.min[k] + p.max[k]) / 2))), start: p.min[h0.axis] };
    else { const y = body.point.y; const at = r.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3()); drag = at && { kind: 'move', y, at, start: [p.min[0], p.min[1]] }; }
    if (drag) { drag.grab = drag.kind === 'move' ? null : alongAxis(r, drag.origin, AXES[drag.axis]); drag.started = false; }
  }, { capture: true });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !down) return;
    if (!drag.started) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return; drag.started = true; hooks.dragStart(); }
    const r = rayAt(e), { tol, step } = hooks.snapping();
    hooks.drag((dr, sel) => {
      const p = dr.parts[sel];
      if (drag.kind === 'move') {
        const at = r.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -drag.y), new THREE.Vector3());
        if (!at) return;
        const bits = [];
        for (const [k, delta] of [[0, at.x - drag.at.x], [1, at.z - drag.at.z]]) {
          const len = p.max[k] - p.min[k], tmp = { ...dr, parts: dr.parts.map((q, i) => (i === sel ? { ...q, min: [...q.min], max: [...q.max] } : q)) };
          tmp.parts[sel].min[k] = drag.start[k]; tmp.parts[sel].max[k] = drag.start[k] + len;
          const m = movePartAxis(tmp, sel, k, delta, tol, step);
          p.min[k] = m.min; p.max[k] = m.max;
          bits.push(`${k ? 'from the back' : 'from the left'} ${cm(m.min)}${m.snapped ? ' ⟷' : ''}`);
        }
        say(bits.join(' · '));
      } else {
        const t = alongAxis(r, drag.origin, AXES[drag.axis]);
        if (t == null || drag.grab == null) return;
        if (drag.kind === 'arrow') {
          const k = drag.axis, len = p.max[k] - p.min[k], tmp = { ...dr, parts: dr.parts.map((q, i) => (i === sel ? { ...q, min: [...q.min], max: [...q.max] } : q)) };
          tmp.parts[sel].min[k] = drag.start; tmp.parts[sel].max[k] = drag.start + len;
          const m = movePartAxis(tmp, sel, k, t - drag.grab, tol, step);
          p.min[k] = m.min; p.max[k] = m.max;
          say(`${['from the left', 'from the back', 'off the floor'][k]} ${cm(m.min)}${m.snapped ? ' ⟷' : ''}`);
        } else {
          const k = drag.axis, m = resizePartFace(dr, sel, k, drag.side, drag.start + (t - drag.grab), tol, step);
          p.min[k] = m.min; p.max[k] = m.max;
          say(`${['width', 'depth', 'height'][k]} ${cm(m.max - m.min)}${m.snapped ? ' ⟷' : ''}`);
        }
      }
    });
  });
  const up = (e) => {
    const was = drag, tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 6;
    down = null; drag = null; controls.enabled = true; say('');
    if (was?.started) return hooks.dragEnd();
    if (!tap) return;
    ray.ray.copy(rayAt(e));
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) hooks.pick(hit.object.userData.part);
  };
  canvas.addEventListener('pointerup', up);
  // For automated tests: where a model point (metres) is on the screen.
  canvas.projectPoint = (x, y, z) => { const v = toView(x, y, z).project(cam), r = canvas.getBoundingClientRect(); return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]; };
  canvas.addEventListener('pointercancel', (e) => { if (drag?.started) hooks.dragEnd(); down = null; drag = null; controls.enabled = true; say(''); });
  return {
    update, fit,
    dispose: () => { ro.disconnect(); controls.dispose(); clear(); renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove(); },
  };
}
