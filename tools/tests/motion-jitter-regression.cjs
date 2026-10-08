const {MotionTrack}=require('./motion-regression.cjs');const assert=require('node:assert/strict');
for(const fps of [30,60,144]){
const track=new MotionTrack(),pose={x:0,y:0,z:0,yaw:0,moving:0},input={dx:1,dz:0,yaw:Math.PI/2,active:true,changedAt:0,history:[]},state={serverTimeMs:10000},base={x:0,y:0,z:0,hp:100,onGround:true,speed:5,inputSeq:0};
track.receive(base,state,0,input);let pending=[],nextSend=0,nextSample=0,minimum=Infinity,maxError=0,previous=0;
for(let frame=1;frame<fps*3;frame++){
const now=frame*1000/fps;
while(nextSend<=now){input.history.push({...input,seq:input.history.length+1,at:nextSend});nextSend+=75}
while(nextSample<=now){const at=nextSample,accepted=input.history.filter(i=>i.at+60<=at).at(-1);pending.push({at,arrive:at+60+([0,20,8,35,12][Math.floor(at/100)%5]),body:{...base,x:Math.max(0,at-60)*.005,inputSeq:accepted?.seq??0,inputDx:accepted?1:0,inputDz:0,inputAt:10000+(accepted?.at??0)+60,inputUntil:10000+(accepted?.at??0)+310}});nextSample+=100}
while(pending[0]?.arrive<=now){const s=pending.shift();track.receive(s.body,{...state,serverTimeMs:10000+s.at},now,input)}
track.update(pose,state,now,1/fps,input);minimum=Math.min(minimum,pose.x-previous);previous=pose.x;if(now>700)maxError=Math.max(maxError,Math.abs(pose.x-Math.max(0,now-60)*.005))
}
assert(minimum>-.04,`rewind ${minimum}`);assert(maxError<.5,`error ${maxError}`);console.log(`${fps} Hz, synthetic 120 ms RTT + 0–35 ms snapshot jitter: min frame displacement ${minimum.toFixed(4)}, max error ${maxError.toFixed(3)} units`)
}
