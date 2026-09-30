"""SQLite persistence for Center.

Durable state is required before any funded room may be labelled live: a restart must be
able to resume a round, and a chain cursor must survive a redeploy. Every room mutation
goes through a compare-and-swap on `rooms.revision` so two concurrent writers cannot
silently clobber each other (manual section 8).
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms (
    id            TEXT PRIMARY KEY,
    owner         TEXT NOT NULL,
    template_id   TEXT NOT NULL,
    visibility    TEXT NOT NULL,
    mode          TEXT NOT NULL,
    status        TEXT NOT NULL,
    config_json   TEXT NOT NULL,
    config_hash   TEXT NOT NULL,
    round_id      TEXT,
    seed          TEXT,
    commit_hash   TEXT,
    revision      INTEGER NOT NULL DEFAULT 1,
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
    room_id  TEXT NOT NULL,
    who      TEXT NOT NULL,
    role     TEXT NOT NULL DEFAULT 'player',
    ready    INTEGER NOT NULL DEFAULT 0,
    joined_at REAL NOT NULL,
    PRIMARY KEY (room_id, who)
);
CREATE TABLE IF NOT EXISTS invites (
    room_id  TEXT NOT NULL,
    code     TEXT NOT NULL,
    created_at REAL NOT NULL,
    revoked  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, code)
);
CREATE TABLE IF NOT EXISTS rounds (
    round_id        TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL,
    seed            TEXT NOT NULL,
    commit_hash     TEXT NOT NULL,
    started_at      REAL NOT NULL,
    ended_at        REAL,
    merkle_root     TEXT,
    allocations_hash TEXT,
    transcript_hash TEXT,
    settlement_deadline INTEGER,
    settled_at      REAL,
    state           TEXT NOT NULL,
    snapshot_json   TEXT
);
CREATE TABLE IF NOT EXISTS entitlements (
    claim_id     TEXT PRIMARY KEY,
    round_id     TEXT NOT NULL,
    room_id      TEXT NOT NULL,
    winner       TEXT NOT NULL,
    slot_id      INTEGER NOT NULL,
    points       INTEGER NOT NULL DEFAULT 0,
    asset_kind   TEXT,
    asset_contract TEXT,
    token_id     INTEGER NOT NULL DEFAULT 0,
    amount       TEXT NOT NULL DEFAULT '0',
    proof_json   TEXT NOT NULL DEFAULT '[]',
    claimed_tx   TEXT,
    created_at   REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    creator    TEXT NOT NULL,
    intent_id  TEXT,
    kind       TEXT NOT NULL,          -- deposit | room-creation | joiner-absorbed | refund
    amount     TEXT NOT NULL,          -- integer base units, as a string
    unit       TEXT NOT NULL,          -- 'simulated' | token address
    room_id    TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
    room_id  TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    who      TEXT NOT NULL,
    payload  TEXT NOT NULL,
    accepted INTEGER NOT NULL,
    at       REAL NOT NULL,
    PRIMARY KEY (room_id, seq)
);
CREATE TABLE IF NOT EXISTS intents (
    intent_id  TEXT PRIMARY KEY,
    creator    TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    amount     TEXT NOT NULL,
    room_id    TEXT,
    state      TEXT NOT NULL,          -- reserved | consumed | refunded
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_creator ON ledger(creator, id DESC);
CREATE INDEX IF NOT EXISTS idx_actions_room ON actions(room_id, seq);
CREATE INDEX IF NOT EXISTS idx_entitlements_winner ON entitlements(winner);
"""


class ConflictError(Exception):
    """A compare-and-swap revision check failed: another writer moved first."""


