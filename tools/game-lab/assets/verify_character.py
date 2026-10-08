"""Verify final standard GLB assets, skeleton targets, tracks and authored pool budgets."""
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parents[3]
OUTPUT=ROOT/'web/public/center-models'
REQUIRED={'Idle','Walk','Run','Sprint','JumpStart','JumpLoop','JumpLand','PunchJab','PunchCross','Kick','Guard','SwordAttack','PistolIdle','PistolAim','PistolShoot','Hit','Death','Dodge'}

def inspect(path):
    data=path.read_bytes()
    magic,version,length=struct.unpack_from('<4sII',data)
    assert magic==b'glTF' and version==2 and length==len(data)
    json_length,json_kind=struct.unpack_from('<II',data,12)
    assert json_kind==0x4e4f534a
    document=json.loads(data[20:20+json_length])
    binary_length,binary_kind=struct.unpack_from('<II',data,20+json_length)
    assert binary_kind==0x004e4942
    binary=data[28+json_length:28+json_length+binary_length]
    formats={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}
    widths={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
    def values(accessor_index):
        accessor=document['accessors'][accessor_index]
        view=document['bufferViews'][accessor['bufferView']]
        kind,size=formats[accessor['componentType']]
        width=widths[accessor['type']]
        offset=view.get('byteOffset',0)+accessor.get('byteOffset',0)
        stride=view.get('byteStride',size*width)
        return [struct.unpack_from('<'+kind*width,binary,offset+i*stride) for i in range(accessor['count'])]
    animation_names={a['name'] for a in document['animations']}
    assert REQUIRED<=animation_names and len(animation_names)==20
    names={node.get('name') for node in document['nodes']}
    assert {'hand_r','hand_l','Head','pelvis','root'}<=names
    assert len(document['skins'])==1 and len(document['skins'][0]['joints'])==65
    assert len(document['meshes'])==1
    triangles=sum(document['accessors'][p['indices']]['count']//3 for m in document['meshes'] for p in m['primitives'])
    for animation in document['animations']:
        for sampler in animation['samplers']:
            times=[v[0] for v in values(sampler['input'])]
            assert all(math.isfinite(t) for t in times) and times==sorted(times)
            assert all(math.isfinite(v) for row in values(sampler['output']) for v in row)
        for channel in animation['channels']:
            target=channel['target']
            if document['nodes'][target['node']].get('name')=='root' and target['path']=='translation':
                rows=values(animation['samplers'][channel['sampler']]['output'])
                assert max(abs(v) for row in rows for v in row)<1e-5,'Root locomotion must stay server-owned'
    assert all(image.get('uri') is None for image in document.get('images',[])), 'Textures must be embedded'
    assert not document.get('extensionsRequired'), 'No runtime decoder dependency'
    return {'path':path.name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'triangles':triangles,'bones':65,'animations':sorted(animation_names),'primitives':len(document['meshes'][0]['primitives'])}

if __name__=='__main__':
    main=inspect(OUTPUT/'orbix-ranger.glb')
    lod=inspect(OUTPUT/'orbix-ranger-lod.glb')
    assert main['bytes']<2*1024*1024 and lod['triangles']<3200
    manifest=json.loads((OUTPUT/'orbix-ranger.manifest.json').read_text())
    assert main['sha256']==manifest['sha256'] and lod['sha256']==manifest['lod']['sha256']
    manifest['verification']={'main':main,'lod':lod,'finite_tracks':True,'server_owned_root_translation':True,'embedded_textures':True,'runtime_decoders_required':False}
    (OUTPUT/'orbix-ranger.manifest.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps({'main':main,'lod':lod},indent=2))
