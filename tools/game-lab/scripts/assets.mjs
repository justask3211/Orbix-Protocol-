import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { inspect } from '@gltf-transform/functions';
import { createAssetIO, optimizeDocument } from './asset-pipeline.mjs';

const usage = 'inspect --input <model.glb|model.gltf> | optimize --input <model.glb|model.gltf> --output <new-model.glb>';
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['inspect', 'optimize'].includes(command) || args.length % 2) throw new Error(usage);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--input', '--output'].includes(args[i]) || options[args[i]]) throw new Error(usage);
    options[args[i]] = args[i + 1];
  }
  if (!options['--input'] || (command === 'optimize') !== Boolean(options['--output'])) throw new Error(usage);
  const input = await realpath(resolve(options['--input']));
  if (!['.glb', '.gltf'].includes(extname(input).toLowerCase())) throw new Error('Input must be a local .glb or .gltf file.');
  const io = await createAssetIO();
  const document = await io.read(input);
  if (command === 'inspect') {
    console.log(JSON.stringify({ input, bytes: (await stat(input)).size, ...inspect(document) }, null, 2));
    return;
  }
  const output = resolve(options['--output']);
  if (extname(output).toLowerCase() !== '.glb') throw new Error('Output must be a .glb file.');
  if (input.toLowerCase() === output.toLowerCase()) throw new Error('Output must differ from input.');
  await optimizeDocument(document);
  const bytes = await io.writeBinary(document);
  // Exclusive creation protects source assets and existing optimized files.
  await writeFile(output, bytes, { flag: 'wx' });
  const roundtrip = await io.readBinary(new Uint8Array(await readFile(output)));
  console.log(JSON.stringify({ input, output, beforeBytes: (await stat(input)).size, afterBytes: bytes.byteLength,
    meshes: roundtrip.getRoot().listMeshes().length, textures: roundtrip.getRoot().listTextures().length,
    note: 'Deduplication, animation resampling, pruning and Meshopt geometry quantization; textures are unchanged.' }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