class Store:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.environ.get("CENTER_DB", "/home/agentuser/vibeswap/center/center.db")
        if self.path != ":memory:":
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    # ------------------------------------------------------------------ plumbing

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            try:
                yield self._conn
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ------------------------------------------------------------------ rooms

    def create_room(self, room: dict) -> None:
        now = time.time()
        with self.tx() as c:
            c.execute(
                """INSERT INTO rooms (id, owner, template_id, visibility, mode, status,
                       config_json, config_hash, round_id, seed, commit_hash, revision, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)""",
                (
                    room["id"], room["owner"], room["template_id"], room["visibility"], room["mode"],
                    room["status"], json.dumps(room["config"]), room["config_hash"],
                    room.get("round_id"), room.get("seed"), room.get("commit_hash"), now, now,
                ),
            )

    def get_room(self, room_id: str) -> dict | None:
        with self.tx() as c:
            row = c.execute("SELECT * FROM rooms WHERE id=?", (room_id,)).fetchone()
        return self._room_row(row) if row else None

    def list_rooms(self, visibility: str | None = None, limit: int = 50) -> list[dict]:
        q = "SELECT * FROM rooms"
        args: list[Any] = []
        if visibility:
            q += " WHERE visibility=?"
            args.append(visibility)
        q += " ORDER BY created_at DESC LIMIT ?"
        args.append(limit)
        with self.tx() as c:
            rows = c.execute(q, args).fetchall()
        return [self._room_row(r) for r in rows]

    def update_room(self, room_id: str, *, expected_revision: int, status: str | None = None,
                    round_id: str | None = None, seed: str | None = None,
                    commit_hash: str | None = None, config: dict | None = None) -> int:
        """Compare-and-swap update. Raises ConflictError when `expected_revision` is stale."""
        sets: list[str] = ["updated_at=?"]
        args: list = [time.time()]
        if status is not None:
            sets.append("status=?")
            args.append(status)
        if round_id is not None:
            sets.append("round_id=?")
            args.append(round_id)
        if seed is not None:
            sets.append("seed=?")
            args.append(seed)
        if commit_hash is not None:
            sets.append("commit_hash=?")
            args.append(commit_hash)
        if config is not None:
            sets.append("config_json=?")
            args.append(json.dumps(config))
        sets.append("revision=revision+1")
        args.extend([room_id, expected_revision])
        with self.tx() as c:
            cur = c.execute(f"UPDATE rooms SET {', '.join(sets)} WHERE id=? AND revision=?", args)
            if cur.rowcount != 1:
                raise ConflictError(f"room {room_id} revision {expected_revision} is stale")
            row = c.execute("SELECT revision FROM rooms WHERE id=?", (room_id,)).fetchone()
        return int(row["revision"])

    @staticmethod
    def _room_row(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["config"] = json.loads(d["config_json"])
        return d

    # ------------------------------------------------------------------ participants

    def join(self, room_id: str, who: str, role: str = "player") -> None:
        with self.tx() as c:
            c.execute(
                "INSERT OR IGNORE INTO participants (room_id, who, role, ready, joined_at) VALUES (?,?,?,0,?)",
                (room_id, who, role, time.time()),
            )

    def set_ready(self, room_id: str, who: str, ready: bool) -> None:
        with self.tx() as c:
            c.execute("UPDATE participants SET ready=? WHERE room_id=? AND who=?", (1 if ready else 0, room_id, who))

    def participants(self, room_id: str, role: str | None = None) -> list[dict]:
        q = "SELECT * FROM participants WHERE room_id=?"
        args: list[Any] = [room_id]
        if role:
            q += " AND role=?"
            args.append(role)
        q += " ORDER BY joined_at"
        with self.tx() as c:
            return [dict(r) for r in c.execute(q, args).fetchall()]

    def ready_count(self, room_id: str) -> int:
        with self.tx() as c:
            row = c.execute(
                "SELECT COUNT(*) n FROM participants WHERE room_id=? AND role='player' AND ready=1", (room_id,)
            ).fetchone()
        return int(row["n"])

    # ------------------------------------------------------------------ invites

    def add_invite(self, room_id: str, code: str) -> None:
        with self.tx() as c:
            c.execute("INSERT OR REPLACE INTO invites (room_id, code, created_at, revoked) VALUES (?,?,?,0)",
                      (room_id, code, time.time()))

    def revoke_invite(self, room_id: str, code: str) -> None:
        with self.tx() as c:
            c.execute("UPDATE invites SET revoked=1 WHERE room_id=? AND code=?", (room_id, code))

    def invite_valid(self, room_id: str, code: str | None) -> bool:
        if not code:
            return False
        with self.tx() as c:
            row = c.execute("SELECT revoked FROM invites WHERE room_id=? AND code=?", (room_id, code)).fetchone()
        return bool(row) and not row["revoked"]

    # ------------------------------------------------------------------ rounds / actions

    def save_round(self, rnd: dict) -> None:
        with self.tx() as c:
            c.execute(
                """INSERT OR REPLACE INTO rounds (round_id, room_id, seed, commit_hash, started_at, ended_at,
                       merkle_root, allocations_hash, transcript_hash, settlement_deadline, settled_at, state, snapshot_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rnd["round_id"], rnd["room_id"], rnd["seed"], rnd["commit_hash"], rnd["started_at"],
                    rnd.get("ended_at"), rnd.get("merkle_root"), rnd.get("allocations_hash"),
                    rnd.get("transcript_hash"), rnd.get("settlement_deadline"), rnd.get("settled_at"),
                    rnd["state"], json.dumps(rnd.get("snapshot")) if rnd.get("snapshot") is not None else None,
                ),
            )

    def save_snapshot(self, round_id: str, snapshot: dict) -> None:
        """Checkpoint the engine state so a restart resumes mid-round, not from scratch."""
        with self.tx() as c:
            c.execute("UPDATE rounds SET snapshot_json=? WHERE round_id=?",
                      (json.dumps(snapshot), round_id))

    def get_round(self, round_id: str) -> dict | None:
        with self.tx() as c:
            row = c.execute("SELECT * FROM rounds WHERE round_id=?", (round_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["snapshot"] = json.loads(d["snapshot_json"]) if d["snapshot_json"] else None
        return d

    def room_round(self, room_id: str) -> dict | None:
        with self.tx() as c:
            row = c.execute("SELECT * FROM rounds WHERE room_id=? ORDER BY started_at DESC LIMIT 1", (room_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["snapshot"] = json.loads(d["snapshot_json"]) if d["snapshot_json"] else None
        return d

    def next_seq(self, room_id: str) -> int:
        with self.tx() as c:
            row = c.execute("SELECT COALESCE(MAX(seq),0) n FROM actions WHERE room_id=?", (room_id,)).fetchone()
        return int(row["n"]) + 1

    def append_action(self, room_id: str, seq: int, who: str, payload: dict, accepted: bool) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT OR REPLACE INTO actions (room_id, seq, who, payload, accepted, at) VALUES (?,?,?,?,?,?)",
                (room_id, seq, who, json.dumps(payload), 1 if accepted else 0, time.time()),
            )

    def actions_since(self, room_id: str, seq: int) -> list[dict]:
        with self.tx() as c:
            rows = c.execute("SELECT * FROM actions WHERE room_id=? AND seq>? ORDER BY seq", (room_id, seq)).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------ entitlements

    def save_entitlement(self, e: dict) -> None:
        with self.tx() as c:
            c.execute(
                """INSERT OR REPLACE INTO entitlements (claim_id, round_id, room_id, winner, slot_id, points,
                       asset_kind, asset_contract, token_id, amount, proof_json, claimed_tx, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    e["claim_id"], e["round_id"], e["room_id"], e["winner"], e["slot_id"], e.get("points", 0),
                    e.get("asset_kind"), e.get("asset_contract"), e.get("token_id", 0), str(e.get("amount", 0)),
                    json.dumps(e.get("proof", [])), e.get("claimed_tx"), time.time(),
                ),
            )

    def get_entitlement(self, claim_id: str) -> dict | None:
        with self.tx() as c:
            row = c.execute("SELECT * FROM entitlements WHERE claim_id=?", (claim_id,)).fetchone()
        return dict(row) if row else None

    def entitlements_for(self, winner: str) -> list[dict]:
        with self.tx() as c:
            rows = c.execute("SELECT * FROM entitlements WHERE winner=?", (winner,)).fetchall()
        return [dict(r) for r in rows]

    def entitlements_for_round(self, round_id: str) -> list[dict]:
        with self.tx() as c:
            rows = c.execute("SELECT * FROM entitlements WHERE round_id=? ORDER BY slot_id", (round_id,)).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------ intents + ledger

    def create_intent(self, intent_id: str, creator: str, config_hash: str, amount: int, room_id: str | None) -> bool:
        """Reserve a publication intent. Returns False when it already exists (idempotent)."""
        with self.tx() as c:
            row = c.execute("SELECT state FROM intents WHERE intent_id=?", (intent_id,)).fetchone()
            if row:
                return False
            c.execute(
                "INSERT INTO intents (intent_id, creator, config_hash, amount, room_id, state, created_at) VALUES (?,?,?,?,?,?,?)",
                (intent_id, creator, config_hash, str(amount), room_id, "reserved", time.time()),
            )
        return True

    def set_intent_room(self, intent_id: str, room_id: str) -> None:
        with self.tx() as c:
            c.execute("UPDATE intents SET room_id=? WHERE intent_id=?", (room_id, intent_id))

    def set_intent_state(self, intent_id: str, state: str) -> None:
        with self.tx() as c:
            c.execute("UPDATE intents SET state=? WHERE intent_id=?", (state, intent_id))

    def get_intent(self, intent_id: str) -> dict | None:
        with self.tx() as c:
            row = c.execute("SELECT * FROM intents WHERE intent_id=?", (intent_id,)).fetchone()
        return dict(row) if row else None

    def add_ledger(self, creator: str, kind: str, amount: int, unit: str,
                   intent_id: str | None = None, room_id: str | None = None) -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO ledger (creator, intent_id, kind, amount, unit, room_id, created_at) VALUES (?,?,?,?,?,?,?)",
                (creator, intent_id, kind, str(amount), unit, room_id, time.time()),
            )

    def ledger(self, creator: str, limit: int = 100) -> list[dict]:
        with self.tx() as c:
            rows = c.execute("SELECT * FROM ledger WHERE creator=? ORDER BY id DESC LIMIT ?", (creator, limit)).fetchall()
        return [dict(r) for r in rows]

    def balance(self, creator: str, unit: str) -> int:
        """Deposits minus deductions plus refunds, as an integer in base units."""
        with self.tx() as c:
            rows = c.execute(
                "SELECT kind, amount FROM ledger WHERE creator=? AND unit=?", (creator, unit)
            ).fetchall()
        total = 0
        for r in rows:
            amt = int(r["amount"])
            total += amt if r["kind"] in {"deposit", "refund"} else -amt
        return total

    def spent_by_creator(self, creator: str, unit: str) -> int:
        with self.tx() as c:
            row = c.execute(
                "SELECT COALESCE(SUM(CAST(amount AS INTEGER)),0) n FROM ledger WHERE creator=? AND unit=? AND kind IN ('room-creation','joiner-absorbed')",
                (creator, unit),
            ).fetchone()
        return int(row["n"])
