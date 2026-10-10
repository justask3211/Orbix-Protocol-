import {MeshBuilder,Mesh,TransformNode,Vector3,Color3,Matrix,Quaternion,type Scene} from './api'
import {material,SunnydropEnvironment} from './environment'
import {staticCollider} from './physics'
import {stateGround} from './terrain'
import {number,type Body} from './types'

type Item = {root:TransformNode; kind:string; collider?:Mesh; label?:string}
export function prop(scene: Scene, kind: string, name: string) {
  const root=new TransformNode(name,scene)
  const color=kind==='coin'?'#f5c25c':kind==='bomb'?'#655269':kind==='heal'?'#83d6a5':kind==='gun'?'#719896':kind==='push'?'#b4a0e3':'#99c2cf'
  const paint=material(scene,`${name}-paint`,color,kind==='coin'?.65:.08,kind==='coin'?.28:.7)
  const piece=(mesh:Mesh)=>{mesh.parent=root;mesh.material=paint;mesh.isPickable=false;return mesh}
  if(kind==='coin'){
    const coin=piece(MeshBuilder.CreateCylinder(`${name}-coin`,{diameter:.48,height:.09,tessellation:16},scene));coin.rotation.x=Math.PI/2
    const stamp=piece(MeshBuilder.CreateTorus(`${name}-stamp`,{diameter:.33,thickness:.035,tessellation:16},scene));stamp.rotation.x=Math.PI/2;stamp.position.z=.052
  }else if(kind==='bomb'){
    piece(MeshBuilder.CreateSphere(`${name}-bomb`,{diameter:.5,segments:8},scene))
    const fuse=piece(MeshBuilder.CreateCylinder(`${name}-fuse`,{diameter:.04,height:.22,tessellation:5},scene));fuse.position.y=.3;fuse.material=material(scene,`${name}-fuse-color`,'#efa17f')
  }else if(kind==='gun'){
    const barrel=piece(MeshBuilder.CreateBox(`${name}-barrel`,{width:.15,height:.14,depth:.45},scene));barrel.position.z=.1
    const grip=piece(MeshBuilder.CreateBox(`${name}-grip`,{width:.13,height:.25,depth:.13},scene));grip.position.y=-.12
  }else if(kind==='sword'||kind==='spear'){
    const blade=piece(MeshBuilder.CreateBox(`${name}-blade`,{width:kind==='sword'?.12:.06,height:.025,depth:.8},scene));blade.position.z=.3
    piece(MeshBuilder.CreateBox(`${name}-guard`,{width:.3,height:.04,depth:.06},scene))
  }else{
    const gem=piece(MeshBuilder.CreatePolyhedron(`${name}-power`,{type:1,size:.23},scene));gem.rotation.z=Math.PI/4
    paint.emissiveColor=Color3.FromHexString(color).scale(.16)
    if(kind==='heal'){const cross=piece(MeshBuilder.CreateBox(`${name}-cross`,{width:.27,height:.07,depth:.06},scene));cross.position.z=.24;cross.material=material(scene,`${name}-cross-white`,'#fff3d2')}
  }
  return root
}

