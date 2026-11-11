import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// The one place a .glb is loaded from. The models in public/models are packed with Meshopt
// (`npx @gltf-transform/cli meshopt`, see public/models/README.md), which more than halves them,
// so every loader needs the decoder: a small WebAssembly module inlined in the bundle, set up on first use.

/** A GLTFLoader that can read Meshopt-compressed (and plain) files. */
export function gltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}
