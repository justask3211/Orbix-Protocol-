#!/usr/bin/env node
// Staking backend API — read-only views over the deployed OrbixMasterChef (K1/K2 backend).
// Plain Node http, zero deps. Port 8310. Cache: 15s per (endpoint+key).
//
// Endpoints:
//   GET /api/staking/pools           -> poolLength + poolInfo for each pool
//   GET /api/staking/user?address=X  -> staked per pool + pendingEco + pendingRewards
//   GET /api/health                  -> rpc reachability + block height + cache stats
'use strict';

const http = require('http');
const url = require('url');

const RPC_URL = process.env.STAKING_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
const PORT = parseInt(process.env.STAKING_API_PORT || '8310', 10);
const CHEF = (process.env.CHEF_ADDRESS || '0xd79a78c40a36babf112502fa3dac78c308293f3d').toLowerCase();
const ECO = (process.env.ECO_ADDRESS || '0xC3D3f769441e60F6e8A3D022fA8f55b0c8c432c3').toLowerCase();
const CACHE_TTL_MS = parseInt(process.env.STAKING_CACHE_TTL_MS || '15000', 10);
// This RPC 403s default curl UA — always present a browser User-Agent.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---- ABI selectors (keccak4, precomputed) -----------------------------------
const SIGS = {
  poolLength: '0x081e3eda',                     // poolLength()
  poolInfo: '0x1526fe27',                       // poolInfo(uint256)
  staked: '0x8f169816',                         // staked(address,uint256)
  pendingEco: '0x12c3a740',                     // pendingEco(uint256,address)
  pendingRewards: '0x31d7a262',                 // pendingRewards(address)
  ecoPerBlock: '0xa86841c7',                    // ecoPerBlock()
  totalAllocPoint: '0x17caf6f1',                // totalAllocPoint()
  balanceOf: '0x70a08231',                      // balanceOf(address)
};
// NB: selectors below are verified at startup via `cast sig` in tooling; if a
// call reverts with a selector mismatch, recompute. staked(address,uint256)
// pendingRewards(address) etc. computed with keccak in build step.

// ---- JSON-RPC ---------------------------------------------------------------
let rpcId = 1;
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params });
    const u = new URL(RPC_URL);
    const lib = u.protocol === 'https:' ? require('https') : http;
    const req = lib.request(
      { hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                   'User-Agent': UA, Accept: 'application/json' },
        timeout: 10000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`RPC HTTP ${res.statusCode}`));
          try {
            const j = JSON.parse(data);
            if (j.error) return reject(new Error('RPC error: ' + JSON.stringify(j.error)));
            resolve(j.result);
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('RPC timeout')));
    req.write(body);
    req.end();
  });
}

function ethCall(to, data) { return rpc('eth_call', [{ to, data }, 'latest']); }
function blockNumber() { return rpc('eth_blockNumber', []); }

// ---- ABI decoding helpers ---------------------------------------------------
function strip0x(s) { return s.startsWith('0x') ? s.slice(2) : s; }
function dec(hex) { return BigInt('0x' + strip0x(hex || '0')); }
function addrFromWord(word) { return '0x' + strip0x(word).slice(24, 64).toLowerCase(); }
function fmtUnits(v, decimals = 18n) {
  let s = v.toString();
  if (decimals === 0n) return s;
  while (s.length <= decimals) s = '0' + s;
  return s.slice(0, s.length - Number(decimals)) + '.' + s.slice(s.length - Number(decimals));
}

// ---- Cache ------------------------------------------------------------------
const cache = new Map();
function cached(key, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.t < CACHE_TTL_MS) return Promise.resolve({ ...hit.v, _cached: true });
  return fn().then((v) => { cache.set(key, { t: now, v }); return { ...v, _cached: false }; });
}
function cacheStats() {
  const now = Date.now();
  let fresh = 0;
  for (const v of cache.values()) if (now - v.t < CACHE_TTL_MS) fresh++;
  return { entries: cache.size, fresh };
}

