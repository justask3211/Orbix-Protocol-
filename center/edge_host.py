"""Cloudflare host policy and signed capabilities. No remote financial authority."""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from fastapi import HTTPException

REALTIME = frozenset({'token-catch', 'combat-duel', 'boss-raid'})


def preferred_host(store, template_id):
    return (store.get_setting(f'game-config:{template_id}') or {}).get('host', 'cloudflare' if template_id=='token-catch' and runtime_ready() else 'railway')


def room_host(store, room_id):
    return (store.get_setting(f'room-host:{room_id}') or {}).get('host', 'railway')


def require_publish_host(store, config):
    host = preferred_host(store, config.template_id)
    if host == 'cloudflare':
        if config.template_id not in REALTIME or getattr(config.rules, 'world_version', 0) != 4:
            raise HTTPException(409, detail={'code': 'CLOUDFLARE_V4_ONLY', 'message': 'Cloudflare hosting is restricted to the three V4 multiplayer worlds.'})
        if not runtime_ready():
            raise HTTPException(409, detail={'code': 'CLOUDFLARE_RUNTIME_NOT_READY', 'message': 'Configure Cloudflare activation and matching ticket, provisioning and result secrets before publishing. Choose Railway to publish now.'})
    return host


def signed_ticket(secret, who, room_id, round_id, role='player', now=None, nonce=None):
    if len(secret) < 32 or not re.fullmatch(r'0x[0-9a-f]{40}', who) or role not in {'player', 'spectator'}:
        raise ValueError('Invalid edge ticket configuration')
    now = int(time.time() if now is None else now)
    claims = {'v': 1, 'iss': 'orbix-center', 'aud': 'orbix-multiplayer', 'sub': who, 'room': room_id,
              'round': round_id, 'role': role, 'iat': now, 'exp': now + 120, 'nonce': nonce or secrets.token_hex(16)}
    payload = base64.urlsafe_b64encode(json.dumps(claims, sort_keys=True, separators=(',', ':')).encode()).decode().rstrip('=')
    mac = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return payload + '.' + mac


def provisioning_signature(secret, path, body, timestamp=None, nonce=None):
    if len(secret) < 32:
        raise ValueError('Provisioning secret must contain at least 32 characters')
    timestamp = str(int(time.time() if timestamp is None else timestamp))
    nonce = nonce or secrets.token_hex(16)
    message = f'orbix/provision/v1\n{path}\n{timestamp}\n{nonce}\n{hashlib.sha256(body.encode()).hexdigest()}'
    mac = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {'X-Orbix-Time': timestamp, 'X-Orbix-Nonce': nonce, 'X-Orbix-Signature': mac}


def runtime_ready():
    import os
    return os.getenv('CENTER_CF_ENABLED') == 'true' and all(len(os.getenv(k, '')) >= 32 for k in
        ('CENTER_EDGE_TICKET_SECRET', 'CENTER_CF_PROVISION_SECRET', 'CENTER_CF_RESULT_SECRET'))


def worker_origin():
    import os
    value = os.getenv('CENTER_CF_ORIGIN', 'https://multiplayer.justask3211.workers.dev').rstrip('/')
    from urllib.parse import urlsplit
    url = urlsplit(value)
    if url.scheme != 'https' or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError('INVALID_CLOUDFLARE_ORIGIN')
    return value


async def provision_runtime(rt):
    """Idempotently activate the committed initial snapshot; never change a running bootstrap."""
    import os
    import httpx
    from center.games.arena import CHARACTERS
    key = f'edge-bootstrap:{rt.round_id}'
    bootstrap = rt.store.get_setting(key)
    if not bootstrap:
        row = rt.store.get_room(rt.room_id)
        bootstrap = dict(roomId=rt.room_id, roundId=rt.round_id, configHash=row['config_hash'],
                         seed=rt.seed, participants=rt.engine.participants, config=rt.config.model_dump(mode='json'),
                         snapshot=rt.engine.snapshot(), characters=list(CHARACTERS), commitHash=rt.commit, owner=rt.owner, settings=rt.community.public_settings(rt.room_id))
        rt.store.set_setting(key, bootstrap)
    path = f'/internal/rooms/{rt.room_id}/provision'
    body = json.dumps(bootstrap, separators=(',', ':'))
    headers = provisioning_signature(os.environ['CENTER_CF_PROVISION_SECRET'], path, body)
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(worker_origin()+path, content=body, headers={**headers, 'Content-Type':'application/json'})
        response.raise_for_status()
        if not response.json().get('ready'):
            raise ValueError('CLOUDFLARE_RUNTIME_NOT_READY')
    rt.store.set_setting(f'edge-active:{rt.round_id}', {'active': True})
    await rt.hub.broadcast(rt.room_id, {'v':1, 'type':'transport.switch', 'roundId':rt.round_id})


def edge_transport(rt, who):
    import os
    if room_host(rt.store, rt.room_id) != 'cloudflare' or not rt.round_id or rt.status != 'running':
        return None
    if not (rt.store.get_setting(f'edge-active:{rt.round_id}') or {}).get('active'):
        return None
    member = next((p for p in rt.store.participants(rt.room_id) if p['who']==who), None)
    if not member or member['role'] not in {'player','spectator'}:
        return None
    if member['role']=='player' and who not in rt.engine.participants:
        return None
    return {'ticket':signed_ticket(os.environ['CENTER_EDGE_TICKET_SECRET'], who, rt.room_id, rt.round_id, role=member['role']),
            'websocketUrl':worker_origin().replace('https://', 'wss://')+f'/multiplayer/v1/ws/rooms/{rt.room_id}'}