type PickupPool = {root:TransformNode;parts:{mesh:Mesh;local:Matrix;matrices:Float32Array}[]}
export class WorldObjects {
  readonly items = new Map<string, Item>()
  readonly pools = new Map<string, PickupPool>()
  private events=new Set<string>()
  private bursts:{mesh:Mesh;velocity:Vector3;life:number}[]=[]
  private sparkPaint=new Map<string,ReturnType<typeof material>>()
  private round: unknown
  private matrix=Matrix.Identity()
  private rotation=Quaternion.Identity()
  private position=Vector3.Zero()
  private scale=Vector3.One()
  constructor(private scene: Scene,private environment: SunnydropEnvironment) {}
  private pool(kind:string) {
    let pool=this.pools.get(kind)
    if(!pool){
      const root=prop(this.scene,kind,`instanced-${kind}`)
      const parts=(root.getChildMeshes() as Mesh[]).map(mesh=>{
        mesh.computeWorldMatrix(true);const local=mesh.getWorldMatrix().clone()
        mesh.parent=null;mesh.position.setAll(0);mesh.rotation.setAll(0);mesh.scaling.setAll(1)
        const matrices=new Float32Array(450*16);mesh.thinInstanceSetBuffer('matrix',matrices,16,false);mesh.thinInstanceCount=0;mesh.alwaysSelectAsActiveMesh=true
        return {mesh:mesh as Mesh,local,matrices}
      })
      pool={root,parts};this.pools.set(kind,pool)
    }
    return pool
  }
  update(state: Body,now: number,dt: number,reduced: boolean) {
    if(this.round!==state.roundId){this.clear();this.events.clear();this.round=state.roundId}
    const active=new Set<string>(),elapsed=number(state.nowMs),counts=new Map<string,number>()
    // Loot and bullets share geometry/materials, including the maximum 450 piles.
    for(const [category,list]of [['drop',state.drops??[]],['projectile',state.projectiles??[]]]as const)for(const item of list){
      if(item.collected||number(item.spawnAt)>elapsed||item.expiresAt!=null&&item.expiresAt<=elapsed)continue
      const kind=category==='projectile'?'projectile':String(item.kind),pool=this.pool(kind),index=counts.get(kind)??0
      if(index>=450)continue
      const progress=Math.max(0,Math.min(1,(elapsed-number(item.spawnAt))/Math.max(1,number(item.landAt)-number(item.spawnAt))))
      const height=number(item.y,stateGround(state,number(item.x),number(item.z)))
      this.position.set(number(item.x),height+(category==='drop'?.45+(1-progress)*7+(reduced?0:Math.sin(now*.004+index)*.055):0),number(item.z))
      this.scale.setAll(category==='projectile'?.18:1);Quaternion.RotationAxisToRef(Vector3.Up(),reduced?0:now*.0015,this.rotation)
      Matrix.ComposeToRef(this.scale,this.rotation,this.position,this.matrix)
      for(const part of pool.parts)part.local.multiply(this.matrix).copyToArray(part.matrices,index*16)
      counts.set(kind,index+1)
    }
    for(const[kind,pool]of this.pools)for(const part of pool.parts){const count=counts.get(kind)??0;part.mesh.thinInstanceCount=count;part.mesh.setEnabled(count>0);if(count)part.mesh.thinInstanceBufferUpdated('matrix')}
    for(const [category,list]of [['crate',state.crates??[]],['airdrop',state.airdrops??[]]] as const)for(const item of list){
      if(item.hp<=0||number(item.spawnAt)>elapsed)continue
      const key=`${category}:${item.id}`;active.add(key);let object=this.items.get(key)
      if(!object){
        const root=new TransformNode(key,this.scene),box=MeshBuilder.CreateBox(`${key}-box`,{size:category==='airdrop'?1.1:1.25},this.scene)
        box.parent=root;box.position.y=.55;box.material=material(this.scene,`${key}-wood`,category==='airdrop'?'#65a79f':'#b7976f');box.receiveShadows=true
        this.environment.shadow?.addShadowCaster(box)
        if(category==='crate'){box.position.addInPlace(new Vector3(number(item.x),number(item.y),number(item.z)));box.parent=null;this.environment.collisions.add(box);staticCollider(box,this.scene)}
        for(const side of [-1,1]){const stripe=MeshBuilder.CreateBox(`${key}-strap`,{width:.12,height:1.13,depth:1.13},this.scene);stripe.parent=category==='crate'?box:root;stripe.position.set(side*.32,category==='crate'?0:.55,0);stripe.material=material(this.scene,`${key}-strap-color`,'#edd295');stripe.isPickable=false}
        if(category==='airdrop'){
          const canopy=new TransformNode(`${key}-parachute`,this.scene);canopy.parent=root
          const cloth=MeshBuilder.CreateSphere(`${key}-canopy`,{diameter:3,segments:8},this.scene);cloth.parent=canopy;cloth.position.y=3;cloth.scaling.y=.35;cloth.material=material(this.scene,`${key}-canvas`,'#ffe3ac');cloth.isPickable=false
          for(const x of [-.6,.6])for(const z of [-.6,.6]){const rope=MeshBuilder.CreateCylinder(`${key}-rope`,{diameter:.02,height:2.3,tessellation:4},this.scene);rope.parent=canopy;rope.position.set(x,1.8,z);rope.material=material(this.scene,`${key}-rope-color`,'#f4e9d3');rope.isPickable=false}
          const lid=MeshBuilder.CreateBox(`${key}-lid`,{width:1.18,height:.13,depth:1.18},this.scene);lid.parent=root;lid.position.y=1.15;lid.material=material(this.scene,`${key}-lid-paint`,'#e9c779');lid.isPickable=false
        }
        object={root,kind:category,collider:category==='crate'?box:undefined};this.items.set(key,object)
      }
      const height=number(item.y,stateGround(state,number(item.x),number(item.z))),progress=Math.max(0,Math.min(1,(elapsed-number(item.spawnAt))/Math.max(1,number(item.landAt)-number(item.spawnAt))))
      object.root.position.set(number(item.x),height+(category==='airdrop'?(1-progress)*12:0),number(item.z))
      const canopy=object.root.getChildren().find(node=>node.name===`${key}-parachute`);canopy?.setEnabled(progress<1)
      const lid=object.root.getChildren().find(node=>node.name===`${key}-lid`)as Mesh|undefined;if(lid)lid.rotation.z=item.opened?-.3:0
    }
    for(const [key,item]of this.items)if(!active.has(key)){this.remove(item);this.items.delete(key)}
    for(const event of state.events??[]){
      const key=String(event.id??`${event.kind}:${event.at}:${event.who}:${event.x}:${event.z}`)
      if(this.events.has(key))continue
      this.events.add(key)
      if(!reduced&&Math.abs(elapsed-number(event.at,elapsed))<700&&(String(event.kind).startsWith('pickup-')||['airdrop-open','punch','knockout','jump','dodge'].includes(event.kind)))this.burst(number(event.x),stateGround(state,number(event.x),number(event.z))+.4,number(event.z),String(event.kind).startsWith('pickup')?'#ffdc86':'#bcebd5')
    }
    if(this.events.size>256)this.events=new Set([...this.events].slice(-128))
    for(let i=this.bursts.length-1;i>=0;i--){const burst=this.bursts[i];burst.life-=dt;if(burst.life<=0){burst.mesh.dispose();this.bursts.splice(i,1);continue}burst.velocity.y-=dt*4;burst.mesh.position.addInPlace(burst.velocity.scale(dt));burst.mesh.scaling.setAll(Math.min(1,burst.life*3))}
  }
  private burst(x: number,y: number,z: number,color: string) {
    if(this.bursts.length>72)return
    let paint=this.sparkPaint.get(color);if(!paint){paint=material(this.scene,'confirmed-event-spark',color,.1,.5);this.sparkPaint.set(color,paint)}
    for(let i=0;i<7;i++){const mesh=MeshBuilder.CreateSphere('pickup-spark',{diameter:.09,segments:3},this.scene);mesh.position.set(x,y,z);mesh.material=paint;mesh.isPickable=false;this.bursts.push({mesh,velocity:new Vector3(Math.sin(i)*1.3,1.3+(i%3)*.4,Math.cos(i)*1.3),life:.65+i*.025})}
  }
  private remove(item:Item){if(item.collider){this.environment.collisions.delete(item.collider);item.collider.dispose(false,true)}item.root.dispose(false,true)}
  private clear(){for(const item of this.items.values())this.remove(item);this.items.clear();for(const burst of this.bursts)burst.mesh.dispose();this.bursts=[];for(const pool of this.pools.values())for(const part of pool.parts){part.mesh.thinInstanceCount=0;part.mesh.setEnabled(false)}}
  dispose(){this.clear();for(const pool of this.pools.values()){for(const part of pool.parts)part.mesh.dispose(false,true);pool.root.dispose()}this.pools.clear();for(const paint of this.sparkPaint.values())paint.dispose();this.sparkPaint.clear()}
}
