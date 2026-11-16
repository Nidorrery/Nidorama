// One place that reads .glb files, including compressed ones (Draco, Meshopt) that scanning apps
// and model sites often produce. The decoders ship with the app; nothing is fetched from the internet.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let loader = null;
export function parseGLB(arrayBuffer) {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setDRACOLoader(new DRACOLoader().setDecoderPath(new URL('draco/', document.baseURI).href));
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader.parseAsync(arrayBuffer, '');
}
/** Does this file start like a .glb? */
export const isGLB = async (blob) => new TextDecoder().decode(await blob.slice(0, 4).arrayBuffer()) === 'glTF';
