/* Shared first-party promo, usable by every Orbix site without React. */
(()=>{
  if(/^\/center\/preview\//.test(location.pathname))return; // Offline preview stays disconnected.
  const source=document.currentScript?.src||location.href;
  const api=new URL('/api/center/v1/orbix-policy',source).href;
  const key='orbix-promo-dismissed';
  try{if(sessionStorage.getItem(key))return}catch{}
  const render=async()=>{
    try{
      const res=await fetch(api,{credentials:'omit'});if(!res.ok)return;
      const p=await res.json();if(!p.promo_enabled||!/^https:\/\//.test(p.promo_link)||!/^0x[\da-f]{40}$/i.test(p.orbix_token))return;
      if(document.getElementById('orbix-promo'))return;
      const style=document.createElement('style');
      style.textContent='#orbix-promo{position:relative;z-index:80;background:#372356;color:#fff;font:14px/1.4 system-ui;padding:8px 48px 8px 12px;box-sizing:border-box;width:100%;overflow:hidden}#orbix-promo .op-lane{overflow:hidden;width:100%}#orbix-promo a{color:#fbe28e;font-weight:800;display:block;width:max-content;animation:orbix-promo-run 16s linear infinite;white-space:nowrap}#orbix-promo a:focus,#orbix-promo a:hover{animation-play-state:paused}#orbix-promo p{margin:6px 0 0;font-size:12px;overflow-wrap:anywhere}#orbix-promo button{background:transparent;color:#fff;border:1px solid #cfc3e9;border-radius:8px;min-width:44px;min-height:44px;cursor:pointer}#orbix-promo .op-copy{margin-left:8px;font-size:12px;min-height:32px}#orbix-promo .op-close{position:absolute;right:3px;top:3px;font-size:23px}#orbix-promo .op-ca{font-family:monospace}@keyframes orbix-promo-run{from{transform:translateX(-100%)}to{transform:translateX(90vw)}}@media(prefers-reduced-motion:reduce){#orbix-promo a{animation:none}}';
      document.head.append(style);
      const strip=document.createElement('aside');strip.id='orbix-promo';strip.setAttribute('aria-label','Buy ORBIX');
      const lane=document.createElement('div');lane.className='op-lane';const buy=document.createElement('a');buy.href=p.promo_link;buy.textContent=p.promo_text;buy.target='_blank';buy.rel='noopener noreferrer';lane.append(buy);
      const ca=document.createElement('p');ca.append('ORBIX token CA: ');const address=document.createElement('span');address.className='op-ca';address.textContent=p.orbix_token;ca.append(address);
      const copy=document.createElement('button');copy.type='button';copy.className='op-copy';copy.textContent='⧉ Copy';copy.setAttribute('aria-label','Copy ORBIX token contract address');copy.onclick=async()=>{try{await navigator.clipboard.writeText(p.orbix_token);copy.textContent='✓ Copied'}catch{copy.textContent='Select CA to copy'}};ca.append(copy);
      const close=document.createElement('button');close.type='button';close.className='op-close';close.textContent='×';close.setAttribute('aria-label','Dismiss ORBIX promotion for this session');close.onclick=()=>{strip.remove();try{sessionStorage.setItem(key,'1')}catch{}};
      strip.append(lane,ca,close);document.body.prepend(strip);
    }catch{/* Promo availability must not block the app. */}
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render,{once:true});else void render();
})();
