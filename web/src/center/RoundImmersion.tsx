import {createContext,forwardRef,useCallback,useContext,useEffect,useImperativeHandle,useRef,useState,type ReactNode} from 'react'
import {lockBodyScroll} from './scrollLock'
import './roundImmersion.css'
export function phoneViewport(width:number,height:number,touchPoints:number,userAgent:string) {
 return touchPoints>0 && (Math.min(width,height)<=600 || /iPhone|Android.*Mobile/i.test(userAgent))
}
type Mode = 'embedded'|'entering'|'native-fullscreen'|'css-immersive'|'minimizing'
export type ImmersionHandle = {enter:()=>void;minimize:()=>void}
const PortalTarget = createContext<HTMLElement|null>(null)
export function useGamePortal() { return useContext(PortalTarget) ?? document.body }
const fallback = 'Browser fullscreen unavailable. Immersive view is active.'
/** One persistent DOM owner: requests happen synchronously through enter(), before API awaits. */
export const RoundImmersion = forwardRef<ImmersionHandle,{active:boolean;roundId:string;movement?:boolean;children:(blocked:boolean)=>ReactNode}>(function RoundImmersion({active,roundId,movement=false,children},ref) {
 const element=useRef<HTMLDivElement>(null),[target,setTarget]=useState<HTMLElement|null>(null)
 const [mode,setMode]=useState<Mode>('embedded'),[notice,setNotice]=useState<string|null>(null),[portrait,setPortrait]=useState(false)
 const epoch=useRef(0),mounted=useRef(true),suppressed=useRef(false),previousActive=useRef(false),priorFocus=useRef<HTMLElement|null>(null),orientationOwned=useRef(false)
 const attach = useCallback((node:HTMLDivElement|null)=>{element.current=node;setTarget(node)},[])
 const immersed = mode!=='embedded'
 const minimize=useCallback(()=>{
  epoch.current++;suppressed.current=true
  setMode('minimizing')
  if(document.pointerLockElement && element.current?.contains(document.pointerLockElement)) document.exitPointerLock()
  if(orientationOwned.current){screen.orientation?.unlock?.();orientationOwned.current=false}
  if(document.fullscreenElement===element.current)void document.exitFullscreen().catch(()=>{})
  setMode('embedded');setNotice(null)
 },[])
 const enter=useCallback(()=>{
  if(!element.current)return
  suppressed.current=false
  const attempt=++epoch.current
  if(document.activeElement instanceof HTMLElement)priorFocus.current=document.activeElement
  setMode('entering');setNotice(null)
  const root=element.current
  const request=root.requestFullscreen
  if(!request || document.fullscreenEnabled===false){setMode('css-immersive');setNotice(fallback);return}
  // Do not move this below an await: transient user activation is consumed here.
  try {
   void request.call(root,{navigationUI:'hide'}).then(()=>{
    if(!mounted.current || attempt!==epoch.current || !root.isConnected){if(document.fullscreenElement===root)void document.exitFullscreen().catch(()=>{});return}
    if(document.fullscreenElement===root){setMode('native-fullscreen');setNotice(null)}
    else {setMode('css-immersive');setNotice(fallback)}
   }).catch(()=>{if(mounted.current&&attempt===epoch.current){setMode('css-immersive');setNotice(fallback)}})
  } catch {setMode('css-immersive');setNotice(fallback)}
 },[])
 useImperativeHandle(ref,()=>({enter,minimize}),[enter,minimize])
 useEffect(()=>{suppressed.current=false},[roundId])
 useEffect(()=>{
  if(active && !suppressed.current && mode==='embedded'){setMode('css-immersive');setNotice('Immersive view is active. Tap Fullscreen to request browser fullscreen.')}
  if(!active && previousActive.current)minimize()
  previousActive.current=active
 },[active,roundId,minimize])
 useEffect(()=>{
  const changed=()=>{if(document.fullscreenElement===element.current && suppressed.current){void document.exitFullscreen().catch(()=>{});return}if(document.fullscreenElement===element.current){setMode('native-fullscreen');setNotice(null)}else if(mode==='native-fullscreen')minimize()}
  document.addEventListener('fullscreenchange',changed)
  return()=>document.removeEventListener('fullscreenchange',changed)
 },[mode,minimize])
 useEffect(()=>{
  mounted.current=true
  const root=element.current
  return()=>{mounted.current=false;epoch.current++;if(document.fullscreenElement===root)void document.exitFullscreen().catch(()=>{});if(orientationOwned.current)screen.orientation?.unlock?.()}
 },[])
 useEffect(()=>{
  if(!immersed)return
  const unlock=lockBodyScroll(),scroll=[window.scrollX,window.scrollY]
  if(!priorFocus.current&&document.activeElement instanceof HTMLElement)priorFocus.current=document.activeElement
  const hidden: {element:HTMLElement;inert:boolean}[]=[]
  for(let node:HTMLElement|null=element.current;node?.parentElement&&node!==document.body;node=node.parentElement){
   for(const sibling of node.parentElement.children)if(sibling!==node&&sibling instanceof HTMLElement){hidden.push({element:sibling,inert:sibling.inert});sibling.inert=true}
  }
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!element.current?.querySelector('[aria-modal="true"]'))minimize()}
  window.addEventListener('keydown',escape)
  const frame=requestAnimationFrame(()=>element.current?.querySelector<HTMLButtonElement>('[data-minimize]')?.focus({preventScroll:true}))
  return()=>{cancelAnimationFrame(frame);unlock();hidden.forEach(({element,inert})=>element.inert=inert);window.removeEventListener('keydown',escape);window.scrollTo(...scroll as [number,number]);if(priorFocus.current?.isConnected)priorFocus.current.focus({preventScroll:true});priorFocus.current=null}
 },[immersed,minimize])
 useEffect(()=>{
  const update=()=>{const view=window.visualViewport;const root=element.current;if(root){root.style.setProperty('--game-height',`${view?.height ?? innerHeight}px`);root.style.setProperty('--game-top',`${view?.offsetTop ?? 0}px`)};setPortrait(innerHeight>innerWidth)}
  update();window.addEventListener('resize',update);visualViewport?.addEventListener('resize',update);visualViewport?.addEventListener('scroll',update)
  return()=>{window.removeEventListener('resize',update);visualViewport?.removeEventListener('resize',update);visualViewport?.removeEventListener('scroll',update)}
 },[])
 useEffect(()=>{
  if(mode!=='native-fullscreen'||!movement)return
  const orientation=screen.orientation as ScreenOrientation & {lock?:(value:string)=>Promise<void>}
  let live=true
  void orientation?.lock?.('landscape').then(()=>{if(live)orientationOwned.current=true;else orientation.unlock()}).catch(()=>{})
  return()=>{live=false;if(orientationOwned.current){orientation.unlock();orientationOwned.current=false}}
 },[mode,movement])
 return <div ref={attach} data-mode={mode} className={`ct-round-container${immersed?' ct-native-game':''}`}>
  <PortalTarget.Provider value={target}>
   <header className="ct-game-toolbar"><span>{active&&!immersed?'Round continues':mode==='native-fullscreen'?'Browser fullscreen':immersed?'Immersive view':'Game view'}</span><div>{mode!=='native-fullscreen'&&<button type="button" onClick={enter}>{immersed?'Fullscreen':'Resume game'}</button>}<button type="button" data-minimize onClick={minimize}>↙ Minimize</button></div></header>
   <div className="ct-round-content">{children(false)}</div>
   {notice&&<p className="ct-fullscreen-notice" role="status">{notice}</p>}
   {movement&&portrait&&immersed&&<p className="ct-landscape-note">Landscape gives more room for movement controls.</p>}
  </PortalTarget.Provider>
 </div>
})
