"""Inspect the cached CC0 FBX starter without modifying original files."""
import argparse
import json
from pathlib import Path
import sys

import bpy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    root = args.root.resolve()
    records = []
    for source in sorted(root.rglob("*.fbx")):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=str(source))
        meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
        rigs = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
        records.append({
            "file": str(source.relative_to(root)),
            "meshes": [{"name": obj.name, "vertices": len(obj.data.vertices),
                        "polygons": len(obj.data.polygons), "materials": [mat.name for mat in obj.data.materials if mat],
                        "vertex_groups": len(obj.vertex_groups)} for obj in meshes],
            "rigs": [{"name": obj.name, "bones": len(obj.data.bones),
                      "bone_names": [bone.name for bone in obj.data.bones],
                      "active_action": obj.animation_data.action.name if obj.animation_data and obj.animation_data.action else None}
                     for obj in rigs],
            "actions": [{"name": action.name, "frames": list(action.frame_range), "fcurves": len(action.fcurves)}
                        for action in bpy.data.actions],
            "fps": bpy.context.scene.render.fps,
        })
    destination = root / "derived"
    destination.mkdir(exist_ok=True)
    (destination / "fbx-inspection.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(json.dumps(records, indent=2))


main()
