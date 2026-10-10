"""End-to-end API + realtime tests: the D/C acceptance bar.

Covers lifecycle legality, vault idempotency, merkle proof integrity, an authenticated
two-player WebSocket round, settlement, claims and the private-room invite gate.
"""

from __future__ import annotations

import json
import time

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from center import lifecycle as lc
from center import settlement as st
from center.api import API_PREFIX, Auth, create_app
from center.store import Store
from center.vault import InsufficientBalance, VaultError, VaultService

HUNT = {
    "templateId": "number-hunt",
    "name": "Four Digit Hunt",
    "visibility": "public",
    "mode": "preview",
    "rules": {
        "templateId": "number-hunt", "digits": 4, "min": 1111, "max": 9999,
        "guess_budget": 20, "duration_seconds": 60, "hints": "on",
        "target_count": 1, "win_mode": "first-hit", "guess_cooldown_ms": 300,
    },
    "admission": {"player_cap": 8, "min_ready_to_start": 2},
    "access": {"vault_mode": "simulated", "required_amount": 100, "joiner_fee": 25,
               "creator_absorbs_joiner_fee": True},
    "rewards": {"kind": "preview-points", "slots": [{"rank": 1, "points": 100}]},
}


def make_app(tmp_path):
    return create_app(db_path=str(tmp_path / "center.db"), authenticator=Auth("test-secret"))


def sign_in(client, acct) -> dict:
    nonce = client.post(f"{API_PREFIX}/auth/nonce", json={"address": acct.address}).json()["nonce"]
    msg = f"Orbix Center sign-in\nnonce: {nonce}"
    sig = Account.sign_message(encode_defunct(text=msg), private_key=acct.key).signature.hex()
    tok = client.post(
        f"{API_PREFIX}/auth/verify",
        json={"address": acct.address, "nonce": nonce, "signature": sig},
    ).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def fund_and_publish(client, host, nonce="intent-1", cfg=None):
    h = sign_in(client, host)
    client.post(f"{API_PREFIX}/wallet/vault/deposit", json={"amount": 1000}, headers=h)
    return h, client.post(
        f"{API_PREFIX}/rooms",
        json={"config": cfg or HUNT, "intentNonce": nonce},
        headers=h,
    ).json()


# --------------------------------------------------------------------- lifecycle


def test_legal_and_illegal_transitions():
    assert lc.transition(lc.DRAFT, lc.CONFIG_FROZEN) == lc.CONFIG_FROZEN
    assert lc.transition(lc.REGISTRATION, lc.RUNNING) == lc.RUNNING
    with pytest.raises(lc.LifecycleError):
        lc.transition(lc.DRAFT, lc.CLAIMABLE)
    with pytest.raises(lc.LifecycleError):
        lc.transition(lc.REGISTRATION, lc.CONFIG_FROZEN)


def test_terminal_state_is_never_overwritten():
    assert lc.transition(lc.CLAIMABLE, lc.CLOSED) == lc.CLOSED
    assert not lc.can_transition(lc.CLOSED, lc.RUNNING)
    with pytest.raises(lc.LifecycleError):
        lc.transition(lc.CLOSED, lc.RUNNING)
    # A stale timer must not revive a refunded room either.
    assert not lc.can_transition(lc.REFUNDABLE, lc.RUNNING)


def test_unknown_state_is_rejected():
    with pytest.raises(lc.LifecycleError):
        lc.can_transition("banana", lc.RUNNING)


# --------------------------------------------------------------------- vault


def test_publish_deduction_is_idempotent_per_intent(tmp_path):
    vault = VaultService(Store(str(tmp_path / "v.db")))
    vault.deposit("0xabc", 500)
    assert vault.deduct_for_publish("0xabc", "0xintent", 100, "room1") is True
    assert vault.deduct_for_publish("0xabc", "0xintent", 100, "room1") is False  # retry: no charge
    assert vault.balance_of("0xabc") == 400


