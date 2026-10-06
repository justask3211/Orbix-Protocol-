"""Signed game operations and invisible, read-only administrative observation.

Archival never deletes settlement evidence. Live moderation suspends inputs while
retaining the frozen player roster and scores. This module never exposes engine
snapshots, unrevealed seeds, private guesses, or sealed duel choices.
"""
from __future__ import annotations

import json
import time
from fastapi import Header, HTTPException, Query
from center.community import CommunityError, DEFAULT_SETTINGS

GAME_IDS = {"number-hunt", "boss-raid", "token-catch", "reaction-duel", "combat-duel"}


def game_availability(store, template_id):
    return {"status": "live", "message": "", **(store.get_setting(f"game-availability:{template_id}") or {})}


def room_archived(store, room_id):
    return bool((store.get_setting(f"room-archive:{room_id}") or {}).get("archived"))


class AdminGameService:
    def __init__(self, store, community, admin_address, clock=time.time):
        self.store, self.community = store, community
        self.admin = admin_address.lower()
        self.clock = clock
        with store.tx() as cx:
            cx.execute("CREATE TABLE IF NOT EXISTS admin_game_suspensions (room_id TEXT NOT NULL,who TEXT NOT NULL,round_id TEXT NOT NULL,actor TEXT NOT NULL,created_at REAL NOT NULL,PRIMARY KEY(room_id,who,round_id))")
            self.suspensions = {(r[0], r[1], r[2]) for r in cx.execute("SELECT room_id,who,round_id FROM admin_game_suspensions")}
            self.bans = {(r[0], r[1]) for r in cx.execute("SELECT room_id,who FROM room_community_bans")}
            self.archives = {r[0].removeprefix("room-archive:") for r in cx.execute("SELECT key,value_json FROM admin_settings WHERE key LIKE 'room-archive:%'") if json.loads(r[1]).get("archived")}

    def _authorize(self, actor):
        if not isinstance(actor, str) or actor.lower() != self.admin:
            raise CommunityError("NOT_ADMIN", "The configured admin wallet is required.", 403)
        return actor.lower()

    def _room(self, room_id):
        row = self.store.get_room(room_id)
        if not row:
            raise CommunityError("NOT_FOUND", "No such room.", 404)
        return row

    def _audit(self, actor, action, old, new):
        self.store.append_audit(actor, action, old, new, 46630)

    def availability(self, actor, template_id, status, message=""):
        actor = self._authorize(actor)
        if template_id not in GAME_IDS or status not in {"live", "maintenance", "offline"}:
            raise CommunityError("INVALID_AVAILABILITY", "Choose an available game and live, maintenance, or offline.")
        if not isinstance(message, str) or len(message) > 180:
            raise CommunityError("INVALID_MESSAGE", "A maintenance note supports up to 180 characters.")
        old = game_availability(self.store, template_id)
        value = {"status": status, "message": message.strip(), "updatedAt": self.clock()}
        self.store.set_setting(f"game-availability:{template_id}", value)
        self._audit(actor, "game.availability", {"templateId": template_id, **old}, {"templateId": template_id, **value})
        return value

    def rooms(self, actor, limit=100, offset=0):
        self._authorize(actor)
        with self.store.tx() as cx:
            rows = cx.execute("SELECT id FROM rooms ORDER BY created_at DESC LIMIT ? OFFSET ?", (min(max(limit, 1), 200), max(offset, 0))).fetchall()
            total = cx.execute("SELECT COUNT(*) FROM rooms").fetchone()[0]
        out = []
        for item in rows:
            r = self._room(item["id"])
            cfg = r["config"]
            out.append({"roomId": r["id"], "name": cfg.get("name", r["id"]), "templateId": r["template_id"],
                        "owner": r["owner"], "status": r["status"], "visibility": r["visibility"], "mode": r["mode"],
                        "players": len(self.store.participants(r["id"], role="player")), "createdAt": r["created_at"],
                        "archived": room_archived(self.store, r["id"]), "rewardKind": cfg.get("rewards", {}).get("kind", "points")})
        return {"rooms": out, "total": total}

    def observe(self, actor, room_id, runtime):
        self._authorize(actor)
        room = self._room(room_id)
        # The owner-authorized community view is safe to reuse after admin authority
        # has been established; reads cannot create a member or alter admission.
        roster = self.community.roster(room_id, room["owner"])
        community = self.community.snapshot(room_id, room["owner"])
        return {"roomId": room_id, "name": room["config"].get("name", room_id), "templateId": room["template_id"],
                "status": room["status"], "owner": room["owner"], "observer": "hidden", "readOnly": True,
                "publicState": runtime.engine.public_state() if runtime.engine else None,
                "roundId": runtime.round_id, "serverTimeMs": int(self.clock() * 1000),
                "roster": roster, "community": community, "archived": room_archived(self.store, room_id)}

    def settings(self, actor, room_id, patch):
        actor = self._authorize(actor)
        self._room(room_id)
        if not isinstance(patch, dict) or not patch or set(patch) - set(DEFAULT_SETTINGS) or any(type(v) is not bool for v in patch.values()):
            raise CommunityError("INVALID_SETTINGS", "Use boolean muteChat, hidePlayers, and hideGuesses settings.")
        old = self.community.public_settings(room_id)
        settings = {**old, **patch}
        with self.store.tx() as cx:
            cx.execute("INSERT INTO room_community_settings(room_id,settings_json,updated_by,updated_at) VALUES (?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET settings_json=excluded.settings_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at", (room_id, json.dumps(settings), actor, self.clock()))
        self._audit(actor, "room.admin_settings", {"roomId": room_id, **old}, {"roomId": room_id, **settings})
        return settings

    def hint(self, actor, room_id, text):
        actor = self._authorize(actor)
        room = self._room(room_id)
        if room["status"] not in {"registration", "ready", "running"}:
            raise CommunityError("ROUND_NOT_OPEN", "Hints are available in a lobby or a live match.", 409)
        if not isinstance(text, str) or not text.strip() or len(text) > 500 or any(ord(c) < 32 and c not in "\n\t" for c in text):
            raise CommunityError("INVALID_MESSAGE", "A clue supports 1–500 plain text characters.")
        # Authored explicitly as administrator. The hidden observer is never added
        # to the roster or disguised as the creator.
        with self.store.tx() as cx:
            row = cx.execute("INSERT INTO room_community_messages(room_id,who,kind,text,created_at) VALUES (?,?,'hint',?,?)", (room_id, actor, text.strip(), self.clock()))
            message_id = row.lastrowid
        self._audit(actor, "room.admin_hint", None, {"roomId": room_id, "messageId": message_id})
        return {"messageId": message_id, "kind": "hint"}

    def delete_message(self, actor, room_id, message_id):
        actor = self._authorize(actor)
        self._room(room_id)
        with self.store.tx() as cx:
            row = cx.execute("SELECT id FROM room_community_messages WHERE room_id=? AND id=?", (room_id, message_id)).fetchone()
            if not row:
                raise CommunityError("NOT_FOUND", "No such message.", 404)
            cx.execute("UPDATE room_community_messages SET deleted_at=?,deleted_by=? WHERE room_id=? AND id=?", (self.clock(), actor, room_id, message_id))
        self._audit(actor, "room.admin_message_delete", None, {"roomId": room_id, "messageId": message_id})
        return {"deleted": True}

    def moderate(self, actor, room_id, target, operation):
        actor = self._authorize(actor)
        target = self.community._wallet(target)
        room = self._room(room_id)
        if operation not in {"kick", "ban", "unban"}:
            raise CommunityError("INVALID_OPERATION", "Choose kick, ban, or unban.")
        if target == actor or target == room["owner"].lower():
            raise CommunityError("INVALID_TARGET", "The host and admin cannot be removed; archive a closed room instead.")
        with self.store.tx() as cx:
            if operation == "unban":
                cx.execute("DELETE FROM room_community_bans WHERE room_id=? AND who=?", (room_id, target))
                cx.execute("DELETE FROM admin_game_suspensions WHERE room_id=? AND who=?", (room_id, target))
            else:
                if not cx.execute("SELECT 1 FROM participants WHERE room_id=? AND who=?", (room_id, target)).fetchone():
                    raise CommunityError("NOT_FOUND", "That wallet is not a participant.", 404)
                if room["status"] not in {"registration", "ready", "running"}:
                    raise CommunityError("ROUND_NOT_OPEN", "Moderation is available in lobbies and live matches.", 409)
                if operation == "ban":
                    cx.execute("INSERT OR IGNORE INTO room_community_bans(room_id,who,created_by,created_at) VALUES (?,?,?,?)", (room_id, target, actor, self.clock()))
                if room["status"] == "running":
                    cx.execute("INSERT OR REPLACE INTO admin_game_suspensions(room_id,who,round_id,actor,created_at) VALUES (?,?,?,?,?)", (room_id, target, room["round_id"] or "", actor, self.clock()))
                else:
                    cx.execute("DELETE FROM participants WHERE room_id=? AND who=?", (room_id, target))
        self._audit(actor, f"room.admin_{operation}", None, {"roomId": room_id, "wallet": target, "frozenRosterPreserved": room["status"] == "running"})
        if operation == "unban":
            self.bans.discard((room_id, target))
            self.suspensions = {item for item in self.suspensions if item[:2] != (room_id, target)}
        else:
            if operation == "ban":
                self.bans.add((room_id, target))
            if room["status"] == "running":
                self.suspensions.add((room_id, target, room["round_id"] or ""))
        return {"wallet": target, "operation": operation, "suspended": operation != "unban" and room["status"] == "running"}

    def assert_can_act(self, room_id, wallet, round_id=None):
        wallet = self.community._wallet(wallet)
        if (room_id, wallet) in self.bans:
            raise CommunityError("ROOM_BANNED", "This wallet is banned from this room.", 403)
        if (room_id, wallet, round_id or "") in self.suspensions:
            raise CommunityError("PLAYER_SUSPENDED", "An administrator suspended your controls for this round.", 403)
        if room_id in self.archives:
            raise CommunityError("ROOM_ARCHIVED", "This room has been removed from active play.", 410)

    def archive(self, actor, room_id, archived=True):
        actor = self._authorize(actor)
        row = self._room(room_id)
        if type(archived) is not bool:
            raise CommunityError("INVALID_SETTINGS", "Archived must be a boolean.")
        if archived and row["status"] == "running":
            raise CommunityError("MATCH_RUNNING", "Finish the running match before archiving its room.", 409)
        old = self.store.get_setting(f"room-archive:{room_id}")
        self.store.set_setting(f"room-archive:{room_id}", {"archived": archived, "at": self.clock()})
        if archived:
            self.archives.add(room_id)
        else:
            self.archives.discard(room_id)
        self._audit(actor, "room.admin_archive", old, {"roomId": room_id, "archived": archived, "recordsPreserved": True})
        return {"roomId": room_id, "archived": archived, "recordsPreserved": True}

    def archive_unused(self, actor):
        actor = self._authorize(actor)
        with self.store.tx() as cx:
            ids = [r[0] for r in cx.execute("SELECT r.id FROM rooms r WHERE r.updated_at<? AND r.status IN ('registration','ready','closed','cancelled') AND NOT EXISTS(SELECT 1 FROM participants p WHERE p.room_id=r.id) LIMIT 200", (self.clock() - 86400,)).fetchall()]
        archived = []
        for room_id in ids:
            if not room_archived(self.store, room_id):
                self.archive(actor, room_id)
                archived.append(room_id)
        return {"archived": archived, "count": len(archived), "recordsPreserved": True}


