// Small pictures of catalogue furniture (#52): each item is drawn once with a tiny off-screen
// three.js view and kept as an image, so the furniture list shows what a piece looks like.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const cache = new Map();
let renderer = null, idle = null;

function getRenderer() {
  clearTimeout(idle);
  // Let go of the extra graphics context when the list has not needed it for a while (wall tablets are short of them).
  idle = setTimeout(() => { renderer?.dispose(); renderer?.forceContextLoss?.(); renderer = null; }, 8000);
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return renderer;
}

/** A catalogue item as three.js meshes, in metres, standing on y = 0 and centred on the origin. */
function build(item) {
  const [w, d, hgt] = item.size, g = new THREE.Group();
  for (const [a, b, c, e, f, k, color, opts = {}] of item.parts) {
    const sx = (e - a) * w, sy = (k - c) * hgt, sz = (f - b) * d;
    if (sx <= 0 || sy <= 0 || sz <= 0) continue;
    let geo;
    if (opts.shape === 'cylinder') { geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 28); geo.scale(sx, sy, sz); }
    else if (opts.radius) geo = new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(opts.radius, sx / 2, sy / 2, sz / 2) * 0.999);
    else geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: opts.opacity != null, opacity: opts.opacity ?? 1 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(((a + e) / 2 - 0.5) * w, ((c + k) / 2) * hgt, ((b + f) / 2 - 0.5) * d);
    g.add(m);
  }
  return g;
}

/** A picture (data URL) of a catalogue item, `px` points square, seen from the front at three-quarter height. */
export function thumb(item, px = 72) {
  const key = `${item.id}:${px}`;
  if (cache.has(key)) return cache.get(key);
  let url = '';
  try {
    const r = getRenderer(), g = build(item), scene = new THREE.Scene();
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(px, px, false);
    scene.add(g, new THREE.HemisphereLight('#ffffff', '#8c8378', 2.1));
    const sun = new THREE.DirectionalLight('#fff4e6', 2.2);
    sun.position.set(-2, 5, 4);
    scene.add(sun);
    const box = new THREE.Box3().setFromObject(g), mid = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    const cam = new THREE.OrthographicCamera(-rad, rad, rad, -rad, 0.1, rad * 10);
    cam.position.copy(mid).add(new THREE.Vector3(0.55, 0.75, 1).normalize().multiplyScalar(rad * 4));
    cam.lookAt(mid);
    r.render(scene, cam);
    url = r.domElement.toDataURL('image/png');
    g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  } catch { url = ''; }
  cache.set(key, url);
  return url;
}