def test_refund_once_and_capped(tmp_path):
    vault = VaultService(Store(str(tmp_path / "v2.db")))
    vault.deposit("0xabc", 300)
    vault.deduct_for_publish("0xabc", "0xi", 100, "r")
    vault.refund_deduction("0xabc", "0xi")
    assert vault.balance_of("0xabc") == 300
    with pytest.raises(VaultError):
        vault.refund_deduction("0xabc", "0xi")  # cannot refund twice


def test_insufficient_balance_and_no_negative(tmp_path):
    vault = VaultService(Store(str(tmp_path / "v3.db")))
    vault.deposit("0xabc", 50)
    with pytest.raises(InsufficientBalance):
        vault.deduct_for_publish("0xabc", "0xi", 100, "r")
    assert vault.balance_of("0xabc") == 50
    assert "room-creation" not in [r["kind"] for r in vault.ledger("0xabc")]


def test_joiner_fee_absorbed_once_per_joiner(tmp_path):
    vault = VaultService(Store(str(tmp_path / "v4.db")))
    vault.deposit("0xhost", 1000)
    assert vault.charge_joiner_fee("0xhost", "room", 25, "0xjoiner") is True
    assert vault.charge_joiner_fee("0xhost", "room", 25, "0xjoiner") is False
    assert vault.balance_of("0xhost") == 975


# --------------------------------------------------------------------- settlement


def test_merkle_proof_rebuilds_the_root():
    escrow = "0x" + "11" * 20
    leaves, entries = [], []
    for i, winner in enumerate(["0x" + "aa" * 20, "0x" + "bb" * 20, "0x" + "cc" * 20]):
        cid, leaf = st.entitlement_leaf(
            chain_id=46630, escrow=escrow, round_id="0x" + "22" * 32, winner=winner,
            slot_id=i + 1, allocation_nonce=0, asset_kind="preview-points",
            asset_contract="0x" + "00" * 20, token_id=0, amount=0,
        )
        leaves.append(leaf)
        entries.append(cid)
    root = st.merkle_root(leaves)
    for i, leaf in enumerate(leaves):
        node = leaf
        for step in st.merkle_proof(leaves, i):
            node = st._hash_pair(node, step)
        assert node == root, f"proof {i} did not rebuild the root"


def test_payment_code_shape_and_reference():
    cid = "0x" + "ab" * 32
    code = st.payment_code(cid)
    assert code.startswith("OC2-")
    assert len(code.split("-")[1]) == 64
    assert st.parse_payment_code(code) == cid.lower()
    assert st.parse_payment_code("OC1-AAAAAAAA-000000") is None
    assert st.parse_payment_code("nonsense") is None


def test_payment_code_rejects_tampered_checksum():
    cid = "0x" + "ab" * 32
    code = st.payment_code(cid)
    prefix, reference, checksum = code.split("-")
    replacement = "0" if checksum[0] != "0" else "1"
    assert st.parse_payment_code(f"{prefix}-{reference}-{replacement}{checksum[1:]}") is None


def test_settlement_signature_is_deterministic_and_verifiable():
    acct = Account.create()
    kwargs = dict(
        chain_id=46630, escrow="0x" + "11" * 20, round_id="0x" + "22" * 32,
        config_hash="0x" + "33" * 32, root=b"\x44" * 32, allocations=b"\x55" * 32,
        transcript=b"\x66" * 32, deadline=int(time.time()) + 3600, epoch=1,
    )
    sig = st.sign_settlement(acct.key.hex(), **kwargs)
    digest = st.settlement_digest(**kwargs)
    recovered = Account._recover_hash(digest, signature=sig)
    assert recovered.lower() == acct.address.lower()


# --------------------------------------------------------------------- API surface


