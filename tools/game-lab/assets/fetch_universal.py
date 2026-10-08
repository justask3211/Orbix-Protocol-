"""Fetch the explicitly CC0 animation mirror, with bounded downloads and inventories."""
import hashlib
import json
from pathlib import Path
import urllib.request

CACHE = Path.home() / '.codex/orbix-tooling/assets/quaternius-universal'
MIRROR_COMMIT = 'e24c23cf2a1323488a3faa226ea7ea21f644b73e'
BASE = f'https://raw.githubusercontent.com/J-Ponzo/gltf-universal-animation-library/{MIRROR_COMMIT}/'

def download(relative):
    target = CACHE / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with urllib.request.urlopen(BASE + relative, timeout=90) as source:
            data = source.read(100 * 1024 * 1024 + 1)
        if len(data) > 100 * 1024 * 1024:
            raise ValueError('Asset exceeded 100 MiB limit')
        target.write_bytes(data)
    data = target.read_bytes()
    return {'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'url': BASE + relative}

if __name__ == '__main__':
    files = [download(p) for p in ('LICENSE', 'README.md', 'glTF/AnimationLibrary_Godot_Standard.gltf', 'glTF/AnimationLibrary_Godot_Standard.bin')]
    document = json.loads((CACHE / files[2]['path']).read_text())
    print(json.dumps({'files': files, 'animations': [a['name'] for a in document['animations']], 'meshes': [m['name'] for m in document['meshes']], 'nodes': [n.get('name') for n in document['nodes']], 'images': document.get('images')}, indent=2))
    (CACHE / 'source-inventory.json').write_text(json.dumps(files, indent=2))
