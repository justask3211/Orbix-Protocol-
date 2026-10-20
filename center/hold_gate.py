"""Read-only holding requirements. No approval, transfer, burn or graduation probe.

All quantities in config are whole tokens; raw balances are uint256 base units.
Only administrators can enable a bounded cache TTL. The default checks every join.
"""
from __future__ import annotations
import os
import re
import time
from typing import Literal
from fastapi import Depends, Header, HTTPException
from pydantic import Field, StrictBool, StrictInt, field_validator
from center.strict_base import Strict
from center.schema import RoomConfig

ORBIX = '0x16c5451763ec2e0e7f041e2db761a0491fdb6db1'
SETTING = 'orbix-policy'
ADDRESS = re.compile(r'0x[0-9a-fA-F]{40}')


class OrbixPolicy(Strict):
    orbix_hold_create_threshold: StrictInt = Field(default=0, ge=0, le=10**15)
    orbix_hold_join_threshold: StrictInt = Field(default=0, ge=0, le=10**15)
    orbix_hold_tournament_threshold: StrictInt = Field(default=0, ge=0, le=10**15)
    hold_cache_ttl_seconds: StrictInt = Field(default=0, ge=0, le=300)
    promo_enabled: StrictBool = True
    promo_text: str = Field(default='Buy $ORBIX', min_length=1, max_length=120)
    promo_link: str = 'https://testnet.vibevibe.fun/token/' + ORBIX

    @field_validator('promo_link')
    @classmethod
    def safe_link(cls, value):
        from urllib.parse import urlsplit
        url = urlsplit(value)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or len(value) > 500:
            raise ValueError('Buy link must be a complete HTTPS URL')
        return value


class HoldReadError(Exception):
    pass


def units_text(raw, decimals):
    if not decimals:
        return str(raw)
    whole, frac = divmod(raw, 10**decimals)
    return str(whole) + ('.' + str(frac).zfill(decimals).rstrip('0') if frac else '')


