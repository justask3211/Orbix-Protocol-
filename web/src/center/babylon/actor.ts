import {TransformNode,MeshBuilder,Mesh,Color3,PBRMaterial,StandardMaterial,type Scene,type InstantiatedEntries} from './api'
import {ActorAnimation} from './animation'
import {CapsuleMotor} from './physics'
import {HealthTrack,healthRatio} from '../framework/health'
import {material,SunnydropEnvironment} from './environment'
import {prop} from './objects'
import {number,type Body} from './types'
import type {MotionPose} from './motion'

export class BabylonActor {
  readonly root: TransformNode
  readonly elastic: TransformNode
  readonly animation: ActorAnimation
  readonly motor: CapsuleMotor | null
  readonly health=new HealthTrack()
  private weapon: TransformNode | null = null
  private weaponKind=''
  private squash=0
  private mark: import('./api').Mesh
  private bar: Mesh
  private barFill: Mesh
  private shield: Mesh
  constructor(private scene: Scene,readonly entries: InstantiatedEntries,readonly key: string,readonly local: boolean,environment: SunnydropEnvironment,body: Body) {
    this.root=new TransformNode(`actor-${key}`,scene);this.elastic=new TransformNode(`actor-elastic-${key}`,scene);this.elastic.parent=this.root
    this.animation=new ActorAnimation(entries,this.elastic,scene)
    this.motor=local?new CapsuleMotor(scene):null
    for(const root of entries.rootNodes)for(const mesh of root.getChildMeshes()){
      mesh.isPickable=false;environment.shadow?.addShadowCaster(mesh)
      if(mesh.material instanceof PBRMaterial){mesh.material.roughness=.85;mesh.material.metallic=.015;mesh.material.environmentIntensity=.6}
    }
    this.mark=MeshBuilder.CreateTorus(`player-marker-${key}`,{diameter:local?1.2:.95,thickness:.022,tessellation:24},scene)
    this.mark.material=material(scene,`player-marker-paint-${key}`,local?'#ffe4a1':'#a9dbd7');this.mark.isPickable=false
    const barPaint=(name:string,color:string)=>{const paint=new StandardMaterial(name,scene);paint.disableLighting=true;paint.emissiveColor=Color3.FromHexString(color);paint.backFaceCulling=false;return paint}
    this.bar=MeshBuilder.CreatePlane(`health-${key}`,{width:.9,height:.08},scene);this.bar.billboardMode=Mesh.BILLBOARDMODE_ALL;this.bar.material=barPaint(`health-bg-${key}`,'#344e55');this.bar.isPickable=false
    this.barFill=MeshBuilder.CreatePlane(`health-fill-${key}`,{width:.86,height:.05},scene);this.barFill.parent=this.bar;this.barFill.material=barPaint(`health-fill-paint-${key}`,'#b8ee91');this.barFill.material.zOffset=-2;this.barFill.isPickable=false
    this.shield=MeshBuilder.CreateSphere(`confirmed-shield-${key}`,{diameter:1.7,segments:12},scene);this.shield.scaling.y=1.2;this.shield.isPickable=false
    const shieldPaint=material(scene,`shield-${key}`,'#81dceb',.1,.4);shieldPaint.alpha=.16;shieldPaint.backFaceCulling=false;this.shield.material=shieldPaint;this.shield.setEnabled(false)
    this.cosmetics(body)
  }
  private cosmetics(body: Body) {
    const targets=this.entries.rootNodes.flatMap(root=>[root,...root.getDescendants()])
    const head=targets.find(node=>node.name==='Head') as TransformNode|undefined
    const chest=targets.find(node=>node.name==='spine_01') as TransformNode|undefined
    const cosmetics=body.cosmetics??{}
    if(head&&cosmetics.hat&&cosmetics.hat!=='none'){
      const hat=cosmetics.hat==='crown'?MeshBuilder.CreateCylinder('original-crown',{diameter:.65,height:.2,tessellation:6},this.scene):MeshBuilder.CreateSphere('original-cap',{diameter:.6,segments:8},this.scene)
      hat.parent=head;hat.position.y=.38;hat.scaling.y=cosmetics.hat==='crown'?1:.4;hat.material=material(this.scene,'hat-color',cosmetics.hat==='crown'?'#e6bf65':'#e7a39c');hat.isPickable=false
    }
    if(chest&&cosmetics.accessory==='backpack'){const pack=MeshBuilder.CreateBox('original-pack',{width:.45,height:.5,depth:.2},this.scene);pack.parent=chest;pack.position.set(0,.1,-.38);pack.material=material(this.scene,'pack-color','#d5af72');pack.isPickable=false}
    if(chest&&cosmetics.accessory==='scarf'){const scarf=MeshBuilder.CreateTorus('original-scarf',{diameter:.45,thickness:.08,tessellation:12},this.scene);scarf.parent=chest;scarf.position.y=.33;scarf.material=material(this.scene,'scarf-color','#e89378');scarf.isPickable=false}
    if(head&&cosmetics.glasses&&cosmetics.glasses!=='none')for(const side of [-1,1]){const glasses=MeshBuilder.CreateTorus('original-round-glasses',{diameter:.2,thickness:.025,tessellation:12},this.scene);glasses.parent=head;glasses.position.set(side*.15,.05,.37);glasses.rotation.x=Math.PI/2;glasses.material=material(this.scene,'glasses-color','#455e60');glasses.isPickable=false}
    const tint=({coral:'#f99a92',mint:'#8adbc4',lilac:'#bdacf0',dress:'#e99cc6'} as Record<string,string>)[cosmetics.outfit]
    if(tint){const materials=this.entries.rootNodes.flatMap(root=>root.getChildMeshes()).flatMap(mesh=>mesh.material&&'subMaterials'in mesh.material?(mesh.material as import('@babylonjs/core/Materials/multiMaterial').MultiMaterial).subMaterials:[mesh.material]);const cloth=materials.find(m=>m instanceof PBRMaterial) as PBRMaterial|undefined;if(cloth)cloth.albedoColor=Color3.FromHexString(tint)}
  }
  update(body: Body,state: Body,pose: MotionPose,now: number,dt: number,reduced: boolean,first: boolean,sprint: boolean) {
    this.root.position.set(pose.x,pose.y,pose.z);this.root.rotation.y=pose.yaw;this.root.setEnabled(!(this.local&&first))
    this.motor?.follow(pose,dt)
    const result=this.animation.update(body,state,now,number(pose.speed),sprint,dt,reduced)
    if(result.landed)this.squash=.1
    this.squash*=Math.exp(-dt*18)
    const stretch=reduced?0:!result.grounded?.035:-this.squash
    this.elastic.scaling.set(1.15*(1-stretch*.5),.96*(1+stretch),1.12*(1-stretch*.5))
    this.elastic.rotation.x+=( (reduced?0:-Math.min(.06,number(pose.speed)*.007))-this.elastic.rotation.x)*(1-Math.exp(-dt*16))
    this.health.observe(number(body.hp,100),state.roundId,performance.now(),body.respawnAt)
    const ratio=healthRatio(number(body.hp,100),number(body.maxHp,100))
    this.bar.position.set(pose.x,pose.y+2.1,pose.z);this.bar.setEnabled(!result.down&&!(this.local&&first));this.barFill.scaling.x=Math.max(.001,ratio);this.barFill.position.x=-(1-ratio)*.43
    const hpPaint=this.barFill.material as StandardMaterial;hpPaint.emissiveColor=Color3.Lerp(Color3.FromHexString(ratio<.3?'#ff917d':'#b8ee91'),Color3.FromHexString('#ff806b'),reduced?0:this.health.intensity(performance.now()))
    this.shield.position.set(pose.x,pose.y+.85,pose.z);this.shield.setEnabled(number(body.shieldUntil)>now&&!result.down&&!(this.local&&first))
    this.mark.position.set(pose.x,Math.min(pose.y,number(body.groundHeight,pose.y))+.025,pose.z);this.mark.setEnabled(!result.down&&!(this.local&&first))
    const weapon=String(body.weapon??'hands')
    if(weapon!==this.weaponKind){
      this.weapon?.dispose(false,true);this.weapon=null;this.weaponKind=weapon
      const hand=this.entries.rootNodes.flatMap(root=>root.getDescendants()).find(node=>node.name==='hand_r') as TransformNode|undefined
      if(hand&&weapon!=='hands'){this.weapon=prop(this.scene,weapon,`held-${this.key}-${weapon}`);this.weapon.parent=hand;this.weapon.position.set(0,0,.12);this.weapon.scaling.setAll(.85)}
    }
  }
  dispose(){
    // Cloned materials own their colors, but texture images belong to the cached
    // AssetContainer. Removing one player must not destroy another player's skin.
    const owned=new Set(this.entries.rootNodes.flatMap(root=>root.getChildMeshes()).flatMap(mesh=>mesh.material&&'subMaterials'in mesh.material?(mesh.material as import('@babylonjs/core/Materials/multiMaterial').MultiMaterial).subMaterials:[mesh.material]))
    this.motor?.dispose();this.animation.dispose();this.entries.dispose();for(const paint of owned)paint?.dispose(false,false)
    this.mark.dispose(false,true);this.bar.dispose(false,true);this.shield.dispose(false,true);this.root.dispose(false,true)
  }
}
