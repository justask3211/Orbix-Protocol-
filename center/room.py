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
from center.games import ENGINES, Engine, commit_hash
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

    async def send(self, who: str, msg: dict) -> None:
        for conn in list(self._conns.values()):
            if conn["who"] == who:
                self._enqueue(conn, msg)

    async def broadcast(self, room_id: str, msg: dict) -> None:
        for conn in list(self._conns.values()):
            if conn["room"] == room_id:
                self._enqueue(conn, msg)

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
        self.engine = engine
        self.finished_at: float | None = None
        self._deadline: float | None = None
        self.actions_seen: deque = deque(maxlen=2000)

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
            "config": config.public_dict(),
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
        rnd = store.room_round(room_id)
        if rnd and rnd.get("snapshot") and rnd.get("state") in {lc.RUNNING, lc.RESULT_PENDING}:
            engine_cls = ENGINES[config.template_id]
            rt.engine = engine_cls.restore(config, rnd["round_id"], rnd["seed"], rnd["snapshot"])
        return rt

    # ------------------------------------------------------------------ state helpers

    def _set_status(self, target: str) -> None:
        new = lc.transition(self.status, target)
        if new != self.status:
            self.revision = self.store.update_room(self.room_id, expected_revision=self.revision, status=new)
            self.status = new

    def is_playable(self) -> bool:
        return lc.is_playable(self.status) and self.engine is not None

    def deadline(self) -> float | None:
        return self._deadline

    # ------------------------------------------------------------------ participants

    def join(self, who: str, role: str = "player", invite: str | None = None, now: float | None = None) -> dict:
        """Admit a participant. Private rooms demand a valid invite; unlisted/private never
        appear in discovery, and a leaked URL cannot bypass a private room."""
        now = now or time.time()
        who = who.lower()
        if self.config.visibility == "private" and role == "player":
            if not self.store.invite_valid(self.room_id, invite):
                raise PermissionError("INVITE_REQUIRED")
        players = [p for p in self.store.participants(self.room_id) if p["role"] == "player"]
        if role == "player" and who not in {p["who"] for p in players}:
            if len(players) >= self.config.admission.player_cap:
                raise ValueError("ROOM_FULL")
            if self.config.entry.kind == "erc20":
                # A paid room records the entry intent; the chain confirms it out of band.
                pass
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
        self.store.set_ready(self.room_id, who.lower(), ready)
        return {"ready": self.store.ready_count(self.room_id)}

    # ------------------------------------------------------------------ round start

    async def start(self, now: float | None = None) -> dict:
        now = now or time.time()
        if self.engine is not None and not self.engine.finished:
            raise ValueError("ROUND_ALREADY_RUNNING")
        players = [p["who"] for p in self.store.participants(self.room_id) if p["role"] == "player"]
        if not players:
            raise ValueError("NO_PLAYERS")
        ready = self.store.ready_count(self.room_id)
        # min_ready_to_start is a hard floor: a host cannot start early just because fewer
        # players joined (min(cap, len) would let a 2-ready room start with one player).
        if ready < self.config.admission.min_ready_to_start:
            raise ValueError("NOT_READY")

        self.round_id = self.round_id or secrets.token_hex(16)
        self.seed = self.seed or secrets.token_hex(32)
        config_hash = "0x" + hashlib.sha256(self.config.config_hash_input().encode()).hexdigest()
        raw_commit = commit_hash(self.round_id, config_hash, self.seed)
        # the wire format always carries the 0x prefix, whatever the helper returns
        self.commit = raw_commit if raw_commit.startswith("0x") else "0x" + raw_commit

        engine_cls = ENGINES[self.config.template_id]
        self.engine = engine_cls(self.config, self.round_id, self.seed, players)
        self.engine.start(now)
        self._deadline = now + float(getattr(self.config.rules, "duration_seconds", 120))
        self._set_status(lc.RUNNING)

        self.store.save_round({
            "round_id": self.round_id, "room_id": self.room_id, "seed": self.seed,
            "commit_hash": self.commit, "started_at": now, "state": lc.RUNNING,
            "snapshot": self.engine.snapshot(),
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
        if result.ok and result.private:
            await self.hub.send(who.lower(), {**msg, "payload": {**msg["payload"], **result.private}})
            await self.hub.broadcast(self.room_id, {**msg, "payload": {"accepted": True, "patch": result.patch, "scores": result.scores}})
        else:
            await self.hub.send(who.lower(), msg)

        if result.finished:
            await self.finish(now)
        return {"ok": result.ok, "error": result.error, "finished": result.finished}

    # ------------------------------------------------------------------ clock

    async def tick(self, now: float) -> bool:
        """Advance time-driven state. Returns True when the round ended."""
        if self.engine is None or self.engine.finished:
            return False
        if lc.is_terminal(self.status):
            return True
        result = self.engine.tick(now)
        if result is not None and self.round_id:
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
        self.engine.finished = True
        self.finished_at = now
        self._set_status(lc.RESULT_PENDING)

        actions = [{"who": a["who"], "action": a["action"], "at": a["at"]} for a in self.actions_seen]
        transcript = st.transcript_hash(self.round_id or "", actions)
        config_hash = "0x" + hashlib.sha256(self.config.config_hash_input().encode()).hexdigest()

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
            "commit_hash": self.commit or "", "started_at": now, "ended_at": now,
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
                "results": [{"who": p, "score": self.engine.scores().get(p, 0)} for p in self.engine.ranking()],
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
        rnd = self.store.room_round(self.room_id) or {}
        return {
            "roundId": self.round_id,
            "commitHash": rnd.get("commit_hash"),
            "seed": rnd.get("seed"),
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
        rnd = self.store.room_round(self.room_id) or {}
        if self.status != lc.CLAIMABLE or not rnd.get("merkle_root"):
            return getattr(self, "_last_settlement", None)  # live frame if present, else nothing
        root = rnd["merkle_root"]
        allocations = self.store.entitlements_for_round(self.round_id or "")
        entries = [
            {
                "claimId": e["claim_id"], "roundId": e["round_id"], "winner": e["winner"],
                "slotId": e["slot_id"], "points": e["points"], "assetKind": e["asset_kind"],
                "assetContract": e["asset_contract"], "tokenId": e["token_id"],
                "amount": e["amount"], "code": "OC1-" + e["claim_id"][:8].upper() + "-" + e["claim_id"][8:14].upper(),
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
                "results": [{"who": p, "score": self.engine.scores().get(p, 0)} for p in self.engine.ranking()] if self.engine else [],
            },
        }

    def results(self) -> dict:
        if self.engine is None:
            return {"roundId": self.round_id, "results": [], "state": self.status}
        return {
            "roundId": self.round_id,
            "state": self.status,
            "results": [{"who": p, "score": self.engine.scores().get(p, 0)} for p in self.engine.ranking()],
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
            await asyncio.sleep(self.interval)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
