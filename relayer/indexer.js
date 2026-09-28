#!/usr/bin/env node
/**
 * Orbix indexer (task I1-I8, D4) — plain Node, zero dependencies.
 * Polls eth_getLogs on chain 46630 for LaunchCreated, Locked, Deposit, Withdraw,
 * Harvest, PairCreated. Durable state in relayer/state.json (idempotent cursor by
 * block number). REST API on :8311.
 *
 * Bridge stays lock-only: there is intentionally NO unlock endpoint anywhere here.
 *
 * Env: PORT (default 8311), RPC (default testnet RPC), STATE_FILE, LAUNCHPAD
 * (resolved dynamically if not set), CHAIN_ID.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const RPC = process.env.RPC || 'https://rpc.testnet.chain.robinhood.com';
const PORT = parseInt(process.env.PORT || '8311', 10);
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '46630', 10);
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const CACHE_TTL_MS = 10 * 1000;
const POLL_INTERVAL_MS = 6 * 1000;
const MAX_BLOCK_RANGE = 20000;

const ADDRESSES = {
  bridgeOut: (process.env.BRIDGE || '0x44e46ee9E3e900a018d1e2A6B969Af008720f4B2').toLowerCase(),
  factory: (process.env.FACTORY || '0x0229c777527CA7750b6b27b91e3F422BE70C8351').toLowerCase(),
  router: (process.env.ROUTER || '0x8979aE333d624b6fCf580D22ba1D0EF179aC0691').toLowerCase(),
  masterChef: (process.env.MASTERCHEF || '0xd79a78c40a36babf112502fa3dac78c308293f3d').toLowerCase(),
  launchpad: (process.env.LAUNCHPAD || '').toLowerCase() || null, // resolved dynamically
};

// keccak256 of event signatures (verified with cast keccak + on-chain log match)
const TOPICS = {
  LaunchCreated: '0x5bb6c0aba37abf86cae838a8cdced16e624714f69969478e55fd8c878f0af268',
  Locked: '0xf54b087fd0c493db18511f5ee013299107a5a8ee1a09cdca7c468d2080218aee',
  Deposit: '0x90890809c654f11d6e72a28fa60149770a0d11ec6c92319d6ceb2bb0a4ea1a15',
  Withdraw: '0xf279e6a1f5e320cca91135676d9cb6e44ca8a08c0b88342bcdb1144f6511b568',
  Harvest: '0xc9695243a805adb74c91f28311176c65b417e842d5699893cef56d18bfa48cba',
  PairCreated: '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9',
};

// topic0 -> parser. Parsers receive {log} and return a normalized event object.
const PARSERS = {
  [TOPICS.LaunchCreated]: (log) => ({
    type: 'LaunchCreated',
    launchId: '0x' + log.topics[1].slice(-64),
    creator: topicAddr(log.topics[2]),
    token: topicAddr(log.topics[3]),
    collateral: word(log.data, 0),
    pair: word(log.data, 1),
    txHash: log.transactionHash,
    blockNumber: parseInt(log.blockNumber, 16),
  }),
  [TOPICS.Locked]: (log) => ({
    type: 'Locked',
    user: topicAddr(log.topics[1]),
    amount: '0x' + log.data.slice(2, 66),
    nonce: parseInt(log.data.slice(66, 130), 16),
    id: log.data.slice(130, 194) === '' ? null : '0x' + log.data.slice(130, 194),
    txHash: log.transactionHash,
    blockNumber: parseInt(log.blockNumber, 16),
  }),
  [TOPICS.Deposit]: (log) => ({
    type: 'Deposit',
    user: topicAddr(log.topics[1]),
    pid: parseInt(log.topics[2], 16),
    amount: '0x' + log.data.slice(2, 66),
    txHash: log.transactionHash,
    blockNumber: parseInt(log.blockNumber, 16),
  }),
  [TOPICS.Withdraw]: (log) => ({
    type: 'Withdraw',
    user: topicAddr(log.topics[1]),
    pid: parseInt(log.topics[2], 16),
    amount: '0x' + log.data.slice(2, 66),
    txHash: log.transactionHash,
    blockNumber: parseInt(log.blockNumber, 16),
  }),
  [TOPICS.Harvest]: (log) => ({
    type: 'Harvest',
    user: topicAddr(log.topics[1]),
    amount: '0x' + log.data.slice(2, 66),
    txHash: log.transactionHash,
    blockNumber: parseInt(log.blockNumber, 16),
  }),
  [TOPICS.PairCreated]: (log) => ({
    type: 'PairCreated',
    token0: topicAddr(log.topics[1]),
    token1: topicAddr(log.topics[2]),
    pair: word(log.data, 0),
    allPairsLength: parseInt(log.data.slice(66, 130) || '0x0', 16),
    txHash: log.transactionHash,
    blockNumber: parseInt(log.blockNumber, 16),
  }),
};

const TOPIC0_TO_NAME = {};
for (const [name, t] of Object.entries(TOPICS)) TOPIC0_TO_NAME[t.toLowerCase()] = name;

function topicAddr(t) { return t ? '0x' + t.slice(-40) : null; }
function word(dataHex, i) {
  const d = dataHex.startsWith('0x') ? dataHex.slice(2) : dataHex;
  const w = d.slice(i * 64, (i + 1) * 64);
  return w ? '0x' + w : null;
}

// ---------------- JSON-RPC with browser UA + backoff on 403 ----------------
let rpcHealthy = true;
let consecutiveFailures = 0;
const backoffDelays = [1, 2, 5, 10, 30, 60]; // seconds

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(RPC);
    const req = require('https').request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        // RPC 403s non-browser clients — must look like a browser
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Origin': 'https://orbix.testnet.chain.robinhood.com',
        'Referer': 'https://orbix.testnet.chain.robinhood.com/',
      },
      timeout: 20000,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode === 403) {
          const err = new Error(`RPC 403 Forbidden (${method})`);
          err.status = 403;
          return reject(err);
        }
        if (res.statusCode !== 200) {
          const err = new Error(`RPC HTTP ${res.statusCode} (${method})`);
          err.status = res.statusCode;
          return reject(err);
        }
        try {
          const j = JSON.parse(buf);
          if (j.error) { const e = new Error('RPC error: ' + JSON.stringify(j.error)); e.rpc = true; return reject(e); }
          resolve(j.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('RPC timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------- Durable state ----------------
const MAX_EVENTS_PER_TYPE = 5000;

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      cursor: s.cursor || 0,                 // last fully processed block
      launches: s.launches || [],            // launchId -> summary
      pairs: s.pairs || [],
      activity: s.activity || [],            // normalized event feed (newest first)
      bridge: s.bridge || { totalLocked: '0', lockCount: 0, locks: [] },
      staking: s.staking || { deposits: 0, withdraws: 0, harvests: 0 },
      seenTx: s.seenTx || {},                // txHash+logIndex dedupe (idempotency)
      startedAt: s.startedAt || new Date().toISOString(),
    };
  } catch {
    return {
      cursor: 0, launches: [], pairs: [], activity: [],
      bridge: { totalLocked: '0', lockCount: 0, locks: [] },
      staking: { deposits: 0, withdraws: 0, harvests: 0 },
      seenTx: {}, startedAt: new Date().toISOString(),
    };
  }
}

let state = loadState();

function saveState() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, STATE_FILE);
}

function trim(arr, n) { if (arr.length > n) arr.length = n; }

function pushActivity(ev) {
  state.activity.unshift({ ...ev, ts: Math.floor(Date.now() / 1000) });
  trim(state.activity, MAX_EVENTS_PER_TYPE);
}

// ---------------- Log processing (idempotent by block + tx+logIndex) ----------------
function processLogs(logs) {
  let processed = 0;
  for (const log of logs) {
    const t0 = (log.topics && log.topics[0] || '').toLowerCase();
    const name = TOPIC0_TO_NAME[t0];
    if (!name) continue;
    const key = (log.transactionHash || '') + ':' + (log.logIndex || '0');
    if (state.seenTx[key]) continue; // idempotent replay guard
    state.seenTx[key] = 1;
    const parser = PARSERS[t0];
    let ev;
    try { ev = parser(log); } catch (e) { console.error('[indexer] parse fail', name, e.message); continue; }
    processed++;
    pushActivity(ev);

    if (name === 'LaunchCreated') {
      state.launches.unshift({
        launchId: ev.launchId, creator: ev.creator, token: ev.token,
        collateral: ev.collateral, pair: ev.pair,
        txHash: ev.txHash, blockNumber: ev.blockNumber,
      });
      trim(state.launches, 1000);
    } else if (name === 'PairCreated') {
      state.pairs.unshift({ pair: ev.pair, token0: ev.token0, token1: ev.token1, blockNumber: ev.blockNumber, txHash: ev.txHash });
      trim(state.pairs, 1000);
    } else if (name === 'Locked') {
      state.bridge.lockCount += 1;
      state.bridge.totalLocked = (BigInt(state.bridge.totalLocked) + BigInt(ev.amount)).toString();
      state.bridge.locks.unshift({ user: ev.user, amount: ev.amount, nonce: ev.nonce, id: ev.id, txHash: ev.txHash, blockNumber: ev.blockNumber });
      trim(state.bridge.locks, 1000);
    } else if (name === 'Deposit') state.staking.deposits += 1;
    else if (name === 'Withdraw') state.staking.withdraws += 1;
    else if (name === 'Harvest') state.staking.harvests += 1;
  }
  return processed;
}

// ---------------- Launchpad discovery ----------------
async function resolveLaunchpad() {
  if (ADDRESSES.launchpad) return ADDRESSES.launchpad;
  // Dynamically probe: check whether the known launchpad has code on chain.
  const candidates = (process.env.LAUNCHPAD_CANDIDATES || '').split(',').filter(Boolean);
  for (const c of candidates) {
    const addr = c.trim().toLowerCase();
    try {
      const code = await rpcCall('eth_getCode', [addr, 'latest']);
      if (code && code !== '0x') { ADDRESSES.launchpad = addr; console.log('[indexer] launchpad resolved:', addr); return addr; }
    } catch (e) { /* retry later */ }
  }
  return null;
}

