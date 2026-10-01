"""Center HTTP + WebSocket API (`/api/center/v1`).

Feature flags gate every funded path. Enabling a funded flag without addresses, a chain
and durable storage is refused at startup rather than silently pretending to work.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
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
from center.store import Store
from center.vault import InsufficientBalance, OnchainVault, VaultError, VaultService, publication_intent
from center.vault import JsonRpc

API_PREFIX = "/api/center/v1"
SESSION_TTL = 3600


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


# --------------------------------------------------------------------- app factory


def create_app(*, db_path: str | None = None, authenticator: Auth | None = None, onchain: OnchainVault | None = None, admin_address: str | None = None) -> FastAPI:
    flags = Flags.from_env()
    problems = flags.validate_startup()
    if problems:
        raise RuntimeError("Center refuses to start: " + "; ".join(problems))

    store = Store(db_path)
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

    origins = [o.strip() for o in os.environ.get("CENTER_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["content-type", "authorization"],
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

    def runtime_for(room_id: str) -> RoomRuntime:
        rt = runtimes.get(room_id)
        if rt is None:
            rt = RoomRuntime.load(store, vault, hub, room_id)
            if rt is None:
                raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such room"})
            runtimes[room_id] = rt
        return rt

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

    # ------------------------------------------------------------------ drafts

    @app.post(f"{API_PREFIX}/drafts")
    def create_draft(body: CreateDraft, who: str = Depends(require_wallet)) -> dict:
        config = validate_config(body.config)
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
                    "roomId": row["id"], "status": row["status"], "visibility": row["visibility"],
                    "intentId": intent, "charged": 0, "balanceAfter": vault.balance_of(who, unit0),
                    "balanceLabel": vault.label(unit0), "replayed": True,
                    "shareUrl": f"/center/rooms/{row['id']}",
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
        # Snapshot the schedule the moment the room is published; a later admin
        # change can never reprice an existing room.
        store.set_setting(f"pricing:{rt.room_id}", FeeSchedule.from_dict(store.get_setting(SETTING_KEY)).as_dict())
        store.set_intent_room(intent, rt.room_id)
        store.set_intent_state(intent, "consumed")
        runtimes[rt.room_id] = rt
        balance_after = vault.balance_of(who, unit)
        return {
            "roomId": rt.room_id,
            "status": rt.status,
            "visibility": config.visibility,
            "intentId": intent,
            "charged": charged,
            "balanceAfter": balance_after,
            "balanceLabel": vault.label(unit),
            "shareUrl": f"/center/rooms/{rt.room_id}",
        }

    @app.get(f"{API_PREFIX}/rooms")
    def list_rooms(limit: int = Query(default=50, le=100)) -> dict:
        rows = store.list_rooms(visibility="public", limit=limit)
        return {
            "rooms": [
                {
                    "roomId": r["id"], "name": r["config"]["name"], "templateId": r["template_id"],
                    "status": r["status"], "visibility": r["visibility"], "mode": r["mode"],
                    "players": len([p for p in store.participants(r["id"]) if p["role"] == "player"]),
                    "rewards": r["config"]["rewards"]["kind"],
                }
                for r in rows
            ]
        }

    @app.get(f"{API_PREFIX}/rooms/{{room_id}}")
    def get_room(room_id: str) -> dict:
        row = store.get_room(room_id)
        if not row:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such room"})
        # Unlisted rooms are readable by URL but never listed; private rooms hide their rules.
        config = row["config"] if row["visibility"] != "private" else {"name": row["config"]["name"]}
        return {
            "roomId": row["id"], "status": row["status"], "visibility": row["visibility"],
            "mode": row["mode"], "owner": row["owner"], "config": config,
            "pricingSnapshot": FeeSchedule.from_dict(store.get_setting(f"pricing:{room_id}")).as_dict(),
            "participants": [
                {"who": p["who"], "role": p["role"], "ready": bool(p["ready"])}
                for p in store.participants(room_id)
            ],
        }

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/invites")
    def create_invite(room_id: str, who: str = Depends(require_wallet)) -> dict:
        row = store.get_room(room_id)
        if not row:
            raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "no such room"})
        if row["owner"] != who:
            raise HTTPException(403, detail={"code": "FORBIDDEN", "message": "only the host may issue invites"})
        code = secrets.token_urlsafe(9)
        store.add_invite(room_id, code)
        return {"invite": code, "shareUrl": f"/center/rooms/{room_id}?invite={code}"}

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/join")
    def join_room(room_id: str, body: JoinBody, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
        try:
            result = rt.join(who, role=body.role, invite=body.invite)
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
        return rt.set_ready(who, ready_flag)

    @app.post(f"{API_PREFIX}/rooms/{{room_id}}/start")
    async def start(room_id: str, who: str = Depends(require_wallet)) -> dict:
        rt = runtime_for(room_id)
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
            "roundId": round_id, "commitHash": rnd["commit_hash"], "seed": rnd["seed"],
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
            rt = runtimes.get(room_id) or RoomRuntime.load(store, vault, hub, room_id)
            if rt is None:
                await ws.close(code=4404)
                return
            runtimes[room_id] = rt

            await hub.register(conn_id, room_id, who, ws)
            pump = asyncio.create_task(hub.pump(conn_id))
            await ws.send_text(json.dumps({
                "v": PROTOCOL_VERSION, "type": "session.ready", "roomId": room_id,
                "serverTimeMs": int(time.time() * 1000), "status": rt.status,
                "commitHash": rt.commit,
                "state": rt.engine.public_state() if rt.engine else None,
                "revision": rt.revision,
            }))
            if rt.engine:
                await ws.send_text(json.dumps({
                    "v": PROTOCOL_VERSION, "type": "game.patch", "payload": rt.engine.public_state(),
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
                    missed = store.actions_since(room_id, since)
                    await ws.send_text(json.dumps({
                        "v": PROTOCOL_VERSION, "type": "room.snapshot",
                        "payload": {"actions": missed, "state": rt.engine.public_state() if rt.engine else None},
                    }))
                elif mtype == "participant.ready":
                    rt.set_ready(who, bool(msg.get("ready", True)))
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
