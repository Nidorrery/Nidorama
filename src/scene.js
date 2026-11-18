// Renders one level of a nidorama.home/1 file with three.js, in one of several styles.
// Plan coordinates: x east, y south, z up (metres). three.js: X = x, Y = z, Z = y.
// Rendering is on demand (no animation loop). The "refine" styles keep improving the picture while
// nothing is changing: jittered samples are averaged, which gives soft sun shadows, real ambient
// occlusion and clean edges without a heavy real-time pipeline.
import * as THREE from 'three';
import { partGeometry } from './shapes.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { parseGLB } from './gltf.js';
import { FLOOR_MATERIALS } from './catalog.js';
import { finishTexture, finishColor } from './finishes.js';
import { upgradeSite, planLevels, placeOf, floorOf, levelZ, eaveOf, piecesOf, boundsOf, toSite, fromSite, ROOF_MATERIALS } from './site.js';
import { blobURL, loadBlob } from './blobs.js';
import { fetchPhotoFromHA } from './store.js';
import { levelBounds, polyBounds, dist, pointInPoly, wallLength, wallAt, wallDir, wallPoints, wallArc } from './geom.js';

const V = (x, y, z = 0) => new THREE.Vector3(x, z, y);
const UP = new THREE.Vector3(0, 1, 0);

export const STYLES = {
  realistic: { label: 'Realistic', camera: 'persp', elevation: 52, cut: 1.25, mat: 'pbr', shadows: true, refine: true, ground: true, bg: ['#dfe3e6', '#0e1119'] },
  illustrated: { label: 'Illustrated', camera: 'ortho', elevation: 53, cut: 1.0, mat: 'lambert', shadows: true },
  // The saved path-traced picture is shown behind the canvas; the canvas only adds live light and selection.
  photo: { label: 'Photo render', camera: 'persp', elevation: 52, cut: 1.25, mat: 'pbr', shadows: false, overlay: true },
  // Pear: calm and minimal — soft matte colours, white walls, gentle shadows, lots of light.
  pear: { label: 'Pear', camera: 'persp', elevation: 56, cut: 1.1, mat: 'pear', shadows: true, refine: true, ground: true, bg: ['#f2f2f7', '#1c1c1e'] },
  // Cyberpunk: a dark model drawn in neon — glowing outlines, deep colours, lamps that light the dark.
  cyber: { label: 'Cyberpunk', camera: 'persp', elevation: 52, cut: 1.1, mat: 'cyber', shadows: false, bg: ['#0b0718', '#06040e'] },
  clay: { label: 'Clay model', camera: 'persp', elevation: 50, cut: 1.25, mat: 'clay', shadows: true, refine: true, ground: true, bg: ['#e9e6e1', '#15161c'] },
  plan: { label: 'Flat plan', camera: 'ortho', elevation: 90, cut: 0.25, mat: 'lambert', shadows: false },
  // Nido: conceptual tiles in deep greens, low walls, amber light, the other floors as faint layers.
  nido: { label: 'Nido', camera: 'persp', elevation: 52, cut: 0.35, mat: 'nido', shadows: false, layers: true, bg: ['#0F1412', '#0B0F0D'] },
  // Nido conceptual: no walls at all, just the rooms as dark tiles with a gap between them, furniture as flat
  // outlines, and every entity a coloured dot (drawn by the app over the plan).
  nidoplan: { label: 'Nido conceptual', camera: 'persp', elevation: 60, cut: 0, mat: 'nido', shadows: false, layers: true, noWalls: true, tiles: true, flat: true, dots: true, bg: ['#0F1412', '#0B0F0D'] },
  blueprint: { label: 'Blueprint', camera: 'ortho', elevation: 90, cut: 0.25, mat: 'blueprint', shadows: false, bg: ['#1b4e8f', '#0d2c55'] },
};
const WALL = { top: '#fffdf9', side: '#e3dcd2' };
/** The polygon moved in by `d` metres on every side (for the gap between Nido conceptual tiles). */
function insetPoly(poly, d) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const s = area > 0 ? 1 : -1, n = poly.length;
  const normal = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [(-dy / l) * s, (dx / l) * s]; }; // pointing inwards
  return poly.map((p, i) => {
    const n1 = normal(poly[(i - 1 + n) % n], p), n2 = normal(p, poly[(i + 1) % n]);
    let bx = n1[0] + n2[0], by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const k = Math.min(3, 1 / Math.max(0.35, bx * n1[0] + by * n1[1]));
    return [p[0] + bx * d * k, p[1] + by * d * k];
  });
}
const WARM = new THREE.Color('#ffb468');
const MAX_POINT_LIGHTS = 10;
const REFINE_SAMPLES = 48;