// ---------------- Polling loop (single upstream loop) ----------------
async function pollOnce() {
  const head = parseInt(await rpcCall('eth_blockNumber', []), 16);
  if (!state.cursor) state.cursor = Math.max(0, head - parseInt(process.env.INITIAL_BLOCKS || '400000', 10));
  const from = state.cursor + 1;
  const to = Math.min(head, from + MAX_BLOCK_RANGE - 1);
  if (from > head) return;

  const filters = [];
  const addrs = [ADDRESSES.bridgeOut, ADDRESSES.factory, ADDRESSES.masterChef];
  if (ADDRESSES.launchpad) addrs.push(ADDRESSES.launchpad);
  const lp = ADDRESSES.launchpad;
  // Batch: one getLogs per contract group (topics OR'ed), capped range
  filters.push({ fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), address: addrs, topics: [Object.values(TOPICS)] });

  for (const f of filters) {
    const logs = await rpcCall('eth_getLogs', [f]);
    if (logs && logs.length) processLogs(logs);
  }
  state.cursor = to;
  state.lastHead = head;
  state.lastPollAt = new Date().toISOString();
}

let polling = false;
async function pollLoop() {
  if (polling) return;
  polling = true;
  try {
    if (!ADDRESSES.launchpad) await resolveLaunchpad();
    await pollOnce();
    rpcHealthy = true;
    consecutiveFailures = 0;
    saveState();
  } catch (e) {
    consecutiveFailures++;
    rpcHealthy = false;
    const delay = backoffDelays[Math.min(consecutiveFailures - 1, backoffDelays.length - 1)];
    console.error(`[indexer] poll error (${consecutiveFailures} consecutive): ${e.message} — backoff ${delay}s`);
    if (e.status === 403) state.lastError = 'RPC 403 — backing off, will retry';
    else state.lastError = e.message;
    await sleep(delay * 1000);
  } finally {
    polling = false;
  }
}

