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
#orbix-promo{position:relative;z-index:80;box-sizing:border-box;width:100%;overflow:hidden;background:#372356;color:#fff;font:14px/1.4 system-ui;padding:8px 100px 8px 12px}
#orbix-promo *{box-sizing:border-box;min-width:0}#orbix-promo .op-message{overflow:hidden;width:100%}#orbix-promo .op-track{display:flex;align-items:center;gap:18px;width:max-content;white-space:nowrap;animation:orbix-promo-run 16s linear infinite}#orbix-promo .op-buy{color:#fbe28e;font-weight:800}#orbix-promo .op-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px}#orbix-promo .op-copy{display:inline-flex;align-items:center;gap:8px;padding:0 8px;font:12px/1.4 system-ui;background:transparent;color:#fff;border:1px solid #cfc3e9;border-radius:8px;min-height:44px;cursor:pointer}#orbix-promo .op-ca{font:12px monospace;overflow-wrap:anywhere}#orbix-promo .op-controls{position:absolute;right:3px;top:3px;display:flex}#orbix-promo .op-control{display:grid;place-items:center;min-width:44px;min-height:44px;background:transparent;color:#fff;border:1px solid #cfc3e9;border-radius:8px;cursor:pointer}#orbix-promo svg{flex-shrink:0}#orbix-promo :is(button,a):focus-visible{outline:3px solid #fbe28e;outline-offset:2px}#orbix-promo:hover .op-track,#orbix-promo:focus-within .op-track,#orbix-promo.op-paused .op-track{animation-play-state:paused}#orbix-promo .op-status{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden}
@keyframes orbix-promo-run{from{transform:translateX(-100%)}to{transform:translateX(90vw)}}
@media(max-width:600px){#orbix-promo{padding-right:12px;padding-top:50px}#orbix-promo .op-copy{max-width:100%;flex-wrap:wrap;gap:5px;padding:8px}#orbix-promo .op-ca{font-size:10px}}
@media(prefers-reduced-motion:reduce){#orbix-promo .op-track{animation:none;white-space:normal;flex-wrap:wrap;gap:6px;width:auto}#orbix-promo .op-pause{display:none}}
`;
      const strip = document.createElement('aside'); strip.id = 'orbix-promo'; strip.setAttribute('aria-label', 'Buy ORBIX');
      const message = document.createElement('div'); message.className = 'op-message';
      const track = document.createElement('div'); track.className = 'op-track';
      const buy = document.createElement('a'); buy.className = 'op-buy'; buy.href = p.promo_link; buy.textContent = 'Buy $ORBIX'; buy.target = '_blank'; buy.rel = 'noopener noreferrer'; buy.setAttribute('aria-label', 'Buy $ORBIX (opens in a new tab)');
      const text = document.createElement('span');
      const configuredText = p.promo_text?.trim();
      text.textContent = !configuredText || /^buy\s+\$?orbix$/i.test(configuredText) ? '' : configuredText;
      track.append(buy, text); message.append(track);
      const actions = document.createElement('div'); actions.className = 'op-actions';
      const copy = button('op-copy', 'Copy ORBIX token contract address', 'M9 9h11v11H9z M5 15H3V3h12v2');
      copy.title = p.orbix_token;
      const caLabel = document.createElement('span'); caLabel.className = 'op-ca-label'; caLabel.textContent = 'ORBIX CA';
      const address = document.createElement('span'); address.className = 'op-ca'; address.translate = false; address.textContent = p.orbix_token;
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
          if (!ok && !fallback) { fallback = document.createElement('input'); fallback.className = 'op-copy-fallback'; fallback.readOnly = true; fallback.value = p.orbix_token; fallback.setAttribute('aria-label', 'ORBIX contract address for manual copy'); fallback.style.cssText = 'width:100%;min-height:44px;padding:10px;color:#fff;background:#372356;border:1px solid #cfc3e9;order:5;font:11px monospace'; strip.append(fallback); fallback.select(); }
          reset = window.setTimeout(() => { address.textContent = p.orbix_token; }, 2400);
        } catch { status.textContent = 'Copy unavailable. Please try again.'; }
      };
      actions.append(copy);
      const controls = document.createElement('div'); controls.className = 'op-controls';
      const pause = button('op-control op-pause', 'Pause promo animation', 'M8 5v14M16 5v14'); pause.setAttribute('aria-pressed', 'false');
      pause.onclick = () => { const paused = strip.classList.toggle('op-paused'); pause.setAttribute('aria-pressed', String(paused)); pause.setAttribute('aria-label', paused ? 'Resume promo animation' : 'Pause promo animation'); pause.replaceChildren(icon(paused ? 'm8 5 11 7-11 7z' : 'M8 5v14M16 5v14')); };
      const close = button('op-control op-close', 'Dismiss ORBIX promotion for this session', 'm6 6 12 12M6 18 18 6');
      close.onclick = () => { window.clearTimeout(reset); strip.remove(); style.remove(); try { sessionStorage.setItem(key, '1'); } catch {} };
      controls.append(pause, close); strip.append(message, actions, controls, status); document.head.append(style); document.body.prepend(strip);
    } catch { /* Promotion availability never blocks the app. */ }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, {once: true}); else void render();
})();
