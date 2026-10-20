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
# Deliberate code gate: credentials/env alone cannot enable unported game engines.
CLOUDFLARE_RUNTIME_READY = False


def preferred_host(store, template_id):
    return (store.get_setting(f'game-config:{template_id}') or {}).get('host', 'railway')


def room_host(store, room_id):
    return (store.get_setting(f'room-host:{room_id}') or {}).get('host', 'railway')


def require_publish_host(store, config):
    host = preferred_host(store, config.template_id)
    if host == 'cloudflare':
        if config.template_id not in REALTIME or getattr(config.rules, 'world_version', 0) != 4:
            raise HTTPException(409, detail={'code': 'CLOUDFLARE_V4_ONLY', 'message': 'Cloudflare hosting is restricted to the three V4 multiplayer worlds.'})
        if not CLOUDFLARE_RUNTIME_READY:
            raise HTTPException(409, detail={'code': 'CLOUDFLARE_RUNTIME_NOT_READY', 'message': 'The Cloudflare transport scaffold is available; game engine ports and verified settlement must ship before enabling rooms. Choose Railway to publish now.'})
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
