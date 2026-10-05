import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// Official API: https://gltf-transform.dev/modules/functions/functions/meshopt
// Geometry quantization is intentionally lossy. Keep the original and review output.
export async function createAssetIO() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

export async function optimizeDocument(document) {
  await document.transform(dedup(), resample(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return document;
}
