"""Render local visual review contact sheets; not distributed as game assets."""
import bpy
from mathutils import Vector
from pathlib import Path
import math

ROOT=Path(__file__).resolve().parents[3]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'web/public/center-models/orbix-ranger.glb'))
rig=next(obj for obj in bpy.data.objects if obj.type=='ARMATURE')
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=640
scene.render.resolution_y=760
scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('ReviewWorld')
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.17,.23,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
bpy.ops.object.light_add(type='AREA', location=(3,-4,5))
bpy.context.object.data.energy=600
bpy.context.object.data.size=4
bpy.ops.object.light_add(type='AREA', location=(-3,1,3))
bpy.context.object.data.energy=450
bpy.context.object.data.size=3
bpy.ops.object.camera_add(location=(2.5,-4.6,2.3))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,.95))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.camera=camera
for track in rig.animation_data.nla_tracks:track.mute=True
cache=Path.home()/'.codex/orbix-tooling/assets/quaternius-universal'
for name,frame in [('Idle',12),('Sprint',5),('PunchCross',10),('Death',45),('Kick',9)]:
    action=next(action for action in bpy.data.actions if action.name.removesuffix('_Orbix_Rig')==name)
    rig.animation_data.action=action
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    scene.render.filepath=str(cache/('review-'+name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('REVIEW_RENDER',name)
