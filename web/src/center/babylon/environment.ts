import {Color3,Color4,Vector3,Quaternion,Matrix,MeshBuilder,Mesh,VertexData,PBRMaterial,StandardMaterial,DynamicTexture,RawCubeTexture,Texture,HemisphericLight,DirectionalLight,ShadowGenerator,PhysicsShapeType,type Scene,type AbstractMesh} from './api'
import {staticCollider} from './physics'
import {stateGround} from './terrain'
import {number,type Body} from './types'
import type {WorldQuality} from '../worlds/GameWorld'

export function material(scene: Scene, name: string, color: string, metallic = 0, roughness = .85) {
  const result = new PBRMaterial(name,scene)
  result.albedoColor = Color3.FromHexString(color);result.metallic=metallic;result.roughness=roughness
  result.environmentIntensity=.55
  return result
}
const rng = (seed: number) => () => {seed = Math.imul(1664525,seed)+1013904223|0;return (seed>>>0)/4294967296}

export class SunnydropEnvironment {
  readonly collisions = new Set<AbstractMesh>()
  readonly shadow: ShadowGenerator | null
  private cover = new Map<string, Mesh>()
  constructor(readonly scene: Scene, readonly state: Body, quality: WorldQuality) {
    scene.clearColor=Color4.FromHexString('#b8dfedff')
    scene.fogMode=3;scene.fogColor=Color3.FromHexString('#b8dfed');scene.fogStart=32;scene.fogEnd=100
    scene.imageProcessingConfiguration.toneMappingEnabled=true
    scene.imageProcessingConfiguration.toneMappingType=1
    scene.imageProcessingConfiguration.exposure=1;scene.imageProcessingConfiguration.contrast=1.12
    const fill=new HemisphericLight('cool-sky',new Vector3(0,1,0),scene)
    fill.intensity=.65;fill.diffuse=Color3.FromHexString('#d1eaf8');fill.groundColor=Color3.FromHexString('#738456')
    const sun=new DirectionalLight('late-morning-sun',new Vector3(-.7,-1,-.4),scene)
    sun.position.set(20,32,12);sun.intensity=1.3;sun.diffuse=Color3.FromHexString('#fff0d4')
    sun.shadowMinZ=.5;sun.shadowMaxZ=85;sun.autoUpdateExtends=true
    this.shadow=quality==='fast'?null:new ShadowGenerator(quality==='sharp'?1024:512,sun)
    if(this.shadow){this.shadow.usePercentageCloserFiltering=true;this.shadow.filteringQuality=0;this.shadow.bias=.001;this.shadow.normalBias=.035;this.shadow.darkness=.35}
    // Original procedural sky and six-face ambient radiance; no remote HDR/art.
    const skyTexture=new DynamicTexture('original-sky',{width:64,height:256},scene,false)
    const skyContext=skyTexture.getContext(),gradient=skyContext.createLinearGradient(0,0,0,256)
    gradient.addColorStop(0,'#379ac9');gradient.addColorStop(.55,'#a1d5e6');gradient.addColorStop(.8,'#dcefdc');gradient.addColorStop(1,'#b8dfed')
    skyContext.fillStyle=gradient;skyContext.fillRect(0,0,64,256);skyTexture.update()
    const skyMaterial=material(scene,'sky-gradient','#87c7e3');skyMaterial.albedoTexture=skyTexture;skyMaterial.unlit=true;skyMaterial.backFaceCulling=false;skyMaterial.fogEnabled=false
    const sky=MeshBuilder.CreateSphere('sky-dome',{diameter:260,segments:16},scene);sky.material=skyMaterial;sky.isPickable=false;sky.infiniteDistance=true
    const faces=['#cce3e6','#cce3e6','#d9efff','#71865f','#cee2de','#cee2de'].map(hex=>{const c=Color3.FromHexString(hex);return new Uint8Array([c.r*255,c.g*255,c.b*255,255,c.r*255,c.g*255,c.b*255,255,c.r*255,c.g*255,c.b*255,255,c.r*255,c.g*255,c.b*255,255])})
    const environment=new RawCubeTexture(scene,faces,2,EngineConstants.RGBA,EngineConstants.UNSIGNED_BYTE,true,false,Texture.TRILINEAR_SAMPLINGMODE)
    environment.gammaSpace=true;scene.environmentTexture=environment
    const water=MeshBuilder.CreateGround('calm-water',{width:240,height:240,subdivisions:1},scene)
    water.position.y=-2.2;water.material=material(scene,'water','#60b8c5',.1,.42);water.isPickable=false
    const cliff=MeshBuilder.CreateBox('island-foundation',{width:48,height:3,depth:48},scene)
    cliff.position.y=-1.65;cliff.material=material(scene,'island-strata','#b69b75');cliff.isPickable=false
    this.terrain(quality)
    this.vegetation(quality)
    this.outpost()
    this.updateCover(state)
  }
  private terrain(quality: WorldQuality) {
    const steps=quality==='fast'?48:72,size=48,positions:number[]=[],indices:number[]=[],uvs:number[]=[],colors:number[]=[]
    for(let iz=0;iz<=steps;iz++)for(let ix=0;ix<=steps;ix++){
      const x=ix/steps*size-size/2,z=iz/steps*size-size/2,y=stateGround(this.state,x,z)
      positions.push(x,y,z);uvs.push(ix/steps*14,iz/steps*14)
      const path=Math.min(Math.abs(x+Math.sin(z*.15)*2),Math.abs(z-4-Math.sin(x*.2)*1.8))<1.4
      const shade=.94+.06*Math.sin(x*2+z*1.3),color=Color3.FromHexString(path?'#dcc48f':y>.7?'#91b36f':'#92bd74').scale(shade)
      colors.push(color.r,color.g,color.b,1)
      if(ix<steps&&iz<steps){const a=iz*(steps+1)+ix,b=a+steps+1;indices.push(a,b,a+1,a+1,b,b+1)}
    }
    const normals:number[]=[];VertexData.ComputeNormals(positions,indices,normals,{useRightHandedSystem:true})
    const data=new VertexData();data.positions=positions;data.indices=indices;data.normals=normals;data.uvs=uvs;data.colors=colors
    const ground=new Mesh('authoritative-field-v1',this.scene);data.applyToMesh(ground)
    ground.useVertexColors=true;ground.hasVertexAlpha=false;ground.receiveShadows=true;this.collisions.add(ground)
    const grass=material(this.scene,'meadow-soil','#ffffff')
    // This hand-authored field uses server x/z winding, independent of Babylon
    // builder orientation. Keep its surface visible in the right-handed scene.
    grass.backFaceCulling=false
    const texture=new DynamicTexture('original-meadow-grain',{width:128,height:128},this.scene,true)
    const context=texture.getContext(),random=rng(140)
    context.fillStyle='#e0ddbf';context.fillRect(0,0,128,128)
    for(let i=0;i<1400;i++){const bright=125+Math.floor(random()*80);context.fillStyle=`rgba(${bright},${bright+8},${bright-20},.25)`;context.fillRect(random()*128,random()*128,1,1+random()*3)}
    texture.update();grass.albedoTexture=texture;ground.material=grass
    staticCollider(ground,this.scene,PhysicsShapeType.MESH)
  }
  private instances(source: Mesh, transforms: Matrix[]) {
    const matrices=new Float32Array(transforms.length*16)
    transforms.forEach((matrix,index)=>matrix.copyToArray(matrices,index*16))
    source.thinInstanceSetBuffer('matrix',matrices,16,true);source.thinInstanceRefreshBoundingInfo()
    source.isPickable=false;source.freezeWorldMatrix()
  }
  private vegetation(quality: WorldQuality) {
    const random=rng(712),scene=this.scene,trees=quality==='fast'?30:55
    const trunks=MeshBuilder.CreateCylinder('instanced-tree-trunks',{height:1.8,diameterTop:.17,diameterBottom:.3,tessellation:7},scene)
    trunks.material=material(scene,'warm-bark','#927158')
    const crowns=MeshBuilder.CreateSphere('instanced-tree-crowns',{diameter:2.6,segments:5},scene);crowns.material=material(scene,'orchard-green','#609764')
    const pale=MeshBuilder.CreateSphere('instanced-pale-crowns',{diameter:2,segments:5},scene);pale.material=material(scene,'pale-sage','#8cb078')
    const tm:Matrix[]=[],cm:Matrix[]=[],pm:Matrix[]=[]
    const compose=(x:number,y:number,z:number,sx:number,sy:number,sz:number,angle=0)=>Matrix.Compose(new Vector3(sx,sy,sz),Quaternion.RotationAxis(Vector3.Up(),angle),new Vector3(x,y,z))
    for(let i=0;i<trees;i++){
      const side=i%4,along=random()*43-21.5,outside=21.4+random()*2,x=side<2?(side===0?-outside:outside):along,z=side>=2?(side===2?-outside:outside):along
      const y=stateGround(this.state,x,z),scale=.8+random()*.8
      tm.push(compose(x,y+.9*scale,z,scale,scale,scale));cm.push(compose(x,y+2.2*scale,z,scale,scale*.9,scale,random()*6));pm.push(compose(x+.55*scale,y+2*scale,z+.35*scale,scale,scale,scale))
    }
    this.instances(trunks,tm);this.instances(crowns,cm);this.instances(pale,pm)
    const tuft=MeshBuilder.CreateCylinder('instanced-meadow-tufts',{height:.25,diameterTop:0,diameterBottom:.28,tessellation:3},scene);tuft.material=material(scene,'grass-blades','#5d9864')
    const flower=MeshBuilder.CreateSphere('instanced-buttercup-heads',{diameter:.11,segments:3},scene);flower.material=material(scene,'buttercup','#ffe9a3')
    const grass:Matrix[]=[],flowers:Matrix[]=[]
    for(let i=0;i<(quality==='fast'?180:440);i++){
      const x=random()*39-19.5,z=random()*39-19.5,y=stateGround(this.state,x,z)
      if(Math.abs(x+Math.sin(z*.15)*2)<2||Math.abs(z-4-Math.sin(x*.2)*1.8)<2)continue
      grass.push(compose(x,y+.1,z,1,.8+random()*.8,1,random()*6))
      if(i%3===0)flowers.push(compose(x+.1,y+.22,z,1,1,1))
    }
    this.instances(tuft,grass);this.instances(flower,flowers)
    const rock=MeshBuilder.CreateSphere('instanced-border-rocks',{diameter:1,segments:4},scene);rock.material=material(scene,'river-stone','#b7b89c')
    const rocks:Matrix[]=[]
    for(let i=0;i<48;i++){const t=i/12,side=Math.floor(t),a=(t%1)*42-21,x=side<2?(side===0?-22:22):a,z=side>=2?(side===2?-22:22):a;rocks.push(compose(x,stateGround(this.state,x,z)+.12,z,.7+random(),.4+random()*.4,.8+random(),random()*6))}
    this.instances(rock,rocks)
    const fence=MeshBuilder.CreateCylinder('instanced-boundary-posts',{height:1,diameter:.13,tessellation:6},scene);fence.material=material(scene,'boundary-post','#e4cba1')
    const posts:Matrix[]=[]
    for(let side=0;side<4;side++)for(let i=0;i<14;i++){const a=i*3-19.5,x=side<2?(side===0?-20.3:20.3):a,z=side>=2?(side===2?-20.3:20.3):a;posts.push(compose(x,stateGround(this.state,x,z)+.5,z,1,1,1))}
    this.instances(fence,posts)
  }
  private outpost() {
    const scene=this.scene,base=stateGround(this.state,-15,-16)
    const deck=MeshBuilder.CreateBox('outpost-deck',{width:5,height:.18,depth:3},scene);deck.position.set(-15,base+.1,-16);deck.material=material(scene,'cedar-deck','#d9b586');deck.isPickable=false
    // Decoration remains outside the published cover volumes and player path.
    const mast=MeshBuilder.CreateCylinder('outpost-signpost',{height:4.3,diameter:.16,tessellation:8},scene);mast.position.set(-18.3,stateGround(this.state,-18.3,-17)+2.15,-17);mast.material=material(scene,'painted-wood','#f5e8cc');mast.isPickable=false
    const sign=MeshBuilder.CreatePlane('sunnydrop-sign',{width:3,height:1.4,sideOrientation:Mesh.DOUBLESIDE},scene);sign.position.set(-18.3,mast.position.y+1.4,-17);sign.rotation.y=Math.PI/4;sign.isPickable=false
    const texture=new DynamicTexture('original-sunnydrop-sign',{width:512,height:256},scene,false),context=texture.getContext() as CanvasRenderingContext2D
    context.fillStyle='#286760';context.fillRect(0,0,512,256);context.fillStyle='#fff4ce';context.font='bold 54px sans-serif';context.textAlign='center';context.fillText('SUNNYDROP',256,109);context.font='28px sans-serif';context.fillText('SUPPLY OUTPOST',256,164);context.strokeStyle='#e9be69';context.lineWidth=8;context.strokeRect(12,12,488,232);texture.update()
    const m=new StandardMaterial('sign-ink',scene);m.diffuseTexture=texture;m.emissiveColor=new Color3(.12,.12,.12);sign.material=m
    const flag=MeshBuilder.CreateBox('outpost-coral-flag',{width:1.6,height:.7,depth:.03},scene);flag.position.set(-17.5,mast.position.y+2,-17);flag.material=material(scene,'coral-canvas','#e88e76');flag.isPickable=false
  }
  updateCover(state: Body) {
    const active=new Set<string>()
    for(const obstacle of state.obstacles??[]){
      const key=String(obstacle.id);active.add(key)
      if(this.cover.has(key))continue
      const mesh=MeshBuilder.CreateBox(`cover-${key}`,{width:number(obstacle.width,1),height:number(obstacle.height,1.6),depth:number(obstacle.depth,1)},this.scene)
      mesh.position.set(number(obstacle.x),number(obstacle.baseY)+number(obstacle.height,1.6)/2,number(obstacle.z));mesh.material=material(this.scene,`cover-stone-${key}`,obstacle.kind==='bunker'?'#698d84':'#c9b897');mesh.receiveShadows=true
      this.collisions.add(mesh);staticCollider(mesh,this.scene);this.shadow?.addShadowCaster(mesh);this.cover.set(key,mesh)
      const cap=MeshBuilder.CreateBox(`cover-cap-${key}`,{width:number(obstacle.width,1)+.08,height:.08,depth:number(obstacle.depth,1)+.08},this.scene);cap.parent=mesh;cap.position.y=number(obstacle.height,1.6)/2;cap.material=material(this.scene,`cover-moss-${key}`,'#92a56e');cap.isPickable=false
    }
    for(const [key,mesh]of this.cover)if(!active.has(key)){this.collisions.delete(mesh);mesh.dispose();this.cover.delete(key)}
  }
}
const EngineConstants = {RGBA:5,UNSIGNED_BYTE:0}