function startLoop() {
  const tick = async () => {
    await pollLoop();
    setTimeout(tick, POLL_INTERVAL_MS);
  };
  tick();
}

// ---------------- REST API with 10s cache ----------------
let cache = { ts: 0, data: {} };

function apiCache(key, builder) {
  const now = Date.now();
  if (now - cache.ts > CACHE_TTL_MS) { cache.ts = now; cache.data = {}; }
  if (!(key in cache.data)) cache.data[key] = builder();
  return cache.data[key];
}

function sumBig(hexStrs) {
  try { return hexStrs.reduce((a, h) => a + BigInt(h), 0n).toString(); } catch { return '0'; }
}

function buildLaunches() {
  return apiCache('launches', () => ({
    chainId: CHAIN_ID,
    count: state.launches.length,
    launchpad: ADDRESSES.launchpad,
    launches: state.launches,
  }));
}

function buildActivity() {
  return apiCache('activity', () => ({
    count: state.activity.length,
    cursor: state.cursor,
    activity: state.activity.slice(0, 500),
  }));
}

function buildBridgeStats() {
  return apiCache('bridge', () => {
    const locks = state.bridge.locks;
    const users = new Set(locks.map((l) => (l.user || '').toLowerCase()));
    return {
      mode: 'lock-only', // D5: settlement not live; NO unlock capability exposed
      destinationSettlementLive: false,
      note: 'Bridge is lock-only. Destination settlement is NOT live. Funds remain locked on source chain.',
      contract: ADDRESSES.bridgeOut,
      chainId: CHAIN_ID,
      totalLockedWei: state.bridge.totalLocked,
      totalLocked: (Number(BigInt(state.bridge.totalLocked)) / 1e18).toFixed(4) + ' FREE',
      lockCount: state.bridge.lockCount,
      uniqueLockers: users.size,
      lastLocks: locks.slice(0, 25),
    };
  });
}

