"""Create a separate, self-contained starter GLB from the cached CC0 source."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    root = args.root.resolve()
    destination = root / "derived"
    destination.mkdir(exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(root / "Model/characterMedium.fbx"))
    rig = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    mesh = next(obj for obj in bpy.data.objects if obj.type == "MESH")
    rig.name = "OrbixStarterRig"
    mesh.name = "OrbixStarterSkater"
    material = bpy.data.materials.new("SkaterFemale_CC0")
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["Roughness"].default_value = 0.8
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(root / "Skins/skaterFemaleA.png"))
    texture.interpolation = "Closest"
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    mesh.data.materials.clear()
    mesh.data.materials.append(material)
    for obj in bpy.context.scene.objects:
        obj.select_set(True)
    # Animation FBX rest transforms differ from this base mesh. Export only the
    # rigged avatar; clip retargeting requires a separate reviewed workflow.
    output = destination / "skater-female-rigged.glb"
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_selection=True,
                             export_animations=False)
    data = output.read_bytes()
    magic, version, total = struct.unpack_from("<4sII", data)
    assert magic == b"glTF" and version == 2 and total == len(data)
    json_size, chunk_type = struct.unpack_from("<II", data, 12)
    assert chunk_type == 0x4E4F534A
    document = json.loads(data[20:20 + json_size])
    exported_clips = [anim.get("name") for anim in document.get("animations", [])]
    assert not exported_clips, exported_clips
    assert document.get("skins") and document.get("images"), "Missing skeleton or embedded texture"
    assert all("uri" not in image for image in document["images"]), "External image reference"
    report = {"file": "derived/skater-female-rigged.glb", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
              "blender": bpy.app.version_string, "exported_clips": exported_clips,
              "skin_joints": [len(skin["joints"]) for skin in document["skins"]],
              "embedded_textures": len(document["images"]), "mesh_count": len(document.get("meshes", [])),
              "validation_limit": "Structural export only; in-browser appearance needs visual review. Source clips require retargeting."}
    (destination / "glb-inspection.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


main()
