"""Durable tournament authority. Clients identify matches; they never supply winners.

Preview entry pools use VaultService intents/refunds and standard entitlements.
The existing direct-pay ERC20 gate cannot escrow/refund a pool; reject that mode.
"""
from __future__ import annotations

import hashlib
import json
import math
import secrets
import time
from typing import Literal

from fastapi import Depends, Header, HTTPException
from pydantic import Field, StrictInt, model_validator
from center.strict_base import Strict
from center.schema import RoomConfig, SOLO_TEMPLATES
from center import settlement as st
from center.admin_games import require_game_mode, game_availability
from center.vault import InsufficientBalance

DUELS = frozenset({'reaction-duel', 'rps-duel', 'combat-duel', 'prism-lines'})
TERMINAL = {'closed', 'cancelled'}


def bracket_type(template):
    return 'elimination' if template in DUELS else 'heats'


def seeded_pairs(players):
    """Standard mirrored seed positions. Highest seeds receive all first-round byes."""
    size = 1 << (len(players) - 1).bit_length()
    order = [1, 2]
    while len(order) < size:
        order = [s for old in order for s in (old, 2 * len(order) + 1 - old)]
    slots = [players[s - 1] if s <= len(players) else None for s in order]
    return [[p for p in slots[i:i + 2] if p is not None] for i in range(0, size, 2)]


class TournamentCaps(Strict):
    max_players: StrictInt = Field(default=256, ge=2, le=1024)
    max_entry_fee: StrictInt = Field(default=10000, ge=0, le=1000000)
    max_room_size: StrictInt = Field(default=50, ge=2, le=100)
    max_heats: StrictInt = Field(default=16, ge=1, le=32)
    max_registration_seconds: StrictInt = Field(default=604800, ge=60, le=2592000)


class TournamentBanner(Strict):
    text: str = Field(default='', max_length=120)
    style: Literal['purple', 'blue', 'gold'] = 'purple'
    size: Literal['small', 'large'] = 'small'
    placement: Literal['join', 'front'] = 'join'


class TournamentConfig(Strict):
    room: RoomConfig
    bracket_type: Literal['elimination', 'heats']
    min_players: StrictInt = Field(default=2, ge=2, le=1024)
    max_players: StrictInt = Field(default=16, ge=2, le=1024)
    room_size: StrictInt = Field(default=10, ge=1, le=100)
    advancers: StrictInt = Field(default=3, ge=1, le=99)
    heats: StrictInt = Field(default=16, ge=1, le=32)
    seeding: Literal['random', 'creator', 'admin'] = 'random'
    seeds: list[str] = Field(default_factory=list, max_length=1024)
    round_names: list[str] = Field(default_factory=list, max_length=32)
    registration_open: StrictInt = Field(default=0, ge=0)
    registration_close: StrictInt = Field(ge=1)
    start_condition: Literal['manual', 'creator', 'auto-when-full'] = 'creator'
    entry_fee: StrictInt = Field(default=0, ge=0, le=1000000)
    fee_unit: Literal['preview-points', 'erc20'] = 'preview-points'
    distribution: list[StrictInt] = Field(default_factory=lambda: [100], min_length=1, max_length=100)
    banner: TournamentBanner = Field(default_factory=TournamentBanner)

    @model_validator(mode='after')
    def valid(self):
        if self.bracket_type != bracket_type(self.room.template_id):
            raise ValueError('Bracket type must match the game template')
        if self.min_players > self.max_players or self.registration_open >= self.registration_close:
            raise ValueError('Invalid player limits or registration window')
        if self.fee_unit != 'preview-points':
            raise ValueError('ERC20 tournament pools require refundable escrow; direct-pay CreatorTokenGate cannot pool or refund entry fees')
        if self.room.entry.kind not in {'free', 'hold'} or self.room.mode != 'preview' or self.room.rewards.kind != 'preview-points' or self.room.access.vault_mode != 'simulated':
            raise ValueError('Tournament matches use preview points; configure fees once on the tournament')
        if self.bracket_type == 'heats':
            if self.room.template_id in SOLO_TEMPLATES:
                if self.room_size != 1:
                    raise ValueError('Solo games run individual trials with aggregate rankings')
            elif self.room_size < 2 or self.advancers >= self.room_size:
                raise ValueError('Heats require 1 <= advancers < room_size')
            if self.room_size > self.room.admission.player_cap:
                raise ValueError('Heat size exceeds game admission cap')
        if any(p < 0 or p > 100 for p in self.distribution) or sum(self.distribution) != 100:
            raise ValueError('Reward percentages must be nonnegative and total 100')
        if len(self.distribution) > self.min_players:
            raise ValueError('Prize positions cannot exceed minimum participants')
        if any(not name.strip() or len(name) > 50 for name in self.round_names):
            raise ValueError('Round names require 1–50 characters')
        if len(set(s.lower() for s in self.seeds)) != len(self.seeds):
            raise ValueError('Seed wallets must be distinct')
        return self


