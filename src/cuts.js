// Cut-out parts (#141, an idea from ElCapitanDre on public pull request #4): a part marked `cut` is not drawn;
// it removes its shape from every part of the same model that it overlaps. A box cutting half a cylinder
// makes a half-round bench, a quarter makes a corner bath, a cylinder cutting a box makes a basin.
// The cutting is done by three-bvh-csg (MIT). Results are kept, so a plan is cut once, not on every redraw.
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'uv', 'normal'];
const kept = new Map(); // key → geometry already cut
const MAX_KEPT = 300;

/** Every shape from shapes.js has a position, a normal and a uv set (the cutter needs the same set on all). */
function ready(THREE, geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}
const brushOf = (THREE, geo, position, quaternion) => {
  const b = new Brush(ready(THREE, geo));
  b.position.copy(position);
  b.quaternion.copy(quaternion);
  b.updateMatrixWorld(true);
  return b;
};
const keyOf = (o) => `${o.position.toArray().map((v) => v.toFixed(4))}|${o.quaternion.toArray().map((v) => v.toFixed(4))}|${o.geometry.uuid}`;

/**
 * Make a cutter for one model. `cuts`: [{ geometry, position, quaternion, key }] for its cut-out parts, all in the
 * frame the model's meshes are placed in. Returns `cut(mesh, key)`: if any cut-out overlaps the mesh, the mesh's
 * shape is replaced by the cut one (still placed where the mesh is) and true is returned. `key` names the part's
 * shape and place, so the same cut is not worked out twice.
 */
export function cutter(THREE, cuts) {
  if (!cuts.length) return () => false;
  const brushes = cuts.map((c) => { const b = brushOf(THREE, c.geometry, c.position, c.quaternion); b.userData.key = c.key; return { b, box: new THREE.Box3().setFromObject(b) }; });
  return (mesh, key) => {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const hits = brushes.filter((c) => c.box.intersectsBox(box));
    if (!hits.length) return false;
    const k = key && `${key}#${hits.map((c) => c.b.userData.key).join('#')}`;
    let geo = k && kept.get(k);
    if (!geo) {
      try {
        let result = brushOf(THREE, mesh.geometry, mesh.position, mesh.quaternion);
        for (const c of hits) { result = evaluator.evaluate(result, c.b, SUBTRACTION); result.updateMatrixWorld(true); }
        geo = result.geometry;
        geo.computeBoundingBox(); geo.computeBoundingSphere();
      } catch (e) { console.warn('A cut-out could not be made', e); return false; }
      if (k) { if (kept.size > MAX_KEPT) kept.clear(); kept.set(k, geo); }
    }
    mesh.geometry = geo; // in the part's own frame, so the mesh keeps its place; a kept geometry is shared, never disposed with the mesh
    mesh.userData.sharedGeometry = true;
    return true;
  };
}
/** A stable name for a part's shape and place, for keeping its cut. */
export const partKey = (p) => JSON.stringify([p.min, p.max, p.shape || '', p.radius || 0, p.axis || '', p.top ?? '', p.bottom ?? '', p.slope || '', p.tilt || 0]);