function buildHealth() {
  return apiCache('health', () => ({
    ok: true,
    chainId: CHAIN_ID,
    rpc: RPC,
    rpcHealthy,
    headBlock: state.lastHead || null,
    cursor: state.cursor,
    cursorLag: state.lastHead ? state.lastHead - state.cursor : null,
    launchpad: ADDRESSES.launchpad,
    eventsIndexed: state.activity.length,
    lastError: state.lastError || null,
    startedAt: state.startedAt,
    uptimeSec: Math.floor(process.uptime()),
  }));
}

function buildStaking() {
  return apiCache('staking', () => ({
    contract: ADDRESSES.masterChef,
    deposits: state.staking.deposits,
    withdraws: state.staking.withdraws,
    harvests: state.staking.harvests,
  }));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const send = (code, obj) => {
    const body = JSON.stringify(obj, null, 2);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  try {
    if (p === '/api/health' || p === '/health') return send(200, buildHealth());
    if (p === '/api/launches') return send(200, buildLaunches());
    if (p === '/api/activity') return send(200, buildActivity());
    if (p === '/api/bridge/stats' || p === '/api/bridge') return send(200, buildBridgeStats());
    if (p === '/api/staking') return send(200, buildStaking());
    return send(404, { error: 'not found', endpoints: ['/api/launches', '/api/activity', '/api/bridge/stats', '/api/staking', '/api/health'] });
  } catch (e) {
    console.error('[indexer] api error', e);
    return send(500, { error: 'internal error' });
  }
});

function shutdown(sig) {
  console.log(`[indexer] ${sig} — saving state and closing`);
  try { saveState(); } catch (e) { console.error('[indexer] save on shutdown failed', e.message); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => { console.error('[indexer] uncaught', e); try { saveState(); } catch {} });
process.on('unhandledRejection', (e) => console.error('[indexer] unhandledRejection', e));

server.listen(PORT, () => {
  console.log(`[indexer] REST on :${PORT}  state=${STATE_FILE}`);
  console.log(`[indexer] RPC=${RPC} chain=${CHAIN_ID}`);
  console.log('[indexer] bridge is LOCK-ONLY: no unlock endpoint exists.');
  startLoop();
});