class TournamentError(Exception):
    def __init__(self, code, message=None, status=409):
        self.code, self.message, self.status = code, message or code, status


class TournamentService:
    def __init__(self, store, vault, hub, admin, clock=time.time):
        self.store, self.vault, self.hub, self.admin, self.clock = store, vault, hub, admin.lower(), clock
        self.hold_check = None
        with store.tx() as cx:
            cx.execute('CREATE TABLE IF NOT EXISTS tournaments(id TEXT PRIMARY KEY,owner TEXT NOT NULL,config_json TEXT NOT NULL,state TEXT NOT NULL,data_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at REAL NOT NULL)')
            cx.execute('CREATE TABLE IF NOT EXISTS tournament_matches(room_id TEXT PRIMARY KEY,tournament_id TEXT NOT NULL,match_id TEXT NOT NULL)')

    def caps(self):
        return TournamentCaps(**(self.store.get_setting('tournament-caps') or {}))

    def get(self, tid, cx=None):
        if cx is None:
            with self.store.tx() as cx:
                return self.get(tid, cx)
        row = cx.execute('SELECT * FROM tournaments WHERE id=?', (tid,)).fetchone()
        if not row:
            raise TournamentError('NOT_FOUND', status=404)
        return {'id': row['id'], 'owner': row['owner'], 'config': json.loads(row['config_json']),
                'state': row['state'], 'revision': row['revision'], **json.loads(row['data_json'])}

    def list(self, who=None, active=False):
        with self.store.tx() as cx:
            ids = [r[0] for r in cx.execute('SELECT id FROM tournaments ORDER BY created_at DESC LIMIT 500')]
            rows = [self.get(tid, cx) for tid in ids]
        return [r for r in rows if (not active or r['state'] not in TERMINAL) and (not who or who == r['owner'] or who in r['participants'])]

    def save(self, t, cx):
        data = {k: v for k, v in t.items() if k not in {'id', 'owner', 'config', 'state', 'revision'}}
        changed = cx.execute('UPDATE tournaments SET config_json=?,state=?,data_json=?,revision=revision+1 WHERE id=? AND revision=?',
                             (json.dumps(t['config']), t['state'], json.dumps(data), t['id'], t['revision']))
        if changed.rowcount != 1:
            raise TournamentError('TOURNAMENT_CHANGED')
        t['revision'] += 1
        return t

    def validate_caps(self, cfg):
        caps = self.caps()
        now = self.clock()
        if cfg.max_players > caps.max_players or cfg.entry_fee > caps.max_entry_fee or cfg.room_size > caps.max_room_size or cfg.heats > caps.max_heats:
            raise TournamentError('ADMIN_CAP_EXCEEDED')
        if not now < cfg.registration_close <= now + caps.max_registration_seconds:
            raise TournamentError('REGISTRATION_WINDOW_INVALID')
        # Every admitted population must finish within the configured heat budget.
        if cfg.bracket_type == 'heats':
            for count in range(cfg.min_players, cfg.max_players + 1):
                n, rounds = count, 1
                while n > max(1, cfg.room_size):
                    n = max(1, math.ceil(n / 2)) if cfg.room_size == 1 else sum(min(cfg.advancers, len(g)) for g in self.groups(list(range(n)), cfg.room_size))
                    rounds += 1
                if rounds > cfg.heats:
                    raise TournamentError('HEAT_BUDGET_TOO_SMALL')
        require_game_mode(self.store, cfg.room.template_id, 'create')
        if game_availability(self.store, cfg.room.template_id)['status'] != 'live':
            raise TournamentError('GAME_UNAVAILABLE')
        from center.content_packs import validate_config_pack
        validate_config_pack(cfg.room)

    def create(self, who, cfg, nonce):
        self.validate_caps(cfg)
        if not isinstance(nonce, str) or not 8 <= len(nonce) <= 128:
            raise TournamentError('INTENT_REQUIRED', status=422)
        if who != self.admin and cfg.banner != TournamentBanner():
            raise TournamentError('ADMIN_BANNER_ONLY', status=403)
        if self.hold_check:
            self.hold_check(who, 'create', cfg.room)
        tid = hashlib.sha256(f'tournament/v1|{who}|{nonce}'.encode()).hexdigest()[:24]
        with self.store.tx() as cx:
            if cx.execute('SELECT 1 FROM tournaments WHERE id=?', (tid,)).fetchone():
                old = self.get(tid, cx)
                if old['config'] != cfg.model_dump(mode='json'):
                    raise TournamentError('INTENT_CONFIG_CHANGED')
                return old
            data = {'participants': [], 'rounds': [], 'pool': 0, 'history': ['registering'], 'podium': [], 'allocations': []}
            cx.execute('INSERT INTO tournaments VALUES(?,?,?,?,?,1,?)', (tid, who, json.dumps(cfg.model_dump(mode='json')), 'registering', json.dumps(data), self.clock()))
            return self.get(tid, cx)

    def join(self, tid, who):
        with self.store.tx() as cx:
            t = self.get(tid, cx)
            cfg = TournamentConfig(**t['config'])
            require_game_mode(self.store, cfg.room.template_id, 'join')
            if self.hold_check:
                self.hold_check(who, 'tournament', cfg.room)
            if who in t['participants']:
                return t
            if t['state'] != 'registering' or not cfg.registration_open <= self.clock() < cfg.registration_close:
                raise TournamentError('REGISTRATION_CLOSED')
            if len(t['participants']) >= cfg.max_players:
                raise TournamentError('TOURNAMENT_FULL')
            intent = '0x' + hashlib.sha256(f'tournament-entry|{tid}|{who}'.encode()).hexdigest()
            self.vault.deduct_for_publish(who, intent, cfg.entry_fee, tid)
            t['participants'].append(who)
            t['pool'] += cfg.entry_fee
            self.save(t, cx)
            if cfg.start_condition == 'auto-when-full' and len(t['participants']) == cfg.max_players:
                self._start(t, cfg, cx)
            return t

    def start(self, tid, actor, seeds=None):
        with self.store.tx() as cx:
            t = self.get(tid, cx)
            cfg = TournamentConfig(**t['config'])
            if actor != self.admin and (actor != t['owner'] or cfg.start_condition == 'manual' or cfg.seeding == 'admin'):
                raise TournamentError('FORBIDDEN', status=403)
            if seeds is not None:
                if not isinstance(seeds, list) or any(not isinstance(p, str) for p in seeds):
                    raise TournamentError('INVALID_SEEDS')
                cfg.seeds = [p.lower() for p in seeds]
                t['config'] = cfg.model_dump(mode='json')
            self._start(t, cfg, cx)
            return t

    def _start(self, t, cfg, cx):
        if t['state'] != 'registering' or self.clock() < cfg.registration_open:
            raise TournamentError('NOT_REGISTERING')
        if len(t['participants']) < cfg.min_players:
            raise TournamentError('NOT_ENOUGH_PLAYERS')
        players = list(t['participants'])
        if cfg.seeding == 'random':
            secrets.SystemRandom().shuffle(players)
        else:
            if set(cfg.seeds) != set(players) or len(cfg.seeds) != len(players):
                raise TournamentError('SEEDS_MUST_MATCH_PARTICIPANTS')
            players = list(cfg.seeds)
        t['seed_order'] = players
        self.transition(t, 'running')
        self._schedule(t, cfg, players, cx)

    @staticmethod
    def transition(t, state):
        current = t['state']
        allowed = (current == 'registering' and state in {'running', 'cancelled'} or
                   current == 'running' and (state.startswith('round-') or state == 'final') or
                   current.startswith('round-') and (state.startswith('round-') or state in {'final', 'cancelled'}) or
                   current == 'final' and state in {'settled', 'cancelled'} or
                   current == 'settled' and state == 'closed')
        if not allowed:
            raise TournamentError('ILLEGAL_TRANSITION', f'{current} → {state}')
        t['state'] = state
        t['history'].append(state)

    @staticmethod
    def groups(players, k):
        # Balance rooms (11 at K=10 becomes 6+5, never a lonely 10+1).
        count = math.ceil(len(players) / k)
        return [players[i::count] for i in range(count)]

    def _schedule(self, t, cfg, players, cx):
        from center.room import RoomRuntime
        index = len(t['rounds']) + 1
        solo = cfg.room.template_id in SOLO_TEMPLATES
        final = len(players) <= (2 if cfg.bracket_type == 'elimination' else max(1, cfg.room_size))
        groups = seeded_pairs(players) if cfg.bracket_type == 'elimination' else self.groups(players, cfg.room_size)
        # Solo finals aggregate independent trials and settle after the last heat.
        if solo and len(players) <= 2:
            final = True
        self.transition(t, 'final' if final else f'round-{index}')
        remaining = math.ceil(math.log2(len(players))) if cfg.bracket_type == 'elimination' else 0
        label = cfg.round_names[index - 1] if index <= len(cfg.round_names) else ('Final' if final else {2: 'Semifinal', 3: 'Quarterfinal'}.get(remaining, f'Round {index}'))
        rnd = {'number': index, 'name': label, 'matches': [], 'final': final}
        for n, group in enumerate(groups):
            mid = f'{index}-{n + 1}'
            match = {'id': mid, 'players': group, 'room_id': None, 'ranking': [], 'advancing': [], 'state': 'pending', 'attempt': 1}
            if len(group) == 1 and not solo:
                match.update(state='bye', ranking=group, advancing=group)
            else:
                raw = cfg.room.model_dump(mode='json')
                raw.update(name=f'{cfg.room.name[:35]} · {label[:12]} {n + 1}', visibility='unlisted', timing={}, rewards={'kind': 'preview-points', 'slots': []}, access={})
                if cfg.room.entry.kind == 'hold':
                    raw['access'] = {'creator_absorbs_joiner_fee': True, 'payout_mode': 'hold'}
                raw['admission'].update(player_cap=len(group), min_ready_to_start=len(group), spectators=False)
                if raw['rules'].get('team_mode') == 'teams':
                    raw['rules']['team_mode'] = 'coop'
                rt = RoomRuntime.create(self.store, self.vault, self.hub, owner=t['owner'], config=RoomConfig(**raw))
                for player in group:
                    self.store.join(rt.room_id, player)
                match['room_id'] = rt.room_id
                cx.execute('INSERT INTO tournament_matches VALUES(?,?,?)', (rt.room_id, t['id'], mid))
            rnd['matches'].append(match)
        t['rounds'].append(rnd)
        self.save(t, cx)

    def assert_member(self, room_id, who):
        with self.store.tx() as cx:
            row = cx.execute('SELECT tournament_id,match_id FROM tournament_matches WHERE room_id=?', (room_id,)).fetchone()
            if row:
                t = self.get(row[0], cx)
                match = next(m for r in t['rounds'] for m in r['matches'] if m['id'] == row[1])
                if who not in match['players'] or t['state'] in TERMINAL or match['room_id'] != room_id:
                    raise TournamentError('TOURNAMENT_ADMISSION_REQUIRED', status=403)

    def report(self, tid, match_id):
        """Read immutable, server-settled room results. No caller-selected rankings."""
        with self.store.tx() as cx:
            t = self.get(tid, cx)
            if t['state'] in TERMINAL or t['state'] == 'settled':
                return t
            rnd = t['rounds'][-1] if t['rounds'] else None
            match = next((m for m in rnd['matches'] if m['id'] == match_id), None) if rnd else None
            if not match:
                raise TournamentError('MATCH_NOT_CURRENT')
            if match['state'] in {'complete', 'bye'}:
                return t
            room = self.store.get_room(match['room_id'])
            result = self.store.get_round(room['round_id']) if room and room['round_id'] else None
            if not result or result['state'] != 'claimable' or result['ended_at'] is None:
                raise TournamentError('MATCH_NOT_SETTLED')
            from center.room import RoomRuntime
            rt = RoomRuntime.load(self.store, self.vault, self.hub, room['id'])
            ranking = [p for p in rt.engine.ranking() if p in match['players']]
            eligible = [p for p in ranking if p in rt.engine.eligible()]
            if not eligible:
                # No legal winner (draw, forfeit both, raid failure): replay, never invent a winner.
                match['attempt'] += 1
                config = rt.config
                new = RoomRuntime.create(self.store, self.vault, self.hub, owner=t['owner'], config=config)
                for p in match['players']:
                    self.store.join(new.room_id, p)
                match['room_id'] = new.room_id
                cx.execute('INSERT INTO tournament_matches VALUES(?,?,?)', (new.room_id, tid, match_id))
                return self.save(t, cx)
            cfg = TournamentConfig(**t['config'])
            match.update(state='complete', ranking=ranking, scores=rt.engine.scores(), advancing=eligible[:1 if cfg.bracket_type == 'elimination' else cfg.advancers])
            if all(m['state'] in {'complete', 'bye'} for m in rnd['matches']):
                if rnd['final']:
                    self._settle(t, cfg, cx)
                else:
                    if cfg.room.template_id in SOLO_TEMPLATES:
                        scores = {p: m.get('scores', {}).get(p, 0) for m in rnd['matches'] for p in m['advancing']}
                        order = sorted(scores, key=lambda p: (-scores[p], t['seed_order'].index(p)))
                        players = order[:max(1, math.ceil(len(order) / 2))]
                    else:
                        players = [p for m in rnd['matches'] for p in m['advancing']]
                    if len(players) == 1:
                        self.transition(t, 'final')
                        self._settle(t, cfg, cx)
                    else:
                        self._schedule(t, cfg, players, cx)
                        return t
            return self.save(t, cx)

    def _settle(self, t, cfg, cx):
        # Final placings then reverse-round finishers. Equal cross-room places use frozen seed order.
        ranking = []
        for rnd in reversed(t['rounds']):
            matches = rnd['matches']
            for rank in range(max(len(m['ranking']) for m in matches)):
                candidates = [m['ranking'][rank] for m in matches if len(m['ranking']) > rank]
                if cfg.room.template_id in SOLO_TEMPLATES:
                    candidates.sort(key=lambda p: (-next(m['scores'].get(p, 0) for m in matches if p in m['ranking']), t['seed_order'].index(p)))
                else:
                    candidates.sort(key=t['seed_order'].index)
                ranking.extend(p for p in candidates if p not in ranking)
        ranking.extend(p for p in t['seed_order'] if p not in ranking)
        t['podium'] = [{'wallet': p, 'rank': i + 1, 'score': 0} for i, p in enumerate(ranking)]
        amounts = [t['pool'] * pct // 100 for pct in cfg.distribution]
        amounts[0] += t['pool'] - sum(amounts)
        round_id = hashlib.sha256(('tournament-' + t['id']).encode()).hexdigest()
        for i, amount in enumerate(amounts):
            winner = ranking[i]
            cid, _ = st.entitlement_leaf(chain_id=46630, escrow='0x' + '00' * 20, round_id=round_id, winner=winner, slot_id=i, allocation_nonce=0, asset_kind='preview-points', asset_contract='0x' + '00' * 20, token_id=0, amount=0)
            claim = '0x' + cid.hex()
            self.store.save_entitlement({'claim_id': claim, 'round_id': round_id, 'room_id': t['id'], 'winner': winner, 'slot_id': i, 'points': amount, 'asset_kind': 'preview-points'})
            t['allocations'].append({'claimId': claim, 'winner': winner, 'points': amount, 'code': st.payment_code(claim)})
        self.transition(t, 'settled')

    def edit(self, tid, actor, raw):
        with self.store.tx() as cx:
            t = self.get(tid, cx)
            if actor not in {self.admin, t['owner']}:
                raise TournamentError('FORBIDDEN', status=403)
            if t['state'] != 'registering' and set(raw) - {'banner'}:
                raise TournamentError('BRACKET_FROZEN')
            if actor != self.admin and 'banner' in raw:
                raise TournamentError('ADMIN_BANNER_ONLY', status=403)
            cfg = TournamentConfig(**{**t['config'], **raw})
            if set(raw) != {'banner'}:
                self.validate_caps(cfg)
            if t['participants'] and any(t['config'][k] != cfg.model_dump(mode='json')[k] for k in ('room', 'entry_fee', 'distribution', 'min_players', 'fee_unit')):
                raise TournamentError('ENTRY_TERMS_FROZEN')
            if len(t['participants']) > cfg.max_players:
                raise TournamentError('TOURNAMENT_FULL')
            t['config'] = cfg.model_dump(mode='json')
            self.store.append_audit(actor, 'tournament.edit', {'id': tid}, raw, 46630)
            return self.save(t, cx)

    def cancel(self, tid, actor):
        with self.store.tx() as cx:
            t = self.get(tid, cx)
            if actor not in {self.admin, t['owner']}:
                raise TournamentError('FORBIDDEN', status=403)
            if t['state'] == 'cancelled':
                return t
            if t['state'] in {'settled', 'closed'}:
                raise TournamentError('ALREADY_SETTLED')
            for player in t['participants']:
                intent = '0x' + hashlib.sha256(f'tournament-entry|{tid}|{player}'.encode()).hexdigest()
                self.vault.refund_deduction(player, intent)
            self.transition(t, 'cancelled')
            self.store.append_audit(actor, 'tournament.cancel', {'id': tid, 'pool': t['pool']}, {'refunded': t['pool']}, 46630)
            return self.save(t, cx)

    def close(self, tid, actor):
        with self.store.tx() as cx:
            t = self.get(tid, cx)
            if actor not in {t['owner'], self.admin}:
                raise TournamentError('FORBIDDEN', status=403)
            self.transition(t, 'closed')
            return self.save(t, cx)

    async def tick(self, runtimes):
        from center.room import RoomRuntime
        for t in self.list(active=True):
            if t['state'] == 'registering':
                if self.clock() >= t['config']['registration_close']:
                    if len(t['participants']) < t['config']['min_players']:
                        self.cancel(t['id'], self.admin)
                    elif t['config']['start_condition'] == 'auto-when-full':
                        self.start(t['id'], self.admin)
                continue
            if t['state'] == 'settled':
                continue
            for match in t['rounds'][-1]['matches']:
                if not match['room_id'] or match['state'] != 'pending':
                    continue
                rid = match['room_id']
                rt = runtimes.get(rid)
                if rt is None:
                    rt = RoomRuntime.load(self.store, self.vault, self.hub, rid)
                    runtimes[rid] = rt
                if rt.status in {'registration', 'ready'} and self.store.ready_count(rid) == len(match['players']):
                    await rt.start()
                if rt.status in {'recovery-required', 'cancelled', 'refundable', 'closed'} and rt.finished_at is None:
                    self.cancel(t['id'], self.admin)
                    break
                if rt.finished_at is not None:
                    self.report(t['id'], match['id'])


def mount_tournaments(app, prefix, store, vault, hub, require_wallet, require_admin, admin):
    service = TournamentService(store, vault, hub, admin)
    app.state.tournaments = service

    @app.exception_handler(TournamentError)
    async def error(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=exc.status, content={'detail': {'code': exc.code, 'message': exc.message}})

    @app.get(prefix + '/tournaments/caps')
    def caps():
        return service.caps().model_dump()

    @app.patch(prefix + '/admin/tournaments/caps')
    def set_caps(body: TournamentCaps, authorization: str | None = Header(None), x_admin_proof: str | None = Header(None)):
        actor = require_admin(authorization, x_admin_proof, need_proof=True)
        with store.tx():
            store.append_audit(actor, 'tournament.caps', service.caps().model_dump(), body.model_dump(), 46630)
            store.set_setting('tournament-caps', body.model_dump())
        return body.model_dump()

    @app.get(prefix + '/tournaments')
    def listing(active: bool = True):
        return {'tournaments': service.list(active=active)}

    @app.get(prefix + '/tournaments/mine')
    def mine(who: str = Depends(require_wallet)):
        return {'tournaments': service.list(who)}

    @app.post(prefix + '/tournaments')
    def create(body: dict, who: str = Depends(require_wallet)):
        from pydantic import ValidationError
        try:
            return service.create(who, TournamentConfig(**body.get('config', {})), body.get('intentNonce'))
        except (ValidationError, ValueError) as exc:
            raise HTTPException(422, detail={'code': 'INVALID_TOURNAMENT', 'message': str(exc)})

    @app.get(prefix + '/tournaments/{tid}')
    def detail(tid: str):
        return service.get(tid)

    @app.post(prefix + '/tournaments/{tid}/join')
    def join(tid: str, who: str = Depends(require_wallet)):
        try:
            return service.join(tid, who)
        except InsufficientBalance as exc:
            raise HTTPException(402, detail={'code': 'INSUFFICIENT_BALANCE', 'message': str(exc)})

    @app.post(prefix + '/tournaments/{tid}/start')
    def start(tid: str, body: dict, who: str = Depends(require_wallet), authorization: str | None = Header(None), x_admin_proof: str | None = Header(None)):
        if who == admin:
            require_admin(authorization, x_admin_proof, need_proof=True)
        return service.start(tid, who, body.get('seeds'))

    @app.patch(prefix + '/tournaments/{tid}')
    def edit(tid: str, body: dict, who: str = Depends(require_wallet), authorization: str | None = Header(None), x_admin_proof: str | None = Header(None)):
        if who == admin:
            require_admin(authorization, x_admin_proof, need_proof=True)
        try:
            return service.edit(tid, who, body)
        except ValueError as exc:
            raise HTTPException(422, detail={'code': 'INVALID_TOURNAMENT', 'message': str(exc)})

    @app.post(prefix + '/tournaments/{tid}/cancel')
    def cancel(tid: str, who: str = Depends(require_wallet), authorization: str | None = Header(None), x_admin_proof: str | None = Header(None)):
        if who == admin:
            require_admin(authorization, x_admin_proof, need_proof=True)
        return service.cancel(tid, who)

    @app.post(prefix + '/tournaments/{tid}/close')
    def close(tid: str, who: str = Depends(require_wallet)):
        return service.close(tid, who)

    @app.post(prefix + '/tournaments/{tid}/report-match-result')
    def report(tid: str, body: dict, who: str = Depends(require_wallet)):
        t = service.get(tid)
        if who not in t['participants'] and who not in {admin, t['owner']}:
            raise TournamentError('FORBIDDEN', status=403)
        return service.report(tid, str(body.get('matchId', '')))
    return service
