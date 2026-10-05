"""Record cache provenance and verify that original extracted files are intact."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    archive = root.parent / "kenney_animated-characters-protagonists.zip"
    source_files = []
    with zipfile.ZipFile(archive) as zipped:
        for entry in zipped.infolist():
            if entry.is_dir():
                continue
            path = (root / entry.filename).resolve()
            assert path.is_relative_to(root), entry.filename
            assert path.read_bytes() == zipped.read(entry), f"Original changed: {entry.filename}"
            source_files.append({"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
                                 "sha256": digest(path)})
    inspection = json.loads((root / "derived/fbx-inspection.json").read_text(encoding="utf-8"))
    glb = json.loads((root / "derived/glb-inspection.json").read_text(encoding="utf-8"))
    clips = []
    for record in inspection:
        for action in record["actions"]:
            clip = action["name"].split("|")[-1]
            if clip == "0.Targeting Pose":
                continue
            clips.append({"name": clip, "source": record["file"].replace("\\", "/"), "frames": action["frames"],
                          "fps": record["fps"], "duration_seconds": (action["frames"][1] - action["frames"][0]) / record["fps"]})
    report = {
        "name": "Kenney Animated Characters Protagonists", "license_file_version": "1.1",
        "source": "https://kenney.nl/assets/animated-characters-protagonists",
        "download": "https://kenney.nl/media/pages/assets/animated-characters-protagonists/608191acc4-1774773108/kenney_animated-characters-protagonists.zip",
        "license": "CC0-1.0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "attribution_required": False, "author": "Kenney", "cost": "Free; no donation, account, or API key",
        "cache": str(root), "archive": {"path": str(archive), "bytes": archive.stat().st_size, "sha256": digest(archive)},
        "original_files": source_files, "original_files_verified_against_zip": True,
        "source_formats": ["FBX", "PNG", "SVG"], "source_glb_count": 0,
        "source_rig": {"bones": 58, "vertices": 804, "polygons": 826, "weighted_vertex_groups": 32},
        "source_clips": clips, "derived_glb": glb,
        "animation_transfer": {"status": "Requires retargeting and visual review",
                               "observation": "Bone names agree, but idle animation and character rest matrices differ (max component difference 1.9411). Direct action copying was rejected.",
                               "clips_embedded_in_derived_glb": False},
        "inspection": str(root / "derived/fbx-inspection.json"), "verified_on": "2026-10-05",
    }
    manifest = Path(__file__).with_name("asset-pack.json")
    manifest.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(manifest), "original_files": len(source_files), "archive_bytes": archive.stat().st_size,
                      "derived_glb_bytes": glb["bytes"], "clips": [clip["name"] for clip in clips]}, indent=2))


if __name__ == "__main__":
    main()
