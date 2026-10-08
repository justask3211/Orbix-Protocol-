"""Bake verified rest-space CC0 animation retargeting onto Orbix's skinned character.

Run only with factory-startup Blender. Original source files remain unchanged.
Exports standard glTF animation tracks; server owns all actual locomotion.
"""
import bpy
from mathutils import Matrix, Vector, Quaternion
import math
import hashlib
import json
from pathlib import Path

CACHE = Path.home() / '.codex/orbix-tooling/assets/quaternius-universal'
ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'web/public/center-models'
SELECTED = ['Idle_Loop','Walk_Loop','Jog_Fwd_Loop','Sprint_Loop','Jump_Start','Jump_Loop','Jump_Land','Punch_Jab','Punch_Cross','Punch_Enter','Sword_Attack','Sword_Idle','Pistol_Idle_Loop','Pistol_Aim_Neutral','Pistol_Shoot','Hit_Chest','Death01','Roll','Interact']
NAMES={'Idle_Loop':'Idle','Walk_Loop':'Walk','Jog_Fwd_Loop':'Run','Sprint_Loop':'Sprint','Jump_Start':'JumpStart','Jump_Loop':'JumpLoop','Jump_Land':'JumpLand','Punch_Jab':'PunchJab','Punch_Cross':'PunchCross','Punch_Enter':'Guard','Sword_Attack':'SwordAttack','Sword_Idle':'SwordIdle','Pistol_Idle_Loop':'PistolIdle','Pistol_Aim_Neutral':'PistolAim','Pistol_Shoot':'PistolShoot','Hit_Chest':'Hit','Death01':'Death','Roll':'Dodge','Interact':'Interact'}

def bone_map(name):
    exact = {'root':'root','pelvis':'DEF-hips','spine_01':'DEF-spine.001','spine_02':'DEF-spine.002','spine_03':'DEF-spine.003','neck_01':'DEF-neck','Head':'DEF-head'}
    if name in exact:
        return exact[name]
    part, _, side = name.rpartition('_')
    suffix = '.'+side.upper()
    parts={'clavicle':'DEF-shoulder','upperarm':'DEF-upper_arm','lowerarm':'DEF-forearm','hand':'DEF-hand','thigh':'DEF-thigh','calf':'DEF-shin','foot':'DEF-foot','ball':'DEF-toe'}
    if part in parts:
        return parts[part]+suffix
    finger, _, segment = part.partition('_')
    if finger in {'index','middle','pinky','ring','thumb'} and segment in {'01','02','03'}:
        return ('DEF-thumb' if finger=='thumb' else 'DEF-f_'+finger)+'.'+segment+suffix
    return None

def material(name, color, roughness=.65, metal=.0):
    result=bpy.data.materials.new(name)
    result.use_nodes=True
    node=result.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value=(*color,1)
    node.inputs['Roughness'].default_value=roughness
    node.inputs['Metallic'].default_value=metal
    return result

def resize_images():
    for image in bpy.data.images:
        if image.type!='IMAGE' or image.size[0]==0:
            continue
        width,height=image.size
        limit=512 if 'Superhero' in image.name else 256
        if max(width,height)>limit:
            factor=limit/max(width,height)
            image.scale(round(width*factor),round(height*factor))
        image.pack()

