"""Inspect downloaded art assets in an isolated factory-startup Blender process."""
import bpy
import json
from pathlib import Path
import sys

args = sys.argv[sys.argv.index('--')+1:]
path = Path(args[0])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(path))
print('ORBIX_ASSET_INSPECT', json.dumps({
    'objects': [{'name': obj.name, 'type': obj.type, 'dimensions': list(obj.dimensions), 'location': list(obj.location), 'rotation': list(obj.rotation_euler)} for obj in bpy.data.objects],
    'meshes': [{'name': mesh.name, 'vertices': len(mesh.vertices), 'triangles': sum(len(p.vertices)-2 for p in mesh.polygons), 'materials': [m.name if m else None for m in mesh.materials], 'bounds': [[min(v.co[i] for v in mesh.vertices),max(v.co[i] for v in mesh.vertices)] for i in range(3)]} for mesh in bpy.data.meshes],
    'rigs': [{'name': arm.name, 'bones': [b.name for b in arm.bones]} for arm in bpy.data.armatures],
    'actions': [{'name': action.name, 'range': list(action.frame_range), 'curves': len(action.fcurves)} for action in bpy.data.actions],
}, indent=2))
