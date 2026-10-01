"""Admin pricing authority + audit log (delivery gates B02, B04, B10, B11, G09 backend).

Every test here proves an admin-control invariant without enabling any funded path:
the schedule is a server-side default that is snapshotted per published room, so a
later admin change can never retroactively alter an existing room's terms.
"""

from __future__ import annotations

import json

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from center.api import API_PREFIX, Auth, create_app
from center.pricing import ADMIN_ADDRESS, JOINER_FEE_CAP, CREATOR_FEE_CAP

HUNT = {
    "templateId": "number-hunt",
    "name": "Admin Schedule Room",
    "visibility": "public",
    "mode": "preview",
    "rules": {
        "templateId": "number-hunt", "digits": 4, "min": 1111, "max": 9999,
        "guess_budget": 20, "duration_seconds": 60, "hints": "on",
        "target_count": 1, "win_mode": "first-hit", "guess_cooldown_ms": 300,
    },
    "admission": {"player_cap": 8, "min_ready_to_start": 2},
    "access": {"vault_mode": "simulated", "required_amount": 100, "joiner_fee": 25},
    "rewards": {"kind": "preview-points", "slots": [{"rank": 1, "points": 100}]},
}


def make_app(tmp_path, admin_address: str | None = None):
    """Build a Center test app wired to a throwaway database."""
    return create_app(
        db_path=str(tmp_path / "center.db"),
        authenticator=Auth("test-secret"),
        admin_address=admin_address,
    )


def sign_in(client, acct) -> dict:
    nonce = client.post(f"{API_PREFIX}/auth/nonce", json={"address": acct.address}).json()["nonce"]
    sig = Account.sign_message(
        encode_defunct(text=f"Orbix Center sign-in\nnonce: {nonce}"), private_key=acct.key
    ).signature.hex()
    tok = client.post(
        f"{API_PREFIX}/auth/verify",
        json={"address": acct.address, "nonce": nonce, "signature": sig},
    ).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def admin_proof(client, acct) -> str:
    """Fresh, single-use signed proof over the distinct admin domain."""
    body = client.post(f"{API_PREFIX}/auth/nonce", json={"address": acct.address, "purpose": "admin"}).json()
    sig = Account.sign_message(encode_defunct(text=body["message"]), private_key=acct.key).signature.hex()
    return f"{body['nonce']}:{sig}"


# --------------------------------------------------------------------- auth gate


def test_non_admin_cannot_read_or_change_pricing(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        user = Account.create()
        headers = sign_in(client, user)
        assert client.get(f"{API_PREFIX}/admin/pricing", headers=headers).status_code == 403
        assert client.patch(
            f"{API_PREFIX}/admin/pricing", json={"creatorFee": 7, "joinerFee": 3}, headers=headers
        ).status_code == 403
        assert client.get(f"{API_PREFIX}/admin/audit", headers=headers).status_code == 403


def test_unauthenticated_admin_calls_are_401(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(f"{API_PREFIX}/admin/pricing").status_code == 401
        assert client.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 1, "joinerFee": 1}).status_code == 401


def test_admin_mutation_requires_a_fresh_signed_proof(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        admin = Account.create()
        app = make_app(tmp_path, admin_address=admin.address)
        with TestClient(app) as c:
            headers = sign_in(c, admin)
            # A valid admin session alone is not enough: no fresh proof.
            no_proof = c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 7, "joinerFee": 3}, headers=headers)
            assert no_proof.status_code == 403
            assert "FRESH" in no_proof.text.upper() or "proof" in no_proof.text.lower()
            # With a fresh proof the same mutation is accepted.
            signed = dict(headers, **{"X-Admin-Proof": admin_proof(c, admin)})
            ok = c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 7, "joinerFee": 3}, headers=signed)
            assert ok.status_code == 200, ok.text


def test_admin_proof_nonce_is_single_use(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        admin = Account.create()
        with TestClient(make_app(tmp_path, admin_address=admin.address)) as c:
            headers = sign_in(c, admin)
            proof = admin_proof(c, admin)
            signed = dict(headers, **{"X-Admin-Proof": proof})
            assert c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 7, "joinerFee": 3}, headers=signed).status_code == 200
            replay = c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 8, "joinerFee": 4}, headers=signed)
            assert replay.status_code == 403, "a consumed admin nonce must never be accepted twice"


def test_admin_proof_must_come_from_the_exact_admin_wallet(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        admin = Account.create()
        with TestClient(make_app(tmp_path, admin_address=admin.address)) as c:
            impostor = Account.create()
            headers = sign_in(c, impostor)
            proof = admin_proof(c, impostor)  # signs the admin domain but recovers to the impostor
            signed = dict(headers, **{"X-Admin-Proof": proof})
            assert c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 7, "joinerFee": 3}, headers=signed).status_code == 403


def test_default_admin_address_is_the_exact_wallet():
    assert ADMIN_ADDRESS == "0x253db2d543b10c94918de97eb8499ee59ab9087e"
    assert make_app.__doc__ is not None  # sanity: module importable


# --------------------------------------------------------------------- schedule + caps


