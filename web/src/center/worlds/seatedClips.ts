/** Original seated/gesture/turn/celebrate clips on the verified shared bone topology. */
import {AnimationClip,Quaternion,QuaternionKeyframeTrack,Vector3,type Skeleton} from 'three'
export function seatedClips(skeleton:Skeleton){
 const make=(name:string,gesture:number,turn:number)=>{
  const tracks=[]
  for(const bone of skeleton.bones){
   let angle=bone.name.startsWith('thigh_')?-1.1:bone.name.startsWith('calf_')?1.2:0
   if(!angle&&!['upperarm_l','upperarm_r','spine_01'].includes(bone.name))continue
   const axis=bone.name==='spine_01'?new Vector3(0,1,0):new Vector3(1,0,0)
   if(bone.name==='spine_01')angle=turn
   if(bone.name==='upperarm_r')angle=gesture
   if(bone.name==='upperarm_l')angle=gesture*.6
   const q=bone.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(axis,angle))
   const peak=bone.quaternion.clone().multiply(new Quaternion().setFromAxisAngle(axis,angle+(bone.name==='upperarm_r'?.15:0)))
   tracks.push(new QuaternionKeyframeTrack(bone.name+'.quaternion',[0,.6,1.2],[...q.toArray(),...peak.toArray(),...q.toArray()]))
  }
  return new AnimationClip(name,1.2,tracks)
 }
 return [make('OrbixSeatedIdle',-.15,0),make('OrbixGesture',-.8,0),make('OrbixTurn',-.15,.25),make('OrbixCelebrate',-1.8,0)]
}
