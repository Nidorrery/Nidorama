// The shapes a furniture part can have, as three.js geometry. Shared by the plan (scene.js), the furniture
// pictures (thumbs.js) and the model maker, so a part looks the same everywhere. Every shape fills its part's
// box exactly, so resizing a piece works the same for all of them.
//   box (no shape), rounded box (radius), cylinder, sphere, dome, cone, wedge
//   axis:   'x' or 'y' lays a cylinder or cone on its side (along the width, or front to back); upright if absent
//   top, bottom: a cone's width at each end, as a share of the part's width (0 = a point, 1 = full); default 0 and 1
//   slope:  which side of a wedge comes down to nothing: 'front' (default), 'back', 'left' or 'right'
// Older versions of the app draw a shape they do not know as a plain box.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A wedge in a 1 × 1 × 1 box centred on 0 (view space: x right, y up, z to the front), high at the back, nothing at the front. */
function unitWedge() {
  const A = [-0.5, -0.5, -0.5], B = [0.5, -0.5, -0.5], C = [0.5, 0.5, -0.5], D = [-0.5, 0.5, -0.5], E = [-0.5, -0.5, 0.5], F = [0.5, -0.5, 0.5];
  const tris = [[A, B, C], [A, C, D], [A, E, F], [A, F, B], [D, C, F], [D, F, E], [A, D, E], [B, F, C]];
  const inside = new THREE.Vector3(0, -0.25, -0.25), pos = [];
  for (const [p, q, r] of tris) { // each face turned to look outwards
    const [a, b, c] = [p, q, r].map((v) => new THREE.Vector3(...v));
    const n = b.clone().sub(a).cross(c.clone().sub(a)), mid = a.clone().add(b).add(c).divideScalar(3);
    pos.push(...(n.dot(mid.sub(inside)) >= 0 ? [...p, ...q, ...r] : [...p, ...r, ...q]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Geometry for a part `w` wide (x), `h` high (y) and `d` deep (z), centred on 0. `p` holds the part's shape options
 * (shape, radius, axis, top, bottom, slope). `segments`: roundness of curved shapes.
 */
export function partGeometry(p, w, h, d, segments = 32) {
  let g;
  const lay = (geo) => { if (p.axis === 'x') geo.rotateZ(-Math.PI / 2); else if (p.axis === 'y') geo.rotateX(Math.PI / 2); return geo; };
  switch (p.shape) {
    case 'cylinder': g = lay(new THREE.CylinderGeometry(0.5, 0.5, 1, segments)); break;
    case 'cone': {
      const top = Math.min(1, Math.max(0, p.top ?? 0)), bottom = Math.min(1, Math.max(0, p.bottom ?? 1));
      g = lay(new THREE.CylinderGeometry(0.5 * top, 0.5 * (top || bottom ? bottom : 1), 1, segments));
      break;
    }
    case 'sphere': g = new THREE.SphereGeometry(0.5, segments, Math.max(8, segments / 2)); break;
    case 'dome': {
      const cap = new THREE.CircleGeometry(0.5, segments).rotateX(Math.PI / 2);
      const top = new THREE.SphereGeometry(0.5, segments, Math.max(6, segments / 4), 0, Math.PI * 2, 0, Math.PI / 2);
      g = mergeGeometries([top.toNonIndexed(), cap.toNonIndexed()]).scale(1, 2, 1).translate(0, -0.5, 0);
      break;
    }
    case 'wedge': {
      g = unitWedge();
      g.rotateY({ back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 }[p.slope] || 0);
      break;
    }
    default:
      if (p.radius) return new RoundedBoxGeometry(w, h, d, 3, Math.min(p.radius, w / 2, d / 2, h / 2) * 0.999);
      return new THREE.BoxGeometry(w, h, d);
  }
  return g.scale(w, h, d);
}
