"""Safely extract only selected CC0 art files, never executables, from official pack."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

CACHE = Path.home() / '.codex/orbix-tooling/assets/quaternius-universal'
PREFIX = 'Universal Base Characters[Standard]/'

if __name__ == '__main__':
    archive = CACHE / 'universal-base-characters-standard.zip'
    destination = CACHE / 'base'
    inventory = []
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in entry.filename:
                raise ValueError('Unsafe archive path')
            selected = (entry.filename.startswith(PREFIX+'Base Characters/Godot - UE/') or entry.filename.startswith(PREFIX+'Hairstyles/Origin at 0/glTF (Godot)/') or entry.filename == PREFIX+'License_Standard.txt')
            if not selected or entry.is_dir():
                continue
            if path.suffix.lower() not in {'.gltf', '.bin', '.png', '.txt'} or entry.file_size > 10*1024*1024:
                raise ValueError('Unexpected asset entry')
            data = source.read(entry)
            target = destination / entry.filename.removeprefix(PREFIX)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            inventory.append({'path': entry.filename, 'bytes':len(data), 'sha256':hashlib.sha256(data).hexdigest()})
    record = {'source':'https://quaternius.itch.io/universal-base-characters', 'archive_bytes':archive.stat().st_size, 'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(), 'files':inventory}
    (CACHE/'base-source-inventory.json').write_text(json.dumps(record,indent=2))
    print(json.dumps({'archive_sha256':record['archive_sha256'], 'files':len(inventory), 'license':(destination/'License_Standard.txt').read_text()},indent=2))
