import {TransformNode,MeshBuilder,Color3,StandardMaterial,type Scene,type UniversalCamera,type Mesh} from './api'
import {prop} from './objects'
import {number,type Body} from './types'

/** Original gloves/equipment, driven only by published inventory/attack clocks. */
export class FirstPersonFeedback {
  readonly root: TransformNode
  private hands: Mesh[]=[]
  private weapon?:TransformNode
  private weaponKind=''
  private flash:Mesh
  private shield:Mesh
  constructor(private scene:Scene,camera:UniversalCamera) {
    this.root=new TransformNode('first-person-feedback',scene);this.root.parent=camera;this.root.setEnabled(false)
    const glove=new StandardMaterial('first-person-glove',scene);glove.diffuseColor=Color3.FromHexString('#fff1d2');glove.emissiveColor=glove.diffuseColor.scale(.3)
    for(const side of [-1,1]){
      const hand=MeshBuilder.CreateBox(`glove-${side}`,{width:.13,height:.11,depth:.18},scene);hand.parent=this.root;hand.material=glove;hand.isPickable=false;hand.renderingGroupId=2;this.hands.push(hand)
      const cuff=MeshBuilder.CreateBox(`cuff-${side}`,{width:.12,height:.13,depth:.24},scene);cuff.parent=hand;cuff.position.z=.16;cuff.material=glove;cuff.isPickable=false;cuff.renderingGroupId=2
    }
    this.flash=MeshBuilder.CreateSphere('confirmed-muzzle-flash',{diameter:.1,segments:4},scene);this.flash.parent=this.root;this.flash.position.set(.25,-.23,-1);this.flash.scaling.z=2;this.flash.isPickable=false;this.flash.renderingGroupId=2
    const flash=new StandardMaterial('muzzle-color',scene);flash.emissiveColor=Color3.FromHexString('#ffe49c');flash.disableLighting=true;this.flash.material=flash
    this.shield=MeshBuilder.CreateSphere('first-person-shield',{diameter:.48,segments:8},scene);this.shield.parent=this.root;this.shield.position.set(-.27,-.2,-.6);this.shield.scaling.z=.16;this.shield.isPickable=false;this.shield.renderingGroupId=2
    const shield=new StandardMaterial('first-person-shield-paint',scene);shield.diffuseColor=Color3.FromHexString('#8cdeeb');shield.alpha=.45;this.shield.material=shield
  }
  update(body:Body|undefined,serverNow:number,now:number,reduced:boolean,first:boolean) {
    const visible=!!body&&first&&number(body.hp,100)>0&&number(body.respawnAt)<=serverNow
    this.root.setEnabled(visible);if(!visible||!body)return
    const kind=String(body.weapon??'hands')
    if(kind!==this.weaponKind){
      this.weapon?.dispose(false,true);this.weapon=undefined;this.weaponKind=kind
      if(['gun','sword','spear'].includes(kind)){this.weapon=prop(this.scene,kind,'first-person-weapon');this.weapon.parent=this.root;this.weapon.position.set(.25,-.24,-.57);this.weapon.rotation.y=Math.PI;for(const mesh of this.weapon.getChildMeshes())mesh.renderingGroupId=2}
    }
    const age=serverNow-number(body.lastAttackAt),attack=age>=0&&age<400?Math.sin(Math.PI*age/400):0
    const bob=reduced||!body.moving?0:Math.sin(now*.009)*.008
    this.hands.forEach((hand,index)=>{const side=index===0?-1:1;hand.position.set(side*(body.blocking?.18:.27), (body.blocking?-.12:-.28)+bob+attack*.05, -.48-(index===1?attack*.22:0));hand.rotation.z=body.blocking?-side*.4:0})
    if(this.weapon){this.weapon.position.z=-.57+(kind==='gun'?attack*.04:-attack*.22);this.weapon.rotation.z=kind==='sword'?-attack*.7:0}
    this.flash.setEnabled(kind==='gun'&&age>=0&&age<75&&!reduced);this.shield.setEnabled(number(body.shieldUntil)>serverNow)
  }
  dispose(){this.root.dispose(false,true)}
}