def verify_result_signature(secret, path, body, headers, now=None):
    now = int(time.time() if now is None else now)
    stamp, nonce, signature = (headers.get(k, '') for k in ('x-orbix-time','x-orbix-nonce','x-orbix-signature'))
    if len(secret)<32 or not re.fullmatch(r'\d{1,12}',stamp) or abs(int(stamp)-now)>30 or not re.fullmatch(r'[0-9a-f]{32}',nonce):
        raise ValueError('BAD_RESULT_SIGNATURE')
    message = f'orbix/result/v1\n{path}\n{stamp}\n{nonce}\n{hashlib.sha256(body).hexdigest()}'
    if not hmac.compare_digest(signature, hmac.new(secret.encode(),message.encode(),hashlib.sha256).hexdigest()):
        raise ValueError('BAD_RESULT_SIGNATURE')
    return nonce


def compare_snapshot(expected, actual, path='snapshot'):
    """IEEE-754 rounding may differ; integers, object sets and RNG bytes must be exact."""
    import math
    if isinstance(expected, bool) or expected is None or isinstance(expected, str):
        if expected != actual or type(expected) is not type(actual): raise ValueError(f'REPLAY_MISMATCH:{path}')
    elif isinstance(expected, (int,float)):
        if isinstance(actual,bool) or not isinstance(actual,(int,float)) or not math.isfinite(actual) or not math.isclose(expected,actual,rel_tol=0,abs_tol=1e-6):
            raise ValueError(f'REPLAY_MISMATCH:{path}')
    elif isinstance(expected, dict):
        if not isinstance(actual,dict) or expected.keys()!=actual.keys(): raise ValueError(f'REPLAY_MISMATCH:{path}:keys')
        for key in expected: compare_snapshot(expected[key],actual[key],path+'.'+key)
    elif isinstance(expected, list):
        if not isinstance(actual,list) or len(expected)!=len(actual): raise ValueError(f'REPLAY_MISMATCH:{path}:length')
        for i,(a,b) in enumerate(zip(expected,actual)): compare_snapshot(a,b,f'{path}[{i}]')
    else: raise ValueError('INVALID_REPLAY_SNAPSHOT')


def replay_result(rt, data):
    """Recompute all inputs, ticks, RNG and scores. Worker never supplies allocations."""
    import math
    from center.games import engine_for
    bootstrap = rt.store.get_setting(f'edge-bootstrap:{rt.round_id}')
    if not bootstrap or data.get('roundId')!=rt.round_id or data.get('configHash')!=bootstrap['configHash']:
        raise ValueError('ROUND_COMMITMENT_MISMATCH')
    engine = engine_for(rt.config).restore(rt.config,rt.round_id,rt.seed,bootstrap['snapshot'])
    journal = data.get('journal')
    if not isinstance(journal,list) or not 1<=len(journal)<=100000:
        raise ValueError('INVALID_JOURNAL')
    previous = engine.started_at
    accepted = []
    for event in journal:
        if not isinstance(event,dict): raise ValueError('INVALID_JOURNAL')
        at = event.get('at')
        if isinstance(at,bool) or not isinstance(at,(int,float)) or not math.isfinite(at) or at<previous or at>time.time()+5 or at>engine.started_at+rt.config.rules.duration_seconds+60:
            raise ValueError('INVALID_JOURNAL_TIME')
        previous = at
        if 'action' in event:
            who, action = event.get('who'),event['action']
            if who not in engine.participants or not isinstance(action,dict):raise ValueError('NOT_ADMITTED')
            result = engine.act(who,action,at)
            if result.ok != event.get('accepted') or result.error != event.get('error'):
                raise ValueError('ACTION_REPLAY_MISMATCH')
            if result.ok: accepted.append({'who':who,'action':action,'at':at})
        elif 'suspended' in event:
            if not isinstance(event['suspended'],list) or any(not isinstance(p,str) or not re.fullmatch(r'0x[0-9a-f]{40}',p) for p in event['suspended']):raise ValueError('INVALID_SUSPENSION')
            engine.suspended=set(event['suspended'])
            for who in engine.suspended:engine.inputs.pop(who,None)
        else:engine.tick(at)
    if not engine.finished:raise ValueError('ROUND_NOT_FINISHED')
    compare_snapshot(engine.snapshot(),data.get('snapshot'))
    # Moderation remains Railway authority, including a ban racing the final tick.
    engine.suspended.update(getattr(rt.engine,'suspended',set()))
    return engine,accepted


async def sync_controls(rt):
    import os
    import httpx
    if not rt.round_id or not (rt.store.get_setting(f'edge-active:{rt.round_id}') or {}).get('active'):return
    suspended=sorted(getattr(rt.engine,'suspended',set()))
    control={'roundId':rt.round_id,'suspended':suspended,'cancelled':rt.status in {'cancelled','refundable','closed'},
             'settings':rt.community.public_settings(rt.room_id)}
    fingerprint=json.dumps(control,sort_keys=True)
    if getattr(rt,'_edge_control_fingerprint',None)==fingerprint:return
    path=f'/internal/rooms/{rt.room_id}/control'
    body=json.dumps(control,separators=(',',':'))
    async with httpx.AsyncClient(timeout=10) as client:
        response=await client.post(worker_origin()+path,content=body,headers={**provisioning_signature(os.environ['CENTER_CF_PROVISION_SECRET'],path,body),'Content-Type':'application/json'})
        response.raise_for_status()
    rt._edge_control_fingerprint=fingerprint
