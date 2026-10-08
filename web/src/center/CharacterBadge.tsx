import {characterInfo,type Appearance} from './characters'
/** Lightweight lobby portrait avoids creating a WebGL context per player. */
export function CharacterBadge({appearance={}}:{appearance?:Appearance}){
 const info=characterInfo(appearance.character),c=appearance.cosmetics??{}
 return <span className="pf-character-badge" title={`${info.name} · ${Object.values(c).join(', ')}`} aria-label={`${info.name} character`} style={{background:info.color,color:'#303348'}}><span aria-hidden>{c.hat==='crown'?'♛':c.hat==='bow'?'🎀':info.face}{c.glasses&&c.glasses!=='none'?' ◉':''}</span><small>{info.name}</small></span>
}