// ---- Domain reads -----------------------------------------------------------
async function readPool(pid) {
  const data = SIGS.poolInfo + pid.toString(16).padStart(64, '0');
  const res = await ethCall(CHEF, data);
  const w = strip0x(res);
  const words = [];
  for (let i = 0; i < w.length; i += 64) words.push(w.slice(i, i + 64));
  // struct Pool { stakingToken, allocPoint, lastRewardBlock, accEcoPerShare }
  return {
    pid,
    stakingToken: addrFromWord(words[0]),
    allocPoint: dec(words[1]).toString(),
    lastRewardBlock: dec(words[2]).toString(),
    accEcoPerShare: dec(words[3]).toString(),
  };
}

async function readPools() {
  const lenRes = await ethCall(CHEF, SIGS.poolLength);
  const poolLength = Number(dec(lenRes));
  const pools = await Promise.all(Array.from({ length: poolLength }, (_, i) => readPool(i)));
  const [ecoPerBlockRes, totalAllocRes, bn] = await Promise.all([
    ethCall(CHEF, SIGS.ecoPerBlock), ethCall(CHEF, SIGS.totalAllocPoint), blockNumber(),
  ]);
  return {
    chef: CHEF,
    poolLength,
    ecoPerBlock: dec(ecoPerBlockRes).toString(),
    totalAllocPoint: dec(totalAllocRes).toString(),
    block: Number(dec(bn)),
    pools,
  };
}

async function readUser(address) {
  const a = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) throw Object.assign(new Error('invalid address'), { status: 400 });
  const poolsRes = await ethCall(CHEF, SIGS.poolLength);
  const poolLength = Number(dec(poolsRes));
  const bn = dec(await blockNumber());
  const perPool = await Promise.all(
    Array.from({ length: poolLength }, async (_, pid) => {
      const pidHex = pid.toString(16).padStart(64, '0');
      const padAddr = a.slice(2).padStart(64, '0');
      const [stakedRes, pendingRes] = await Promise.all([
        ethCall(CHEF, SIGS.staked + padAddr + pidHex),
        ethCall(CHEF, SIGS.pendingEco + pidHex + padAddr),
      ]);
      return {
        pid,
        staked: dec(stakedRes).toString(),
        stakedFormatted: fmtUnits(dec(stakedRes)),
        pendingEco: dec(pendingRes).toString(),
        pendingEcoFormatted: fmtUnits(dec(pendingRes)),
      };
    })
  );
  const pendingRewardsRes = await ethCall(CHEF, SIGS.pendingRewards + a.slice(2).padStart(64, '0'));
  return {
    address: a,
    chef: CHEF,
    block: Number(bn),
    pendingRewards: dec(pendingRewardsRes).toString(),
    pendingRewardsFormatted: fmtUnits(dec(pendingRewardsRes)),
    positions: perPool,
  };
}

async function readHealth() {
  const t0 = Date.now();
  const bn = dec(await blockNumber());
  return { status: 'ok', rpc: RPC_URL, block: Number(bn), rpcLatencyMs: Date.now() - t0, cache: cacheStats() };
}

// ---- HTTP server ------------------------------------------------------------
function send(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL_MS / 1000}` });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const route = u.pathname.replace(/\/+$/, '');
  Promise.resolve()
    .then(async () => {
      if (route === '/api/health') return send(res, 200, await cached('health', readHealth));
      if (route === '/api/staking/pools') return send(res, 200, await cached('pools', readPools));
      if (route === '/api/staking/user') {
        const address = (u.query.address || '').trim();
        if (!address) return send(res, 400, { error: 'missing ?address=0x...' });
        return send(res, 200, await cached('user:' + address.toLowerCase(), () => readUser(address)));
      }
      return send(res, 404, { error: 'not found', routes: ['/api/staking/pools', '/api/staking/user?address=', '/api/health'] });
    })
    .catch((e) => send(res, e.status || 502, { error: e.message }));
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`staking-api listening on :${PORT} (rpc=${RPC_URL} chef=${CHEF})`));
}
module.exports = { server, readPools, readUser, readHealth };