def prepare_look(rig):
    body=next(obj for obj in bpy.data.objects if obj.type=='MESH' and obj.name.startswith('SuperHero'))
    skin=body.data.materials[0]
    # Keep authored face albedo; drop large normal/roughness textures from suit skin.
    skin_bsdf=skin.node_tree.nodes.get('Principled BSDF')
    for socket in ('Normal','Roughness'):
        for link in list(skin_bsdf.inputs[socket].links):skin.node_tree.links.remove(link)
    skin_bsdf.inputs['Roughness'].default_value=.68
    suit=material('Orbix_Suit',(0.027,0.048,0.09),.76,.07)
    armor=material('Orbix_Armor',(0.115,0.22,0.3),.45,.35)
    trim=material('Orbix_Accent',(0.03,0.63,0.62),.37,.20)
    boot=material('Orbix_Boots',(0.018,0.028,0.035),.78,.05)
    body.data.materials.clear()
    for mat in (skin,suit,armor,trim,boot):body.data.materials.append(mat)
    groups={group.index:group.name for group in body.vertex_groups}
    for polygon in body.data.polygons:
        points=[body.data.vertices[index] for index in polygon.vertices]
        center=sum((p.co for p in points),Vector())/len(points)
        face=sum(g.weight for p in points for g in p.groups if groups[g.group] in {'Head','neck_01'})/len(points)
        if center.z>1.555:polygon.material_index=0
        elif center.z<.22:polygon.material_index=4
        else:polygon.material_index=1
    # The author's Origin-at-0 hair still occupies character-head world coordinates.
    previous=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CACHE/'base/Hairstyles/Origin at 0/glTF (Godot)/Hair_Buzzed.gltf'))
    hair=[obj for obj in bpy.data.objects if obj not in previous and obj.type=='MESH']
    for obj in hair:
        obj.data.materials.clear()
        obj.data.materials.append(material('Orbix_Hair',(.035,.025,.018),.8))
        group=obj.vertex_groups.new(name='Head')
        group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        obj.modifiers.new('OrbixHeadRig','ARMATURE').object=rig
        obj.parent=rig
    eyebrows=next(obj for obj in bpy.data.objects if obj.name.startswith('Eyebrows'))
    eyebrows.data.materials.clear()
    eyebrows.data.materials.append(bpy.data.materials['Orbix_Hair'])
    def pad(name, center, size, bone, mat):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        obj=bpy.context.object
        obj.name=name
        obj.scale=size
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        bevel=obj.modifiers.new('ArmorContour','BEVEL')
        bevel.width=.045 if name.startswith('Orbix_Boot_') else .028
        bevel.segments=3 if name.startswith('Orbix_Boot_') else 2
        bpy.ops.object.modifier_apply(modifier=bevel.name)
        # Bake placement into mesh so armature weights share the target bind space.
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        obj.data.materials.append(mat)
        group=obj.vertex_groups.new(name=bone)
        group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        obj.modifiers.new('OrbixArmorRig','ARMATURE').object=rig
        obj.parent=rig
    pad('Orbix_ChestPlate',(0,-.138,1.405),(.34,.065,.20),'spine_03',armor)
    pad('Orbix_BackPlate',(0,.125,1.36),(.31,.065,.23),'spine_03',armor)
    pad('Orbix_ChestBadge',(0,-.18,1.40),(.075,.017,.075),'spine_03',trim)
    pad('Orbix_Belt',(0,-.035,.9),(.39,.23,.08),'pelvis',boot)
    pad('Orbix_Buckle',(0,-.17,.9),(.09,.045,.07),'pelvis',trim)
    pad('Orbix_Boot_L',(.105,-.057,.055),(.125,.235,.115),'foot_l',boot)
    pad('Orbix_Boot_R',(-.105,-.057,.055),(.125,.235,.115),'foot_r',boot)
    return body

def retarget(source,target,actions):
    scene=bpy.context.scene
    scene.render.fps=24
    mappings={bone.name:bone_map(bone.name) for bone in target.data.bones if bone_map(bone.name)}
    assert all(name in source.data.bones for name in mappings.values())
    ratio=target.data.bones['pelvis'].head_local.z/source.data.bones['DEF-hips'].head_local.z
    clip_reports=[]
    target.animation_data_create()
    for clip_name in SELECTED:
        source.animation_data.action=actions[clip_name]
        result=bpy.data.actions.new(NAMES[clip_name])
        target.animation_data.action=result
        frames=round(actions[clip_name].frame_range[1])
        maximum_rest_error=0.0
        for frame in range(frames+1):
            scene.frame_set(frame)
            for bone in target.pose.bones:
                original=target.data.bones[bone.name]
                source_name=mappings.get(bone.name)
                if source_name:
                    source_pose=source.pose.bones[source_name]
                    source_rest=source.data.bones[source_name].matrix_local
                    rotation=(source_pose.matrix.to_quaternion() @ source_rest.to_quaternion().inverted() @ original.matrix_local.to_quaternion()).to_matrix().to_4x4()
                    if bone.parent:
                        parent_delta=bone.parent.matrix @ target.data.bones[bone.parent.name].matrix_local.inverted()
                        rotation.translation=parent_delta @ original.head_local
                    else:
                        rotation.translation=original.head_local
                    if bone.name=='pelvis':
                        shift=(source_pose.matrix.translation-source_rest.translation)*ratio
                        # Keep clip locomotion in-place: network controller owns X/Z.
                        rotation.translation.z+=shift.z
                    bone.matrix=rotation
                else:
                    bone.matrix_basis=Matrix.Identity(4)
                bone.rotation_mode='QUATERNION'
                bone.keyframe_insert('location',frame=frame,group=bone.name)
                bone.keyframe_insert('rotation_quaternion',frame=frame,group=bone.name)
                bone.keyframe_insert('scale',frame=frame,group=bone.name)
            bpy.context.view_layer.update()
        clip_reports.append({'name':NAMES[clip_name],'source':clip_name,'duration':frames/24,'frames':frames+1})
        result.use_fake_user=True
        target.animation_data.action=None
        track=target.animation_data.nla_tracks.new()
        track.name=NAMES[clip_name]
        track.strips.new(NAMES[clip_name],0,result)
        track.mute=True
    target.animation_data.action=None
    source.animation_data.action=None
    return clip_reports, mappings