class HoldGate:
    def __init__(self, store, rpc, chain_id=46630, orbix=None, clock=time.time):
        self.store, self.rpc, self.chain_id = store, rpc, chain_id
        self.orbix = (orbix or os.environ.get('CENTER_ORBIX_TOKEN', ORBIX)).lower()
        if not ADDRESS.fullmatch(self.orbix):
            raise ValueError('CENTER_ORBIX_TOKEN must be an ERC20 address')
        self.clock, self.cache = clock, {}
        from center.pricing import ADMIN_ADDRESS
        self.admin = ADMIN_ADDRESS

    def policy(self):
        return OrbixPolicy(**(self.store.get_setting(SETTING) or {}))

    def public_policy(self):
        p = self.policy().model_dump()
        return {**p, 'orbix_token': self.orbix,
                'forcible': {key: p[key] > 0 for key in p if key.startswith('orbix_hold_')}}

    def read_balance(self, token, who, ttl):
        if not ADDRESS.fullmatch(token or '') or not ADDRESS.fullmatch(who or ''):
            raise HoldReadError('A complete token and wallet address are required')
        key = (token.lower(), who.lower())
        hit = self.cache.get(key)
        if ttl and hit and 0 <= self.clock() - hit[0] < ttl:
            return hit[1]
        try:
            if int(self.rpc.call('eth_chainId', []), 16) != self.chain_id:
                raise HoldReadError('Balance RPC is connected to a different chain')
            block = self.rpc.call('eth_blockNumber', [])
            if not isinstance(block, str) or not re.fullmatch(r'0x[0-9a-fA-F]+', block):
                raise HoldReadError('Invalid block response')
            def uint(data):
                raw = self.rpc.call('eth_call', [{'to': token, 'data': data}, block])
                if not isinstance(raw, str) or not re.fullmatch(r'0x[0-9a-fA-F]{64}', raw):
                    raise HoldReadError('Token did not return a uint256')
                return int(raw, 16)
            decimals = uint('0x313ce567')
            if decimals > 77:
                raise HoldReadError('Unsupported token decimals')
            balance = uint('0x70a08231' + who[2:].lower().zfill(64))
            value = {'balance_base_units': str(balance), 'balance': units_text(balance, decimals), 'decimals': decimals, 'block': block}
            if ttl:
                if len(self.cache) >= 4096:
                    self.cache.clear()
                self.cache[key] = (self.clock(), value)
            return value
        except HoldReadError:
            raise
        except Exception as exc:
            raise HoldReadError('On-chain balance check unavailable; retry before joining') from exc

    def check(self, who, action, config=None):
        policy = self.policy()
        field = {'create': 'orbix_hold_create_threshold', 'join': 'orbix_hold_join_threshold', 'tournament': 'orbix_hold_tournament_threshold'}[action]
        # Tournament admission also obeys the global room admission floor.
        global_threshold = max(getattr(policy, field), policy.orbix_hold_join_threshold if action == 'tournament' else 0)
        requirements = {}
        if global_threshold:
            requirements[self.orbix] = (global_threshold, 'ORBIX', 'global')
        if config and config.entry.hold_threshold:
            token = config.entry.token.lower()
            threshold = config.entry.hold_threshold
            prior = requirements.get(token)
            requirements[token] = (max(threshold, prior[0] if prior else 0), 'ORBIX' if token == self.orbix else 'entry token', 'global+room' if prior else 'room')
        checks = []
        for token, (threshold, label, source) in requirements.items():
            value = self.read_balance(token, who, policy.hold_cache_ttl_seconds)
            required = threshold * 10**value['decimals']
            if required >= 2**256:
                raise HoldReadError('Required token amount exceeds uint256')
            checks.append({**value, 'token': token, 'symbol': label, 'source': source,
                           'required': str(threshold), 'required_base_units': str(required),
                           'passed': int(value['balance_base_units']) >= required})
        return {'passed': all(c['passed'] for c in checks), 'checks': checks, 'buy_link': policy.promo_link,
                'orbix_token': self.orbix, 'action': action}

    def require(self, who, action, config=None):
        if action == 'create' and config and config.entry.hold_threshold and config.entry.token.lower() == self.orbix and who.lower() != self.admin:
            raise HTTPException(403, detail={'code': 'ORBIX_GATE_ADMIN_ONLY', 'message': 'ORBIX holding thresholds are controlled by the administrator.'})
        try:
            result = self.check(who, action, config)
        except HoldReadError as exc:
            raise HTTPException(503, detail={'code': 'HOLD_CHECK_UNAVAILABLE', 'message': str(exc)})
        if not result['passed']:
            c = next(c for c in result['checks'] if not c['passed'])
            raise HTTPException(403, detail={'code': 'HOLD_INSUFFICIENT', 'message': f"Insufficient balance — you need {c['required']} {c['symbol']}, you have {c['balance']}", **result})
        return result


class Preflight(Strict):
    action: Literal['create', 'join', 'tournament']
    config: dict | None = None
    room_id: str | None = None
    tournament_id: str | None = None


def mount_hold_gate(app, prefix, store, require_wallet, require_admin, validate_config, runtime_for, admin):
    from center.vault import JsonRpc
    gate = HoldGate(store, JsonRpc(os.environ.get('CENTER_RPC_URL', 'https://rpc.testnet.chain.robinhood.com'), app.state.flags.chain_id), app.state.flags.chain_id)
    gate.admin = admin.lower()
    app.state.hold_gate = gate

    @app.get(prefix + '/orbix-policy')
    def public():
        from fastapi.responses import JSONResponse
        return JSONResponse(gate.public_policy(), headers={'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'})

    @app.patch(prefix + '/admin/orbix-policy')
    def update(body: OrbixPolicy, authorization: str | None = Header(None), x_admin_proof: str | None = Header(None)):
        who = require_admin(authorization, x_admin_proof, need_proof=True)
        with store.tx():
            store.append_audit(who, 'orbix.policy', gate.policy().model_dump(), body.model_dump(), app.state.flags.chain_id)
            store.set_setting(SETTING, body.model_dump())
        gate.cache.clear()
        return gate.public_policy()

    @app.post(prefix + '/hold-check')
    def check(body: Preflight, who: str = Depends(require_wallet)):
        if body.room_id:
            config = runtime_for(body.room_id).config
        elif body.tournament_id:
            config = RoomConfig(**app.state.tournaments.get(body.tournament_id)['config']['room'])
        else:
            config = validate_config(body.config) if body.config else None
        try:
            return gate.check(who, body.action, config)
        except HoldReadError as exc:
            raise HTTPException(503, detail={'code': 'HOLD_CHECK_UNAVAILABLE', 'message': str(exc)})
    return gate
