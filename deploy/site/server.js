// Orbix Core site + Center SPA mount.
//
// The cockpit (swap/bridge/pools/launch/NFT) stays at /.
// The Center (creator game platform) is mounted at /center and its API at /api/center,
// proxied to the orbix-center service. One origin, so the browser never sees a CORS
// preflight and WebSocket upgrades pass straight through.
const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const PORT = process.env.PORT || 8080;

// The Center backend. Inside Railway the private network resolves the service by name;
// CENTER_INTERNAL_URL lets a deployment override that (local dev points at localhost).
const CENTER_TARGET =
  process.env.CENTER_INTERNAL_URL ||
  process.env.CENTER_TARGET ||
  'http://orbix-center.railway.internal:8080';

// --- Center API + realtime -------------------------------------------------
// Mounted at the ROOT with a pathFilter (not app.use('/api/center', mw)): mounting on a
// path makes Express strip that prefix before the proxy sees it, which forwarded
// /api/center/v1/health as /v1/health and returned 404.
const centerProxy = createProxyMiddleware({
  pathFilter: '/api/center',
  target: CENTER_TARGET,
  changeOrigin: true,
  ws: true,
  on: {
    error: (err, _req, res) => {
      console.error('[center-proxy]', err.message);
      if (res && 'writeHead' in res && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      if (res && 'end' in res) res.end(JSON.stringify({ error: 'CENTER_PROXY_UNAVAILABLE' }));
    },
  },
});
app.use(centerProxy);

// --- Center SPA (prebuilt dist, built with base "/center/") -----------------
const centerDist = process.env.CENTER_DIST_DIR || path.join(__dirname, 'center-dist');

// Serve /center directly (no redirect hop), then its assets, then SPA deep links.
app.get('/center', (_req, res) => res.sendFile(path.join(centerDist, 'index.html')));
app.use('/center', express.static(centerDist, { maxAge: '1h' }));
app.get('/center/*', (_req, res) => res.sendFile(path.join(centerDist, 'index.html')));

// --- cockpit (unchanged) ---------------------------------------------------
app.use(express.static(__dirname, { maxAge: '1h' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'orbixcore-site' }));
app.get('/api-base', (_req, res) => res.json({ hunt: process.env.HUNT_URL || null }));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const server = app.listen(PORT, () => console.log(`[orbixcore-site] listening on :${PORT}`));
// WebSocket upgrade for /api/center/ws/* must be handed to the proxy explicitly.
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/api/center')) {
    centerProxy.upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});
