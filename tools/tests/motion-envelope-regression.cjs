const fs=require('node:fs'),assert=require('node:assert/strict')
const {transformSync}=require('../../web/node_modules/rolldown/dist/utils-index.mjs')
const path=process.argv[2]||'web/src/center/worlds/motion.ts'
const code=transformSync('motion.ts',fs.readFileSync(path,'utf8').replace(/import.*\n/g,''),{target:'es2022'}).code.replace(/\bexport\s+/g,'')
const {MotionTrack}=new Function('stateGround',code+'\nreturn {MotionTrack};')(()=>0)
const state={serverTimeMs:10000},body={x:0,y:0,z:0,vy:0,hp:100,onGround:true,speed:5,inputSeq:0},input={dx:0,dz:0,active:true,changedAt:0,history:[],jumpAt:1}
const heights=[]
for(const fps of [30,60,144]){
 const track=new MotionTrack(),p={x:0,y:0,z:0,yaw:0,moving:0};track.receive(body,state,0,input)
 for(let f=1;f<=fps*.2;f++)track.update(p,state,f*1000/fps,1/fps,input)
 heights.push({fps,time:Math.floor(fps*.2)/fps,y:p.y})
}
// Compare at a common exact 200 ms endpoint, including the fractional final frame.
const exact=[]
for(const fps of [30,60,144]){const t=new MotionTrack(),p={x:0,y:0,z:0,yaw:0,moving:0};t.receive(body,state,0,input);let now=0;while(now<200-1e-7){let next=Math.min(200,now+1000/fps);t.update(p,state,next,(next-now)/1000,input);now=next}exact.push(p.y)}
const spread=Math.max(...exact)-Math.min(...exact)
console.log(JSON.stringify({jumpHeight200ms:exact,frameRateSpread:spread}))
if(!process.argv[2])assert(spread<.002,'Airborne integration must agree across render rates')
// Opponents see the same timeline under independent arrival jitter, not arrival-based easing.
const tracks=[new MotionTrack(),new MotionTrack()],poses=tracks.map(()=>({x:0,y:0,z:0,yaw:0,moving:0}));let difference=0,lag=0
for(let now=0;now<=2000;now+=1000/60){for(let c=0;c<2;c++){for(let at=0;at<=2000;at+=100){const arrival=at+60+(c?[0,20,8,35,12][at/100%5]:0);if(arrival<=now&&(!tracks[c].samples.length||at>tracks[c].samples.at(-1).at-10000))tracks[c].receive({...body,x:at*.005},{...state,serverTimeMs:10000+at},arrival)}tracks[c].update(poses[c],state,now,1/60)}if(now>500){difference=Math.max(difference,Math.abs(poses[0].x-poses[1].x));lag=Math.max(lag,now-60-poses[1].x/.005)}}
console.log(JSON.stringify({remoteObserverMaxDifference:difference,remoteDelayBeyondTransitMs:lag}))
if(!process.argv[2]){assert(difference<.08);assert(lag<=150.01)}
