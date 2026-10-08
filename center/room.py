"""Room runtime: lifecycle, realtime protocol and the settlement hand-off.

This is where the manual's invariants are enforced end to end:
  * a room's config is frozen before play and hashed; the seed is committed before play
  * an elapsed deadline is handled by the scheduler even with zero connected clients
  * a terminal state is never overwritten by a later timer
  * Ready/entry state belongs to the participant identity, not to a socket
  * a slow consumer is resynced or dropped, never allowed to block the room
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
import time
from collections import deque
from typing import Any

from center import lifecycle as lc
from center import settlement as st
from center.games import ENGINES, Engine, commit_hash, engine_for
from center.schema import RoomConfig
from center.store import ConflictError, Store
from center.vault import VaultService

PROTOCOL_VERSION = 1
DEFAULT_CHAIN_ID = int(os.environ.get("CENTER_CHAIN_ID", "46630"))
PLACEHOLDER_ESCROW = os.environ.get("CENTER_ESCROW", "0x" + "00" * 20)


class SlowConsumer(Exception):
    """The socket queue is full: the client must resync from a snapshot."""


class Hub:
    """Connection registry with a bounded per-connection queue."""

    def __init__(self, maxsize: int = 64) -> None:
        self._conns: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()
        self.frame_filter = None

    async def register(self, conn_id: str, room_id: str, who: str, ws, role: str = "player") -> None:
        async with self._lock:
            self._conns[conn_id] = {
                "room": room_id, "who": who, "ws": ws, "role": role,
                "queue": asyncio.Queue(maxsize=64),
            }

    async def unregister(self, conn_id: str) -> None:
        async with self._lock:
            self._conns.pop(conn_id, None)

    def who(self, conn_id: str) -> str | None:
        conn = self._conns.get(conn_id)
        return conn["who"] if conn else None

    def count(self, room_id: str) -> int:
        return sum(1 for c in self._conns.values() if c["room"] == room_id)

    def connected_players(self, room_id: str) -> set[str]:
        return {c["who"] for c in list(self._conns.values())
                if c["room"] == room_id and c.get("role", "player") == "player"}

    async def send(self, who: str, msg: dict, room_id: str | None = None) -> None:
        for conn in list(self._conns.values()):
            if conn["who"] == who and (room_id is None or conn["room"] == room_id):
                self._enqueue(conn, self.frame_filter(conn, msg) if self.frame_filter else msg)

    async def broadcast(self, room_id: str, msg: dict) -> None:
        for conn in list(self._conns.values()):
            if conn["room"] == room_id:
                self._enqueue(conn, self.frame_filter(conn, msg) if self.frame_filter else msg)

    @staticmethod
    def _enqueue(conn: dict, msg: dict) -> None:
        try:
            conn["queue"].put_nowait(msg)
        except asyncio.QueueFull:
            # Drop the oldest pending frame and flag a required resync instead of blocking.
            try:
                conn["queue"].get_nowait()
                conn["queue"].put_nowait({"v": PROTOCOL_VERSION, "type": "resync.required"})
            except Exception:
                pass

    async def pump(self, conn_id: str) -> None:
        conn = self._conns.get(conn_id)
        if not conn:
            return
        while True:
            msg = await conn["queue"].get()
            await conn["ws"].send_text(json.dumps(msg))


class RoomRuntime:
    """One live room. Owns the engine, the round record and the broadcast surface."""

    def __init__(self, store: Store, vault: VaultService, hub: Hub, room: dict,
                 config: RoomConfig, engine: Engine | None = None) -> None:
        self.store = store
        self.vault = vault
        self.hub = hub
        self.room_id: str = room["id"]
        self.owner: str = room["owner"]
        self.config = config
        self.status: str = room["status"]
        self.revision: int = int(room.get("revision", 1))
        self.round_id: str | None = room.get("round_id")
        self.seed: str | None = room.get("seed")
        self.commit: str | None = room.get("commit_hash")
        self.join_code: str = room.get("join_code", "")
        self.engine = engine
        self.finished_at: float | None = None
        self._deadline: float | None = None
        self.actions_seen: deque = deque(maxlen=2000)
        from center.community import CommunityService
        self.community = CommunityService(store)
        self._last_hint_tick = 0.0
        self.entry_verifier = None
        self.action_guard = None
        self._arena_actions = []
        self._arena_seq = None
        self._arena_checkpoint_at = 0.0
        self._arena_broadcast_at = 0.0

    # ------------------------------------------------------------------ factories

    @classmethod
    def create(cls, store: Store, vault: VaultService, hub: Hub, *, owner: str, config: RoomConfig,
               room_id: str | None = None, status: str = lc.REGISTRATION) -> "RoomRuntime":
        room_id = room_id or secrets.token_hex(8)
        room = {
            "id": room_id,
            "owner": owner.lower(),
            "template_id": config.template_id,
            "visibility": config.visibility,
            "mode": config.mode,
            "status": status,
            "config": config.model_dump(mode="json"),
            "config_hash": "0x" + hashlib.sha256(config.config_hash_input().encode()).hexdigest(),
        }
        store.create_room(room)
        return cls(store, vault, hub, store.get_room(room_id), config)

    @classmethod
    def load(cls, store: Store, vault: VaultService, hub: Hub, room_id: str) -> "RoomRuntime | None":
        row = store.get_room(room_id)
        if not row:
            return None
        from center.schema import RoomConfig as RC

        config = RC(**row["config"])
        rt = cls(store, vault, hub, row, config)
        # A reserved rematch has no snapshot: never restore the prior match into it.
        rnd = store.get_round(rt.round_id) if rt.round_id else store.room_round(room_id)
        if rnd and rnd.get("snapshot"):
            engine_cls = engine_for(config)
            rt.engine = engine_cls.restore(config, rnd["round_id"], rnd["seed"], rnd["snapshot"])
            duration = float(getattr(config.rules, "duration_seconds", 120))
            if config.template_id == "reaction-duel":
                duration = config.rules.rounds * (config.rules.choice_window_seconds + config.rules.reveal_window_seconds)
            rt._deadline = rnd["started_at"] + duration
        if rnd:
            rt.finished_at = rnd.get("ended_at")
        return rt

    # ------------------------------------------------------------------ state helpers

    def _set_status(self, target: str) -> None:
        new = lc.transition(self.status, target)
        if new != self.status:
            self.revision = self.store.update_room(self.room_id, expected_revision=self.revision, status=new)
            self.status = new

    def is_playable(self) -> bool:
        return lc.is_playable(self.status) and self.engine is not None

    def close(self, reason: str = "") -> None:
        """Move the room to CLOSED if the lifecycle allows it. Carries every
        non-terminal state through CANCELLED/CLAIMABLE first, so no state is
        skipped and the terminal state is never overwritten."""
        if self.status == lc.CLOSED:
            return
        path = {
            lc.DRAFT: [lc.CANCELLED, lc.REFUNDABLE, lc.CLOSED],
            lc.PREVIEW_PUBLISHED: [lc.CANCELLED, lc.REFUNDABLE, lc.CLOSED],
            lc.CONFIG_FROZEN: [lc.CANCELLED, lc.REFUNDABLE, lc.CLOSED],
            lc.FUNDING: [lc.CANCELLED, lc.REFUNDABLE, lc.CLOSED],
            lc.FUNDED: [lc.CANCELLED, lc.REFUNDABLE, lc.CLOSED],
            lc.REGISTRATION: [lc.CANCELLED, lc.REFUNDABLE, lc.CLOSED],
            lc.READY: [lc.CANCELLED, lc.REFUNDABLE, lc.CLOSED],
            lc.RUNNING: [lc.RESULT_PENDING, lc.SETTLEMENT_PENDING, lc.CLAIMABLE, lc.CLOSED],
            lc.RECOVERY_REQUIRED: [lc.REFUNDABLE, lc.CLOSED],
            lc.RESULT_PENDING: [lc.SETTLEMENT_PENDING, lc.CLAIMABLE, lc.CLOSED],
            lc.SETTLEMENT_PENDING: [lc.CLAIMABLE, lc.CLOSED],
            lc.CLAIMABLE: [lc.CLOSED],
            lc.CANCELLED: [lc.REFUNDABLE, lc.CLOSED],
            lc.REFUNDABLE: [lc.CLOSED],
        }.get(self.status, [])
        for target in path:
            try:
                self._set_status(target)
            except Exception:
                continue
        if self.status == lc.CLOSED:
            self.store.append_action(self.room_id, -1, "system", {"close": reason}, True)

    def hub_clients(self) -> int:
        """Connected client count for this room (used by the reaper)."""
        try:
            return self.hub.count(self.room_id)
        except Exception:
            return 0

    def deadline(self) -> float | None:
        return self._deadline

    # ------------------------------------------------------------------ participants

    def join(self, who: str, role: str = "player", invite: str | None = None, now: float | None = None) -> dict:
        """Admit a participant. Private rooms demand a valid invite; unlisted/private never
        appear in discovery, and a leaked URL cannot bypass a private room."""
        now = now or time.time()
        who = who.lower()
        if role not in {"player", "spectator"}:
            raise ValueError("BAD_ROLE")
        if self.status not in lc.JOINABLE:
            if who not in {p["who"] for p in self.store.participants(self.room_id)}:
                raise ValueError("REGISTRATION_CLOSED")
        if role == "spectator" and not self.config.admission.spectators:
            raise ValueError("SPECTATORS_DISABLED")
        if self.config.visibility == "private":
            previously_admitted=any(p['who']==who for p in self.store.participants(self.room_id))
            if who!=self.owner and not previously_admitted and not self.store.invite_valid(self.room_id, invite):
                raise PermissionError("INVITE_REQUIRED")
        players = [p for p in self.store.participants(self.room_id) if p["role"] == "player"]
        if role == "player" and who not in {p["who"] for p in players}:
            if len(players) >= self.config.admission.player_cap:
                raise ValueError("ROOM_FULL")
        if role == "player" and self.config.entry.kind == "erc20":
            if self.entry_verifier is None:
                raise ValueError("ENTRY_VERIFICATION_UNAVAILABLE")
            self.entry_verifier(who)
        self.store.join(self.room_id, who, role)

        # Joiner fee: either the creator absorbs it from the vault, or the player sees it.
        joiner_fee = self.config.access.joiner_fee
        if who == self.owner:
            # Hosting is not joining: the creator is never charged their own joiner fee.
            fee_state = "host"
        elif joiner_fee > 0 and self.store.get_room(self.room_id)["mode"] == "preview":
            if self.config.access.creator_absorbs_joiner_fee:
                self.vault.charge_joiner_fee(self.owner, self.room_id, joiner_fee, who)
                fee_state = "absorbed-by-creator"
            else:
                fee_state = "player-pays"
        else:
            fee_state = "none"
        return {"role": role, "joinerFee": fee_state, "status": self.status}

    def set_ready(self, who: str, ready: bool = True) -> dict:
        if who.lower() not in {p["who"] for p in self.store.participants(self.room_id, role="player")}:
            raise ValueError("NOT_ADMITTED")
        if self.action_guard:self.action_guard(who.lower())
        self.store.set_ready(self.room_id, who.lower(), ready)
        return {"ready": self.store.ready_count(self.room_id)}

    def rematch_capability(self) -> dict:
        financial = (self.config.rewards.kind != "preview-points" or self.config.entry.kind != "free"
                     or self.config.access.vault_mode != "simulated" or self.config.mode != "preview")
        return {"supported": not financial, "requiresFreshRoom": financial,
                "reason": "FRESH_FUNDED_ROOM_REQUIRED" if financial else None}

    def _rematch_players(self) -> list[str]:
        """Presence filtering is scoped to rematches; original admission stays intact."""
        connected = self.hub.connected_players(self.room_id)
        eligible = []
        for p in self.store.participants(self.room_id, role="player"):
            if not p["ready"] or p["who"] not in connected:
                continue
            try:
                self.community.assert_can_join(self.room_id, p["who"])
                if self.action_guard:
                    self.action_guard(p["who"])
            except Exception as exc:
                if getattr(exc, "code", "") in {"ROOM_BANNED", "PLAYER_SUSPENDED", "ROOM_ARCHIVED"}:
                    continue
                raise
            eligible.append(p["who"])
        return eligible

    async def prepare_rematch(self, config: RoomConfig | None = None, now: float | None = None) -> dict:
        """Reserve a fresh preview match while retaining every finished round/claim.

        This explicit host command begins a new match in the room container.
        Existing lifecycle transitions still prevent stale timers reopening it.
        """
        now = time.time() if now is None else now
        if not self.rematch_capability()["supported"]:
            raise ValueError("FRESH_FUNDED_ROOM_REQUIRED")
        old = self.store.get_round(self.round_id) if self.round_id else None
        if self.status not in {lc.CLAIMABLE, lc.CLOSED} or not old or old.get("ended_at") is None:
            raise ValueError("MATCH_NOT_FINISHED")
        cfg = config or self.config
        if (cfg.mode != "preview" or cfg.rewards.kind != "preview-points"
                or cfg.entry.kind != "free" or cfg.access.vault_mode != "simulated"):
            raise ValueError("FRESH_FUNDED_ROOM_REQUIRED")
        if cfg.template_id != self.config.template_id:
            raise ValueError("REMATCH_TEMPLATE_CHANGED")
        if cfg.timing.close_at and now >= cfg.timing.close_at:
            raise ValueError("ROOM_SCHEDULE_ENDED")
        previous = self.round_id
        round_id, seed = secrets.token_hex(16), secrets.token_hex(32)
        config_hash = "0x" + hashlib.sha256(cfg.config_hash_input().encode()).hexdigest()
        commit = "0x" + commit_hash(round_id, config_hash, seed)
        self.revision = self.store.prepare_rematch(self.room_id, self.revision, cfg.model_dump(mode="json"),
                                                  config_hash, round_id, seed, commit, reset_community=config is not None)
        self.config, self.status = cfg, lc.REGISTRATION
        self.round_id, self.seed, self.commit = round_id, seed, commit
        self.engine = None
        self.finished_at = self._deadline = None
        self.actions_seen.clear()
        self._arena_actions.clear()
        self._arena_seq = None
        self._arena_checkpoint_at = self._arena_broadcast_at = self._last_hint_tick = 0.0
        self._last_settlement = None
        self._community_cache = None
        if hasattr(self, "_closed_at"):
            del self._closed_at
        payload = {"roomId": self.room_id, "roomNumber": self.join_code, "joinCode": self.join_code,
                   "status": self.status, "roundId": round_id, "previousRoundId": previous,
                   "commitHash": commit, "readinessReset": True, "config": cfg.public_dict(),
                   "rematch": self.rematch_capability()}
        await self.hub.broadcast(self.room_id, {"v": PROTOCOL_VERSION, "type": "room.rematch",
                                                "roundId": round_id, "payload": payload})
        return payload

    # ------------------------------------------------------------------ round start

    async def start(self, now: float | None = None) -> dict:
        now = now or time.time()
        if self.status not in {lc.REGISTRATION, lc.READY}:
            raise ValueError("ROUND_NOT_OPEN")
        if self.engine is not None and not self.engine.finished:
            raise ValueError("ROUND_ALREADY_RUNNING")
        reserved = self.store.get_round(self.round_id) if self.round_id else None
        is_rematch = reserved is not None and reserved["state"] == lc.REGISTRATION
        players = self._rematch_players() if is_rematch else [p["who"] for p in self.store.participants(self.room_id) if p["role"] == "player"]
        if not players:
            raise ValueError("NO_PLAYERS")
        ready = len(players) if is_rematch else self.store.ready_count(self.room_id)
        # min_ready_to_start is a hard floor: a host cannot start early just because fewer
        # players joined (min(cap, len) would let a 2-ready room start with one player).
        if ready < self.config.admission.min_ready_to_start:
            raise ValueError("NOT_READY")
        if len(players) > self.config.admission.player_cap:
            raise ValueError("ROOM_FULL")

        self.round_id = self.round_id or secrets.token_hex(16)
        self.seed = self.seed or secrets.token_hex(32)
        config_hash = self.store.get_room(self.room_id)["config_hash"]
        raw_commit = commit_hash(self.round_id, config_hash, self.seed)
        # the wire format always carries the 0x prefix, whatever the helper returns
        self.commit = raw_commit if raw_commit.startswith("0x") else "0x" + raw_commit

        engine_cls = engine_for(self.config)
        engine = engine_cls(self.config, self.round_id, self.seed, players)
        if self.config.template_id == "boss-raid" and getattr(self.config.rules, "team_mode", "coop") == "teams":
            engine.teams = (self.store.get_setting(f"teams:{self.room_id}") or {}).get("teams", {})
            if getattr(engine, 'arena', False):
                size = self.config.rules.team_size
                team_count = max(2, (self.config.admission.player_cap + size - 1) // size)
                teams = {p:t for p,t in engine.teams.items() if p in players and t in {f'team-{i+1}' for i in range(team_count)}}
                for p in players:
                    if p not in teams:
                        teams[p] = min((f'team-{i+1}' for i in range(team_count)), key=lambda t:sum(v==t for v in teams.values()))
                if len(set(teams.values())) < 2:
                    raise ValueError('CHOOSE_AT_LEAST_TWO_TEAMS')
                if any(sum(v==t for v in teams.values()) > size for t in set(teams.values())):
                    raise ValueError('TEAM_FULL')
                engine.teams = teams
                self.store.set_setting(f'teams:{self.room_id}', {'teams':teams})
        engine.start(now)
        self.engine = engine
        if getattr(self.engine,'arena',False):
            from center.games.arena import CHARACTERS
            chosen=(self.store.get_setting(f'characters:{self.room_id}') or {}).get('characters',{})
            for p, body in self.engine.bodies.items():
                profile = self.store.get_profile(p) or {}
                if getattr(self.engine, 'version', 2) >= 4:
                    body['character'] = chosen.get(p, profile.get('character', 'blob'))
                    body['cosmetics'] = profile.get('cosmetics', {})
                elif chosen.get(p) in CHARACTERS:
                    body['character'] = chosen[p]
        duration = float(getattr(self.config.rules, "duration_seconds", 120))
        if self.config.template_id == "reaction-duel":
            duration = self.config.rules.rounds * (self.config.rules.choice_window_seconds + self.config.rules.reveal_window_seconds)
        self._deadline = now + duration
        self._set_status(lc.RUNNING)

        self.store.save_round({
            "round_id": self.round_id, "room_id": self.room_id, "seed": self.seed,
            "commit_hash": self.commit, "started_at": now, "state": lc.RUNNING,
            "snapshot": self.engine.snapshot(),
            "config": self.config.model_dump(mode="json"), "config_hash": config_hash,
            "action_start_seq": reserved["action_start_seq"] if reserved else self.store.next_seq(self.room_id) - 1,
        })
        self.revision = self.store.update_room(
            self.room_id, expected_revision=self.revision, status=lc.RUNNING,
            round_id=self.round_id, seed=self.seed, commit_hash=self.commit,
        )
        self.status = lc.RUNNING

        await self.hub.broadcast(self.room_id, {
            "v": PROTOCOL_VERSION, "type": "round.started",
            "roundId": self.round_id, "commitHash": self.commit,
            "deadline": self._deadline, "state": self.engine.public_state(),
        })
        return {"roundId": self.round_id, "commitHash": self.commit, "deadline": self._deadline}

    # ------------------------------------------------------------------ play

    async def act(self, who: str, action: dict, now: float | None = None) -> dict:
        now = now or time.time()
        if self.engine is None or not self.is_playable():
            return {"ok": False, "error": "ROUND_NOT_OPEN"}
        if self.action_guard:
            self.action_guard(who.lower())
        if getattr(self.engine, 'arena', False):
            return await self._arena_act(who.lower(), action, now)
        seq = self.store.next_seq(self.room_id)
        result = self.engine.act(who.lower(), action, now)
        self.store.append_action(self.room_id, seq, who.lower(), action, result.ok)
        if result.ok:
            self.actions_seen.append({"who": who.lower(), "action": action, "at": round(now, 3)})
            # Durability: a restart must resume mid-round, so checkpoint after every
            # accepted action as well as writing the action log.
            if self.round_id:
                self.store.save_snapshot(self.round_id, self.engine.snapshot())
        msg = {
            "v": PROTOCOL_VERSION, "type": "action.ack" if result.ok else "action.rejected",
            "seq": seq, "roundId": self.round_id, "actionId": action.get("actionId"),
            "payload": {"accepted": result.ok, "error": result.error,
                        "patch": result.patch, "scores": result.scores},
        }
        await self.hub.send(who.lower(), {**msg, "payload": {**msg["payload"], **(result.private or {})}}, self.room_id)
        if result.ok:
            # Every player must see accepted public state, including a Duel opponent's
            # sealed status. Private preimages and hints never enter this frame.
            await self.hub.broadcast(self.room_id, {"v": PROTOCOL_VERSION, "type": "game.patch", "seq": seq, "roundId": self.round_id, "payload": self.engine.public_state()})

        if result.finished:
            await self.finish(now)
        return {"ok": result.ok, "error": result.error, "finished": result.finished}

    def _checkpoint_arena(self, now):
        if not self.round_id:
            return
        self.store.checkpoint_arena(self.room_id,self.round_id,self.engine.snapshot(),self._arena_actions)
        self._arena_actions.clear()
        self._arena_checkpoint_at=now

    async def _arena_act(self, who, action, now):
        result=self.engine.act(who,action,now)
        if not result.ok:
            return {'ok':False,'error':result.error,'finished':result.finished}
        if self._arena_seq is None:self._arena_seq=self.store.next_seq(self.room_id)-1
        self._arena_seq+=1
        self._arena_actions.append({'seq':self._arena_seq,'who':who,'action':action,'at':round(now,3)})
        # Inputs are durable in batches, never one SQLite transaction per render frame.
        # Combat/character changes and settlement flush immediately.
        if action.get('kind') not in {'move','block','equip'} or now-self._arena_checkpoint_at>=1:
            self._checkpoint_arena(now)
        if result.finished:await self.finish(now)
        return {'ok':True,'error':None,'finished':result.finished}

    # ------------------------------------------------------------------ clock

    async def tick(self, now: float) -> bool:
        """Advance time-driven state. Returns True when the round ended."""
        if self.engine is None or self.engine.finished:
            return False
        if lc.is_terminal(self.status):
            return True
        result = self.engine.tick(now)
        if now - self._last_hint_tick >= 1:
            self.community.deliver_hints(self.room_id, getattr(self.engine, "started_at", 0), now)
            self._last_hint_tick = now
        if getattr(self.engine, 'arena', False):
            if now-self._arena_checkpoint_at>=1 or self.engine.finished:
                self._checkpoint_arena(now)
            if now-self._arena_broadcast_at>=.1 or self.engine.finished:
                await self.hub.broadcast(self.room_id, {'v':PROTOCOL_VERSION,'type':'game.patch','roundId':self.round_id,'payload':self.engine.public_state()})
                self._arena_broadcast_at=now
            if self.engine.finished or (self._deadline is not None and now>=self._deadline):
                if not self.engine.finished:self.engine._finish()
                await self.finish(now)
                return True
            return False
        if result is not None and self.round_id and (self.config.template_id != "token-catch" or result.finished):
            self.store.save_snapshot(self.round_id, self.engine.snapshot())
        if result is not None and result.patch:
            await self.hub.broadcast(self.room_id, {
                "v": PROTOCOL_VERSION, "type": "game.patch", "roundId": self.round_id, "payload": result.patch,
            })
        overdue = self._deadline is not None and now >= self._deadline
        if self.engine.finished or overdue:
            await self.finish(now)
            return True
        return False

    # ------------------------------------------------------------------ settlement

    async def finish(self, now: float | None = None) -> dict:
        now = now or time.time()
        if self.engine is None:
            raise ValueError("NO_ROUND")
        if self.finished_at is not None:
            return {"roundId": self.round_id, "alreadyFinished": True}
        if getattr(self.engine, 'arena', False):
            if not self.engine.finished:self.engine._finish()
            self._checkpoint_arena(now)
        self.engine.finished = True
        self.finished_at = now
        self._set_status(lc.RESULT_PENDING)

        actions = [{"who": a["who"], "action": a["action"], "at": a["at"]} for a in self.actions_seen]
        if getattr(self.engine, 'arena', False):
            start_seq = (self.store.get_round(self.round_id) or {}).get('action_start_seq', 0)
            actions=[{'who':a['who'],'action':json.loads(a['payload']),'at':a['at']} for a in self.store.actions_since(self.room_id,start_seq) if a['accepted']]
        transcript = st.transcript_hash(self.round_id or "", actions)
        config_hash = self.store.get_room(self.room_id)["config_hash"]

        entitlements = self.engine.entitlements()
        escrow = PLACEHOLDER_ESCROW if self.config.mode == "preview" else os.environ.get("CENTER_ESCROW", PLACEHOLDER_ESCROW)
        deadline = int(now) + int(os.environ.get("CENTER_SETTLE_SECONDS", "3600"))
        epoch = int(os.environ.get("CENTER_AUTHORITY_EPOCH", "1"))

        entries: list[dict] = []
        leaves: list[bytes] = []
        for e in entitlements:
            effective_kind = e.asset_kind or "preview-points"
            cid, leaf = st.entitlement_leaf(
                chain_id=DEFAULT_CHAIN_ID, escrow=escrow, round_id=self.round_id or "",
                winner=e.winner, slot_id=e.slot_id, allocation_nonce=0,
                asset_kind=effective_kind,
                asset_contract=e.asset_contract or ("0x" + "00" * 20),
                token_id=e.token_id, amount=e.amount,
            )
            entries.append({
                "claimId": "0x" + cid.hex(), "roundId": self.round_id, "winner": e.winner,
                "slotId": e.slot_id, "points": e.points, "assetKind": effective_kind,
                "assetContract": e.asset_contract, "tokenId": e.token_id, "amount": e.amount,
                "code": st.payment_code("0x" + cid.hex()),
            })
            leaves.append(leaf)

        root = st.merkle_root(leaves) if leaves else b"\x00" * 32
        alloc = st.allocations_hash(entries)

        for i, entry in enumerate(entries):
            proof = st.merkle_proof(leaves, i) if leaves else []
            self.store.save_entitlement({
                **entry, "room_id": self.room_id, "asset_kind": entry["assetKind"],
                "asset_contract": entry["assetContract"], "token_id": entry["tokenId"],
                "amount": entry["amount"], "round_id": self.round_id,
                "claim_id": entry["claimId"], "winner": entry["winner"], "slot_id": entry["slotId"],
                "proof": ["0x" + p.hex() for p in proof],
            })

        self.store.save_round({
            "round_id": self.round_id, "room_id": self.room_id, "seed": self.seed,
            "commit_hash": self.commit or "", "started_at": (self.store.get_round(self.round_id) or {}).get("started_at", now), "ended_at": now,
            "merkle_root": "0x" + root.hex(), "allocations_hash": "0x" + alloc.hex(),
            "transcript_hash": "0x" + transcript.hex(), "settlement_deadline": deadline,
            "settled_at": now, "state": lc.CLAIMABLE, "snapshot": self.engine.snapshot(),
        })
        # A preview round has no chain confirmation step, but it still passes through the
        # settlement state so the recorded state always matches what actually happened.
        self._set_status(lc.SETTLEMENT_PENDING)
        self._set_status(lc.CLAIMABLE)

        settlement_frame = {
            "v": PROTOCOL_VERSION, "type": "settlement.finalized", "roundId": self.round_id,
            "payload": {
                "merkleRoot": "0x" + root.hex(), "allocationsHash": "0x" + alloc.hex(),
                "transcriptHash": "0x" + transcript.hex(), "deadline": deadline,
                "escrow": escrow, "chainId": DEFAULT_CHAIN_ID,
                "allocations": entries,
                "results": self._result_rows(),
            },
        }
        self._last_settlement = settlement_frame
        await self.hub.broadcast(self.room_id, settlement_frame)
        return {"roundId": self.round_id, "allocations": entries}

    async def cancel(self, reason: str = "host-cancelled") -> dict:
        if lc.is_terminal(self.status):
            return {"status": self.status}
        self._set_status(lc.CANCELLED)
        self._set_status(lc.REFUNDABLE)
        await self.hub.broadcast(self.room_id, {
            "v": PROTOCOL_VERSION, "type": "room.cancelled", "payload": {"reason": reason},
        })
        return {"status": self.status}

    # ------------------------------------------------------------------ fairness view

    def fairness(self) -> dict:
        rnd = (self.store.get_round(self.round_id) if self.round_id else None) or {}
        return {
            "roundId": self.round_id,
            "commitHash": rnd.get("commit_hash"),
            "configHash": rnd.get("config_hash"),
            "seed": rnd.get("seed") if rnd.get("ended_at") is not None else None,
            "merkleRoot": rnd.get("merkle_root"),
            "allocationsHash": rnd.get("allocations_hash"),
            "transcriptHash": rnd.get("transcript_hash"),
            "settlementDeadline": rnd.get("settlement_deadline"),
            "chainId": DEFAULT_CHAIN_ID,
            "escrow": PLACEHOLDER_ESCROW if self.config.mode == "preview" else os.environ.get("CENTER_ESCROW", PLACEHOLDER_ESCROW),
            "actions": [{"who": a["who"], "at": a["at"], "kind": a["action"].get("kind")} for a in self.actions_seen],
            "publicState": self.engine.public_state() if self.engine else None,
        }

    def settlement_frame(self) -> dict | None:
        """The settlement.finalized frame for this room, rebuilt from durable state.

        Serves reconnecting clients after a restart too: nothing here depends on
        in-memory state alone.
        """
        rnd = (self.store.get_round(self.round_id) if self.round_id else None) or {}
        if self.status not in {lc.CLAIMABLE, lc.CLOSED} or not rnd.get("merkle_root"):
            return getattr(self, "_last_settlement", None)  # live frame if present, else nothing
        root = rnd["merkle_root"]
        allocations = self.store.entitlements_for_round(self.round_id or "")
        entries = [
            {
                "claimId": e["claim_id"], "roundId": e["round_id"], "winner": e["winner"],
                "slotId": e["slot_id"], "points": e["points"], "assetKind": e["asset_kind"],
                "assetContract": e["asset_contract"], "tokenId": e["token_id"],
                "amount": e["amount"], "code": st.payment_code(e["claim_id"]),
            }
            for e in allocations
        ]
        return {
            "v": PROTOCOL_VERSION, "type": "settlement.finalized", "roundId": self.round_id,
            "payload": {
                "merkleRoot": root, "allocationsHash": rnd.get("allocations_hash"),
                "transcriptHash": rnd.get("transcript_hash"),
                "deadline": rnd.get("settlement_deadline"),
                "escrow": PLACEHOLDER_ESCROW if self.config.mode == "preview" else os.environ.get("CENTER_ESCROW", PLACEHOLDER_ESCROW),
                "chainId": DEFAULT_CHAIN_ID,
                "allocations": entries,
                "results": self._result_rows(),
            },
        }

    def _result_rows(self) -> list[dict]:
        """Scores are presentation data; only the engine decides final eligibility.

        Number Hunt's score is remaining guesses, so a positive score cannot prove
        a win. Preserve the engine's actual ordered ranking, including its tie
        policy, rather than sorting by that display score on the client.
        """
        if self.engine is None:
            return []
        scores = self.engine.scores()
        eligible = self.engine.eligible() if self.engine.finished else set()
        return [{"who": who, "score": scores.get(who, 0), "rank": rank, "eligible": who in eligible}
                for rank, who in enumerate(self.engine.ranking(), 1)]

    def results(self) -> dict:
        if self.engine is None:
            return {"roundId": self.round_id, "results": [], "state": self.status}
        return {
            "roundId": self.round_id,
            "state": self.status,
            "results": self._result_rows(),
            "entitlements": self.store.entitlements_for_round(self.round_id or ""),
        }


class Scheduler:
    """Drives time-based engine ticks and closes overdue rooms with no clients attached."""

    def __init__(self, runtimes: dict[str, RoomRuntime], interval: float = 0.25, sweep_every: float = 5.0) -> None:
        self.runtimes = runtimes
        self.interval = interval
        self.sweep_every = sweep_every
        self._task: asyncio.Task | None = None
        self._last_sweep = 0.0

    async def _loop(self) -> None:
        while True:
            now = time.time()
            for rt in list(self.runtimes.values()):
                try:
                    await rt.tick(now)
                except Exception:
                    continue
            if now - self._last_sweep >= self.sweep_every:
                self._last_sweep = now
                for rt in list(self.runtimes.values()):
                    # Deadline enforcement is independent of connected clients.
                    if rt.status == lc.RUNNING and rt.deadline() and now >= rt.deadline() and not rt.engine.finished:
                        await rt.finish(now)
                self._enforce_schedules(now)
                self._reap_closed(now)
            arenas = any(getattr(rt.engine, 'arena', False) and rt.status == lc.RUNNING for rt in self.runtimes.values())
            catching = any(rt.config.template_id == "token-catch" and rt.status == lc.RUNNING for rt in self.runtimes.values())
            await asyncio.sleep(min(self.interval, 1/30 if arenas else .05) if arenas or catching else self.interval)

    def _enforce_schedules(self, now: float) -> None:
        """Open scheduled rooms at their open_at time; close rooms whose close_at
        has passed. Both are idempotent — the lifecycle module rejects illegal
        transitions, so a late sweep can never reopen a closed room."""
        for rt in list(self.runtimes.values()):
            timing = getattr(rt.config, "timing", None)
            if timing is None:
                continue
            # scheduled opening: draft/preview -> registration once open_at arrives
            if timing.open_at and now >= timing.open_at and rt.status in (lc.DRAFT, lc.PREVIEW_PUBLISHED):
                try:
                    if rt.status == lc.DRAFT:
                        rt._set_status(lc.PREVIEW_PUBLISHED)
                    if rt.status == lc.PREVIEW_PUBLISHED:
                        rt._set_status(lc.REGISTRATION)
                except Exception:
                    pass
            # scheduled closing: any live state -> CLOSED once close_at passes
            if timing.close_at and now >= timing.close_at and rt.status not in lc.TERMINAL:
                try:
                    rt.close("schedule elapsed")
                except Exception:
                    pass

    def _reap_closed(self, now: float) -> None:
        """Drop runtimes for rooms that have been CLOSED for a while, freeing
        scheduler CPU and memory so the process can host more rooms. The room row
        stays in the store (history, claims), only the in-memory runtime goes."""
        reap_after = getattr(self, "reap_after", 120.0)
        for rid, rt in list(self.runtimes.items()):
            if rt.status != lc.CLOSED:
                continue
            closed_at = getattr(rt, "_closed_at", None)
            if closed_at is None:
                rt._closed_at = now  # start the timer on first sighting
                continue
            if now - closed_at >= reap_after and not rt.hub_clients():
                self.runtimes.pop(rid, None)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        # Movement is batched during play; commit the final accepted batch before
        # a graceful restart closes the database.
        for rt in list(self.runtimes.values()):
            if getattr(rt.engine, 'arena', False) and rt.round_id:
                rt._checkpoint_arena(time.time())