def author_kick(target):
    """Original guarded front kick, six poses, never relabels source punch clips."""
    target.animation_data.action=bpy.data.actions['Guard']
    bpy.context.scene.frame_set(20)
    bpy.context.view_layer.update()
    baseline={bone.name:bone.matrix_basis.copy() for bone in target.pose.bones}
    action=bpy.data.actions.new('Kick')
    target.animation_data.action=action
    for frame,thigh,knee in [(0,0,0),(3,35,65),(6,85,70),(9,85,5),(12,45,65),(17,0,0)]:
        for bone in target.pose.bones:bone.matrix_basis=baseline[bone.name]
        for name,angle in [('thigh_r',-thigh),('calf_r',knee),('upperarm_l',-thigh*.10),('upperarm_r',thigh*.08)]:
            bone=target.pose.bones[name]
            bone.rotation_mode='QUATERNION'
            bone.rotation_quaternion=bone.rotation_quaternion @ Quaternion((1,0,0),math.radians(angle))
        for bone in target.pose.bones:
            bone.keyframe_insert('location',frame=frame,group=bone.name)
            bone.keyframe_insert('rotation_quaternion',frame=frame,group=bone.name)
            bone.keyframe_insert('scale',frame=frame,group=bone.name)
    action.use_fake_user=True
    for curve in action.fcurves:
        for keyframe in curve.keyframe_points:keyframe.interpolation='LINEAR'
    target.animation_data.action=None
    track=target.animation_data.nla_tracks.new()
    track.name='Kick'
    track.strips.new('Kick',0,action)
    track.mute=True
    return {'name':'Kick','source':'Orbix original guarded front-kick poses','duration':17/24,'frames':18}

if __name__=='__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(CACHE/'glTF/AnimationLibrary_Godot_Standard.gltf'))
    source=next(obj for obj in bpy.data.objects if obj.type=='ARMATURE')
    source_objects=set(bpy.data.objects)
    actions={action.name.removesuffix('_Rig'):action for action in bpy.data.actions}
    bpy.ops.import_scene.gltf(filepath=str(CACHE/'base/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf'))
    target=next(obj for obj in bpy.data.objects if obj.type=='ARMATURE' and obj!=source)
    target.name='Orbix_Rig'
    reports,mappings=retarget(source,target,actions)
    reports.append(author_kick(target))
    for obj in source_objects:bpy.data.objects.remove(obj,do_unlink=True)
    for action in list(bpy.data.actions):
        if action not in {strip.action for track in target.animation_data.nla_tracks for strip in track.strips}:
            bpy.data.actions.remove(action)
    body=prepare_look(target)
    # One skinned mesh, seven shared materials; no separate draw per armor plate.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.data.objects:
        if obj.type=='MESH':obj.select_set(True)
    bpy.context.view_layer.objects.active=body
    bpy.ops.object.join()
    target.location.z=-min(vertex.co.z for vertex in body.data.vertices)
    resize_images()
    # Reset authored pose before exporting the rest/bind matrices.
    for bone in target.pose.bones:bone.matrix_basis=Matrix.Identity(4)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    OUTPUT.mkdir(parents=True,exist_ok=True)
    path=OUTPUT/'orbix-ranger.glb'
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_animations=True,export_nla_strips=True,export_all_influences=False,export_force_sampling=True,export_frame_range=False,export_optimize_animation_size=True,export_skins=True,export_yup=True)
    stats={'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'animations':reports,'bone_map':mappings,'bones':[bone.name for bone in target.data.bones],'triangles':sum(sum(len(p.vertices)-2 for p in obj.data.polygons) for obj in bpy.data.objects if obj.type=='MESH'),'character_height':body.dimensions.z,'coordinate_system':{'up':'+Y','forward':'+Z','feet_Y':0,'units':'meters','rightHand':'hand_r'},'license':'CC0-1.0','source_base':json.loads((CACHE/'base-source-inventory.json').read_text()),'source_animations':json.loads((CACHE/'source-inventory.json').read_text())}
    (OUTPUT/'orbix-ranger.manifest.json').write_text(json.dumps(stats,indent=2))
    (OUTPUT/'LICENSE-Quaternius-CC0.txt').write_text((CACHE/'LICENSE').read_text())
    (OUTPUT/'NOTICE.md').write_text('# Orbix Ranger character\n\nDerived from Quaternius Universal Base Characters Standard and Universal Animation Library Standard (CC0 1.0). Original sources: https://quaternius.com/packs/universalbasecharacters.html and https://quaternius.com/packs/universalanimationlibrary.html . Animation mirror: https://github.com/J-Ponzo/gltf-universal-animation-library .\n\nOrbix changes: deliberate rest-space animation retargeting, in-place root locomotion, tactical suit material regions, selected hair and embedded downscaled textures. Exact source hashes and bone mapping are in orbix-ranger.manifest.json. These assets contain no Epic Games/Fortnite/PUBG assets.\n')
    print('ORBIX_CHARACTER_EXPORT',json.dumps({'bytes':stats['bytes'],'triangles':stats['triangles'],'clips':len(reports),'height':stats['character_height']}))