def test_admin_updates_schedule_and_reads_it_back(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        admin = Account.create()
        with TestClient(make_app(tmp_path, admin_address=admin.address)) as c:
            headers = sign_in(c, admin)
            started = c.get(f"{API_PREFIX}/admin/pricing", headers=headers).json()
            assert started["pricing"] == {"creatorFee": 0, "joinerFee": 0}
            assert started["caps"] == {"creatorFee": CREATOR_FEE_CAP, "joinerFee": JOINER_FEE_CAP}
            assert started["admin"].lower() == admin.address.lower()
            assert started["chainId"] == 46630

            signed = dict(headers, **{"X-Admin-Proof": admin_proof(c, admin)})
            changed = c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 120, "joinerFee": 15}, headers=signed)
            assert changed.status_code == 200
            assert changed.json()["pricing"] == {"creatorFee": 120, "joinerFee": 15}
            readback = c.get(f"{API_PREFIX}/admin/pricing", headers=headers).json()
            assert readback["pricing"] == {"creatorFee": 120, "joinerFee": 15}


def test_schedule_rejects_values_above_caps_and_negatives(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        admin = Account.create()
        with TestClient(make_app(tmp_path, admin_address=admin.address)) as c:
            headers = sign_in(c, admin)
            signed = dict(headers, **{"X-Admin-Proof": admin_proof(c, admin)})
            over = c.patch(
                f"{API_PREFIX}/admin/pricing",
                json={"creatorFee": CREATOR_FEE_CAP + 1, "joinerFee": 0}, headers=signed,
            )
            assert over.status_code in (400, 403, 422), over.text
            neg = c.patch(
                f"{API_PREFIX}/admin/pricing",
                json={"creatorFee": -1, "joinerFee": 0}, headers=signed,
            )
            assert neg.status_code in (400, 403, 422)
            # No partial write happened.
            assert c.get(f"{API_PREFIX}/admin/pricing", headers=headers).json()["pricing"] == {"creatorFee": 0, "joinerFee": 0}


# --------------------------------------------------------------------- audit log


def test_audit_log_records_actor_old_new_and_chain(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        admin = Account.create()
        with TestClient(make_app(tmp_path, admin_address=admin.address)) as c:
            headers = sign_in(c, admin)
            c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 50, "joinerFee": 5}, headers=dict(headers, **{"X-Admin-Proof": admin_proof(c, admin)}))
            c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 60, "joinerFee": 6}, headers=dict(headers, **{"X-Admin-Proof": admin_proof(c, admin)}))

            entries = c.get(f"{API_PREFIX}/admin/audit", headers=headers).json()["entries"]
            assert len(entries) == 2
            newest = entries[0]
            assert newest["actor"].lower() == admin.address.lower()
            assert newest["action"] == "pricing.update"
            assert newest["oldValue"] == {"creatorFee": 50, "joinerFee": 5}
            assert newest["newValue"] == {"creatorFee": 60, "joinerFee": 6}
            assert newest["chainId"] == 46630
            assert newest["createdAt"] > 0
            older = entries[1]
            assert older["oldValue"] == {"creatorFee": 0, "joinerFee": 0}


def test_audit_log_grows_by_one_per_accepted_change_only(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        admin = Account.create()
        with TestClient(make_app(tmp_path, admin_address=admin.address)) as c:
            headers = sign_in(c, admin)
            # A rejected mutation (over cap) must not be logged as applied.
            signed = dict(headers, **{"X-Admin-Proof": admin_proof(c, admin)})
            c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": CREATOR_FEE_CAP + 1, "joinerFee": 0}, headers=signed)
            assert c.get(f"{API_PREFIX}/admin/audit", headers=headers).json()["entries"] == []


# --------------------------------------------------------------------- room snapshot


def _publish(client, host, cfg=None, nonce="snap-1"):
    h = sign_in(client, host)
    client.post(f"{API_PREFIX}/wallet/vault/deposit", json={"amount": 1000}, headers=h)
    room = client.post(f"{API_PREFIX}/rooms", json={"config": cfg or HUNT, "intentNonce": nonce}, headers=h)
    assert room.status_code == 200, room.text
    return h, room.json()


def test_room_pricing_snapshot_is_immutable_when_the_schedule_changes(tmp_path):
    admin = Account.create()
    app = make_app(tmp_path, admin_address=admin.address)
    with TestClient(app) as c:
        host = Account.create()
        _h, room_a = _publish(c, host)
        snap_a = c.get(f"{API_PREFIX}/rooms/{room_a['roomId']}").json()["pricingSnapshot"]
        assert snap_a == {"creatorFee": 0, "joinerFee": 0}

        aheaders = sign_in(c, admin)
        signed = dict(aheaders, **{"X-Admin-Proof": admin_proof(c, admin)})
        changed = c.patch(f"{API_PREFIX}/admin/pricing", json={"creatorFee": 200, "joinerFee": 20}, headers=signed)
        assert changed.status_code == 200

        # The already-published room keeps its frozen terms...
        frozen = c.get(f"{API_PREFIX}/rooms/{room_a['roomId']}").json()["pricingSnapshot"]
        assert frozen == {"creatorFee": 0, "joinerFee": 0}, "an existing room must not be repriced"

        # ...while a newly published room picks up the new schedule.
        _h2, room_b = _publish(c, host, cfg=None, nonce="snap-2")
        snap_b = c.get(f"{API_PREFIX}/rooms/{room_b['roomId']}").json()["pricingSnapshot"]
        assert snap_b == {"creatorFee": 200, "joinerFee": 20}
        assert room_b["roomId"] != room_a["roomId"]
