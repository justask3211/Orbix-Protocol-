"""Center HTTP + WebSocket API (`/api/center/v1`).

Feature flags gate every funded path. Enabling a funded flag without addresses, a chain
and durable storage is refused at startup rather than silently pretending to work.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import base64
import json
import logging
import sqlite3
from functools import wraps
import os
import re
import secrets
import time
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, ValidationError

from center import lifecycle as lc
from center import settlement as st
from center.pricing import ADMIN_ADDRESS, FeeSchedule, SETTING_KEY, caps as pricing_caps
from center.room import PROTOCOL_VERSION, Hub, RoomRuntime, Scheduler
from center.schema import TEMPLATE_META, RoomConfig, normalise_keys, parse_rules
from center.store import ConflictError, Store
from center.community import CommunityService, CommunityError
from center.privacy import visible_state
from center.entry_gate import EntryGateVerifier, EntryGateError, DEPLOYED_GATE
from center.admin_games import mount_admin_games, game_availability, room_archived
from center.practice import mount_practice
from center.vault import InsufficientBalance, OnchainVault, VaultError, VaultService, publication_intent
from center.vault import JsonRpc

API_PREFIX = "/api/center/v1"
SESSION_TTL = 60 * 60 * 24 * 30  # 30 days; a returning wallet re-signs silently anyway


def profile_storage(operation):
    """Keep storage failures observable and safe to retry without leaking SQL."""
    @wraps(operation)
    def guarded(*args, **kwargs):
        try:
            return operation(*args, **kwargs)
        except (sqlite3.Error, OSError) as error:
            logging.getLogger("center.storage").exception(
                "profile_storage_failed", extra={"operation": operation.__name__, "retriable": True})
            raise HTTPException(503, detail={"code": "PROFILE_STORAGE_UNAVAILABLE",
                "message": "Profile storage is temporarily unavailable. Please retry.", "retriable": True},
                headers={"Retry-After": "2"}) from error
    return guarded


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Flags(BaseModel):
    preview: bool = True
    testnet_rewards: bool = False
    real_burn: bool = False
    mainnet: bool = False
    vault_token: str | None = None
    vault_address: str | None = None
    escrow: str | None = None
    chain_id: int = 46630

    @classmethod
    def from_env(cls) -> "Flags":
        return cls(
            preview=env_flag("CENTER_PREVIEW", True),
            testnet_rewards=env_flag("CENTER_TESTNET_REWARDS", False),
            real_burn=env_flag("CENTER_REAL_BURN", False),
            mainnet=env_flag("CENTER_MAINNET", False),
            vault_token=os.environ.get("CENTER_VAULT_TOKEN"),
            vault_address=os.environ.get("CENTER_VAULT"),
            escrow=os.environ.get("CENTER_ESCROW"),
            chain_id=int(os.environ.get("CENTER_CHAIN_ID", "46630")),
        )

    def validate_startup(self) -> list[str]:
        """Refuse to pretend. Returns the list of problems (empty means OK)."""
        problems: list[str] = []
        if self.mainnet:
            problems.append("CENTER_MAINNET is not permitted: mainnet stays disabled until security and legal gates pass")
        if self.real_burn and not (self.vault_token and self.vault_address):
            problems.append("CENTER_REAL_BURN requires CENTER_VAULT_TOKEN and CENTER_VAULT")
        if self.testnet_rewards and not self.escrow:
            problems.append("CENTER_TESTNET_REWARDS requires CENTER_ESCROW")
        if (self.real_burn or self.testnet_rewards) and not os.environ.get("CENTER_DB"):
            problems.append("funded flags require durable storage (set CENTER_DB)")
        return problems


# --------------------------------------------------------------------- auth


class Auth:
    """Nonce + wallet-signature sessions. Tokens are HMACs, never stored server-side."""

    def __init__(self, secret: str | None = None) -> None:
        self.secret = (secret or secrets.token_hex(32)).encode()
        self._nonces: dict[str, float] = {}

    def nonce(self, address: str) -> str:
        n = secrets.token_hex(16)
        self._nonces[f"{address.lower()}:{n}"] = time.time() + 300
        return n

    def consume_nonce(self, address: str, nonce: str) -> bool:
        """Pop a pending nonce if it is live; single-use either way."""
        key = f"{address.lower()}:{nonce}"
        exp = self._nonces.get(key)
        if not exp or exp < time.time():
            return False
        self._nonces.pop(key, None)
        return True

    def verify(self, address: str, nonce: str, signature: str) -> str | None:
        key = f"{address.lower()}:{nonce}"
        exp = self._nonces.get(key)
        if not exp or exp < time.time():
            return None
        try:
            recovered = Account.recover_message(encode_defunct(text=f"Orbix Center sign-in\nnonce: {nonce}"), signature=signature)
        except Exception:
            return None
        if recovered.lower() != address.lower():
            return None
        self._nonces.pop(key, None)
        payload = f"{address.lower()}:{int(time.time() // SESSION_TTL)}"
        mac = hmac.new(self.secret, payload.encode(), hashlib.sha256).hexdigest()
        return f"{payload}:{mac}"

    def check(self, token: str | None) -> str | None:
        if not token or token.count(":") != 2:
            return None
        address, bucket, mac = token.split(":")
        expected = hmac.new(self.secret, f"{address}:{bucket}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(mac, expected):
            return None
        try:
            if int(bucket) < int(time.time() // SESSION_TTL) - 1:
                return None
        except ValueError:
            return None
        return address


# --------------------------------------------------------------------- request bodies


class RulesIn(BaseModel):
    templateId: str
    payload: dict = Field(default_factory=dict)


class CreateDraft(BaseModel):
    config: dict


class PublishRoom(BaseModel):
    draftId: str | None = None
    config: dict
    intentNonce: str | None = None


class JoinBody(BaseModel):
    invite: str | None = None
    role: str = "player"


class StartBody(BaseModel):
    pass


class RematchBody(BaseModel):
    config: dict | None = None


# --------------------------------------------------------------------- app factory


def create_app(*, db_path: str | None = None, authenticator: Auth | None = None, onchain: OnchainVault | None = None, admin_address: str | None = None) -> FastAPI:
    flags = Flags.from_env()
    problems = flags.validate_startup()
    if problems:
        raise RuntimeError("Center refuses to start: " + "; ".join(problems))

    store = Store(db_path)
    community = CommunityService(store)
    def app_community_filter(rt, value, viewer=None):
        if viewer == admin:return value
        cached=getattr(rt,'_community_cache',None)
        now=time.monotonic()
        if not cached or now-cached[0]>.5:
            cached=(now,community.public_settings(rt.room_id))
            rt._community_cache=cached
        return visible_state(value,cached[1],viewer,rt.owner)
    if onchain is None and flags.real_burn and flags.vault_token and flags.vault_address:
        # Funded mode: build the on-chain adapter from environment configuration.
        # The signer key never leaves the process; only the deposit path is signed.
        signer_key = os.environ.get("CENTER_SIGNER_KEY")
        if not signer_key:
            raise RuntimeError("CENTER_REAL_BURN requires CENTER_SIGNER_KEY")
        rpc_url = os.environ.get("CENTER_RPC_URL", "https://rpc.testnet.chain.robinhood.com")
        onchain = OnchainVault(
            rpc=JsonRpc(rpc_url, flags.chain_id),
            vault_address=flags.vault_address,
            token_address=flags.vault_token,
            private_key=signer_key,
            chain_id=flags.chain_id,
        )
    vault = VaultService(store, onchain=onchain)
    hub = Hub()
    auth = authenticator or Auth()
    admin = (admin_address or ADMIN_ADDRESS).lower()
    used_admin_nonces: set[str] = set()
    runtimes: dict[str, RoomRuntime] = {}
    drafts: dict[str, dict] = {}
    scheduler = Scheduler(runtimes)

    app = FastAPI(title="Orbix Center", version="1.0.0")
    app.state.flags = flags
    app.state.store = store
    app.state.vault = vault
    app.state.runtimes = runtimes
    app.state.hub = hub
    app.state.auth = auth
    app.state.drafts = drafts
    app.state.scheduler = scheduler
    app.state.entry_gate = EntryGateVerifier(JsonRpc(os.environ.get("CENTER_RPC_URL", "https://rpc.testnet.chain.robinhood.com"), flags.chain_id), os.environ.get("CENTER_CREATOR_GATE", DEPLOYED_GATE), chain_id=flags.chain_id)

    @app.exception_handler(EntryGateError)
    async def entry_gate_error(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503 if "UNAVAILABLE" in exc.code or "RPC" in exc.code else 403, content={"detail": {"code": exc.code, "message": exc.message}})

    origins = [o.strip() for o in os.environ.get("CENTER_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["content-type", "authorization", "X-Admin-Proof", "X-Practice-Token"],
    )

    # ------------------------------------------------------------------ helpers

    def require_wallet(authorization: str | None = Header(default=None)) -> str:
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        who = auth.check(token)
        if not who:
            raise HTTPException(401, detail={"code": "UNAUTHORIZED", "message": "sign in first"})
        return who

    def optional_wallet(authorization: str | None = Header(default=None)) -> str | None:
        return auth.check(authorization[7:].strip()) if authorization and authorization.lower().startswith("bearer ") else None

    @app.exception_handler(CommunityError)
    async def community_error(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=exc.status, content={"detail": {"code": exc.code, "message": str(exc)}})

    def filter_frame(conn, msg):
        if msg.get("type") in {"game.patch", "action.ack", "session.ready", "round.started", "room.snapshot"}:
            rt = runtime_for(conn["room"])
            return app_community_filter(rt, msg, conn["who"])
        return msg

    hub.frame_filter = filter_frame

    def runtime_for(room_id: str) -> RoomRuntime:
        rt = runtimes.get(room_id)
        if rt is None:
            rt = RoomRuntime.load(store, vault, hub, room_id)
            if rt is None:
                raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such room"})
            runtimes[room_id] = rt
        if rt.config.entry.kind == "erc20":
            rt.entry_verifier = lambda player: app.state.entry_gate.require(rt.room_id, player, rt.owner, rt.config.entry.token, rt.config.entry.amount, payout_mode=rt.config.access.payout_mode, payout_address=rt.config.access.payout_address)
        operations=getattr(app.state,'admin_games',None)
        if operations:
            rt.action_guard=lambda who:operations.assert_can_act(room_id,who,rt.round_id)
            if rt.engine and getattr(rt.engine,'arena',False):
                rt.engine.suspended.update(p for rid,p,rnd in operations.suspensions if rid==room_id and rnd==rt.round_id)
        return rt

    def require_game_live(template_id):
        availability=game_availability(store,template_id)
        if availability['status']!='live':
            raise HTTPException(409,detail={'code':'GAME_UNAVAILABLE','message':availability.get('message') or 'This game is under maintenance or offline.'})

    def require_room_active(room_id):
        if room_archived(store,room_id):
            raise HTTPException(410,detail={'code':'ROOM_ARCHIVED','message':'This room has been removed from active play.'})

    def validate_config(raw: dict) -> RoomConfig:
        try:
            return RoomConfig(**normalise_keys(raw))
        except ValidationError as exc:
            raise HTTPException(422, detail={
                "code": "INVALID_CONFIG",
                "message": [
                    {"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")}
                    for e in exc.errors(include_url=False)[:6]
                ],
            })

    # ------------------------------------------------------------------ health

    @app.get(f"{API_PREFIX}/health/live")
    def health_live() -> dict:
        return {"ok": True, "service": "orbix-center", "preview": flags.preview}

    @app.get(f"{API_PREFIX}/token/" + "{address}")
    def token_identity(address: str) -> dict:
        """Read-only on-chain token identity + conservative acceptance verdict.

        Trust rule: identity comes from the chain, never from a client claim or a
        deployment note. Burn support is reported as bytecode-detected possibility
        only and still requires an explicit owner opt-in before any burn flow.
        """
        from center.token_identity import TokenInspector
        if not re.fullmatch(r"0x[0-9a-fA-F]{40}", address):
            raise HTTPException(status_code=422, detail="invalid token address")
        rpc = JsonRpc(
            os.environ.get("CENTER_RPC_URL", "https://rpc.testnet.chain.robinhood.com"),
            flags.chain_id,
        )
        try:
            return TokenInspector(rpc).inspect(address).verdict()
        except Exception:
            raise HTTPException(status_code=503, detail="rpc unreachable; token identity unavailable")


    @app.get(f"{API_PREFIX}/health/ready")
    def health_ready() -> dict:
        return {
            "ok": True,
            "db": bool(store.path),
            "scheduler": scheduler._task is not None,
            "rooms": len(runtimes),
            "flags": flags.model_dump(),
        }

    # ------------------------------------------------------------------ catalog

    @app.get(f"{API_PREFIX}/templates")
    def templates() -> dict:
        from center.games import ENGINES

        out = []
        for tid, cls in ENGINES.items():
            meta = TEMPLATE_META[tid]
            out.append({
                "templateId": tid,
                "version": 1,
                "label": meta["label"],
                "blurb": meta["blurb"],
                "modes": meta["modes"],
                "multiplayer": meta["multiplayer"],
                "availability": "preview",  # honest: nothing here is a live funded game yet
                "playStatus": game_availability(store,tid)['status'],
                "maintenanceMessage": game_availability(store,tid).get('message',''),
            })
        return {"templates": out, "count": len(out)}

    @app.get(f"{API_PREFIX}/templates/{{template_id}}/rules")
    def template_rules(template_id: str) -> dict:
        from center.schema import TEMPLATE_RULES

        if template_id not in TEMPLATE_RULES:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "unknown template"})
        model = TEMPLATE_RULES[template_id]
        schema = model.model_json_schema()
        props = schema.get("properties", {})
        # caps the wizard needs so it can never publish an impossible player_cap
        min_players = props.get("min_players", {}).get("default")
        max_players = props.get("max_players", {}).get("default") or props.get("max_players", {}).get("maximum")
        return {
            "templateId": template_id,
            "fields": schema,
            "playerCap": {"min": min_players, "max": max_players},
        }

    # ------------------------------------------------------------------ auth

    @app.post(f"{API_PREFIX}/auth/nonce")
    def auth_nonce(body: dict) -> dict:
        address = str(body.get("address", "")).lower()
        if not address.startswith("0x") or len(address) != 42:
            raise HTTPException(422, detail={"code": "BAD_ADDRESS", "message": "expected a 0x address"})
        nonce = auth.nonce(address)
        if str(body.get("purpose", "")) == "admin":
            # Distinct admin domain: an admin proof can never be replayed as a sign-in
            # (or vice versa) because the signed text differs.
            message = f"Orbix Center admin action\nnonce: {nonce}"
        else:
            message = f"Orbix Center sign-in\nnonce: {nonce}"
        return {"nonce": nonce, "message": message}

    @app.post(f"{API_PREFIX}/auth/verify")
    def auth_verify(body: dict) -> dict:
        token = auth.verify(str(body.get("address", "")), str(body.get("nonce", "")), str(body.get("signature", "")))
        if not token:
            raise HTTPException(401, detail={"code": "BAD_SIGNATURE", "message": "signature did not verify"})
        return {"token": token}

    # ------------------------------------------------------------------ admin pricing

    def require_admin(authorization: str | None = Header(default=None), x_admin_proof: str | None = Header(default=None, alias="X-Admin-Proof"), *, need_proof: bool) -> str:
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        who = auth.check(token)
        if not who:
            raise HTTPException(401, detail={"code": "UNAUTHORIZED", "message": "sign in first"})
        if who != admin:
            raise HTTPException(403, detail={"code": "NOT_ADMIN", "message": "this wallet is not the pricing authority"})
        if need_proof:
            if not x_admin_proof or ":" not in x_admin_proof:
                raise HTTPException(403, detail={"code": "PROOF_REQUIRED", "message": "a fresh signed admin proof is required"})
            nonce, signature = x_admin_proof.split(":", 1)
            if nonce in used_admin_nonces:
                raise HTTPException(403, detail={"code": "PROOF_REPLAYED", "message": "this admin proof was already consumed"})
            if not auth.consume_nonce(who, nonce):
                raise HTTPException(403, detail={"code": "BAD_PROOF", "message": "admin proof nonce expired"})
            try:
                recovered = Account.recover_message(encode_defunct(text=f"Orbix Center admin action\nnonce: {nonce}"), signature=signature)
            except Exception:
                raise HTTPException(403, detail={"code": "BAD_PROOF", "message": "admin proof did not verify"})
            if recovered.lower() != who:
                raise HTTPException(403, detail={"code": "BAD_PROOF", "message": "admin proof did not verify"})
            used_admin_nonces.add(nonce)
        return who

    @app.get(f"{API_PREFIX}/admin/pricing")
    def get_pricing(authorization: str | None = Header(default=None)) -> dict:
        who = require_admin(authorization, need_proof=False)
        current = FeeSchedule.from_dict(store.get_setting(SETTING_KEY))
        return {"pricing": current.as_dict(), "caps": pricing_caps(), "admin": admin, "chainId": 46630}

    @app.patch(f"{API_PREFIX}/admin/pricing")
    def patch_pricing(body: FeeSchedule, authorization: str | None = Header(default=None), x_admin_proof: str | None = Header(default=None, alias="X-Admin-Proof")) -> dict:
        require_admin(authorization, x_admin_proof, need_proof=True)
        old = FeeSchedule.from_dict(store.get_setting(SETTING_KEY))
        store.set_setting(SETTING_KEY, body.as_dict())
        store.append_audit(admin, "pricing.update", old.as_dict(), body.as_dict(), 46630)
        return {"pricing": body.as_dict(), "caps": pricing_caps(), "chainId": 46630}

    @app.get(f"{API_PREFIX}/admin/audit")
    def get_audit(authorization: str | None = Header(default=None)) -> dict:
        require_admin(authorization, need_proof=False)
        return {"entries": store.list_audit()}

    @app.get(f"{API_PREFIX}/admin/audit/verify")
    def verify_audit(authorization: str | None = Header(default=None)) -> dict:
        """Recompute the audit hash chain so tampering with history is detectable."""
        require_admin(authorization, need_proof=False)
        return store.verify_audit_chain()

    # ------------------------------------------------------------------ drafts

    mount_admin_games(app,API_PREFIX,store,community,require_admin,runtime_for,hub,admin)
    mount_practice(app,API_PREFIX)

    @app.post(f"{API_PREFIX}/drafts")
    def create_draft(body: CreateDraft, who: str = Depends(require_wallet)) -> dict:
        config = validate_config(body.config)
        require_game_live(config.template_id)
        draft_id = secrets.token_hex(8)
        drafts[draft_id] = {"id": draft_id, "owner": who, "config": config.model_dump(mode="json", by_alias=True)}
        return {"draftId": draft_id, "config": drafts[draft_id]["config"]}

    @app.patch(f"{API_PREFIX}/drafts/{{draft_id}}")
    def patch_draft(draft_id: str, body: CreateDraft, who: str = Depends(require_wallet)) -> dict:
        d = drafts.get(draft_id)
        if not d or d["owner"] != who:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such draft"})
        config = validate_config(body.config)
        d["config"] = config.model_dump(mode="json", by_alias=True)
        return {"draftId": draft_id, "config": d["config"], "saved": True}

    @app.get(f"{API_PREFIX}/drafts")
    def list_drafts(who: str = Depends(require_wallet)) -> dict:
        return {"drafts": [d for d in drafts.values() if d["owner"] == who]}

    # ------------------------------------------------------------------ rooms

    @app.post(f"{API_PREFIX}/rooms")
    def publish_room(body: PublishRoom, who: str = Depends(require_wallet)) -> dict:
        config = validate_config(body.config)
        require_game_live(config.template_id)
        config_hash = "0x" + hashlib.sha256(config.config_hash_input().encode()).hexdigest()
        unit = vault.unit_for(config.access.vault_mode, config.access.token)
        amount = int(config.access.required_amount or 0)

        if config.access.vault_mode == "onchain" and not flags.real_burn:
            raise HTTPException(409, detail={"code": "UNFUNDED_REWARD", "message": "real vault deduction is disabled"})
        if config.rewards.kind == "funded-assets" and not flags.testnet_rewards:
            raise HTTPException(409, detail={"code": "UNFUNDED_REWARD", "message": "funded rewards are disabled"})

        intent = publication_intent(who, config_hash, body.intentNonce or secrets.token_hex(8))

        # Idempotent publish: a retried request (same intent) returns the original room
        # instead of creating a second one or charging again.
        existing = store.get_intent(intent)
        if existing and existing["creator"] == who and existing["state"] == "consumed" and existing.get("room_id"):
            row = store.get_room(existing["room_id"])
            if row:
                unit0 = vault.unit_for(config.access.vault_mode, config.access.token)
                return {
                    "roomId": row["id"], "roomNumber": row["join_code"], "joinCode": row["join_code"],
                    "status": row["status"], "visibility": row["visibility"],
                    "intentId": intent, "charged": 0, "balanceAfter": vault.balance_of(who, unit0),
                    "balanceLabel": vault.label(unit0), "replayed": True,
                    "shareUrl": f"/center/rooms/{row['join_code']}",
                }

        charged = 0
        try:
            if amount > 0:
                charged = amount if vault.deduct_for_publish(who, intent, amount, "", unit=unit) else 0
        except InsufficientBalance as exc:
            raise HTTPException(402, detail={"code": "INSUFFICIENT_BALANCE", "message": str(exc)})
        except VaultError as exc:
            raise HTTPException(400, detail={"code": "VAULT_ERROR", "message": str(exc)})

        rt = RoomRuntime.create(store, vault, hub, owner=who, config=config)
        community.initialize(rt.room_id, who, config.community_settings)
        # Snapshot the schedule the moment the room is published; a later admin
        # change can never reprice an existing room.
        store.set_setting(f"pricing:{rt.room_id}", FeeSchedule.from_dict(store.get_setting(SETTING_KEY)).as_dict())
        store.set_intent_room(intent, rt.room_id)
        store.set_intent_state(intent, "consumed")
        runtimes[rt.room_id] = rt
        balance_after = vault.balance_of(who, unit)
        return {
            "roomId": rt.room_id,
            "roomNumber": rt.join_code, "joinCode": rt.join_code,
            "status": rt.status,
            "visibility": config.visibility,
            "intentId": intent,
            "charged": charged,
            "balanceAfter": balance_after,
            "balanceLabel": vault.label(unit),
            "shareUrl": f"/center/rooms/{rt.join_code}",
        }

    @app.get(f"{API_PREFIX}/rooms")
    def list_rooms(limit: int = Query(default=50, le=100)) -> dict:
        rows = store.list_rooms(visibility="public", limit=limit)
        rows=[r for r in rows if not room_archived(store,r['id'])]
        return {
            "rooms": [
                {
                    "roomId": r["id"], "name": r["config"]["name"], "templateId": r["template_id"],
                    "roomNumber": r["join_code"], "joinCode": r["join_code"],
                    "status": r["status"], "visibility": r["visibility"], "mode": r["mode"],
                    "players": len([p for p in store.participants(r["id"]) if p["role"] == "player"]),
                    "rewards": r["config"]["rewards"]["kind"],
                    "entryKind": r["config"]["entry"].get("kind", "free"),
                    "entryToken": r["config"]["entry"].get("token"),
                    "entryAmount": r["config"]["entry"].get("amount") or None,
                }
                for r in rows
            ]
        }

    @app.get(f"{API_PREFIX}/my/rooms")
    def my_rooms(who: str = Depends(require_wallet)) -> dict:
        """Rooms created by the connected wallet, with live status and timing."""
        mine = []
        for row in store.list_rooms(limit=200):
            if room_archived(store,row['id']):continue
            if row["owner"].lower() != who.lower():
                continue
            cfg = row["config"]
            timing = cfg.get("timing", {}) if isinstance(cfg, dict) else {}
            now = time.time()
            open_at = timing.get("open_at", 0)
            close_at = timing.get("close_at", 0)
            scheduled = "scheduled" if (open_at and now < open_at) else None
            expiring = "closing" if (close_at and now >= close_at - 60) else None
            mine.append({
                "roomId": row["id"],
                "roomNumber": row["join_code"], "joinCode": row["join_code"],
                "name": cfg.get("name", ""),
                "templateId": row.get("template_id", ""),
                "status": row["status"],
                "visibility": row["visibility"],
                "players": len([p for p in store.participants(row["id"]) if p["role"] == "player"]),
                "openAt": open_at or None,
                "closeAt": close_at or None,
                "scheduled": scheduled,
                "expiring": expiring,
                "active": row["status"] not in ("closed", "cancelled"),
            })
        return {"rooms": mine}

    @app.get(f"{API_PREFIX}/rooms/resolve/{{join_code}}")
    def resolve_room_code(join_code: str, invite: str | None = None,
                          who: str | None = Depends(optional_wallet)) -> dict:
        # New aliases have six or more digits; accept legacy three-to-five-digit links.
        # A room alias is navigation, not admission or proof of token entry.
        # Private aliases are deliberately indistinguishable from missing codes.
        row = store.resolve_room_code(join_code) if re.fullmatch(r"[1-9][0-9]{2,8}", join_code) else None
        denied = not row or room_archived(store, row["id"])
        if row and row["visibility"] == "private":
            admitted = who == admin or who == row["owner"] or any(
                p["who"] == who for p in store.participants(row["id"]))
            denied = denied or not (who and (admitted or store.invite_valid(row["id"], invite)))
        if denied:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such room"})
        return {"roomId": row["id"], "roomNumber": row["join_code"], "joinCode": row["join_code"]}

    @app.get(f"{API_PREFIX}/rooms/{{room_id}}")
    def get_room(room_id: str, who: str | None = Depends(optional_wallet)) -> dict:
        row = store.get_room(room_id)
        if not row:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such room"})
        # Unlisted rooms are readable by URL but never listed; private rooms hide their rules.
        members = store.participants(room_id)
        admitted = who == admin or who == row["owner"] or any(p["who"] == who for p in members)
        config = RoomConfig(**row["config"]).public_dict() if row["visibility"] != "private" or admitted else {"name": row["config"]["name"]}
        settings = community.public_settings(room_id)
        presentation_owner=who if who==admin else row['owner']
        rt = runtime_for(room_id)
        timing = row["config"].get("timing", {}) if isinstance(row["config"], dict) else {}
        connected_players = hub.connected_players(room_id)
        settlement = rt.settlement_frame() if admitted else None
        settlement_payload = dict(settlement["payload"]) if settlement else None
        if settlement_payload and who not in {admin, row["owner"]}:
            # Keep only this wallet's original claim receipts; do not anonymize
            # addresses inside a proof/contract payload or leak others' claim codes.
            settlement_payload["allocations"] = [a for a in settlement_payload.get("allocations", [])
                                                  if a.get("winner") == who]
            settlement_payload["results"] = visible_state(settlement_payload.get("results", []), settings, who, row["owner"])
        return {
            "roomId": row["id"], "status": row["status"], "visibility": row["visibility"],
            "roomNumber": row["join_code"], "joinCode": row["join_code"],
            "mode": row["mode"], "owner": row["owner"], "config": config,
            "timing": timing,
            "communitySettings": settings,
            "gameStatus": game_availability(store,row['template_id'])['status'],
            "maintenanceMessage": game_availability(store,row['template_id']).get('message',''),
            "archived": room_archived(store,room_id),
            "rematch": rt.rematch_capability(),
            "settlement": settlement_payload,
            "settlementAccess": "available" if settlement_payload else "session-required" if not who else "admission-required" if not admitted else "pending",
            "characters": visible_state((store.get_setting(f'characters:{room_id}') or {}).get('characters',{}),settings,who,presentation_owner),
            "publicState": app_community_filter(rt, rt.engine.public_state(), who) if rt.engine and (row["visibility"] != "private" or admitted) else None,
            "roundId": rt.round_id, "deadline": rt.deadline(), "serverTimeMs": int(time.time() * 1000),
            "teams": visible_state((store.get_setting(f"teams:{room_id}") or {}).get("teams", {}), settings, who, presentation_owner),
            "pricingSnapshot": FeeSchedule.from_dict(store.get_setting(f"pricing:{room_id}")).as_dict(),
            "participants": visible_state([
                {"who": p["who"], "role": p["role"], "ready": bool(p["ready"]),
                 "connected": p["who"] in connected_players}
                for p in members
            ] if row["visibility"] != "private" or admitted else [], settings, who, presentation_owner),
        }

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/close")
    def close_room(room_id: str, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
        if rt.owner != who:
            raise HTTPException(403, detail={"code": "FORBIDDEN", "message": "only the host may close the room"})
        if rt.status == lc.CLOSED:
            return {"status": "closed"}
        rt.close("host closed")
        return {"status": rt.status}

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/team")
    async def choose_team(room_id: str, body: dict, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
        if rt.config.template_id != "boss-raid" or getattr(rt.config.rules, "team_mode", "coop") != "teams":
            raise HTTPException(409, detail={"code": "NOT_A_TEAM_RAID"})
        if rt.status not in lc.JOINABLE:
            raise HTTPException(409, detail={"code": "TEAMS_FROZEN"})
        if not any(p["who"] == who and p["role"] == "player" for p in store.participants(room_id)):
            raise HTTPException(403, detail={"code": "NOT_ADMITTED"})
        team = body.get("team")
        arena=getattr(rt.config.rules,'arena_mode',False)
        size=rt.config.rules.team_size if arena else 3
        team_count=max(2,(rt.config.admission.player_cap+size-1)//size)
        choices={f'team-{i+1}' for i in range(team_count)} if arena else {'a','b'}
        if team not in choices:
            raise HTTPException(422, detail={"code": "BAD_TEAM"})
        # One synchronous transaction section in the single-authority process.
        teams = (store.get_setting(f"teams:{room_id}") or {}).get("teams", {})
        active = {p["who"] for p in store.participants(room_id) if p["role"] == "player"}
        teams = {p: t for p, t in teams.items() if p in active}
        if sum(p != who and t == team for p, t in teams.items()) >= size:
            raise HTTPException(409, detail={"code": "TEAM_FULL"})
        teams[who] = team
        store.set_setting(f"teams:{room_id}", {"teams": teams})
        store.set_ready(room_id, who, False)
        return {"teams": teams}

    @app.post(f'{API_PREFIX}/rooms/{{room_id}}/character')
    def choose_character(room_id:str,body:dict,who:str=Depends(require_wallet)):
        from center.games.arena import CHARACTERS
        rt=runtime_for(room_id)
        require_room_active(room_id)
        if rt.status not in lc.JOINABLE:
            raise HTTPException(409,detail={'code':'CHARACTERS_FROZEN','message':'Choose your character before the match starts.'})
        if not any(p['who']==who and p['role']=='player' for p in store.participants(room_id)):
            raise HTTPException(403,detail={'code':'NOT_ADMITTED'})
        character=body.get('character')
        if character not in CHARACTERS:raise HTTPException(422,detail={'code':'UNKNOWN_CHARACTER'})
        mapping=(store.get_setting(f'characters:{room_id}') or {}).get('characters',{})
        mapping[who]=character
        store.set_setting(f'characters:{room_id}',{'characters':mapping})
        return {'characters':mapping}

    @app.get(f"{API_PREFIX}/rooms/{{room_id}}/community")
    def community_snapshot(room_id: str, after: int = 0, who: str = Depends(require_wallet)):
        return community.snapshot(room_id, who, after)

    @app.patch(f"{API_PREFIX}/rooms/{{room_id}}/community/settings")
    def community_settings(room_id: str, body: dict, who: str = Depends(require_wallet)):
        result=community.update_settings(room_id, who, body)
        runtime_for(room_id)._community_cache=None
        return result

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/community/messages")
    def community_post(room_id: str, body: dict, who: str = Depends(require_wallet)):
        return community.post_message(room_id, who, body.get("text"), body.get("kind", "chat"), delay_seconds=body.get("delaySeconds"))

    @app.delete(f"{API_PREFIX}/rooms/{{room_id}}/community/messages/{{message_id}}")
    def community_delete(room_id: str, message_id: int, who: str = Depends(require_wallet)):
        return community.delete_message(room_id, who, message_id)

    @app.get(f"{API_PREFIX}/rooms/{{room_id}}/community/roster")
    def community_roster(room_id: str, who: str = Depends(require_wallet)):
        return community.roster(room_id, who)

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/community/players/{{wallet}}/{{operation}}")
    async def community_remove(room_id: str, wallet: str, operation: str, who: str = Depends(require_wallet)):
        if operation not in {"kick", "ban"}:
            raise HTTPException(404, detail={"code": "NOT_FOUND"})
        out = getattr(community, operation)(room_id, who, wallet)
        # Tickets and sockets cannot keep admission after the creator removed it.
        app.state.tickets = {k: t for k, t in getattr(app.state, "tickets", {}).items() if not (t["room"] == room_id and t["who"] == wallet.lower())}
        for conn in list(hub._conns.values()):
            if conn["room"] == room_id and conn["who"] == wallet.lower():
                await conn["ws"].close(code=4403)
        return out

    @app.delete(f"{API_PREFIX}/rooms/{{room_id}}/community/players/{{wallet}}/ban")
    def community_unban(room_id: str, wallet: str, who: str = Depends(require_wallet)):
        return community.unban(room_id, who, wallet)

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/invites")
    def create_invite(room_id: str, who: str = Depends(require_wallet)) -> dict:
        row = store.get_room(room_id)
        if not row:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such room"})
        if row["owner"] != who:
            raise HTTPException(403, detail={"code": "FORBIDDEN", "message": "only the host may issue invites"})
        code = secrets.token_urlsafe(9)
        store.add_invite(room_id, code)
        return {"invite": code, "shareUrl": f"/center/rooms/{row['join_code']}?invite={code}"}

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/join")
    def join_room(room_id: str, body: JoinBody, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
        require_room_active(room_id)
        if rt.status != lc.RUNNING or not any(p['who']==who for p in store.participants(room_id)):
            require_game_live(rt.config.template_id)
        app.state.admin_games.assert_can_act(room_id,who,rt.round_id)
        community.assert_can_join(room_id, who)
        try:
            result = rt.join(who, role=body.role, invite=body.invite)
        except EntryGateError:
            raise
        except PermissionError:
            raise HTTPException(403, detail={"code": "INVITE_REQUIRED", "message": "this room is private"})
        except ValueError as exc:
            code = str(exc)
            raise HTTPException(409, detail={"code": code, "message": code})
        ticket = secrets.token_urlsafe(16)
        app.state.tickets = getattr(app.state, "tickets", {})
        app.state.tickets[ticket] = {"who": who, "room": room_id, "exp": time.time() + 120}
        return {**result, "ticket": ticket}

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/ready")
    def ready(room_id: str, body: dict | None = None, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
        ready_flag = bool((body or {}).get("ready", True))
        try:
            return rt.set_ready(who, ready_flag)
        except ValueError as exc:
            raise HTTPException(403, detail={"code": str(exc), "message": str(exc)})

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/rematch")
    async def rematch(room_id: str, body: RematchBody | None = None, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
        require_room_active(room_id)
        require_game_live(rt.config.template_id)
        if who != rt.owner:
            raise HTTPException(403, detail={"code": "FORBIDDEN", "message": "only the host may prepare a rematch"})
        config = validate_config(body.config) if body and body.config is not None else None
        try:
            result = await rt.prepare_rematch(config)
        except ValueError as exc:
            code = str(exc)
            message = ("Token-funded, paid-entry and onchain rooms need a fresh room and independent funding."
                       if code == "FRESH_FUNDED_ROOM_REQUIRED" else code)
            raise HTTPException(409, detail={"code": code, "message": message})
        except ConflictError:
            raise HTTPException(409, detail={"code": "ROOM_CHANGED", "message": "refresh the room before trying again"})
        return result

    @app.get(f"{API_PREFIX}/rooms/{{room_id}}/history")
    def room_history(room_id: str, who: str | None = Depends(optional_wallet)) -> dict:
        rt = runtime_for(room_id)
        if rt.config.visibility == "private" and not (who == admin or who == rt.owner or any(
                p["who"] == who for p in store.participants(room_id))):
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such room"})
        from center.games import engine_for
        rounds = []
        settings = community.public_settings(room_id)
        for rnd in store.rounds_for_room(room_id):
            result = []
            if rnd.get("ended_at") is not None and rnd.get("snapshot") and rnd.get("config"):
                cfg = RoomConfig(**rnd["config"])
                engine = engine_for(cfg).restore(cfg, rnd["round_id"], rnd["seed"], rnd["snapshot"])
                result = [{"who": player, "score": engine.scores().get(player, 0)} for player in engine.ranking()]
            entitlements = store.entitlements_for_round(rnd["round_id"])
            if who not in {admin, rt.owner}:
                entitlements = [e for e in entitlements if e["winner"] == who]
            record = {"roundId": rnd["round_id"], "state": rnd["state"], "startedAt": rnd["started_at"],
                      "endedAt": rnd.get("ended_at"), "configHash": rnd.get("config_hash"),
                      "commitHash": rnd["commit_hash"], "merkleRoot": rnd.get("merkle_root"),
                      "allocationsHash": rnd.get("allocations_hash"), "transcriptHash": rnd.get("transcript_hash"),
                      "results": result if who == admin else visible_state(result, settings, who, rt.owner),
                      "entitlements": entitlements}
            rounds.append(record)
        return {"roomId": room_id, "roomNumber": rt.join_code, "joinCode": rt.join_code, "rounds": rounds}

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/start")
    async def start(room_id: str, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
        require_room_active(room_id)
        require_game_live(rt.config.template_id)
        if rt.owner != who:
            raise HTTPException(403, detail={"code": "FORBIDDEN", "message": "only the host may start"})
        try:
            scheduler.start()
            return await rt.start()
        except ValueError as exc:
            raise HTTPException(409, detail={"code": str(exc), "message": str(exc)})

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/cancel")
    async def cancel(room_id: str, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
        if rt.owner != who:
            raise HTTPException(403, detail={"code": "FORBIDDEN", "message": "only the host may cancel"})
        return await rt.cancel()

    @app.get(f"{API_PREFIX}/rooms/{{room_id}}/results")
    def results(room_id: str) -> dict:
        return runtime_for(room_id).results()

    @app.get(f"{API_PREFIX}/rounds/{{round_id}}/fairness")
    def fairness(round_id: str) -> dict:
        for rt in runtimes.values():
            if rt.round_id == round_id:
                return rt.fairness()
        rnd = store.get_round(round_id)
        if not rnd:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such round"})
        return {
            "roundId": round_id, "commitHash": rnd["commit_hash"], "seed": rnd["seed"] if rnd.get("ended_at") is not None else None,
            "configHash": rnd.get("config_hash"),
            "merkleRoot": rnd["merkle_root"], "allocationsHash": rnd["allocations_hash"],
            "transcriptHash": rnd["transcript_hash"], "settlementDeadline": rnd["settlement_deadline"],
        }

    # ------------------------------------------------------------------ claims

    @app.get(f"{API_PREFIX}/claims/{{reference}}")
    def get_claim(reference: str, who: str = Depends(require_wallet)) -> dict:
        claim = _get_claim(reference)
        if claim["winner"].lower() != who:
            raise HTTPException(403, detail={"code": "WRONG_CLAIM_WALLET", "message": "this reward belongs to a different wallet"})
        return claim

    def _get_claim(reference: str) -> dict:
        ref = st.parse_payment_code(reference)
        if not ref:
            raise HTTPException(404, detail={"code": "UNKNOWN_CLAIM", "message": "no entitlement for that code"})
        with store.tx() as c:
            hit = c.execute("SELECT * FROM entitlements WHERE LOWER(claim_id)=? LIMIT 1", (ref.lower(),)).fetchone()
        if not hit:
            raise HTTPException(404, detail={"code": "UNKNOWN_CLAIM", "message": "no entitlement for that code"})
        e = dict(hit)
        return {
            "claimId": e["claim_id"], "roundId": e["round_id"], "roomId": e["room_id"],
            "winner": e["winner"], "slotId": e["slot_id"], "points": e["points"],
            "assetKind": e["asset_kind"], "assetContract": e["asset_contract"],
            "tokenId": e["token_id"], "amount": e["amount"],
            "proof": json.loads(e["proof_json"]), "claimedTx": e["claimed_tx"],
            "code": st.payment_code(e["claim_id"]),
        }

    @app.post(f"{API_PREFIX}/claims/lookup")
    def lookup_claim(body: dict, who: str = Depends(require_wallet)) -> dict:
        reference = str(body.get("code") or "")
        claim = _get_claim(reference)
        # Ownership is checked before payability: a reward's status is never disclosed to
        # a wallet that does not own it.
        if claim["winner"].lower() != who:
            raise HTTPException(403, detail={"code": "WRONG_CLAIM_WALLET", "message": "this reward belongs to a different wallet"})
        if claim["assetKind"] in {None, "preview-points"}:
            return {"claim": claim, "payable": False, "reason": "preview points are not claimable on-chain"}
        if claim["claimedTx"]:
            return {"claim": claim, "payable": False, "reason": "ALREADY_CLAIMED"}
        return {"claim": claim, "payable": True}

    # ------------------------------------------------------------------ wallet / vault

    @app.get(f"{API_PREFIX}/wallet/vault")
    def wallet_vault(who: str = Depends(require_wallet)) -> dict:
        unit = flags.vault_token.lower() if (flags.real_burn and flags.vault_token) else "simulated"
        return {
            "balance": vault.balance_of(who, unit),
            "unit": unit,
            "label": vault.label(unit),
            "simulated": vault.is_simulated(unit),
            "token": flags.vault_token,
            "vaultAddress": flags.vault_address,
            "note": "Balance is simulated. Hard wallet validation is disabled." if vault.is_simulated(unit) else "",
            "spent": store.spent_by_creator(who, unit),
            "ledger": vault.ledger(who, limit=25),
        }

    @app.get(f"{API_PREFIX}/wallet/onchain-balance")
    def wallet_onchain_balance(who: str = Depends(require_wallet)) -> dict:
        """Live on-chain balances: wallet token balance + credited vault balance.

        Reads directly from the chain with a short TTL cache so the UI can show
        real numbers without hammering the RPC. Returns simulated:null when no
        funded token is configured, so the client can fall back cleanly.
        """
        token = flags.vault_token
        if not (flags.real_burn and token and flags.vault_address):
            return {"live": False, "wallet": None, "vaultCredit": None, "symbol": None}
        rpc_client = getattr(app.state, "balance_rpc", None)
        if rpc_client is None:
            rpc_url = os.environ.get("CENTER_RPC_URL", "https://rpc.testnet.chain.robinhood.com")
            rpc_client = JsonRpc(rpc_url, flags.chain_id)
            app.state.balance_rpc = rpc_client
        who_l = who.lower()
        now = time.time()
        cache = getattr(app.state, "balance_cache", {})
        entry = cache.get(who_l)
        if entry and now - entry[0] < 15:
            wallet_bal, vault_credit = entry[1], entry[2]
        else:
            call = lambda to, data_hex: rpc_client.call("eth_call", [{"to": to, "data": data_hex}, "latest"])
            token_addr = token
            vault_addr = flags.vault_address
            bal_sel = "0x70a08231"
            wallet_hex = str(call(token_addr, bal_sel + who_l.removeprefix("0x").rjust(64, "0")) or "0x")
            vault_hex = str(call(vault_addr, bal_sel + who_l.removeprefix("0x").rjust(64, "0")) or "0x")
            wallet_bal = int(wallet_hex, 16) if wallet_hex not in (None, "0x") else 0
            vault_credit = int(vault_hex, 16) if vault_hex not in (None, "0x") else 0
            cache[who_l] = (now, wallet_bal, vault_credit)
            app.state.balance_cache = cache
        return {
            "live": True,
            "wallet": wallet_bal,
            "vaultCredit": vault_credit,
            "symbol": os.environ.get("CENTER_VAULT_SYMBOL", "ORBIX"),
            "token": token,
            "vaultAddress": flags.vault_address,
            "chainId": flags.chain_id,
        }

    @app.get(f"{API_PREFIX}/wallet/ledger.csv", response_class=PlainTextResponse)
    def wallet_ledger_csv(who: str = Depends(require_wallet)) -> str:
        return vault.ledger_csv(who)

    @app.post(f"{API_PREFIX}/wallet/vault/deposit")
    def wallet_deposit(body: dict, who: str = Depends(require_wallet)) -> dict:
        """Preview top-up. With real burn enabled the client deposits on-chain instead."""
        if flags.real_burn:
            raise HTTPException(409, detail={"code": "REAL_BURN_ENABLED", "message": "deposit on-chain through the vault contract"})
        amount = int(body.get("amount") or 0)
        if amount <= 0:
            raise HTTPException(422, detail={"code": "BAD_AMOUNT", "message": "amount must be positive"})
        vault.deposit(who, amount, "simulated")
        return {"balance": vault.balance_of(who, "simulated"), "simulated": True}

    # ------------------------------------------------------------------ deposit check (QR path)

    @app.post(f"{API_PREFIX}/wallet/deposit/check")
    def wallet_deposit_check(who: str = Depends(require_wallet)) -> dict:
        """QR-deposit reconciliation: read the vault's on-chain balanceOf(who) and
        sync the software ledger UP to it. Idempotent, rate-limited (10s/wallet).

        The vault contract credits the depositor on-chain at deposit() time, so
        the on-chain balanceOf is the source of truth; the software ledger is a
        convenience cache for game-time deduction. Only increases are credited
        (the sync can never mint balance) and every sync is audit-logged.
        """
        token = flags.vault_token
        if not (flags.real_burn and token and flags.vault_address):
            raise HTTPException(409, detail={"code": "FUNDED_DISABLED", "message": "on-chain deposits are not enabled on this deployment"})
        now = time.time()
        checks = getattr(app.state, "deposit_check_at", {})
        if now - checks.get(who, 0) < 10:
            raise HTTPException(429, detail={"code": "RATE_LIMITED", "message": "wait a few seconds between deposit checks"})
        checks[who] = now
        app.state.deposit_check_at = checks
        rpc_client = getattr(app.state, "balance_rpc", None)
        if rpc_client is None:
            rpc_client = JsonRpc(os.environ.get("CENTER_RPC_URL", "https://rpc.testnet.chain.robinhood.com"), flags.chain_id)
            app.state.balance_rpc = rpc_client
        who_hex = who.lower().removeprefix("0x").rjust(64, "0")
        bal_sel = "0x70a08231"  # balanceOf(address)
        try:
            vault_hex = str(rpc_client.call("eth_call", [{"to": flags.vault_address, "data": bal_sel + who_hex}, "latest"]) or "0x")
            wallet_hex = str(rpc_client.call("eth_call", [{"to": token, "data": bal_sel + who_hex}, "latest"]) or "0x")
        except Exception:
            raise HTTPException(503, detail={"code": "RPC_DOWN", "message": "chain reads are temporarily unavailable, try again"})
        onchain_vault = int(vault_hex, 16) if vault_hex not in ("0x", "") else 0
        wallet_bal = int(wallet_hex, 16) if wallet_hex not in ("0x", "") else 0
        credited = vault.balance_of(who, token)
        if onchain_vault > credited:
            delta = onchain_vault - credited
            vault.deposit(who, delta, token)
            store.append_audit("system", "deposit.sync", {"credited": credited}, {"credited": onchain_vault}, flags.chain_id)
            return {"credited": delta, "balance": onchain_vault, "wallet": wallet_bal, "symbol": os.environ.get("CENTER_VAULT_SYMBOL", "ORBIX"), "synced": True}
        return {"credited": 0, "balance": max(credited, onchain_vault), "wallet": wallet_bal, "symbol": os.environ.get("CENTER_VAULT_SYMBOL", "ORBIX"), "synced": False}

    # ------------------------------------------------------------------ profiles

    @app.get(f"{API_PREFIX}/profile/{{address}}")
    @profile_storage
    def get_profile(address: str) -> dict:
        """Public profile: name, bio, hue, and whether the address is shown.
        If showAddress is false, the raw address is not included in the response."""
        import re as _re
        if not _re.fullmatch(r"0x[0-9a-fA-F]{40}", address):
            raise HTTPException(422, detail={"code": "BAD_ADDRESS", "message": "invalid address"})
        profile = store.get_profile(address)
        if not profile:
            return {"address": address.lower(), "name": "", "bio": "", "hue": 0, "showAddress": True}
        result = {"name": profile["name"], "bio": profile["bio"], "hue": profile["hue"],
                  "showAddress": profile["showAddress"], "hasImage": store.has_avatar(address)}
        if profile["showAddress"]:
            result["address"] = address.lower()
        return result

    @app.post(f"{API_PREFIX}/profile")
    @profile_storage
    def set_profile(body: dict, who: str = Depends(require_wallet)) -> dict:
        from center.profile import validate_name, validate_bio, ProfileError
        name = str(body.get("name", "")).strip()
        bio = str(body.get("bio", "")).strip()
        hue = int(body.get("hue", 0))
        show_address = bool(body.get("showAddress", True))
        try:
            name = validate_name(name)
            bio = validate_bio(bio)
        except ProfileError as e:
            raise HTTPException(422, detail={"code": "INVALID_PROFILE", "message": str(e)})
        result = store.set_profile(who, name, bio, hue, show_address)
        return {**result, "address": who.lower()}

    @app.post(f"{API_PREFIX}/profiles/batch")
    @profile_storage
    def get_profiles_bulk(body: dict) -> dict:
        """Batch profile lookup for room pages. Returns profiles keyed by address.
        If a profile has showAddress=false, the raw address is omitted."""
        addresses = body.get("addresses", [])
        if not isinstance(addresses, list) or len(addresses) > 100:
            raise HTTPException(422, detail={"code": "BAD_INPUT", "message": "addresses must be a list (max 100)"})
        profiles = store.get_profiles_bulk(addresses)
        return {addr: {"name": p["name"], "hue": p["hue"], "showAddress": p["showAddress"], "hasImage": store.has_avatar(addr)}
                for addr, p in profiles.items()}

    # ------------------------------------------------------------------ profile images

    @app.post(f"{API_PREFIX}/profile/image")
    @profile_storage
    def upload_profile_image(body: dict, who: str = Depends(require_wallet)) -> dict:
        from center.avatars import prepare_avatar, write_avatar
        try:
            data = prepare_avatar(body.get("image"))
        except ValueError as error:
            raise HTTPException(422, detail={"code": "BAD_IMAGE", "message": str(error)})
        version = write_avatar(who, data)
        store.set_profile_avatar(who.lower(), True)
        return {"ok": True, "url": f"{API_PREFIX}/profile/image/{who.lower()}?v={version}"}

    @app.get(f"{API_PREFIX}/profile/image/{{address}}")
    @profile_storage
    def serve_profile_image(address: str):
        from center.avatars import avatar_path
        from fastapi.responses import Response
        if not re.fullmatch(r"0x[0-9a-f]{40}", address.lower()):
            raise HTTPException(422, detail={"code": "BAD_ADDRESS", "message": "invalid address"})
        try:
            # Read once: FileResponse stat/open can straddle an atomic overwrite.
            data = avatar_path(address).read_bytes()
        except FileNotFoundError:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no profile image"})
        return Response(data, media_type="image/webp", headers={
            "Cache-Control": "no-cache", "ETag": f'"{hashlib.sha256(data).hexdigest()}"',
            "X-Content-Type-Options": "nosniff",
        })

    # ------------------------------------------------------------------ websocket

    @app.websocket(f"{API_PREFIX}/ws/rooms/{{room_id}}")
    async def ws_room(ws: WebSocket, room_id: str) -> None:
        await ws.accept()
        conn_id = secrets.token_hex(8)
        who: str | None = None
        pump: asyncio.Task | None = None
        try:
            # First frame must authenticate with a short-lived ticket.
            try:
                first = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=10))
            except Exception:
                await ws.close(code=4401)
                return
            if first.get("type") != "session.hello":
                await ws.close(code=4400)
                return
            tickets = getattr(app.state, "tickets", {})
            t = tickets.pop(str(first.get("ticket")), None)
            if not t or t["room"] != room_id or t["exp"] < time.time():
                await ws.close(code=4401)
                return
            who = t["who"]
            community.assert_can_join(room_id, who)
            if not any(p["who"] == who for p in store.participants(room_id)):
                await ws.close(code=4403)
                return
            rt = runtimes.get(room_id) or RoomRuntime.load(store, vault, hub, room_id)
            if rt is None:
                await ws.close(code=4404)
                return
            runtimes[room_id] = rt

            role = next(p["role"] for p in store.participants(room_id) if p["who"] == who)
            await hub.register(conn_id, room_id, who, ws, role=role)
            pump = asyncio.create_task(hub.pump(conn_id))
            await ws.send_text(json.dumps({
                "v": PROTOCOL_VERSION, "type": "session.ready", "roomId": room_id,
                "roomNumber": rt.join_code, "joinCode": rt.join_code,
                "serverTimeMs": int(time.time() * 1000), "status": rt.status,
                "commitHash": rt.commit,
                "roundId": rt.round_id, "deadline": rt.deadline(),
                "state": app_community_filter(rt, {**rt.engine.public_state(), **(rt.engine.private_state(who) if hasattr(rt.engine, "private_state") else {})}, who) if rt.engine else None,
                "revision": rt.revision,
            }))
            if rt.engine:
                await ws.send_text(json.dumps({
                    "v": PROTOCOL_VERSION, "type": "game.patch", "payload": app_community_filter(rt, rt.engine.public_state(), who),
                }))
            # A client that reconnected after settlement must still see the results: replay
            # the frame, rebuilt from durable state so it survives a restart too.
            last = rt.settlement_frame()
            if last:
                await ws.send_text(json.dumps(last))

            while True:
                raw = await ws.receive_text()
                if len(raw) > 8192:
                    await ws.send_text(json.dumps({"v": PROTOCOL_VERSION, "type": "error", "payload": {"code": "PAYLOAD_TOO_LARGE"}}))
                    continue
                try:
                    msg = json.loads(raw)
                except Exception:
                    await ws.send_text(json.dumps({"v": PROTOCOL_VERSION, "type": "error", "payload": {"code": "BAD_JSON"}}))
                    continue
                mtype = msg.get("type")
                if mtype == "connection.ping":
                    await ws.send_text(json.dumps({"v": PROTOCOL_VERSION, "type": "connection.pong", "serverTimeMs": int(time.time() * 1000)}))
                elif mtype == "room.sync":
                    since = int(msg.get("seq") or 0)
                    await ws.send_text(json.dumps({
                        "v": PROTOCOL_VERSION, "type": "room.snapshot",
                        "roundId": rt.round_id, "deadline": rt.deadline(),
                        "serverTimeMs": int(time.time() * 1000),
                        "payload": {"state": app_community_filter(rt, {**rt.engine.public_state(), **(rt.engine.private_state(who) if hasattr(rt.engine, "private_state") else {})}, who) if rt.engine else None},
                    }))
                elif mtype == "participant.ready":
                    try:
                        rt.set_ready(who, bool(msg.get("ready", True)))
                    except (ValueError, CommunityError) as exc:
                        await ws.send_text(json.dumps({"v": PROTOCOL_VERSION, "type": "error",
                                                      "payload": {"code": getattr(exc, "code", str(exc)),
                                                                  "message": str(exc)}}))
                        continue
                    await hub.broadcast(room_id, {"v": PROTOCOL_VERSION, "type": "participant.ready", "payload": {"who": who, "ready": bool(msg.get("ready", True))}})
                elif mtype == "action":
                    payload = msg.get("payload") or {}
                    out = await rt.act(who, payload, time.time())
                    if not out["ok"]:
                        await ws.send_text(json.dumps({
                            "v": PROTOCOL_VERSION, "type": "action.rejected", "roundId": rt.round_id,
                            "payload": {"accepted": False, "error": out["error"]},
                        }))
                else:
                    await ws.send_text(json.dumps({"v": PROTOCOL_VERSION, "type": "error", "payload": {"code": "UNKNOWN_TYPE", "message": mtype}}))
        except WebSocketDisconnect:
            pass
        finally:
            await hub.unregister(conn_id)
            if pump is not None:
                pump.cancel()

    @app.on_event("startup")
    async def _startup() -> None:
        scheduler.start()
        for row in store.list_rooms(limit=100):
            if row["status"] in {lc.RUNNING, lc.READY}:
                rt = RoomRuntime.load(store, vault, hub, row["id"])
                if rt:
                    runtimes[row["id"]] = rt

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await scheduler.stop()

    # ---------------------------------------------------------------- static SPA
    # Serving the built Center SPA from the same origin as the API removes CORS and any
    # proxy from the path, so what is verified locally is what runs in production.
    dist = os.environ.get("CENTER_WEB_DIST") or "/home/agentuser/vibeswap/web/dist"
    index = os.path.join(dist, "index.html")
    if os.path.exists(index):
        from fastapi.responses import FileResponse, HTMLResponse
        from fastapi.staticfiles import StaticFiles

        assets = os.path.join(dist, "assets")
        if os.path.isdir(assets):
            app.mount("/center/assets", StaticFiles(directory=assets), name="center-assets")

        @app.get("/center", include_in_schema=False)
        @app.get("/center/{rest:path}", include_in_schema=False)
        def center_spa(rest: str = ""):
            candidate = os.path.join(dist, rest)
            if rest and os.path.isfile(candidate) and os.path.abspath(candidate).startswith(os.path.abspath(dist)):
                return FileResponse(candidate)
            # Client-side routes (/center/create, /center/rooms/x) all serve the shell.
            return HTMLResponse(open(index, encoding="utf-8").read())

    return app


app = create_app() if os.environ.get("CENTER_EAGER_APP", "false").lower() == "true" else None
