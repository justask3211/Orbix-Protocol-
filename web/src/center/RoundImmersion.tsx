import {useEffect,useRef,useState,type ReactNode} from 'react'
import './roundImmersion.css'
export function phoneViewport(width:number,height:number,touchPoints:number,userAgent:string) {
 return touchPoints>0 && (Math.min(width,height)<=600 || /iPhone|Android.*Mobile/i.test(userAgent))
}
/** Native fullscreen requires an actual gesture. CSS immersion covers unsupported browsers. */
export function RoundImmersion({active,roundId,children}:{active:boolean;roundId:string;children:(blocked:boolean)=>ReactNode}) {
 const element=useRef<HTMLDivElement>(null),[phone,setPhone]=useState(false),[portrait,setPortrait]=useState(false),[entered,setEntered]=useState(false),[immersive,setImmersive]=useState(false),[notice,setNotice]=useState<string|null>(null)
 useEffect(()=>{const orientation=matchMedia('(orientation: portrait)'),update=()=>{setPhone(phoneViewport(innerWidth,innerHeight,navigator.maxTouchPoints,navigator.userAgent));setPortrait(orientation.matches)};update();orientation.addEventListener('change',update);window.addEventListener('resize',update);return()=>{orientation.removeEventListener('change',update);window.removeEventListener('resize',update)}},[])
 useEffect(()=>{setEntered(false);setImmersive(false);setNotice(null)},[roundId])
 useEffect(()=>{if(!active){setImmersive(false);setEntered(false);if(document.fullscreenElement===element.current)void document.exitFullscreen().catch(()=>{})}},[active])
 useEffect(()=>{const changed=()=>{if(!document.fullscreenElement)setImmersive(false)};document.addEventListener('fullscreenchange',changed);return()=>{document.removeEventListener('fullscreenchange',changed);if(document.fullscreenElement===element.current)void document.exitFullscreen().catch(()=>{})}},[])
 useEffect(()=>{if(!immersive)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setImmersive(false);if(document.fullscreenElement===element.current)void document.exitFullscreen().catch(()=>{})}};window.addEventListener('keydown',escape);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',escape)}},[immersive])
 const enter=()=>{
  if(!active || phone&&portrait)return
  setEntered(true);setImmersive(true);setNotice(null)
  if(element.current?.requestFullscreen){void element.current.requestFullscreen().catch(()=>setNotice('Browser fullscreen is unavailable. Playing in the immersive view.'))}
  else setNotice('Playing in the immersive view. Browser fullscreen is unavailable.')
 }
 const blocked=active&&phone&&(portrait||!entered)
 return <div ref={element} className={`ct-round-container${immersive?' ct-native-game':''}`}>
  <div className="ct-round-content" inert={blocked}>{children(blocked)}</div>
  {active&&!blocked&&<button className="ct-fullscreen-button" onClick={()=>{if(immersive){setImmersive(false);if(document.fullscreenElement===element.current)void document.exitFullscreen().catch(()=>{})}else enter()}}>{immersive?'Exit fullscreen':'Play fullscreen'}</button>}
  {active&&notice&&<p className="ct-fullscreen-notice" role="status">{notice}</p>}
  {blocked&&<div className="ct-orientation-prompt" role="status"><span aria-hidden="true">↻</span><h2>{portrait?'Rotate your phone':'Ready for the round?'}</h2><p>{portrait?'Turn to landscape for room to move and use the controls. The live round continues.':'Enter the game in landscape. Touch controls stay inside the play area.'}</p>{!portrait&&<button className="btn-primary" onClick={enter}>Enter game</button>}</div>}
 </div>
}