def test_health_and_catalog(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(f"{API_PREFIX}/health/live").json()["ok"] is True
        t = client.get(f"{API_PREFIX}/templates").json()
        assert t["count"] == 25, "the full catalog including the five portfolio games"
        from center.schema import TEMPLATE_RULES
        ids = {x["templateId"] for x in t["templates"]}
        assert ids == set(TEMPLATE_RULES), "the catalog must list every registered template"
        for tid in ("number-hunt", "live-quiz", "memory-match", "token-catch",
                    "reaction-duel", "puzzle-sprint", "hash-hunt", "boss-raid"):
            assert tid in ids
        assert all(x["availability"] == "preview" for x in t["templates"])


def test_unauthenticated_publish_is_rejected(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        r = client.post(f"{API_PREFIX}/rooms", json={"config": HUNT})
        assert r.status_code == 401


def test_publish_replay_returns_the_same_room(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        host = Account.create()
        h, first = fund_and_publish(client, host, nonce="fixed-nonce")
        assert first["charged"] == 100
        second = client.post(
            f"{API_PREFIX}/rooms", json={"config": HUNT, "intentNonce": "fixed-nonce"}, headers=h
        ).json()
        assert second["roomId"] == first["roomId"]
        assert second["charged"] == 0 and second.get("replayed") is True
        assert second["balanceAfter"] == 900  # charged exactly once
        rooms = client.get(f"{API_PREFIX}/rooms").json()["rooms"]
        assert len(rooms) == 1


def test_preview_room_cannot_use_the_real_vault(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        host = Account.create()
        h = sign_in(client, host)
        bad = json.loads(json.dumps(HUNT))
        bad["access"] = {"vault_mode": "onchain", "token": "0x" + "77" * 20, "required_amount": 100}
        r = client.post(f"{API_PREFIX}/rooms", json={"config": bad}, headers=h)
        assert r.status_code == 422


def test_private_room_needs_an_invite(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        host, guest = Account.create(), Account.create()
        cfg = json.loads(json.dumps(HUNT))
        cfg["visibility"] = "private"
        h, room = fund_and_publish(client, host, cfg=cfg)
        g = sign_in(client, guest)
        denied = client.post(f"{API_PREFIX}/rooms/{room['roomId']}/join", json={}, headers=g)
        assert denied.status_code == 403
        invite = client.post(f"{API_PREFIX}/rooms/{room['roomId']}/invites", headers=h).json()["invite"]
        ok = client.post(f"{API_PREFIX}/rooms/{room['roomId']}/join", json={"invite": invite}, headers=g)
        assert ok.status_code == 200 and ok.json()["role"] == "player"
        # Private rooms never appear in discovery.
        assert client.get(f"{API_PREFIX}/rooms").json()["rooms"] == []


def test_publish_requires_a_funded_vault(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        host = Account.create()
        h = sign_in(client, host)
        r = client.post(f"{API_PREFIX}/rooms", json={"config": HUNT, "intentNonce": "broke"}, headers=h)
        assert r.status_code == 402
        assert r.json()["detail"]["code"] == "INSUFFICIENT_BALANCE"


def test_admin_pricing_rejects_non_admin_wallet(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        user = Account.create()
        headers = sign_in(client, user)
        denied = client.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 7, "joinerFee": 3}, headers=headers)
        assert denied.status_code == 403



class WsReader:
    """Reads frames on a background thread so a missing frame fails fast, never hangs."""

    def __init__(self, ws) -> None:
        import queue
        import threading

        self.q: queue.Queue = queue.Queue()
        self.seen: list[dict] = []
        self.thread = threading.Thread(target=self._run, args=(ws,), daemon=True)
        self.thread.start()

    def _run(self, ws) -> None:
        try:
            while True:
                msg = json.loads(ws.receive_text())
                self.seen.append(msg)
                self.q.put(msg)
        except Exception as exc:  # socket closed
            self.q.put({"type": "_closed", "payload": {"error": str(exc)}})

    def want(self, kind: str, timeout: float = 10.0) -> dict:
        end = time.time() + timeout
        while True:
            remaining = end - time.time()
            if remaining <= 0:
                raise AssertionError(f"never received {kind}; saw {[m.get('type') for m in self.seen]}")
            try:
                msg = self.q.get(timeout=remaining)
            except Exception:
                continue
            if msg.get("type") == kind:
                return msg


def _drain(ws, want: str, limit: int = 40) -> dict:
    return WsReader(ws).want(want)


def test_two_player_websocket_round_settles(tmp_path, monkeypatch):
    monkeypatch.setenv("CENTER_DB", str(tmp_path / "center.db"))
    app = make_app(tmp_path)
    with TestClient(app) as client:
        host, guest = Account.create(), Account.create()
        h, room = fund_and_publish(client, host)
        room_id = room["roomId"]
        assert room["charged"] == 100

        g = sign_in(client, guest)
        assert client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=g).status_code == 200
        host_ticket = client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=h).json()["ticket"]

        # The host absorbed the joiner fee from the vault, so the guest pays nothing.
        assert client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=g).json()["joinerFee"] == "absorbed-by-creator"
        assert client.get(f"{API_PREFIX}/wallet/vault", headers=h).json()["balance"] == 875  # 1000-100-25

        client.post(f"{API_PREFIX}/rooms/{room_id}/ready", json={"ready": True}, headers=h)
        client.post(f"{API_PREFIX}/rooms/{room_id}/ready", json={"ready": True}, headers=g)
        started = client.post(f"{API_PREFIX}/rooms/{room_id}/start", headers=h).json()
        assert started["roundId"] and started["commitHash"].startswith("0x")

        with client.websocket_connect(f"{API_PREFIX}/ws/rooms/{room_id}") as ws_h:
            rh = WsReader(ws_h)
            ws_h.send_text(json.dumps({"type": "session.hello", "ticket": host_ticket}))
            hello = rh.want("session.ready")
            assert hello["status"] == lc.RUNNING

            # A 5-digit guess is refused: only four digits are accepted.
            ws_h.send_text(json.dumps({"type": "action", "payload": {"kind": "guess", "number": 12345}}))
            assert rh.want("action.rejected")["payload"]["error"] == "BAD_DIGITS"

            rt = app.state.runtimes[room_id]
            target = rt.engine.targets[0]

            # The guest guesses the target first and wins the round.
            guest_ticket = client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=g).json()["ticket"]
            with client.websocket_connect(f"{API_PREFIX}/ws/rooms/{room_id}") as ws_g:
                rg = WsReader(ws_g)
                ws_g.send_text(json.dumps({"type": "session.hello", "ticket": guest_ticket}))
                rg.want("session.ready")
                ws_g.send_text(json.dumps({"type": "action", "payload": {"kind": "guess", "number": target}}))
                ack = rg.want("action.ack")
                assert ack["payload"]["accepted"] is True, ack
                settled = rh.want("settlement.finalized")
                assert settled["payload"]["allocations"], "no allocation produced"
                alloc = settled["payload"]["allocations"][0]
                assert alloc["winner"].lower() == guest.address.lower()
                assert alloc["points"] == 100
                assert alloc["code"].startswith("OC2-")

        results = client.get(f"{API_PREFIX}/rooms/{room_id}/results").json()
        assert results["state"] == lc.CLAIMABLE
        assert results["results"][0]["who"].lower() == guest.address.lower()

        fair = client.get(f"{API_PREFIX}/rounds/{results['roundId']}/fairness").json()
        assert fair["commitHash"].startswith("0x") and fair["merkleRoot"].startswith("0x")
        assert fair["seed"] and fair["transcriptHash"].startswith("0x")

        # Reveal-after-the-fact: the seed now reproduces the same target set.
        from center.games import ENGINES
        from center.schema import RoomConfig

        cfg = RoomConfig(**app.state.store.get_room(room_id)["config"])
        replay = ENGINES["number-hunt"](cfg, results["roundId"], fair["seed"], [host.address, guest.address])
        replay.start(0.0)
        assert replay.targets == rt.engine.targets

        claim = client.get(f"{API_PREFIX}/claims/{alloc['code']}")
        assert claim.status_code == 401
        claim = client.get(f"{API_PREFIX}/claims/{alloc['code']}", headers=g)
        assert claim.status_code == 200
        assert claim.json()["winner"].lower() == guest.address.lower()
        lookup = client.post(f"{API_PREFIX}/claims/lookup", json={"code": alloc["code"]}, headers=g).json()
        assert lookup["payable"] is False  # preview points are honestly not payable
        assert "preview" in lookup["reason"]

        # A different wallet cannot claim someone else's entitlement.
        other = sign_in(client, Account.create())
        bad = client.post(f"{API_PREFIX}/claims/lookup", json={"code": alloc["code"]}, headers=other)
        assert bad.status_code == 403
        assert "proof" not in bad.text
        assert client.get(f"{API_PREFIX}/claims/{alloc['code']}", headers=other).status_code == 403
        assert client.get(f"{API_PREFIX}/claims/{alloc['claimId']}", headers=g).status_code == 404
        assert client.post(f"{API_PREFIX}/claims/lookup", json={"code": alloc["code"][:12]}, headers=g).status_code == 404
        assert client.post(f"{API_PREFIX}/claims/lookup", json={"code": "OC1-" + alloc["claimId"][2:10].upper() + "-000000"}, headers=g).status_code == 404

        # Ledger export is a real download.
        csv = client.get(f"{API_PREFIX}/wallet/ledger.csv", headers=h)
        assert csv.status_code == 200 and "room-creation" in csv.text


def test_settlement_is_replayed_to_a_late_joiner(tmp_path):
    """A client that reconnects after settlement must still receive the results.

    Found live: a tab that was idle while the room went claimable showed no results
    panel at all, because the settlement was only ever a live broadcast.
    """
    app = make_app(tmp_path)
    with TestClient(app) as client:
        host = Account.create()
        h, room = fund_and_publish(client, host)
        room_id = room["roomId"]
        ticket = client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=h).json()["ticket"]
        client.post(f"{API_PREFIX}/rooms/{room_id}/ready", json={"ready": True}, headers=h)
        # min_ready_to_start is a hard floor, so the room needs its second ready player.
        guest = Account.create()
        g = sign_in(client, guest)
        client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=g)
        client.post(f"{API_PREFIX}/rooms/{room_id}/ready", json={"ready": True}, headers=g)
        client.post(f"{API_PREFIX}/rooms/{room_id}/start", headers=h)

        # Reconnect on a fresh socket mid-round: session.ready must carry a running state.
        with client.websocket_connect(f"{API_PREFIX}/ws/rooms/{room_id}") as ws:
            r = WsReader(ws)
            ws.send_text(json.dumps({"type": "session.hello", "ticket": ticket}))
            hello = r.want("session.ready")
            assert hello["status"] == lc.RUNNING

        import asyncio as _asyncio
        rt = app.state.runtimes[room_id]
        client.portal.call(rt.finish)  # settle with zero clients on the app event loop

        # A brand-new socket after settlement must receive the replayed settlement frame.
        with client.websocket_connect(f"{API_PREFIX}/ws/rooms/{room_id}") as ws2:
            r2 = WsReader(ws2)
            fresh = client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=h).json()["ticket"]
            ws2.send_text(json.dumps({"type": "session.hello", "ticket": fresh}))
            frame = r2.want("settlement.finalized")
            assert frame["payload"]["merkleRoot"], "the replayed frame must carry the receipt"
            assert frame["payload"]["results"] is not None


def test_min_ready_floor_cannot_be_undershot(tmp_path):
    """A host must not start a room before min_ready_to_start players are ready.

    Found live: the start check used min(min_ready, len(players)), so a host with
    min_ready=2 could start a round with just himself.
    """
    app = make_app(tmp_path)
    with TestClient(app) as client:
        host = Account.create()
        h, room = fund_and_publish(client, host)
        room_id = room["roomId"]
        client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=h)
        client.post(f"{API_PREFIX}/rooms/{room_id}/ready", json={"ready": True}, headers=h)
        r = client.post(f"{API_PREFIX}/rooms/{room_id}/start", headers=h)
        assert r.status_code in (400, 409), "starting with 1/2 ready must be refused"