def mount_admin_games(app, prefix, store, community, require_admin, runtime_for, hub, admin_address):
    service = AdminGameService(store, community, admin_address)
    app.state.admin_games = service

    @app.get(f"{prefix}/admin/games")
    def games(authorization: str | None = Header(default=None)):
        require_admin(authorization, need_proof=False)
        return {"games": [{"templateId": key, **game_availability(store, key)} for key in sorted(GAME_IDS)]}

    @app.patch(f"{prefix}/admin/games/{{template_id}}")
    def game_update(template_id: str, body: dict, authorization: str | None = Header(default=None), x_admin_proof: str | None = Header(default=None, alias="X-Admin-Proof")):
        actor = require_admin(authorization, x_admin_proof, need_proof=True)
        return service.availability(actor, template_id, body.get("status"), body.get("message", ""))

    @app.get(f"{prefix}/admin/rooms")
    def rooms(authorization: str | None = Header(default=None), limit: int = Query(default=100, ge=1, le=200), offset: int = Query(default=0, ge=0)):
        return service.rooms(require_admin(authorization, need_proof=False), limit, offset)

    @app.get(f"{prefix}/admin/rooms/{{room_id}}/observe")
    async def observe(room_id: str, authorization: str | None = Header(default=None)):
        actor = require_admin(authorization, need_proof=False)
        return service.observe(actor, room_id, runtime_for(room_id))

    @app.post(f"{prefix}/admin/rooms/archive-unused")
    def unused(authorization: str | None = Header(default=None), x_admin_proof: str | None = Header(default=None, alias="X-Admin-Proof")):
        return service.archive_unused(require_admin(authorization, x_admin_proof, need_proof=True))

    @app.post(f"{prefix}/admin/rooms/{{room_id}}/actions")
    async def action(room_id: str, body: dict, authorization: str | None = Header(default=None), x_admin_proof: str | None = Header(default=None, alias="X-Admin-Proof")):
        actor = require_admin(authorization, x_admin_proof, need_proof=True)
        operation = body.get("operation")
        if operation == "settings":
            result=service.settings(actor, room_id, body.get("settings"))
            runtime_for(room_id)._community_cache=None
            return result
        if operation == "hint":
            return service.hint(actor, room_id, body.get("text"))
        if operation == "delete-message":
            message_id = body.get("messageId")
            if type(message_id) is not int:
                raise HTTPException(422, detail={"code": "INVALID_MESSAGE_ID", "message": "A message ID is required."})
            return service.delete_message(actor, room_id, message_id)
        if operation == "archive":
            return service.archive(actor, room_id, body.get("archived", True))
        if operation in {"kick", "ban", "unban"}:
            result = service.moderate(actor, room_id, body.get("wallet"), operation)
            if operation=='unban':
                rt=runtime_for(room_id)
                if rt.engine and hasattr(rt.engine,'suspended'):
                    rt.engine.suspended.discard(result['wallet'])
                    rt._checkpoint_arena(service.clock())
            if operation != "unban":
                wallet = result["wallet"]
                rt = runtime_for(room_id)
                if result["suspended"] and rt.engine and hasattr(rt.engine, "suspended"):
                    rt.engine.suspended.add(wallet)
                    rt.engine.inputs.pop(wallet, None)
                    # Arena snapshots include suspensions; root runtime recovery
                    # also restores its action guard from the durable service.
                    if hasattr(rt, "_checkpoint_arena"):
                        rt._checkpoint_arena(service.clock())
                    else:
                        store.save_snapshot(rt.round_id, rt.engine.snapshot())
                app.state.tickets = {k: t for k, t in getattr(app.state, "tickets", {}).items() if not (t["room"] == room_id and t["who"] == wallet)}
                for conn in list(hub._conns.values()):
                    if conn["room"] == room_id and conn["who"] == wallet:
                        await conn["ws"].close(code=4403)
            return result
        raise HTTPException(422, detail={"code": "INVALID_OPERATION", "message": "Choose a supported administrative room action."})
    return service
