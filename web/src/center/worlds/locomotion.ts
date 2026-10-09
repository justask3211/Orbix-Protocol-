/** Original in-place gait: planted feet travel backwards linearly; arms swing below the chest.
 * The imported combat/jump rig is unchanged. Server displacement is never animated here. */
import {AnimationClip,AnimationMixer,Quaternion,QuaternionKeyframeTrack,Vector3,VectorKeyframeTrack} from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js'
const cache=new WeakMap<GLTF,{clips:AnimationClip[];speeds:Record<string,number>}>()
export function locomotion(gltf:GLTF) {
  const cached=cache.get(gltf);if(cached)return cached
  const scene=clone(gltf.scene);scene.updateMatrixWorld(true)
  const pos=(name:string)=>scene.getObjectByName(name)!.getWorldPosition(new Vector3())
  const worldQ=(name:string)=>scene.getObjectByName(name)!.getWorldQuaternion(new Quaternion())
  const legScale=(pos('thigh_l').distanceTo(pos('calf_l'))+pos('calf_l').distanceTo(pos('foot_l')))/.8876
  const clips:AnimationClip[]=[],speeds:Record<string,number>={}
  for(const [name,duration,stride,lift] of [['Walk',1.05,.62,.10],['Run',.68,.94,.18],['Sprint',.54,1.12,.23]] as const){
    const times:number[]=[],values=new Map<string,number[]>(),steps=64
    const record=(bone:string,q:Quaternion)=>{const a=values.get(bone)??[];a.push(q.x,q.y,q.z,q.w);values.set(bone,a)}
    const solve=(base:string,joint:string,end:string,target:Vector3,bend:Vector3)=>{
      const a=pos(base),b=pos(joint),c=pos(end),l1=a.distanceTo(b),l2=b.distanceTo(c),d=target.clone().sub(a),length=Math.min(l1+l2-.001,Math.max(Math.abs(l1-l2)+.001,d.length())),dir=d.normalize()
      const along=(l1*l1-l2*l2+length*length)/(2*length),height=Math.sqrt(Math.max(0,l1*l1-along*along))
      const plane=bend.clone().addScaledVector(dir,-bend.dot(dir)).normalize(),knee=a.clone().addScaledVector(dir,along).addScaledVector(plane,height)
      const q1=new Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(),knee.clone().sub(a).normalize()).multiply(worldQ(base))
      const q2=new Quaternion().setFromUnitVectors(c.clone().sub(b).normalize(),target.clone().sub(knee).normalize()).multiply(worldQ(joint))
      record(base,scene.getObjectByName(base)!.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(q1))
      record(joint,q1.clone().invert().multiply(q2))
      record(end,q2.clone().invert().multiply(worldQ(end)))
    }
    for(let i=0;i<=steps;i++){
      const strideLength=stride*legScale
      const t=i/steps;times.push(t*duration)
      for(const [side,offset] of [['l',0],['r',.5]] as const){
        const phase=(t+offset)%1,stance=phase<.5,swing=(phase-.5)*2
        const foot=pos(`foot_${side}`)
        foot.z+=stance?strideLength*(.5-phase*2):strideLength*(-.5+swing*swing*(3-2*swing))
        foot.y+=stance?0:Math.sin(swing*Math.PI)*lift
        solve(`thigh_${side}`,`calf_${side}`,`foot_${side}`,foot,new Vector3(0,0,1))
        // Relaxed hands at hip level, opposite to the advancing foot. No fists at the chest.
        const shoulder=pos(`upperarm_${side}`),hand=shoulder.clone().add(new Vector3(side==='l'?.08:-.08,-.48,-Math.cos(phase*Math.PI*2)*.15))
        solve(`upperarm_${side}`,`lowerarm_${side}`,`hand_${side}`,hand,new Vector3(0,0,-1))
      }
    }
    const tracks=[...values].map(([bone,v])=>new QuaternionKeyframeTrack(`${bone}.quaternion`,times,v))
    // Reset all other rotation channels to their rest pose; no T-pose arm channels remain.
    scene.traverse(bone=>{if((bone as any).isBone&&!values.has(bone.name)){const q=bone.quaternion;tracks.push(new QuaternionKeyframeTrack(`${bone.name}.quaternion`,[0,duration],[q.x,q.y,q.z,q.w,q.x,q.y,q.z,q.w]))}})
    const pelvis=scene.getObjectByName('pelvis')!,p=pelvis.position
    const bob=times.flatMap(time=>[p.x,p.y+Math.sin(time/duration*Math.PI*4)*.012,p.z])
    const clip=new AnimationClip(name,duration,[...tracks,new VectorKeyframeTrack('pelvis.position',times,bob)])
    clips.push(clip)
    // Measure actual backward planted-foot speed after skin rig playback (not a guessed constant).
    const mixer=new AnimationMixer(scene);mixer.clipAction(clip).play();mixer.update(0)
    const samples:number[]=[];let previous=pos('foot_l')
    for(let i=1;i<steps/2;i++){mixer.update(duration/steps);const next=pos('foot_l');samples.push((previous.z-next.z)/(duration/steps));previous=next}
    samples.sort((a,b)=>a-b);speeds[name]=Math.max(.1,samples[Math.floor(samples.length/2)])
    mixer.stopAllAction();mixer.uncacheRoot(scene)
    // Measurements must not become the rest pose for the next clip.
    scene.traverse(b=>{const original=gltf.scene.getObjectByName(b.name);if((b as any).isBone&&original){b.position.copy(original.position);b.quaternion.copy(original.quaternion)}});scene.updateMatrixWorld(true)
  }
  const result={clips:gltf.animations.map(c=>clips.find(l=>l.name===c.name)??c),speeds};cache.set(gltf,result);return result
}
