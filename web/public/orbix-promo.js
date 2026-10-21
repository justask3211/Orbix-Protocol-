/* First-party promotion shared by Center, the cockpit and standalone Orbix sites. */
(() => {
  if (/^\/center\/preview\//.test(location.pathname)) return;
  const source = document.currentScript?.src || location.href;
  const api = new URL('/api/center/v1/orbix-policy', source).href;
  const key = 'orbix-promo-dismissed';
  try { if (sessionStorage.getItem(key)) return; } catch {}

  const icon = (path) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS(svg.namespaceURI, 'path'); line.setAttribute('d', path); svg.append(line); return svg;
  };
  const button = (className, label, path) => {
    const el = document.createElement('button'); el.type = 'button'; el.className = className; el.setAttribute('aria-label', label); el.append(icon(path)); return el;
  };
  const render = async () => {
    try {
      const res = await fetch(api, {credentials: 'omit'}); if (!res.ok) return;
      const p = await res.json();
      if (!p.promo_enabled || !/^https:\/\//.test(p.promo_link) || !/^0x[\da-f]{40}$/i.test(p.orbix_token) || document.getElementById('orbix-promo')) return;
      const style = document.createElement('style');
      style.textContent = `
#orbix-promo{--op-orange:var(--orange,#ff6b22);position:relative;isolation:isolate;z-index:80;display:flex;align-items:center;gap:18px;box-sizing:border-box;width:100%;min-height:76px;padding:12px clamp(16px,3vw,48px);overflow:hidden;background:radial-gradient(ellipse at 5% 0%,#ff6b222e,transparent 50%),linear-gradient(110deg,#241a13,#141719 55%,#14221f);color:#f2f0ec;border-bottom:1px solid #ff6b2245;font:13px/1.4 Manrope,system-ui,sans-serif}
#orbix-promo *{box-sizing:border-box;min-width:0}#orbix-promo button,#orbix-promo a{touch-action:manipulation;-webkit-tap-highlight-color:#ff6b2230}#orbix-promo button{font:inherit;cursor:pointer}#orbix-promo svg{flex-shrink:0}#orbix-promo :is(button,a):focus-visible{outline:2px solid #ffb48c;outline-offset:3px}#orbix-promo .op-brand{display:flex;align-items:center;gap:11px;flex-shrink:0}#orbix-promo .op-orb{display:grid;place-items:center;width:42px;height:42px;border:1px solid #ff9c6a75;border-radius:50%;background:radial-gradient(circle at 35% 25%,#ffba87,#ff6b22 48%,#853412);box-shadow:inset 0 0 0 5px #1b1715;font-size:20px;font-weight:850;color:#ffe3cf}#orbix-promo .op-brand strong{display:block;font-size:15px;letter-spacing:-.025em;font-weight:850}#orbix-promo .op-brand small{display:block;color:#b6b0a9;font:8px/1.6 'DM Mono',monospace;letter-spacing:.12em}#orbix-promo .op-message{flex:1;overflow:hidden;position:relative;mask-image:linear-gradient(90deg,transparent,#000 18px,#000 calc(100% - 18px),transparent)}#orbix-promo .op-track{display:flex;width:max-content;animation:orbix-promo-run 28s linear infinite}#orbix-promo .op-segment{display:flex;align-items:center;gap:25px;white-space:nowrap;padding-right:25px;font-size:12px;font-weight:650;color:#ded5cc}#orbix-promo .op-spark{font-size:16px;color:#ff9c6a}#orbix-promo .op-detail{color:#83d9c8;font:9px 'DM Mono',monospace;letter-spacing:.08em}#orbix-promo:hover .op-track,#orbix-promo:focus-within .op-track,#orbix-promo.op-paused .op-track{animation-play-state:paused}
#orbix-promo .op-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}#orbix-promo .op-copy{display:flex;align-items:center;gap:9px;min-height:44px;padding:7px 11px;border:1px solid #80cdb43a;border-radius:10px;background:#0b0c0e65;color:#c9ddd7;transition:background .18s,border-color .18s}#orbix-promo .op-copy:hover{background:#69d9c815;border-color:#69d9c870}#orbix-promo .op-ca-label{color:#83d9c8;font:9px 'DM Mono',monospace}#orbix-promo .op-ca{font:11px 'DM Mono',monospace;font-variant-numeric:tabular-nums}#orbix-promo .op-buy{display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:44px;padding:10px 19px;border-radius:999px;background:var(--op-orange);border:1px solid #ffb48c45;box-shadow:0 4px 18px #ff6b221c;color:#141414;text-decoration:none;font-size:12px;font-weight:850;white-space:nowrap;transition:background .18s,transform .18s}#orbix-promo .op-buy:hover{background:#ff9c6a;transform:translateY(-1px)}#orbix-promo .op-control{display:grid;place-items:center;min-width:44px;min-height:44px;padding:8px;background:transparent;border:1px solid transparent;border-radius:10px;color:#bbb7b1}#orbix-promo .op-control:hover{color:#fff;background:#ffffff0a;border-color:#ffffff20}#orbix-promo .op-controls{display:flex;gap:0;flex-shrink:0}#orbix-promo .op-status{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden;white-space:nowrap}
@keyframes orbix-promo-run{from{transform:translateX(-50%)}to{transform:translateX(0)}}
@media(max-width:1100px){#orbix-promo{gap:12px;padding:12px 20px;flex-wrap:wrap}#orbix-promo .op-message{order:4;flex-basis:100%;border-top:1px solid #ffffff0b;padding-top:9px}#orbix-promo .op-actions{margin-left:auto}#orbix-promo .op-controls{margin-left:0}}
@media(max-width:600px){#orbix-promo{padding:12px 16px;gap:10px;min-height:0}#orbix-promo .op-brand{gap:9px;flex:1}#orbix-promo .op-orb{width:36px;height:36px;font-size:17px}#orbix-promo .op-brand strong{font-size:14px}#orbix-promo .op-brand small{font-size:7px}#orbix-promo .op-actions{order:3;width:100%;gap:8px;margin:0}#orbix-promo .op-copy{flex:1;justify-content:center;padding:7px 9px}#orbix-promo .op-buy{padding:10px 16px;gap:10px}#orbix-promo .op-message{padding-top:8px}#orbix-promo .op-segment{font-size:11px;gap:18px;padding-right:18px}#orbix-promo .op-controls{gap:0}#orbix-promo .op-control{min-width:44px}}
@media(prefers-reduced-motion:reduce){#orbix-promo .op-track{animation:none;width:auto}#orbix-promo .op-segment{white-space:normal;padding:0;line-height:1.6}#orbix-promo .op-segment[aria-hidden],#orbix-promo .op-detail,#orbix-promo .op-spark,#orbix-promo .op-pause{display:none}#orbix-promo .op-message{mask-image:none}#orbix-promo :is(a,button){transition:none}#orbix-promo .op-buy:hover{transform:none}}
`;
      const strip = document.createElement('aside'); strip.id = 'orbix-promo'; strip.setAttribute('aria-label', 'Buy ORBIX');
      const brand = document.createElement('div'); brand.className = 'op-brand';
      const orb = document.createElement('span'); orb.className = 'op-orb'; orb.setAttribute('aria-hidden', 'true'); orb.textContent = 'O';
      const brandText = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = 'Meet $ORBIX'; title.translate = false;
      const subtitle = document.createElement('small'); subtitle.textContent = 'THE ORBIX CORE TOKEN'; brandText.append(title, subtitle); brand.append(orb, brandText);
      const message = document.createElement('div'); message.className = 'op-message';
      const track = document.createElement('div'); track.className = 'op-track';
      const segment = document.createElement('div'); segment.className = 'op-segment';
      const text = document.createElement('span');
      const configuredText = p.promo_text?.trim();
      // Upgrade the legacy CTA-only default while preserving every custom announcement.
      text.textContent = !configuredText || /^buy\s+\$?orbix$/i.test(configuredText) ? 'Step into the Orbix world. Discover our core token, $ORBIX.' : configuredText;
      const detail = document.createElement('span'); detail.className = 'op-detail'; detail.textContent = 'DISCOVER THE TOKEN. ENTER THE ORBIX WORLD.';
      for (const node of [text, detail]) { const spark = document.createElement('span'); spark.className = 'op-spark'; spark.textContent = '✦'; spark.setAttribute('aria-hidden', 'true'); segment.append(node, spark); }
      const duplicate = segment.cloneNode(true); duplicate.setAttribute('aria-hidden', 'true'); track.append(segment, duplicate); message.append(track);
      const actions = document.createElement('div'); actions.className = 'op-actions';
      const copy = button('op-copy', 'Copy ORBIX token contract address', 'M9 9h11v11H9z M5 15H3V3h12v2');
      copy.title = p.orbix_token;
      const caLabel = document.createElement('span'); caLabel.className = 'op-ca-label'; caLabel.textContent = 'CA';
      const address = document.createElement('span'); address.className = 'op-ca'; address.translate = false; address.textContent = p.orbix_token.slice(0, 6) + '…' + p.orbix_token.slice(-4);
      copy.prepend(caLabel, address);
      const status = document.createElement('span'); status.className = 'op-status'; status.setAttribute('role', 'status');
      let reset;
      copy.onclick = async () => {
        try {
          const {copyText} = await import(new URL('orbix-clipboard.js', source).href);
          const ok = await copyText(p.orbix_token);
          window.clearTimeout(reset);
          address.textContent = ok ? '✓ Copied' : 'Copy failed';
          status.textContent = ok ? 'ORBIX contract address copied.' : 'Copy failed. The full contract address is shown below for manual copying.';
          let fallback = strip.querySelector('.op-copy-fallback');
          if (!ok && !fallback) { fallback = document.createElement('input'); fallback.className = 'op-copy-fallback'; fallback.readOnly = true; fallback.value = p.orbix_token; fallback.setAttribute('aria-label', 'ORBIX contract address for manual copy'); fallback.style.cssText = 'width:100%;min-height:44px;padding:10px;color:#fff;background:#121416;border:1px solid #69d9c8;order:5;font:11px monospace'; strip.append(fallback); fallback.select(); }
          reset = window.setTimeout(() => { address.textContent = p.orbix_token.slice(0, 6) + '…' + p.orbix_token.slice(-4); }, 2400);
        } catch { status.textContent = 'Copy unavailable. Please try again.'; }
      };
      const buy = document.createElement('a'); buy.className = 'op-buy'; buy.href = p.promo_link; buy.textContent = 'Buy $ORBIX'; buy.target = '_blank'; buy.rel = 'noopener noreferrer'; buy.setAttribute('aria-label', 'Buy $ORBIX (opens in a new tab)'); buy.append(icon('M7 17 17 7M7 7h10v10')); actions.append(copy, buy);
      const controls = document.createElement('div'); controls.className = 'op-controls';
      const pause = button('op-control op-pause', 'Pause promo animation', 'M8 5v14M16 5v14'); pause.setAttribute('aria-pressed', 'false');
      pause.onclick = () => { const paused = strip.classList.toggle('op-paused'); pause.setAttribute('aria-pressed', String(paused)); pause.setAttribute('aria-label', paused ? 'Resume promo animation' : 'Pause promo animation'); pause.replaceChildren(icon(paused ? 'm8 5 11 7-11 7z' : 'M8 5v14M16 5v14')); };
      const close = button('op-control op-close', 'Dismiss ORBIX promotion for this session', 'm6 6 12 12M6 18 18 6');
      close.onclick = () => { window.clearTimeout(reset); strip.remove(); style.remove(); try { sessionStorage.setItem(key, '1'); } catch {} };
      controls.append(pause, close); strip.append(brand, message, actions, controls, status); document.head.append(style); document.body.prepend(strip);
    } catch { /* Promotion availability never blocks the app. */ }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, {once: true}); else void render();
})();
