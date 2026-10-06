"""Durable room chat and creator controls, separate from gameplay and settlement.

Call these methods with the wallet produced by the existing authentication layer.
Room ownership and admission are rechecked from persistence for every operation.
Public chat never contains wallet addresses; the owner-only roster is explicit.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Callable

from center.store import Store


class CommunityError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


DEFAULT_SETTINGS = {"muteChat": False, "hidePlayers": False, "hideGuesses": False}
LOBBY_STATES = {"registration", "ready"}
COMMUNITY_SCHEMA = (
    """CREATE TABLE IF NOT EXISTS room_community_settings (
        room_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL,
        updated_by TEXT NOT NULL, updated_at REAL NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS room_community_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL,
        who TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
        created_at REAL NOT NULL, deleted_at REAL, deleted_by TEXT)""",
    """CREATE INDEX IF NOT EXISTS idx_community_messages_room
        ON room_community_messages(room_id, id)""",
    """CREATE INDEX IF NOT EXISTS idx_community_messages_rate
        ON room_community_messages(room_id, who, created_at)""",
    """CREATE TABLE IF NOT EXISTS room_community_bans (
        room_id TEXT NOT NULL, who TEXT NOT NULL, created_by TEXT NOT NULL,
        created_at REAL NOT NULL, PRIMARY KEY(room_id, who))""",
    """CREATE TABLE IF NOT EXISTS room_community_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL,
        actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT,
        detail TEXT NOT NULL, created_at REAL NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS room_community_scheduled_hints (
        id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL,
        who TEXT NOT NULL, text TEXT NOT NULL, delay_seconds INTEGER NOT NULL,
        preset_index INTEGER, round_id TEXT, run_at REAL, created_at REAL NOT NULL,
        UNIQUE(room_id, preset_index))""",
    """CREATE TABLE IF NOT EXISTS room_community_hint_deliveries (
        schedule_id INTEGER NOT NULL, round_id TEXT NOT NULL, message_id INTEGER NOT NULL,
        delivered_at REAL NOT NULL, PRIMARY KEY(schedule_id, round_id))""",
)


class CommunityService:
    def __init__(self, store: Store, clock: Callable[[], float] = time.time):
        self.store = store
        self.clock = clock
        with store.tx() as cx:
            for statement in COMMUNITY_SCHEMA:
                cx.execute(statement)

    @staticmethod
    def _wallet(who: str | None) -> str:
        if not isinstance(who, str) or not re.fullmatch(r"0x[a-fA-F0-9]{40}", who):
            raise CommunityError("UNAUTHENTICATED", "A verified wallet is required.", 401)
        return who.lower()

    @staticmethod
    def _room(cx, room_id: str):
        room = cx.execute("SELECT owner, status FROM rooms WHERE id=?", (room_id,)).fetchone()
        if not room:
            raise CommunityError("NOT_FOUND", "No such room.", 404)
        return room

    def _owner(self, cx, room_id: str, who: str):
        room = self._room(cx, room_id)
        if room["owner"].lower() != who:
            raise CommunityError("FORBIDDEN", "Only the room creator can do that.", 403)
        return room

    def _member(self, cx, room_id: str, who: str):
        room = self._room(cx, room_id)
        if room["owner"].lower() == who:
            return room
        if cx.execute("SELECT 1 FROM room_community_bans WHERE room_id=? AND who=?", (room_id, who)).fetchone():
            raise CommunityError("ROOM_BANNED", "The creator has banned this wallet from the room.", 403)
        if not cx.execute("SELECT 1 FROM participants WHERE room_id=? AND who=? AND role='player'", (room_id, who)).fetchone():
            raise CommunityError("NOT_ADMITTED", "Join the room before opening its community.", 403)
        return room

    @staticmethod
    def _settings(cx, room_id: str) -> dict:
        row = cx.execute("SELECT settings_json FROM room_community_settings WHERE room_id=?", (room_id,)).fetchone()
        return {**DEFAULT_SETTINGS, **(json.loads(row[0]) if row else {})}

    def public_settings(self, room_id: str) -> dict:
        """Flags may be included in existing public room responses, never the roster."""
        with self.store.tx() as cx:
            self._room(cx, room_id)
            return self._settings(cx, room_id)

    def initialize(self, room_id: str, owner: str, options) -> None:
        """Idempotently seed creator defaults and private hints from validated config."""
        from center.schema import CommunityOptions
        if not isinstance(options, CommunityOptions):
            options = CommunityOptions.model_validate(options)
        owner = self._wallet(owner)
        settings = {"muteChat": options.mute_chat, "hidePlayers": options.hide_players, "hideGuesses": options.hide_guesses}
        with self.store.tx() as cx:
            self._owner(cx, room_id, owner)
            cx.execute("INSERT OR IGNORE INTO room_community_settings(room_id,settings_json,updated_by,updated_at) VALUES (?,?,?,?)",
                       (room_id, json.dumps(settings), owner, self.clock()))
            for index, hint in enumerate(options.timed_hints):
                cx.execute("INSERT OR IGNORE INTO room_community_scheduled_hints(room_id,who,text,delay_seconds,preset_index,created_at) VALUES (?,?,?,?,?,?)",
                           (room_id, owner, hint.text, hint.delay_seconds, index, self.clock()))

    def _audit(self, cx, room_id: str, actor: str, action: str, target: str | None = None, detail: dict | None = None):
        cx.execute("INSERT INTO room_community_audit(room_id,actor,action,target,detail,created_at) VALUES (?,?,?,?,?,?)",
                   (room_id, actor, action, target, json.dumps(detail or {}), self.clock()))

    def update_settings(self, room_id: str, who: str, patch: dict) -> dict:
        who = self._wallet(who)
        if not isinstance(patch, dict) or not patch or set(patch) - set(DEFAULT_SETTINGS) or any(type(value) is not bool for value in patch.values()):
            raise CommunityError("INVALID_SETTINGS", "Use boolean muteChat, hidePlayers, and hideGuesses settings.")
        with self.store.tx() as cx:
            self._owner(cx, room_id, who)
            settings = {**self._settings(cx, room_id), **patch}
            cx.execute("INSERT INTO room_community_settings(room_id,settings_json,updated_by,updated_at) VALUES (?,?,?,?) "
                       "ON CONFLICT(room_id) DO UPDATE SET settings_json=excluded.settings_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
                       (room_id, json.dumps(settings), who, self.clock()))
            self._audit(cx, room_id, who, "settings.updated", detail=patch)
            return settings

    def assert_can_join(self, room_id: str, who: str) -> None:
        """Mount before both HTTP/WS admission, ready actions, and gameplay actions."""
        who = self._wallet(who)
        with self.store.tx() as cx:
            self._room(cx, room_id)
            if cx.execute("SELECT 1 FROM room_community_bans WHERE room_id=? AND who=?", (room_id, who)).fetchone():
                raise CommunityError("ROOM_BANNED", "The creator has banned this wallet from the room.", 403)

    def post_message(self, room_id: str, who: str, text: str, kind: str = "chat", delay_seconds: int | None = None) -> dict:
        who = self._wallet(who)
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            raise CommunityError("INVALID_MESSAGE", "Messages must contain 1–500 characters.")
        if kind not in {"chat", "hint"}:
            raise CommunityError("INVALID_MESSAGE", "Choose chat or hint.")
        if delay_seconds is not None and (kind != "hint" or type(delay_seconds) is not int or not 0 <= delay_seconds <= 3600):
            raise CommunityError("INVALID_HINT_DELAY", "Host hints may be delayed by 0–3600 whole seconds.")
        text = text.strip()
        # Keep plain text safe for every client, including controls in copied messages.
        if any(ord(char) < 32 and char not in "\n\t" for char in text):
            raise CommunityError("INVALID_MESSAGE", "Control characters are not allowed.")
        with self.store.tx() as cx:
            room = self._member(cx, room_id, who)
            is_owner = room["owner"].lower() == who
            if kind == "hint" and not is_owner:
                raise CommunityError("FORBIDDEN", "Only the creator can publish a host hint.", 403)
            if kind == "chat" and self._settings(cx, room_id)["muteChat"] and not is_owner:
                raise CommunityError("CHAT_MUTED", "The creator has muted chat.", 409)
            now = self.clock()
            rate = cx.execute(
                "SELECT COUNT(*) AS n, MAX(created_at) AS latest FROM ("
                "SELECT m.created_at FROM room_community_messages m WHERE m.room_id=? AND m.who=? AND m.created_at>? "
                "AND NOT EXISTS(SELECT 1 FROM room_community_hint_deliveries d WHERE d.message_id=m.id) "
                "UNION ALL SELECT created_at FROM room_community_scheduled_hints "
                "WHERE room_id=? AND who=? AND preset_index IS NULL AND created_at>?)",
                (room_id, who, now - 60, room_id, who, now - 60)).fetchone()
            if rate["n"] >= 10 or (rate["latest"] is not None and now - rate["latest"] < 1):
                raise CommunityError("RATE_LIMIT", "Wait a moment before posting again. Up to 10 messages per minute.", 429)
            if delay_seconds is not None and delay_seconds > 0:
                if room["status"] not in LOBBY_STATES | {"running"}:
                    raise CommunityError("ROUND_NOT_OPEN", "Hints can be scheduled in the lobby or during a match.", 409)
                pending = cx.execute("SELECT COUNT(*) AS n FROM room_community_scheduled_hints s WHERE s.room_id=? AND NOT EXISTS(SELECT 1 FROM room_community_hint_deliveries d WHERE d.schedule_id=s.id)", (room_id,)).fetchone()["n"]
                if pending >= 20:
                    raise CommunityError("HINT_LIMIT", "A room can have up to 20 pending hints.", 409)
                round_row = cx.execute("SELECT round_id FROM rounds WHERE room_id=? ORDER BY started_at DESC LIMIT 1", (room_id,)).fetchone() if room["status"] == "running" else None
                if room["status"] == "running" and not round_row:
                    raise CommunityError("ROUND_NOT_OPEN", "The running round is not available.", 409)
                cursor = cx.execute("INSERT INTO room_community_scheduled_hints(room_id,who,text,delay_seconds,round_id,run_at,created_at) VALUES (?,?,?,?,?,?,?)",
                                    (room_id, who, text, delay_seconds, round_row[0] if round_row else None, now + delay_seconds if round_row else None, now))
                self._audit(cx, room_id, who, "hint.scheduled", detail={"scheduleId": cursor.lastrowid, "delaySeconds": delay_seconds})
                return {"scheduled": True, "scheduleId": cursor.lastrowid, "delaySeconds": delay_seconds}
            cursor = cx.execute("INSERT INTO room_community_messages(room_id,who,kind,text,created_at) VALUES (?,?,?,?,?)",
                                (room_id, who, kind, text, now))
            if kind == "hint":
                self._audit(cx, room_id, who, "hint.published", detail={"messageId": cursor.lastrowid})
            return {"messageId": cursor.lastrowid, "kind": kind, "createdAt": now}

    def deliver_hints(self, room_id: str, started_at: float, now: float) -> list[dict]:
        """A tick delivers due hints atomically; restart/repeated ticks cannot duplicate."""
        delivered = []
        with self.store.tx() as cx:
            room = self._room(cx, room_id)
            if room["status"] != "running":
                return delivered
            rnd = cx.execute("SELECT round_id,started_at FROM rounds WHERE room_id=? AND state='running' ORDER BY started_at DESC LIMIT 1", (room_id,)).fetchone()
            if not rnd:
                return delivered
            # Persisted start time is authoritative even if a recovered runtime has
            # a different in-memory clock. The caller's start value is advisory.
            actual_start = float(rnd["started_at"])
            hints = cx.execute("SELECT * FROM room_community_scheduled_hints s WHERE s.room_id=? AND (s.round_id IS NULL OR s.round_id=?) AND NOT EXISTS(SELECT 1 FROM room_community_hint_deliveries d WHERE d.schedule_id=s.id AND d.round_id=?) ORDER BY s.id", (room_id, rnd["round_id"], rnd["round_id"])).fetchall()
            for hint in hints:
                due = hint["run_at"] if hint["run_at"] is not None else actual_start + hint["delay_seconds"]
                if now < due:
                    continue
                cursor = cx.execute("INSERT INTO room_community_messages(room_id,who,kind,text,created_at) VALUES (?,?,'hint',?,?)", (room_id, hint["who"], hint["text"], now))
                cx.execute("INSERT INTO room_community_hint_deliveries(schedule_id,round_id,message_id,delivered_at) VALUES (?,?,?,?)", (hint["id"], rnd["round_id"], cursor.lastrowid, now))
                delivered.append({"messageId": cursor.lastrowid, "kind": "hint", "createdAt": now})
            return delivered

    def delete_message(self, room_id: str, who: str, message_id: int) -> dict:
        who = self._wallet(who)
        with self.store.tx() as cx:
            self._owner(cx, room_id, who)
            row = cx.execute("SELECT id FROM room_community_messages WHERE room_id=? AND id=?", (room_id, message_id)).fetchone()
            if not row:
                raise CommunityError("NOT_FOUND", "No such room message.", 404)
            cx.execute("UPDATE room_community_messages SET deleted_at=?,deleted_by=? WHERE room_id=? AND id=? AND deleted_at IS NULL",
                       (self.clock(), who, room_id, message_id))
            self._audit(cx, room_id, who, "message.deleted", detail={"messageId": message_id})
            return {"deleted": True, "messageId": message_id}

    def _remove(self, room_id: str, who: str, target: str, ban: bool) -> dict:
        who, target = self._wallet(who), self._wallet(target)
        with self.store.tx() as cx:
            room = self._owner(cx, room_id, who)
            if target == who:
                raise CommunityError("INVALID_TARGET", "The creator cannot remove their own wallet.")
            # Roster changes after start could change allocations or paid settlement.
            if room["status"] not in LOBBY_STATES:
                raise CommunityError("LOBBY_ONLY", "Kick and ban are available before the match starts.", 409)
            member = cx.execute("SELECT 1 FROM participants WHERE room_id=? AND who=?", (room_id, target)).fetchone()
            banned = cx.execute("SELECT 1 FROM room_community_bans WHERE room_id=? AND who=?", (room_id, target)).fetchone()
            if not member and not (ban and banned):
                raise CommunityError("NOT_FOUND", "That wallet is not in this room.", 404)
            if ban:
                cx.execute("INSERT OR IGNORE INTO room_community_bans(room_id,who,created_by,created_at) VALUES (?,?,?,?)", (room_id, target, who, self.clock()))
            cx.execute("DELETE FROM participants WHERE room_id=? AND who=?", (room_id, target))
            self._audit(cx, room_id, who, "player.banned" if ban else "player.kicked", target)
            return {"removed": True, "banned": ban, "wallet": target}

    def kick(self, room_id: str, who: str, target: str) -> dict:
        return self._remove(room_id, who, target, False)

    def ban(self, room_id: str, who: str, target: str) -> dict:
        return self._remove(room_id, who, target, True)

    def unban(self, room_id: str, who: str, target: str) -> dict:
        who, target = self._wallet(who), self._wallet(target)
        with self.store.tx() as cx:
            self._owner(cx, room_id, who)
            cx.execute("DELETE FROM room_community_bans WHERE room_id=? AND who=?", (room_id, target))
            self._audit(cx, room_id, who, "player.unbanned", target)
            return {"banned": False, "wallet": target}

    @staticmethod
    def _player_id(room_id: str, who: str) -> str:
        return hashlib.sha256(f"{room_id}:{who}".encode()).hexdigest()[:12]

    def _display(self, cx, room_id: str, who: str, hidden: bool = False):
        player_id = self._player_id(room_id, who)
        profile = None if hidden else cx.execute("SELECT name FROM profiles WHERE address=?", (who,)).fetchone()
        return {"playerId": player_id, "name": profile[0] if profile and profile[0] else f"Player {player_id[:4]}"}

    def roster(self, room_id: str, who: str) -> dict:
        who = self._wallet(who)
        with self.store.tx() as cx:
            self._owner(cx, room_id, who)
            players = [{**self._display(cx, room_id, row["who"]), "wallet": row["who"], "role": row["role"], "ready": bool(row["ready"])}
                       for row in cx.execute("SELECT who,role,ready FROM participants WHERE room_id=? ORDER BY joined_at", (room_id,)).fetchall()]
            banned = [{**self._display(cx, room_id, row["who"]), "wallet": row["who"]}
                      for row in cx.execute("SELECT who FROM room_community_bans WHERE room_id=? ORDER BY created_at", (room_id,)).fetchall()]
            return {"players": players, "banned": banned}

    def snapshot(self, room_id: str, who: str, after: int = 0) -> dict:
        who = self._wallet(who)
        if type(after) is not int or after < 0:
            raise CommunityError("INVALID_CURSOR", "Message cursor must be a nonnegative integer.")
        with self.store.tx() as cx:
            room = self._member(cx, room_id, who)
            settings = self._settings(cx, room_id)
            is_owner = room["owner"].lower() == who
            # Fetch the latest 100 and reverse for chronological display. Clients
            # refresh full snapshots (after=0) to pick up deletions of older messages.
            rows = cx.execute("SELECT id,who,kind,text,created_at,deleted_at FROM room_community_messages WHERE room_id=? AND id>? ORDER BY id DESC LIMIT 100", (room_id, after)).fetchall()
            messages = []
            for row in reversed(rows):
                messages.append({"id": row["id"], "kind": row["kind"], "text": "" if row["deleted_at"] is not None else row["text"],
                                 "deleted": row["deleted_at"] is not None, "createdAt": row["created_at"],
                                 "isMine": row["who"] == who, "isHost": row["who"] == room["owner"].lower(),
                                 **self._display(cx, room_id, row["who"], settings["hidePlayers"] and not is_owner)})
            players = [] if settings["hidePlayers"] and not is_owner else [
                {**self._display(cx, room_id, row["who"]), "ready": bool(row["ready"])}
                for row in cx.execute("SELECT who,ready FROM participants WHERE room_id=? AND role='player' ORDER BY joined_at", (room_id,)).fetchall()]
            return {"settings": settings, "messages": messages, "players": players, "isHost": is_owner}