// ---------- procedural textures ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function floorTexture(kind, rich) {
  if (kind === 'void') return null;
  const N = rich ? 512 : 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const r = rng(kind.length * 7919 + (rich ? 1 : 0));
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, N, N);
  let metres = 1.1;
  if (kind === 'wood') {
    const planks = 8, w = N / planks;
    for (let i = 0; i < planks; i++) {
      const tone = rich ? 205 + r() * 50 : 228 + [0, 12, -8, 6, -14, 9, -4, 14][i];
      g.fillStyle = `rgb(${tone},${tone},${tone})`;
      g.fillRect(i * w, 0, w, N);
      if (rich) {
        for (let k = 0; k < 26; k++) {
          g.strokeStyle = `rgba(60,40,20,${0.03 + r() * 0.06})`;
          g.lineWidth = 0.6 + r();
          const x = i * w + r() * w;
          g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 6, N / 3, x + (r() - 0.5) * 6, (2 * N) / 3, x + (r() - 0.5) * 4, N); g.stroke();
        }
        const joint = r() * N;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(i * w, joint, w, 1.5);
      }
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(i * w + w - 1, 0, rich ? 1.5 : 1, N);
    }
  } else if (kind === 'tile' || kind === 'mosaic') {
    const n = kind === 'mosaic' ? 6 : 2, w = N / n;
    metres = kind === 'mosaic' ? 0.4 : 1.2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const tone = rich ? 236 + r() * 14 : 244;
      g.fillStyle = `rgb(${tone},${tone},${tone})`;
      g.fillRect(i * w, j * w, w, w);
      if (rich && kind === 'tile') for (let k = 0; k < 3; k++) {
        g.strokeStyle = `rgba(90,90,100,${0.05 + r() * 0.06})`;
        g.lineWidth = 0.8 + r() * 1.2;
        g.beginPath(); g.moveTo(i * w + r() * w, j * w); g.bezierCurveTo(i * w + r() * w, j * w + w / 3, i * w + r() * w, j * w + (2 * w) / 3, i * w + r() * w, j * w + w); g.stroke();
      }
    }
    g.strokeStyle = rich ? 'rgba(70,70,70,0.45)' : 'rgba(0,0,0,0.14)';
    g.lineWidth = rich ? 3 : 2;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * w, 0); g.lineTo(i * w, N); g.moveTo(0, i * w); g.lineTo(N, i * w); g.stroke(); }
  } else {
    metres = kind === 'grass' ? 1.5 : 0.8;
    if (!rich) return null;
    const amt = kind === 'concrete' ? 0.05 : 0.11;
    const img = g.getImageData(0, 0, N, N);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 238 * (1 - amt + r() * amt * 2);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, v);
    }
    g.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.metres = metres;
  return t;
}
function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function polyShape(points) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, -y) : s.moveTo(x, -y)));
  s.closePath();
  return s;
}
function flatPolygon(points, z, material) {
  const geo = new THREE.ShapeGeometry(polyShape(points));
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.y = z;
  return m;
}
// Roughness by what a thing probably is: screens and steel shine, fabric does not.
const roughOf = (kind = '', color = '') => (/tv|fridge|glass|sink|cooktop/.test(kind) ? 0.25 : /bath|toilet|vanity|bench|island|table|cabinet/.test(kind) ? 0.45 : /#c7ccd1/i.test(color) ? 0.3 : 0.85);

export class NidoramaScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // soft by default in current three.js
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.persp = new THREE.PerspectiveCamera(26, 1, 0.5, 600);
    this.camera = this.ortho;
    this.glowTex = radialTexture([[0, 'rgba(255,214,150,1)'], [0.25, 'rgba(255,180,104,0.55)'], [1, 'rgba(255,160,80,0)']]);
    this.textures = {};
    this.photos = new Map(); // photo id → HTMLImageElement | 'loading' | 'missing'
    this.models = new Map(); // model id → THREE.Object3D | 'loading' | 'failed'
    this.night = false;
    this.sunAngles = { azimuth: 55, elevation: 40 };
    this.styleId = 'realistic';
    this.style = STYLES.realistic;
    this.selectedRoom = null;
    this.cam = { cx: 0, cy: 0, zoom: 1, az: 0, off: [0, 0] };
    this._pending = false;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    const gl = this.renderer.getContext();
    this.canRefine = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this._initRefine();
  }

  // ---------- loading ----------
  /** Show a level. keepView keeps the current pan / zoom (used while editing). */
  load(home, level, { style = this.styleId, keepView = false } = {}) {
    const lightStates = keepView && this.lights ? [...this.lights.values()].map((l) => [l.def.id, l.on, l.level]) : [];
    this.scene?.traverse((o) => o.geometry?.dispose?.());
    this.home = upgradeSite(home);
    this.level = level;
    this.styleId = STYLES[style] ? style : 'realistic';
    this.style = STYLES[this.styleId];
    // The whole site is looked at from lower down, so roofs and walls read as a model of the property (#112).
    if (level.site && this.style.elevation < 90) this.style = { ...this.style, elevation: Math.min(this.style.elevation, 34) };
    this.camera = this.style.camera === 'persp' ? this.persp : this.ortho;
    this.scene = new THREE.Scene();
    this.lights = new Map();
    this.rooms = new Map();
    this.objects = new Map();
    this.bounds = level.site ? this._siteBounds() : boundsOf(level);
    this.simple = !level.footprint; // levels drawn in the app: slab follows the rooms
    this._buildEnvironment();
    if (level.site) this._buildSite();
    this._buildFloors();
    if (!this.style.noWalls) this._buildWalls();
    this._buildStairs();
    this._buildObjects();
    this._buildLights();
    this._buildRooms();
    if (!level.site && !this.style.noWalls) this._buildPieces(level, 0, true);
    if (this.style.layers && !level.site) this._buildLayers(level);
    for (const [id, on, lvl] of lightStates) this.setLight(id, on, lvl, true);
    this.setNight(this.night);
    if (this.style.overlay) this._overlayOnly();
    if (level.site && !keepView && this.style.elevation < 90) this.cam.az = 30; // a three-quarter view of the property
    if (!keepView || !this.baseExt) this.fit(); else this.resize();
    this.selectRoom(this.rooms.has(this.selectedRoom) ? this.selectedRoom : null);
    this._applyIsolation();
  }

  // ---------- materials ----------
  _mat(color, o = {}) {
    const m = this.style.mat;
    const base = {};
    if (o.opacity != null) Object.assign(base, { transparent: true, opacity: o.opacity, depthWrite: false });
    if (m === 'blueprint') return new THREE.MeshBasicMaterial({ color: o.fill || '#1b4e8f', ...base, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    if (m === 'nido') { // flat, unlit deep greens: darker things become the floor tone, lighter ones the furniture tone; the edges draw the shapes
      const l = new THREE.Color(color).getHSL({}).l, c = new THREE.Color('#161D1A').lerp(new THREE.Color('#34403B'), Math.min(1, Math.max(0, (l - 0.15) / 0.75)));
      return new THREE.MeshBasicMaterial({ color: c, ...base, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    }
    if (m === 'cyber') { // every colour becomes a deep, saturated dark; the outlines carry the picture
      const c = new THREE.Color(color), hsl = c.getHSL({});
      c.setHSL(hsl.s < 0.08 ? 0.72 : hsl.h, 0.55, 0.07 + hsl.l * 0.1);
      return new THREE.MeshLambertMaterial({ color: c, ...base, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    }
    if (m === 'lambert') return new THREE.MeshLambertMaterial({ color, map: o.map || null, ...base });
    const glass = o.opacity != null;
    if (m === 'pear') { // every colour made lighter and quieter; no textures
      const c = new THREE.Color(color), hsl = c.getHSL({});
      if (!glass) c.setHSL(hsl.h, hsl.s * 0.5, hsl.l + (0.97 - hsl.l) * 0.3);
      return new THREE.MeshStandardMaterial({ color: c, roughness: glass ? 0.05 : 0.62, metalness: 0, envMap: this.envMap, envMapIntensity: this.night ? 0.06 : glass ? 1.0 : 0.45, ...base });
    }
    return new THREE.MeshStandardMaterial({
      color: m === 'clay' && !glass ? '#ece8e1' : color,
      map: m === 'pbr' ? o.map || null : null,
      bumpMap: m === 'pbr' && o.bump ? o.map : null,
      bumpScale: 0.6,
      roughness: glass ? 0.05 : m === 'clay' ? 0.92 : o.rough ?? 0.8,
      metalness: m === 'pbr' ? o.metal ?? 0 : 0,
      envMap: this.envMap,
      envMapIntensity: this.night ? 0.06 : glass ? 1.0 : 0.3,
      ...base,
    });
  }

  // ---------- the user's photos and 3D models ----------
  _reloadSoon() {
    clearTimeout(this._reloadTimer);
    this._reloadTimer = setTimeout(() => { if (this.level && !this.tracing) this.load(this.home, this.level, { keepView: true }); this.onAssets?.(); }, 60);
  }
  /** A texture of one of the user's photos, or null while it is still loading (the scene rebuilds when it arrives). */
  _photoTexture(id, repeatX = 1, repeatY = 1) {
    if (!id || ['blueprint', 'clay', 'pear', 'cyber', 'nido'].includes(this.style.mat)) return null;
    const have = this.photos.get(id);
    if (have instanceof HTMLImageElement) {
      const t = new THREE.Texture(have);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeatX, repeatY);
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    }
    if (!have) {
      this.photos.set(id, 'loading');
      (async () => {
        let url = await blobURL(`photo/${id}`);
        if (!url && (await fetchPhotoFromHA(id))) url = await blobURL(`photo/${id}`);
        if (!url) return this.photos.set(id, 'missing');
        const img = new Image();
        img.onload = () => { this.photos.set(id, img); this._reloadSoon(); };
        img.onerror = () => this.photos.set(id, 'missing');
        img.src = url;
      })();
    }
    return null;
  }
  /** A copy of an imported 3D model, or null while loading / if it cannot be read. */
  _model(id) {
    if (!id || this.style.mat === 'blueprint') return null;
    const have = this.models.get(id);
    if (have?.isObject3D) return have.clone(true);
    if (!have) {
      this.models.set(id, 'loading');
      (async () => {
        try {
          const blob = await loadBlob(`model/${id}`);
          if (!blob) throw new Error('This 3D model is not on this device or in the Home Assistant folder.');
          const gltf = await parseGLB(await blob.arrayBuffer());
          this.models.set(id, gltf.scene);
          this._reloadSoon();
        } catch (e) {
          this.models.set(id, 'failed');
          this.onModelError?.(id, e);
        }
      })();
    }
    return null;
  }
  forgetModel(id) { this.models.delete(id); }
  /** True while photos or models are still being fetched. */
  get assetsLoading() { return [...this.photos.values(), ...this.models.values()].includes('loading'); }

  /** Photo style: draw nothing solid (the saved render is behind the canvas), only lights and selection. */
  _overlayOnly() {
    this.scene.traverse((o) => {
      if (!o.isMesh || o.userData.overlay) return;
      for (const m of [].concat(o.material)) m.colorWrite = false;
    });
  }

  _floorMat(materialId) {
    const def = FLOOR_MATERIALS[materialId] || { color: '#999', kind: 'concrete' };
    const rich = this.style.mat === 'pbr';
    const key = def.kind + (rich ? '+' : '');
    if (!(key in this.textures)) this.textures[key] = floorTexture(def.kind, rich);
    const tex = this.textures[key];
    const rough = { wood: 0.55, tile: 0.25, mosaic: 0.35, concrete: 0.8, carpet: 1, grass: 1 }[def.kind] ?? 0.8;
    return { mat: this._mat(def.color, { map: tex, bump: def.kind !== 'tile', rough }), metres: tex?.userData.metres || 1 };
  }

  _edges(mesh) {
    if (this.style.mat !== 'blueprint' && this.style.mat !== 'cyber' && this.style.mat !== 'nido') return;
    let src = mesh.geometry;
    if (src.type === 'RoundedBoxGeometry') { // rounded corners have no hard edges: outline the plain box
      src.computeBoundingBox();
      const sz = src.boundingBox.getSize(new THREE.Vector3());
      src = new THREE.BoxGeometry(sz.x, sz.y, sz.z);
    }
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(src, 30), (this._lineMats ||= {})[this.style.mat] ||= new THREE.LineBasicMaterial({ color: this.style.mat === 'cyber' ? '#35e6ff' : this.style.mat === 'nido' ? '#44514C' : '#e8f1ff' }));
    lines.position.copy(mesh.position);
    lines.rotation.copy(mesh.rotation);
    (mesh.parent || this.scene).add(lines);
    return lines;
  }

  _add(mesh, { cast = true, receive = true, layer = 0 } = {}) {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (layer) mesh.layers.set(layer);
    this.scene.add(mesh);
    if (!layer) { const lines = this._edges(mesh); if (lines && mesh.userData.room) lines.userData.room = mesh.userData.room; }
    return mesh;
  }

  // ---------- building ----------
  _buildEnvironment() {
    const s = this.scene, b = this.bounds, st = this.style;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    this.span = Math.max(b.x1 - b.x0, b.y1 - b.y0, 4);
    this.centre = V(cx, cy, 0);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#8a7a6a', 1);
    this.sun = new THREE.DirectionalLight('#fff4e6', 1);
    this.sun.castShadow = st.shadows;
    const half = this.span * 0.75 + 3;
    for (const light of [this.sun, (this.sky = new THREE.DirectionalLight('#dfe9ff', 0))]) {
      const sc = light.shadow.camera;
      Object.assign(sc, { left: -half, right: half, top: half, bottom: -half, near: 1, far: this.span * 4 + 40 });
      light.shadow.bias = -0.0006;
      light.shadow.normalBias = 0.02;
      light.target.position.copy(this.centre);
      s.add(light, light.target);
    }
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.camera.layers.enable(1); // layer 1 = roof and upper walls: block the sun, never drawn
    this.sky.shadow.mapSize.set(1024, 1024);
    this.sky.castShadow = false;
    s.add(this.hemi);
    if (st.ground) {
      const ground = new THREE.Mesh(new THREE.CircleGeometry(this.span * 6 + 40, 48), new THREE.MeshStandardMaterial({ color: st.bg[0], roughness: 1 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.copy(this.centre).setY(this.simple ? -0.11 : -0.31);
      ground.receiveShadow = true;
      this.ground = ground;
      s.add(ground);
    } else this.ground = null;
    this.pool = [];
    const count = this.level.site ? MAX_POINT_LIGHTS : Math.min(MAX_POINT_LIGHTS, this.level.lights.length);
    for (let i = 0; i < count; i++) {
      const p = new THREE.PointLight(WARM, 0, 6, 1.6);
      this.pool.push(p);
      s.add(p);
    }
  }

  _buildFloors() {
    const L = this.level;
    const z0 = this.simple ? -0.1 : -0.3;
    const addPoly = (polygon, materialId, z, photo, room) => {
      let { mat, metres } = this._floorMat(materialId);
      const tex = photo ? this._photoTexture(photo.id) : null;
      if (tex) { mat = this._mat('#ffffff', { map: tex, rough: 0.6 }); metres = photo.size || 2; } // one photo covers `size` metres, then repeats
      const m = flatPolygon(polygon, z, mat);
      const uv = m.geometry.attributes.uv; // ShapeGeometry UVs are in metres already
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / metres, uv.getY(i) / metres);
      if (room) m.userData.room = room;
      this._add(m, { cast: false });
    };
    const isVoid = (r) => FLOOR_MATERIALS[r.floor]?.kind === 'void';
    if (this.style.tiles) { // Nido conceptual: each room a flat dark tile, a little in from its walls
      for (const r of L.rooms) {
        if (isVoid(r) || r.polygon.length < 3) continue;
        const m = flatPolygon(insetPoly(r.polygon, 0.07), r.outdoor ? -0.01 : 0, new THREE.MeshBasicMaterial({ color: r.outdoor ? '#141A17' : '#1A211E' }));
        m.userData.room = r.id;
        this._add(m, { cast: false });
      }
      return;
    }
    for (const r of L.rooms) {
      if (isVoid(r) || r.polygon.length < 3) continue;
      addPoly(r.polygon, r.floor, r.outdoor ? -0.02 : r.floorPainted || r.floorPhoto ? 0.012 : 0, r.floorPhoto, r.id);
      if (this.simple) {
        const geo = new THREE.ExtrudeGeometry(polyShape(r.polygon), { depth: r.outdoor ? 0.07 : -z0 - 0.002, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2);
        const slab = new THREE.Mesh(geo, this._mat('#d9d1c6'));
        slab.position.y = r.outdoor ? -0.1 : z0;
        slab.userData.room = r.id;
        this._add(slab, { cast: false });
      }
    }
    L.floors.forEach((f, i) => {
      const [x0, y0, x1, y1] = f.rect;
      addPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], f.material, 0.001 * (i + 1));
    });
    if (!this.simple) {
      const fp = L.footprint;
      const rect = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const shape = polyShape(rect([fp.min[0], fp.min[1], fp.max[0], fp.max[1]]));
      for (const v of L.voids || []) shape.holes.push(polyShape(rect(v.rect)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const slab = new THREE.Mesh(geo, this._mat('#d9d1c6'));
      slab.position.y = -0.302;
      this._add(slab, { cast: false });
    }
    for (const o of L.outdoor || []) {
      if (o.kind === 'glass-balustrade') this._segment(o.a, o.b, 0.03, 0, o.height, this._mat('#bfe0f2', { opacity: 0.35 }), { cast: false });
    }
    // Roof: never drawn, but it stops the sun so daylight only comes in through the openings.
    if (this.style.refine) {
      const roofMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      roofMat.shadowSide = THREE.DoubleSide;
      for (const r of L.rooms) {
        if (r.outdoor || r.polygon.length < 3) continue;
        this._add(flatPolygon(r.polygon, L.ceilingHeight || 2.4, roofMat), { layer: 1 });
      }
    }
  }

  _segment(a, b, thickness, z0, z1, mat, opts = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-3 || z1 - z0 < 1e-3) return null;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, z1 - z0, thickness), typeof mat === 'function' ? mat(len, z1 - z0) : mat);
    m.position.copy(V((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (z0 + z1) / 2));
    m.rotation.y = -Math.atan2(dy, dx);
    return this._add(m, opts);
  }

  /** A wall with its own finishes (#129): its right-hand face (as drawn from a to b) and its left-hand face each
   *  painted or clad; the ends and the top stay plain. Returns materials for one piece of the wall. */
  _wallMats(w, top, plain) {
    const face = (sd, len, hgt) => {
      if (!sd) return this._mat(plain, { rough: 0.9 });
      const tex = this.style.mat === 'clay' || this.style.mat === 'pear' ? null : finishTexture(sd, len, hgt);
      return this._mat(this.style.mat === 'clay' ? plain : finishColor(sd), { rough: 0.9, map: tex, bump: !!tex });
    };
    const ends = this._mat(plain, { rough: 0.9 }), cap = this._mat(top, { rough: 0.9 });
    return (len, hgt) => [ends, ends, cap, ends, face(w.sides.r, len, hgt), face(w.sides.l, len, hgt)];
  }
  _buildWalls() {
    const st = this.style, L = this.level;
    const bp = st.mat === 'blueprint';
    const top = st.mat === 'pear' ? '#ffffff' : st.mat === 'pbr' ? '#efeae3' : WALL.top, side = st.mat === 'pear' ? '#fbfbfd' : st.mat === 'pbr' ? '#e9e3da' : WALL.side;
    const wallMats = [side, side, top, side, side, side].map((c) => this._mat(c, { rough: 0.9, fill: '#dfeaff' }));
    const glass = this._mat('#bfe0f2', { opacity: bp ? 0.5 : 0.3, fill: '#7fb2f0' });
    const shadowMat = new THREE.MeshBasicMaterial();
    const ends = L.walls.flatMap((w) => [w.a, w.b]);
    const joined = (p) => ends.filter((q) => dist(p, q) < 0.02).length > 1;
    const base = this.simple ? -0.1 : 0;
    for (const w of L.walls) {
      const len0 = wallLength(w);
      if (len0 < 0.01) continue;
      // Walls that meet at a corner are extended half a thickness so the corner closes.
      const ea = joined(w.a) ? w.thickness / 2 : 0, eb = joined(w.b) ? w.thickness / 2 : 0;
      const arc = wallArc(w);
      /**
       * A piece of this wall between t0 and t1 metres along it, `off` metres to its right, `th` thick.
       * A curved wall (#52) is made of short straight pieces that overlap a little at each bend.
       */
      const strip = (t0, t1, off, th, z0, z1, mat, opts) => {
        if (t1 - t0 < 1e-3) return;
        const pts = wallPoints(w, t0, t1), n = pts.length - 1;
        const lap = arc && n > 1 ? (th / 2) * Math.tan((t1 - t0) / n / arc.R / 2) + 0.002 : 0;
        for (let i = 0; i < n; i++) {
          const p = pts[i], q = pts[i + 1], l = dist(p, q) || 1, dx = (q[0] - p[0]) / l, dy = (q[1] - p[1]) / l;
          const la = i > 0 ? lap : 0, lb = i < n - 1 ? lap : 0;
          this._segment([p[0] - dx * la - dy * off, p[1] - dy * la + dx * off], [q[0] + dx * lb - dy * off, q[1] + dy * lb + dx * off], th, z0, z1, mat, opts);
        }
      };
      const ops = [...(w.openings || [])].sort((p, q) => p.offset - q.offset);
      const build = (zLo, zHi, mat, opts, withGlass) => {
        if (zHi - zLo < 0.01) return;
        let s = -ea;
        for (const o of ops) {
          const o1 = Math.min(len0, o.offset + o.width);
          if (o.offset > s) strip(s, o.offset, 0, w.thickness, zLo, zHi, mat, opts);
          if (o.sill > zLo) strip(o.offset, o1, 0, w.thickness, zLo, Math.min(o.sill, zHi), mat, opts);
          if (o.head < zHi) strip(o.offset, o1, 0, w.thickness, Math.max(o.head, zLo), zHi, mat, opts);
          if (withGlass && (o.type === 'window' || o.type === 'slider') && o.sill < zHi) {
            strip(o.offset, o1, 0, 0.02, Math.max(o.sill, 0), Math.min(o.head, zHi), glass, { cast: false });
          }
          s = Math.max(s, o1);
        }
        if (s < len0 + eb) strip(s, len0 + eb, 0, w.thickness, zLo, zHi, mat, opts);
      };
      const cut = Math.min(w.height, st.cut);
      build(base, cut, w.sides && !['blueprint', 'cyber', 'nido'].includes(st.mat) ? this._wallMats(w, top, side) : wallMats, {}, true);
      if (st.refine) build(cut, w.height, shadowMat, { layer: 1 }, false);
      if (!bp) for (const o of ops) this._buildOpening(w, o, strip, cut, len0);
      if (st.mat === 'pbr') { // skirting boards on both faces, broken at doorways
        const off = w.thickness / 2 + 0.006;
        let s0 = 0;
        const runs = [];
        for (const o of ops) { if (o.sill > 0.05) continue; if (o.offset > s0) runs.push([s0, o.offset]); s0 = Math.max(s0, o.offset + o.width); }
        if (s0 < len0) runs.push([s0, len0]);
        for (const [r0, r1] of runs) for (const side of [1, -1]) strip(r0, r1, off * side, 0.012, 0, 0.09, (this._skirt ||= this._mat('#f3f0ea', { rough: 0.5 })), { cast: false });
      }
    }
  }

  /**
   * The door leaf or window frame of an opening that has a `style` (#53, #54). Openings without one
   * (homes made before styles existed) stay as plain gaps / plain glass.
   */
  _buildOpening(w, o, strip, cut, len0) {
    if (!o.style || o.style === 'none' || o.type === 'opening') return;
    const o1 = Math.min(len0, o.offset + o.width), zb = Math.max(o.sill, 0), zt = Math.min(o.head, cut);
    if (zt - zb < 0.02) return;
    const mat = this._mat(o.color || '#f3f0ea', { rough: 0.55 });
    if (o.type === 'door') {
      if (o.trim) { // a painted frame around the doorway (#129)
        const tm = this._mat(o.trim, { rough: 0.5 }), fw = Math.min(0.06, o.width / 8), th = w.thickness + 0.03, np = { cast: false };
        strip(o.offset - fw, o.offset, 0, th, zb, zt, tm, np); strip(o1, o1 + fw, 0, th, zb, zt, tm, np);
        if (o.head <= cut + 1e-6) strip(o.offset - fw, o1 + fw, 0, th, zt, Math.min(cut, zt + fw), tm, np);
      }
      const side = o.swing === -1 ? -1 : 1, end = o.hinge === 'end';
      const leaf = (hingeT, along, width) => { // a leaf standing open about 80° from its closed position
        const hp = wallAt(w, hingeT), d = wallDir(w, hingeT), a = (80 * Math.PI) / 180;
        const dir = [d[0] * along * Math.cos(a) - d[1] * side * Math.sin(a), d[1] * along * Math.cos(a) + d[0] * side * Math.sin(a)];
        this._segment(hp, [hp[0] + dir[0] * width, hp[1] + dir[1] * width], 0.04, zb, zt, mat);
      };
      if (o.style === 'double') { leaf(o.offset, 1, o.width / 2); leaf(o1, -1, o.width / 2); }
      else if (o.style === 'sliding') { // slid most of the way open, along the face of the wall
        const t0 = end ? o.offset + o.width * 0.85 : o.offset - o.width * 0.85;
        strip(t0, t0 + o.width, side * (w.thickness / 2 + 0.03), 0.04, zb, zt, mat, {});
      } else leaf(end ? o1 : o.offset, end ? -1 : 1, o.width);
      return;
    }
    // window / sliding glass door: a frame around the glass, and bars by style
    const fw = Math.min(0.05, o.width / 6), th = w.thickness + 0.02, np = { cast: false };
    strip(o.offset, o.offset + fw, 0, th, zb, zt, mat, np);
    strip(o1 - fw, o1, 0, th, zb, zt, mat, np);
    strip(o.offset, o1, 0, th, zb, zb + (o.sill > 0 ? fw : 0.02), mat, np);
    if (o.head <= cut + 1e-6) strip(o.offset, o1, 0, th, zt - fw, zt, mat, np);
    const mid = (o.offset + o1) / 2, bars = o.type === 'slider' ? 'sliding' : o.style;
    if (bars === 'sliding' || bars === 'grid') strip(mid - fw / 2, mid + fw / 2, 0, th, zb, zt, mat, np);
    const zm = (Math.max(o.sill, 0) + o.head) / 2;
    if ((bars === 'double-hung' || bars === 'grid') && zm + fw / 2 < zt) strip(o.offset, o1, 0, th, zm - fw / 2, zm + fw / 2, mat, np);
  }

  _buildStairs() {
    const L = this.level;
    for (const v of L.voids || []) {
      const [x0, y0, x1, y1] = v.rect;
      const pit = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.02, y1 - y0), this._mat('#1c1714'));
      pit.position.copy(V((x0 + x1) / 2, (y0 + y1) / 2, -2.6));
      this._add(pit, { cast: false });
      const pitWall = this._mat('#4a3b31');
      const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      for (let i = 0; i < 4; i++) this._segment(c[i], c[(i + 1) % 4], 0.02, -2.6, -0.002, pitWall, { cast: false });
    }
    const treadMat = this._mat(FLOOR_MATERIALS['timber-dark'].color, { rough: 0.6 });
    const box = (min, max) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], max[2] - min[2], max[1] - min[1]), treadMat);
      m.position.copy(V((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2));
      this._add(m);
    };
    for (const st of L.stairs || []) {
      let step = 0;
      for (const f of st.flights) {
        if (f.landing) {
          step += 1;
          const [x0, y0, x1, y1] = f.landing;
          box([x0, y0, -step * st.rise - 0.05], [x1, y1, -step * st.rise]);
          continue;
        }
        const [ax, ay] = f.from, [bx, by] = f.to;
        const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
        for (let i = 0; i < f.treads; i++) {
          step += 1;
          const z = -step * st.rise;
          const t0 = i / f.treads, t1 = (i + 1) / f.treads;
          let r;
          if (f.run === 'west') r = [x1 - (x1 - x0) * t1, y0, x1 - (x1 - x0) * t0, y1];
          else if (f.run === 'east') r = [x0 + (x1 - x0) * t0, y0, x0 + (x1 - x0) * t1, y1];
          else if (f.run === 'south') r = [x0, y0 + (y1 - y0) * t0, x1, y0 + (y1 - y0) * t1];
          else r = [x0, y1 - (y1 - y0) * t1, x1, y1 - (y1 - y0) * t0];
          box([r[0], r[1], z - 0.04], [r[2], r[3], z]);
        }
      }
      for (const rail of st.rails || []) {
        for (let i = 1; i < rail.along.length; i++) this._segment(rail.along[i - 1], rail.along[i], 0.04, rail.height - 0.04, rail.height, this._mat('#3a2a1f'));
      }
    }
  }

  _buildObjects() {
    for (const o of this.level.objects) {
      const g = new THREE.Group();
      const b = o.bounds;
      const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
      g.position.copy(V(c[0], c[1], 0));
      g.rotation.y = -THREE.MathUtils.degToRad(o.rotation || 0);
      this.scene.add(g);
      const bulbs = [];
      if (this.style.flat) { // Nido conceptual: furniture as a low outlined block over its footprint
        const w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
        if (w > 0.01 && d > 0.01) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 0.03, d * 0.94), new THREE.MeshBasicMaterial({ color: '#232C28', polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
          m.position.y = 0.03;
          g.add(m);
          this._edges(m);
        }
        g.userData = { object: o, bulbs };
        this.objects.set(o.id, g);
        continue;
      }
      const model = o.model ? this._model(o.model.id) : null;
      if (model) {
        // An imported 3D model (a scan of the real thing): scaled to fit the object's box, standing on its base.
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
        const k = Math.min((b.max[0] - b.min[0]) / (size.x || 1), (b.max[1] - b.min[1]) / (size.z || 1), (b.max[2] - b.min[2]) / (size.y || 1));
        const mid = box.getCenter(new THREE.Vector3());
        model.scale.setScalar(k);
        model.position.set(-mid.x * k, b.min[2] - box.min.y * k, -mid.z * k);
        model.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; if (this.style.mat === 'clay') m.material = this._mat('#ece8e1'); } });
        g.add(model);
      }
      for (const p of model ? [] : o.parts) {
        const w = p.max[0] - p.min[0], d = p.max[1] - p.min[1], h = p.max[2] - p.min[2];
        if (w <= 0 || d <= 0 || h <= 0) continue;
        const geo = partGeometry(p, w, h, d);
        const opts = { opacity: p.opacity, rough: roughOf(o.kind, p.color), metal: /#c7ccd1/i.test(p.color) ? 0.6 : 0, fill: '#2a62ab' };
        let mat = this._mat(p.color, opts); // one material per part so a lit shade can glow on its own
        if (o.photo && p.opacity == null) { // covered with the user's photo: once ("fit") or repeated at real size ("tile")
          const sz = o.photo.size || 0.5, tile = o.photo.mode === 'tile';
          const tex = this._photoTexture(o.photo.id, tile ? Math.max(w, d) / sz : 1, tile ? Math.max(h, Math.min(w, d)) / sz : 1);
          if (tex) mat = this._mat('#ffffff', { ...opts, map: tex });
        }
        if (p.sideColor && !p.shape && !p.radius && this.style.mat !== 'blueprint') {
          const side = this._mat(p.sideColor, opts);
          mat = [side, side, mat, side, side, side];
        }
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(V((p.min[0] + p.max[0]) / 2 - c[0], (p.min[1] + p.max[1]) / 2 - c[1], (p.min[2] + p.max[2]) / 2));
        m.castShadow = h >= 0.03 && p.opacity == null;
        m.receiveShadow = true;
        g.add(m);
        this._edges(m);
        if (new THREE.Color(p.color).getHSL({}).l > 0.75) bulbs.push(m);
      }
      g.userData = { object: o, bulbs };
      this.objects.set(o.id, g);
    }
  }

  _roomCentre(id) {
    const r = this.level.rooms.find((q) => q.id === id);
    if (!r) return null;
    const b = polyBounds(r.polygon);
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  }

  _buildLights() {
    for (const l of this.level.lights) {
      let pos;
      if (l.kind === 'ceiling') {
        const c = this._roomCentre(l.room);
        if (!c) continue;
        pos = [c[0], c[1], 2.2];
      } else pos = l.position;
      let glow = null;
      if (l.kind !== 'ceiling' && !this.style.dots) {
        glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0 }));
        glow.scale.set(1.2, 1.2, 1);
        glow.position.copy(V(pos[0], pos[1], pos[2] + 0.1));
        glow.renderOrder = 10;
        this.scene.add(glow);
      }
      const room = l.room || this.level.rooms.find((r) => r.polygon.length > 2 && pointInPoly(pos, r.polygon))?.id;
      this.lights.set(l.id, { def: l, pos, room, glow, fixture: l.fixture ? this.objects.get(l.fixture) : null, on: false, level: 0 });
    }
  }

  _buildRooms() {
    for (const r of this.level.rooms) {
      if (r.polygon.length < 3) continue;
      const z = r.outdoor ? -0.01 : 0.02, poly = this.style.tiles ? insetPoly(r.polygon, 0.07) : r.polygon;
      const sel = this.selection, pat = sel && sel.style !== 'glow' ? this._selTexture(sel.style) : null;
      const tint = flatPolygon(poly, z, new THREE.MeshBasicMaterial({ color: sel?.color || (this.style.mat === 'blueprint' ? '#9cc4ff' : this.style.mat === 'cyber' ? '#ff3df2' : this.style.mat === 'nido' ? '#F2B544' : '#ffd9a8'), map: pat, transparent: true, opacity: 0, depthWrite: false }));
      tint.renderOrder = 2;
      tint.userData.room = r.id;
      tint.userData.overlay = true;
      const wash = flatPolygon(poly, z + 0.005, this.style.tiles ? new THREE.MeshBasicMaterial({ color: this.washColor || '#F2B544', transparent: true, opacity: 0, depthWrite: false })
        : new THREE.MeshBasicMaterial({ color: WARM, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      wash.renderOrder = 3;
      wash.userData.overlay = true;
      wash.userData.room = r.id;
      this.scene.add(tint, wash);
      this.rooms.set(r.id, { def: r, tint, wash });
    }
  }

  // ---------- the whole site (#111, #112, #115): every plan dashboard placed in the yard on its floor, roofs on top ----------
  _siteBounds() {
    const pts = [];
    const own = levelBounds(this.level);
    if (!own.empty) pts.push([own.x0, own.y0], [own.x1, own.y1]);
    for (const L of planLevels(this.home)) {
      const bb = boundsOf(L);
      if (!bb.empty) for (const p of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]]) pts.push(toSite(placeOf(L), p));
    }
    return pts.length ? polyBounds(pts) : { x0: -5, y0: -5, x1: 5, y1: 5, empty: true };
  }
  /** `peel`: 'all' (roofs on), 'open' (roofs off), 'ground' (ground floors only). */
  _buildSite() {
    const root = this.scene, style = this.style, site = this.level, simple = this.simple, peel = this.peel || 'all';
    this.style = { ...style, cut: 99, refine: false }; // whole walls, to the ceiling
    this.siteRooms = new Map(); // room id → level id, so a tap on a room of the site view can open that level
    try {
      for (const level of planLevels(this.home)) {
        if (peel === 'ground' && floorOf(level) > 0) continue;
        if (peel !== 'all' && level.roof) continue;
        const pl = placeOf(level), lg = new THREE.Group();
        lg.position.copy(V(pl.x || 0, pl.y || 0, levelZ(this.home, level)));
        lg.rotation.y = -THREE.MathUtils.degToRad(pl.rot || 0);
        root.add(lg);
        this.scene = lg; this.level = level; this.simple = !level.footprint;
        const before = new Set(this.lights.keys());
        this._buildFloors(); if (!this.style.noWalls) this._buildWalls(); this._buildStairs(); this._buildObjects(); this._buildLights(); this._buildRooms();
        if (peel === 'all') this._buildPieces(level, 0);
        root.updateMatrixWorld(true);
        for (const [id, rec] of this.lights) if (!before.has(id)) { const w = lg.localToWorld(V(rec.pos[0], rec.pos[1], rec.pos[2])); rec.pos = [w.x, w.z, w.y]; }
        for (const r of level.rooms) this.siteRooms.set(r.id, level.id);
      }
    } finally {
      this.scene = root; this.style = style; this.level = site; this.simple = simple;
    }
  }
  /** Nido: the home's other floors as faint outlines above and below this one, like a stack of layers. */
  _buildLayers(level) {
    const mine = floorOf(level), mat = new THREE.LineBasicMaterial({ color: '#5FC4B0', transparent: true, opacity: 0.32, depthWrite: false });
    for (const L of planLevels(this.home)) {
      if (L === level || L.roof || floorOf(L) === mine) continue;
      const z = (floorOf(L) - mine) * 1.6, from = placeOf(L), to = placeOf(level);
      const map = (p) => fromSite(to, toSite(from, p));
      const outlines = L.rooms.filter((r) => !r.outdoor && r.polygon?.length > 2).map((r) => r.polygon);
      for (const poly of outlines) {
        const pts = [...poly, poly[0]].map((p) => { const q = map(p); return V(q[0], q[1], z); });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
        line.userData.layer = L.id;
        this.scene.add(line);
      }
    }
  }
  /** A level's roof pieces (#114), each a rectangle turned on its own, starting at the level's eave height. */
  _buildPieces(level, z, own = false) {
    const host = this.scene;
    try {
      for (const p of piecesOf(level)) {
        const g = new THREE.Group(), o = p.overhang ?? 0.5;
        g.position.copy(V(p.x, p.y, z));
        g.rotation.y = -THREE.MathUtils.degToRad(p.rot || 0);
        host.add(g);
        this.scene = g;
        this._buildRoof(p, { rect: [-p.w / 2 - o, -p.d / 2 - o, p.w / 2 + o, p.d / 2 + o], eave: own ? Math.max(0.02, eaveOf(level)) : eaveOf(level) });
      }
    } finally { this.scene = host; }
  }
  /** A roof over a rectangle: gable, hip, skillion or flat, with the ridge along the longer side unless turned. */
  _buildRoof(roof, { rect, eave }) {
    const [x0, y0, x1, y1] = rect, pitch = THREE.MathUtils.degToRad(Math.min(60, Math.max(3, roof.pitch ?? 25)));
    const alongX = (x1 - x0 >= y1 - y0) !== !!roof.turn;
    // Work in (u along the ridge, v across it), then map back to the plan.
    const [u0, u1, v0, v1] = alongX ? [x0, x1, y0, y1] : [y0, y1, x0, x1];
    const P = (u, v, z) => (alongX ? V(u, v, z) : V(v, u, z));
    const w = (v1 - v0) / 2, vm = (v0 + v1) / 2, tris = [];
    const tri = (a, b, c) => tris.push(a, b, c), quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    const type = roof.type || 'gable';
    if (type === 'flat') {
      const t = 0.18, z = eave + t;
      quad(P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z));
      quad(P(u0, v0, eave), P(u1, v0, eave), P(u1, v0, z), P(u0, v0, z)); quad(P(u0, v1, eave), P(u1, v1, eave), P(u1, v1, z), P(u0, v1, z));
      quad(P(u0, v0, eave), P(u0, v1, eave), P(u0, v1, z), P(u0, v0, z)); quad(P(u1, v0, eave), P(u1, v1, eave), P(u1, v1, z), P(u1, v0, z));
    } else if (type === 'skillion') {
      const top = eave + (v1 - v0) * Math.tan(pitch);
      quad(P(u0, v0, eave), P(u1, v0, eave), P(u1, v1, top), P(u0, v1, top));
      tri(P(u0, v0, eave), P(u0, v1, eave), P(u0, v1, top)); tri(P(u1, v0, eave), P(u1, v1, eave), P(u1, v1, top));
      quad(P(u0, v1, eave), P(u1, v1, eave), P(u1, v1, top), P(u0, v1, top));
    } else {
      const top = eave + w * Math.tan(pitch);
      const inset = type === 'hip' ? Math.min(w, (u1 - u0) / 2) : 0, r0 = u0 + inset, r1 = u1 - inset;
      quad(P(u0, v0, eave), P(u1, v0, eave), P(r1, vm, top), P(r0, vm, top));
      quad(P(u1, v1, eave), P(u0, v1, eave), P(r0, vm, top), P(r1, vm, top));
      tri(P(u0, v1, eave), P(u0, v0, eave), P(r0, vm, top)); tri(P(u1, v0, eave), P(u1, v1, eave), P(r1, vm, top));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(tris);
    geo.computeVertexNormals();
    const mat = this._mat((ROOF_MATERIALS[roof.material] || ROOF_MATERIALS.tiles)[1], { rough: 0.85 });
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.roof = true;
    this._add(mesh);
  }
  /** The level a room of the site view belongs to, or null for the yard's own areas. */
  siteLevelOf(roomId) { return this.siteRooms?.get(roomId) || null; }
  setPeel(peel) { this.peel = peel; if (this.level?.site) this.load(this.home, this.level, { keepView: true }); }

  // ---------- camera ----------
  _dir() {
    const el = THREE.MathUtils.degToRad(this.style.elevation);
    return new THREE.Vector3(0, Math.sin(el), Math.cos(el)).applyAxisAngle(UP, THREE.MathUtils.degToRad(this.cam.az));
  }
  _basis() {
    const az = THREE.MathUtils.degToRad(this.cam.az);
    return { right: new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, az), fwd: new THREE.Vector3(0, 0, -1).applyAxisAngle(UP, az) };
  }
  _orient(cam, target, distance) {
    const topDown = this.style.elevation > 89;
    cam.position.copy(target).addScaledVector(this._dir(), distance);
    cam.up.copy(topDown ? this._basis().fwd : UP);
    cam.lookAt(target);
    cam.updateMatrixWorld();
  }
  /** Size of a plan rectangle as seen by the camera (camera-space units = metres). */
  _extents(b) {
    const target = V((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0);
    this._orient(this.ortho, target, 100);
    const inv = this.ortho.matrixWorldInverse;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [0, this.style.cut]) {
      const p = V(x, y, z).applyMatrix4(inv);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { w: x1 - x0 + 0.7, h: y1 - y0 + 0.7, off: [(x0 + x1) / 2, (y0 + y1) / 2] };
  }

  /** Hold the camera exactly where a saved photo render was taken, so the live overlay lines up with it. */
  lock(cam) { this.locked = { ...cam, off: [...cam.off] }; this.fit(); }
  unlock() { this.locked = null; }

  /** Frame the whole level. */
  fit() {
    if (this.locked && this.bounds) {
      this.baseExt = this._extents(this.bounds);
      Object.assign(this.cam, this.locked, { off: [...this.locked.off] });
      return this.resize();
    }
    const b = this.bounds;
    this.stopAnimation();
    this.baseExt = this._extents(b);
    Object.assign(this.cam, { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, zoom: 1, off: this.baseExt.off });
    this.resize();
  }

  /** The camera that frames part of the plan (a room), at the current angle. */
  boundsTarget(b) {
    const e = this._extents(b);
    const { vw, vh } = this._frustum(1);
    return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, off: e.off, zoom: Math.max(1, Math.min(vw / e.w, vh / e.h) * 0.9), az: this.cam.az };
  }
  /** Zoom in on part of the plan (a room). */
  focusBounds(b) {
    if (!this.baseExt || this.locked) return;
    this.stopAnimation();
    Object.assign(this.cam, this.boundsTarget(b));
    this.resize();
  }
  roomTarget(id) {
    const r = this.level?.rooms.find((q) => q.id === id);
    return r && this.baseExt ? this.boundsTarget(polyBounds(r.polygon)) : null;
  }
  focusRoom(id, animate = false) {
    const t = this.roomTarget(id);
    if (!t || this.locked) return;
    if (animate) this.animateTo(t); else this.focusBounds(polyBounds(this.level.rooms.find((q) => q.id === id).polygon));
  }
  /** The camera for a view seen from angle `az`: the whole plan (no cx / cy given) or a saved view. */
  viewTarget({ az = 0, cx, cy, zoom = 1 } = {}) {
    const keep = this.cam.az;
    this.cam.az = az;
    const e = this._extents(this.bounds);
    this.cam.az = keep;
    const b = this.bounds;
    return { cx: cx ?? (b.x0 + b.x1) / 2, cy: cy ?? (b.y0 + b.y1) / 2, zoom, off: e.off, az };
  }

  /** Glide the camera to `to` ({cx, cy, zoom, off, az}) — pan, zoom and turn together, eased (#51). */
  animateTo(to, ms = 520) {
    if (!to || this.locked || !this.baseExt) return;
    this.stopAnimation();
    const from = { ...this.cam, off: [...this.cam.off] };
    const daz = ((((to.az ?? from.az) - from.az) % 360) + 540) % 360 - 180;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now(), lerp = (a, b, k) => a + (b - a) * k;
    const step = (now) => {
      const t = reduce ? 1 : Math.min(1, (now - t0) / ms);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.cam.az = (from.az + daz * k + 360) % 360;
      if (daz) this.baseExt = this._extents(this.bounds);
      this.cam.cx = lerp(from.cx, to.cx, k);
      this.cam.cy = lerp(from.cy, to.cy, k);
      this.cam.zoom = from.zoom * Math.pow(to.zoom / from.zoom, k);
      this.cam.off = [lerp(from.off[0], to.off[0], k), lerp(from.off[1], to.off[1], k)];
      this.resize();
      if (t < 1) this._animRaf = requestAnimationFrame(step);
      else { this._animRaf = null; this.onAnimationEnd?.(); }
    };
    this._animRaf = requestAnimationFrame(step);
  }
  stopAnimation() { if (this._animRaf) { cancelAnimationFrame(this._animRaf); this._animRaf = null; } }
  get animating() { return !!this._animRaf; }

  /**
   * Show only one room (#51): its floor, furniture and lights; everything else is hidden, and walls
   * are clipped to the room's outline. null shows the whole plan again.
   */
  isolate(id) {
    this.isolated = id && this.level?.rooms.some((r) => r.id === id) ? id : null;
    this._applyIsolation();
    this._assignLights();
    this.requestRender();
  }
  /** Is a plan point part of what is shown? (Always, unless one room is isolated.) */
  shows(x, y) {
    const r = this.isolated && this.level?.rooms.find((q) => q.id === this.isolated);
    return !r || this._inRoom(r, x, y);
  }
  _inRoom(r, x, y) {
    if (pointInPoly([x, y], r.polygon)) return true;
    const b = polyBounds(r.polygon), m = 0.1;
    return r.polygon.length === 4 && x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m;
  }
  _applyIsolation() {
    for (const o of this._isoHidden || []) o.visible = true;
    this._isoHidden = [];
    this.renderer.clippingPlanes = [];
    if (!this.scene || !this.lights) return;
    for (const l of this.lights.values()) l.hidden = false;
    const r = this.isolated && this.level.rooms.find((q) => q.id === this.isolated);
    if (!r) { this.isolated = null; return; }
    const hide = (o) => { if (o && o.visible) { o.visible = false; this._isoHidden.push(o); } };
    for (const child of this.scene.children) {
      const room = child.userData.room, obj = child.userData.object;
      if (room) { if (room !== r.id) hide(child); continue; }
      if (obj) {
        const c = [(obj.bounds.min[0] + obj.bounds.max[0]) / 2, (obj.bounds.min[1] + obj.bounds.max[1]) / 2];
        if (!(obj.room ? obj.room === r.id : this._inRoom(r, c[0], c[1]))) hide(child);
      }
    }
    for (const l of this.lights.values()) {
      const inside = l.def.room ? l.def.room === r.id : this._inRoom(r, l.pos[0], l.pos[1]);
      if (!inside) { l.hidden = true; hide(l.glow); }
    }
    // Walls, slabs and anything else not owned by a room: cut to the room's box (plus the wall thickness).
    const b = polyBounds(r.polygon), m = 0.22;
    this.renderer.clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -(b.x0 - m)), new THREE.Plane(new THREE.Vector3(-1, 0, 0), b.x1 + m),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -(b.y0 - m)), new THREE.Plane(new THREE.Vector3(0, 0, -1), b.y1 + m),
    ];
  }

  _frustum(zoom = this.cam.zoom) {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    const aspect = w / h;
    let vw = this.baseExt.w, vh = this.baseExt.h;
    if (vw / vh > aspect) vh = vw / aspect; else vw = vh * aspect;
    return { vw: vw / zoom, vh: vh / zoom, w, h };
  }

  resize() {
    if (!this.baseExt) return;
    const { vw, vh, w, h } = this._frustum();
    this.renderer.setSize(w, h, false);
    const target = V(this.cam.cx, this.cam.cy, 0);
    const [mx, my] = this.cam.off;
    if (this.camera === this.ortho) {
      this._orient(this.ortho, target, 100);
      Object.assign(this.ortho, { left: mx - vw / 2, right: mx + vw / 2, top: my + vh / 2, bottom: my - vh / 2 });
    } else {
      // Shift the look-at point by the framing offset, then stand back far enough to see vh metres.
      this._orient(this.persp, target, 10);
      const e = this.persp.matrixWorld.elements;
      target.add(new THREE.Vector3(e[0], e[1], e[2]).multiplyScalar(mx)).add(new THREE.Vector3(e[4], e[5], e[6]).multiplyScalar(my));
      this.persp.aspect = w / h;
      this._orient(this.persp, target, (vh / 2 / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2))) * 1.13);
    }
    this.camera.updateProjectionMatrix();
    this.pxPerMetre = w / vw;
    this._resizeRefine(w, h);
    this.requestRender();
  }

  panBy(dxPx, dyPx) {
    if (this.locked) return;
    this.stopAnimation();
    const { right, fwd } = this._basis();
    const k = 1 / this.pxPerMetre, s = Math.max(0.3, Math.sin(THREE.MathUtils.degToRad(this.style.elevation)));
    const d = right.multiplyScalar(-dxPx * k).add(fwd.multiplyScalar((dyPx * k) / s));
    this.cam.cx += d.x;
    this.cam.cy += d.z;
    this.resize();
  }
  zoomAt(factor, sx, sy) {
    if (this.locked) return;
    this.stopAnimation();
    const before = this.unproject(sx, sy);
    this.cam.zoom = Math.max(0.4, Math.min(12, this.cam.zoom * factor));
    this.resize();
    const after = this.unproject(sx, sy);
    if (before && after) { this.cam.cx += before[0] - after[0]; this.cam.cy += before[1] - after[1]; this.resize(); }
  }
  rotateBy(deg) {
    if (this.locked) return;
    this.stopAnimation();
    this.cam.az = (this.cam.az + deg + 360) % 360;
    const keep = { ...this.cam };
    this.baseExt = this._extents(this.bounds);
    Object.assign(this.cam, keep);
    this.resize();
  }

  /** Screen position (CSS px) of a plan point. */
  project(x, y, z = 0) {
    const p = V(x, y, z).project(this.camera);
    return [((p.x + 1) / 2) * this.canvas.clientWidth, ((1 - p.y) / 2) * this.canvas.clientHeight];
  }
  /** Plan point under a screen position, at height z. */
  unproject(sx, sy, z = 0) {
    const ray = this._ray(sx, sy).ray;
    const t = (z - ray.origin.y) / ray.direction.y;
    if (!isFinite(t)) return null;
    const p = ray.origin.clone().addScaledVector(ray.direction, t);
    return [p.x, p.z];
  }
  _ray(sx, sy) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((sx / this.canvas.clientWidth) * 2 - 1, -(sy / this.canvas.clientHeight) * 2 + 1), this.camera);
    return rc;
  }

  // ---------- state ----------
  setStyle(styleId) {
    if (styleId === this.styleId || !this.level) return;
    const cam = { ...this.cam };
    this.load(this.home, this.level, { style: styleId, keepView: true });
    this.baseExt = this._extents(this.bounds);
    Object.assign(this.cam, cam);
    this.resize();
  }

  /** Where the sun is: compass azimuth (0 = north, 90 = east) and elevation, in degrees. */
  setSun(azimuth, elevation) {
    this.sunAngles = { azimuth, elevation };
    this._applySun();
    this.requestRender();
  }
  _applySun() {
    if (!this.sun) return;
    const a = THREE.MathUtils.degToRad(this.sunAngles.azimuth), e = THREE.MathUtils.degToRad(Math.max(12, this.sunAngles.elevation));
    this.sunDir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    this.sun.position.copy(this.centre).addScaledVector(this.sunDir, this.span * 2 + 20);
  }

  setNight(night) {
    this.night = night;
    if (!this.scene) return;
    const st = this.style, rich = ['pbr', 'clay', 'pear'].includes(st.mat);
    this.renderer.toneMapping = rich ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = rich ? 0.92 : 1;
    this.hemiBase = night ? (rich ? 0.2 : 0.75) : rich ? 0.8 : 1.6;
    this.hemi.intensity = this.hemiBase;
    this.hemi.color.set(night ? '#8f9ad8' : rich ? '#eef3ff' : '#fffaf2');
    this.hemi.groundColor.set(night ? '#20243a' : st.mat === 'pear' ? '#d9d9e0' : '#9a8b7c');
    this.sun.intensity = night ? (rich ? 0.18 : 0.25) : rich ? 3.3 : 1.6;
    this.sun.color.set(night ? '#9aa6ff' : st.mat === 'pear' ? '#ffffff' : '#fff1dc');
    this.sun.castShadow = st.shadows && (rich || !night);
    this._applySun();
    if (st.bg) {
      const bg = st.bg[night ? 1 : 0];
      this.renderer.setClearColor(bg, 1);
      this.ground?.material.color.set(bg);
      this.scene.fog = st.ground ? new THREE.Fog(bg, this.span * 4 + 30, this.span * 9 + 80) : null;
    } else this.renderer.setClearColor(0x000000, 0);
    this.scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) if (m.isMeshStandardMaterial && m !== this.ground?.material) m.envMapIntensity = night ? 0.06 : m.transparent ? 1.0 : 0.3;
    });
    this._assignLights();
    this.requestRender();
  }

  setLight(id, on, level = on ? 1 : 0, quiet = false) {
    const l = this.lights?.get(id);
    if (!l) return;
    l.on = on;
    l.level = level;
    if (!quiet) { this._assignLights(); this.requestRender(); }
  }

  /** Give the limited pool of real light sources to the lights that are on; the rest still glow. */
  _assignLights() {
    if (!this.lights) return;
    const rich = ['pbr', 'clay', 'pear'].includes(this.style.mat);
    const lit = [...this.lights.values()].filter((l) => l.on && !l.hidden).sort((a, b) => b.level - a.level);
    this.pool.forEach((p, i) => {
      const l = lit[i];
      if (!l) { p.intensity = 0; return; }
      const ceiling = l.def.kind === 'ceiling';
      const k = Math.max(0.15, l.level);
      p.position.copy(V(l.pos[0], l.pos[1], Math.max(l.pos[2], 0.5)));
      p.distance = ceiling ? 7 : 3.6;
      p.intensity = k * (this.night ? (ceiling ? 9 : 5) : ceiling ? 1.5 : 1.2) * (rich ? 1.6 : 1);
    });
    for (const l of this.lights.values()) {
      const k = l.on ? Math.max(0.15, l.level) : 0;
      if (l.glow) l.glow.material.opacity = k * (this.night ? 1 : 0.75);
      for (const m of l.fixture?.userData.bulbs || []) {
        if (!m.material.emissive) continue;
        m.material.emissive.set(l.on ? WARM : '#000');
        m.material.emissiveIntensity = k * (rich ? 2.2 : 0.9);
      }
      if (l.def.kind === 'ceiling' && !this.style.tiles) {
        const room = this.rooms.get(l.def.room);
        if (room) room.wash.material.opacity = k * (this.night ? 0.22 : 0.08);
      }
    }
    if (this.style.tiles) { // Nido conceptual: a room is washed amber while any light in it is on
      const most = new Map();
      for (const l of this.lights.values()) if (l.on && l.room) most.set(l.room, Math.max(most.get(l.room) || 0, Math.max(0.3, l.level)));
      for (const [id, room] of this.rooms) { room.wash.material.opacity = (most.get(id) || 0) * 0.16; if (this.washColor) room.wash.material.color.set(this.washColor); }
    }
  }

  /** How a selected room is marked (themes, #57): null = the original soft glow, or { style: glow | grid | stripes | dots, color }. */
  setSelection(sel) {
    this.selection = sel && sel.color ? { style: sel.style || 'glow', color: sel.color } : null;
    if (this.level && !this.tracing) { this.load(this.home, this.level, { keepView: true }); this.onAssets?.(); }
  }
  /** A see-through pattern, one tile per half metre of floor (floor UVs are in metres). */
  _selTexture(kind) {
    const key = `sel-${kind}`;
    if (this.textures[key]) return this.textures[key];
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = g.fillStyle = '#fff';
    if (kind === 'grid') { g.globalAlpha = 0.16; g.fillRect(0, 0, 64, 64); g.globalAlpha = 1; g.lineWidth = 5; g.strokeRect(0, 0, 64, 64); }
    else if (kind === 'stripes') { g.lineWidth = 14; for (const o of [-64, 0, 64]) { g.beginPath(); g.moveTo(o, 64); g.lineTo(o + 64, 0); g.stroke(); } }
    else { g.globalAlpha = 0.14; g.fillRect(0, 0, 64, 64); g.globalAlpha = 1; g.beginPath(); g.arc(32, 32, 13, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    t.colorSpace = THREE.SRGBColorSpace;
    return (this.textures[key] = t);
  }

  selectRoom(id) {
    this.selectedRoom = id;
    if (!this.rooms) return;
    const strong = this.selection && this.selection.style !== 'glow' ? 0.95 : this.selection ? (this.night ? 0.28 : 0.36) : this.night ? 0.18 : 0.26;
    for (const [rid, r] of this.rooms) r.tint.material.opacity = rid === id ? strong : 0;
    this.requestRender();
  }

  /** Move an object's model without rebuilding (live feedback while dragging in the editor). */
  nudgeObject(id, x, y, rotation) {
    const g = this.objects?.get(id);
    if (!g) return;
    g.position.x = x;
    g.position.z = y;
    if (rotation != null) g.rotation.y = -THREE.MathUtils.degToRad(rotation);
    this.requestRender();
  }

  // ---------- picking ----------
  /** Nearest controllable thing (light, or object with an entity) within `radius` px. */
  pickThing(sx, sy, radius = 34) {
    let best = null, bd = radius;
    const test = (x, y, z, hit) => {
      const [px, py] = this.project(x, y, z);
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = hit; }
    };
    for (const l of this.lights.values()) if (l.def.kind !== 'ceiling' && !l.hidden) test(l.pos[0], l.pos[1], l.pos[2], { light: l.def });
    for (const o of this.level.objects) {
      if ((!o.entity && !o.gestures) || this.objects.get(o.id)?.visible === false) continue;
      test((o.bounds.min[0] + o.bounds.max[0]) / 2, (o.bounds.min[1] + o.bounds.max[1]) / 2, o.bounds.max[2], { object: o });
    }
    return best;
  }
  pickRoom(sx, sy) {
    const hits = this._ray(sx, sy).intersectObjects([...this.rooms.values()].filter((r) => !this.isolated || r.def.id === this.isolated).map((r) => r.tint), false);
    return hits.length ? hits[0].object.userData.room : null;
  }

  // ---------- rendering ----------
  _initRefine() {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const vertexShader = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    // Each new sample is blended into the running average with a constant weight of 1/n.
    this.blendMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: null } }, vertexShader, toneMapped: false, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }',
      blending: THREE.CustomBlending, blendSrc: THREE.ConstantAlphaFactor, blendDst: THREE.OneMinusConstantAlphaFactor,
      blendSrcAlpha: THREE.ConstantAlphaFactor, blendDstAlpha: THREE.OneMinusConstantAlphaFactor, transparent: true,
    });
    this.presentMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: null } }, vertexShader, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    });
    this.blendScene = new THREE.Scene().add(new THREE.Mesh(quad, this.blendMat));
    this.presentScene = new THREE.Scene().add(new THREE.Mesh(quad, this.presentMat));
    this.samples = 0;
  }
  _resizeRefine(w, h) {
    if (!this.canRefine) return;
    const pr = this.renderer.getPixelRatio(), W = Math.round(w * pr), H = Math.round(h * pr);
    if (this.sampleRT?.width === W && this.sampleRT?.height === H) return;
    this.sampleRT?.dispose();
    this.accRT?.dispose();
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.sampleRT = new THREE.WebGLRenderTarget(W, H, opts);
    this.accRT = new THREE.WebGLRenderTarget(W, H, { ...opts, depthBuffer: false });
  }

  /** A picture of what is on screen now (for the move between dashboards, #128). Null when it cannot be read. */
  snapshot() {
    try { if (!this.scene) return null; this.renderer.setRenderTarget(null); this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); } catch { return null; }
  }
  /** Draw a quick frame now, then (in refine styles) keep improving it while idle. */
  requestRender() {
    if (this.tracing) return;
    cancelAnimationFrame(this._refineRaf);
    this.samples = 0;
    clearTimeout(this._refineTimer);
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => {
      this._pending = false;
      if (!this.scene) return;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      this.onRender?.();
      if (this.style.refine && this.canRefine && this.refineEnabled !== false) this._refineTimer = setTimeout(() => this._refineStep(), 350);
    });
  }

  _refineStep() {
    if (!this.scene || this._pending || this.samples >= REFINE_SAMPLES) return;
    const r = this.renderer, n = this.samples, { w, h } = this._frustum();
    const rnd = (this._rnd ||= rng(12345));
    // jitter: sub-pixel camera offset, the sun across its disc, and a sky light across the dome
    this.camera.setViewOffset(w, h, rnd() - 0.5, rnd() - 0.5, w, h);
    const sunPos = this.sun.position.clone();
    const spread = this.span * 0.09;
    this.sun.position.add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(spread));
    const u = rnd(), phi = rnd() * Math.PI * 2, sinT = Math.sqrt(u), cosT = Math.sqrt(1 - u); // cosine-weighted
    this.sky.position.copy(this.centre).add(new THREE.Vector3(sinT * Math.cos(phi), cosT, sinT * Math.sin(phi)).multiplyScalar(this.span * 2 + 20));
    this.sky.castShadow = true;
    this.sky.color.copy(this.hemi.color);
    this.sky.intensity = this.hemiBase * 1.05;
    this.hemi.intensity = this.hemiBase * 0.3;
    r.setRenderTarget(this.sampleRT);
    r.render(this.scene, this.camera);
    this.camera.clearViewOffset();
    this.sun.position.copy(sunPos);
    this.sky.castShadow = false;
    this.sky.intensity = 0;
    this.hemi.intensity = this.hemiBase;
    this.blendMat.uniforms.t.value = this.sampleRT.texture;
    this.blendMat.blendAlpha = 1 / (n + 1);
    r.setRenderTarget(this.accRT);
    r.autoClear = false;
    r.render(this.blendScene, this.fsCam);
    r.autoClear = true;
    this.samples = n + 1;
    if (this.samples >= 4) { // the first few samples are too noisy to show
      this.presentMat.uniforms.t.value = this.accRT.texture;
      r.setRenderTarget(null);
      r.render(this.presentScene, this.fsCam);
    }
    r.setRenderTarget(null);
    if (this.samples < REFINE_SAMPLES) this._refineRaf = requestAnimationFrame(() => this._refineStep());
    else this.onRefined?.();
  }

  // ---------- photo render (path tracing) ----------
  /**
   * Compute a physically based picture of the current view: light bounces around the rooms, soft
   * shadows, real reflections. Progressive; resolves with a JPEG Blob (or null if cancelled early).
   */
  async trace({ samples = 200, onProgress, cancelled = () => false, finishEarly = () => false } = {}) {
    if (!this.scene || this.tracing) return null;
    const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
    clearTimeout(this._refineTimer);
    cancelAnimationFrame(this._refineRaf);
    this.tracing = true;
    const r = this.renderer, scene = this.scene, hidden = [];
    // Leave out what only exists for the live view: the unseen roof, glow sprites, selection tints.
    // (They are taken out of the scene, not just hidden: hidden meshes confuse the tracer's material table.)
    scene.traverse((o) => { if (o.layers.mask === 2 || o.isSprite || o.userData.overlay) hidden.push([o, o.parent]); });
    for (const [o, parent] of hidden) parent.remove(o);
    // The tracer mis-assigns materials on meshes that use several at once, so give those one material for now.
    const multi = [];
    scene.traverse((o) => {
      if (!Array.isArray(o.material)) return;
      multi.push([o, o.material, o.geometry.groups.map((g) => ({ ...g }))]);
      o.material = o.material[2] || o.material[0];
      o.geometry.clearGroups();
    });
    const sky = new GradientEquirectTexture();
    sky.topColor.set(this.night ? '#101830' : '#bcd6ff');
    sky.bottomColor.set(this.night ? '#06080f' : '#f4efe6');
    sky.update();
    const keep = { env: scene.environment, bg: scene.background, fog: scene.fog, envI: scene.environmentIntensity, hemi: this.hemi.visible, sun: this.sun.intensity };
    scene.environment = sky;
    scene.background = new THREE.Color(this.style.bg ? this.style.bg[this.night ? 1 : 0] : '#dfe3e6');
    scene.environmentIntensity = this.night ? 0.25 : 0.6;
    scene.fog = null;
    this.hemi.visible = false;
    this.sun.intensity = this.night ? 0.05 : 2.2;
    let blob = null, pt = null;
    try {
      pt = new WebGLPathTracer(r);
      pt.bounces = 5;
      pt.filterGlossyFactor = 0.5;
      pt.renderScale = 1;
      pt.tiles.set(3, 3);
      pt.dynamicLowRes = false;
      pt.setScene(scene, this.camera);
      while (!cancelled()) {
        await new Promise((res) => requestAnimationFrame(res));
        pt.renderSample();
        onProgress?.(pt.samples);
        if (pt.samples >= samples || (finishEarly() && pt.samples >= 8)) {
          blob = await new Promise((res) => this.canvas.toBlob(res, 'image/jpeg', 0.93));
          break;
        }
      }
    } finally {
      pt?.dispose?.();
      for (const [o, parent] of hidden) parent.add(o);
      for (const [o, mats, groups] of multi) { o.material = mats; for (const g of groups) o.geometry.addGroup(g.start, g.count, g.materialIndex); }
      Object.assign(scene, { environment: keep.env, background: keep.bg, fog: keep.fog, environmentIntensity: keep.envI });
      this.hemi.visible = keep.hemi;
      this.sun.intensity = keep.sun;
      sky.dispose();
      this.tracing = false;
      r.setRenderTarget(null);
      this.requestRender();
    }
    return blob;
  }
}
