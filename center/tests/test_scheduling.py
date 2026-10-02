"""Timing/scheduling E2E: scheduled opening, scheduled closing, my-rooms list,
host close, and the reaper freeing closed runtimes. FakeRpc-backed; no live RPC."""

import pytest
from fastapi.testclient import TestClient
import tempfile

import center.api as api_mod
from center.room import Scheduler, RoomRuntime


def _client(tmp_path):
    for var in ("CENTER_REAL_BURN", "CENTER_VAULT_TOKEN", "CENTER_VAULT", "CENTER_ESCROW",
                "CENTER_SIGNER_KEY", "CENTER_TESTNET_REWARDS"):
        import os
        monkeypatch_free = True
    # create_app with a clean env is fine for preview rooms (no funded flags)
    app = api_mod.create_app(db_path=str(tmp_path / "c.db"))
    return TestClient(app)


def _sign_in(client, key_hex: str = "0x" + "aa" * 32):
    from eth_account import Account
    import center.api as api_mod
    acct = Account.from_key(key_hex)
    nonce = client.post(f"{api_mod.API_PREFIX}/auth/nonce", json={"address": acct.address}).json()["nonce"]
    sig = Account.sign_message(
        api_mod.encode_defunct(text=f"Orbix Center sign-in\nnonce: {nonce}"), private_key=acct.key
    ).signature.hex()
    tok = client.post(f"{api_mod.API_PREFIX}/auth/verify",
                      json={"address": acct.address, "nonce": nonce, "signature": sig}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}, acct.address


def _publish(client, headers, name: str, open_at: int = 0, close_at: int = 0) -> str:
    config = {
        "template_id": "number-hunt", "name": name, "visibility": "unlisted", "mode": "preview",
        "description": "",
        "rules": {"templateId": "number-hunt", "digits": 4, "min": 1111, "max": 9999,
                  "guess_budget": 10, "duration_seconds": 60, "hints": "off"},
        "admission": {"player_cap": 8, "min_ready_to_start": 1, "spectators": False},
        "access": {"vault_mode": "simulated", "required_amount": 0, "joiner_fee": 0,
                   "creator_absorbs_joiner_fee": False},
        "entry": {"kind": "free"},
        "rewards": {"kind": "preview-points", "slots": [{"rank": 1, "points": 10}]},
        "timing": {"open_at": open_at, "close_at": close_at},
    }
    r = client.post(f"{api_mod.API_PREFIX}/rooms",
                    json={"config": config, "intentNonce": name}, headers=headers)
    assert r.status_code == 200, r.json()
    return r.json()["roomId"]


def test_my_rooms_lists_created_rooms(tmp_path):
    client = _client(tmp_path)
    headers, addr = _sign_in(client)
    rid = _publish(client, headers, "My Scheduled Room", open_at=int(__import__("time").time()) + 3600, close_at=0)
    r = client.get(f"{api_mod.API_PREFIX}/my/rooms", headers=headers)
    assert r.status_code == 200
    rooms = r.json()["rooms"]
    assert len(rooms) == 1
    assert rooms[0]["roomId"] == rid
    assert rooms[0]["scheduled"] == "scheduled"
    assert rooms[0]["openAt"] is not None
    assert rooms[0]["active"] is True


def test_my_rooms_does_not_show_other_walls(tmp_path):
    client = _client(tmp_path)
    headers, addr = _sign_in(client, "0x" + "bb" * 32)
    other, _ = _sign_in(client, "0x" + "cc" * 32)
    rid = _publish(client, other, "Not My Room")
    r = client.get(f"{api_mod.API_PREFIX}/my/rooms", headers=headers)
    assert r.status_code == 200
    assert all(x["roomId"] != rid for x in r.json()["rooms"])


def test_host_can_close_a_room(tmp_path):
    client = _client(tmp_path)
    headers, _ = _sign_in(client)
    rid = _publish(client, headers, "To Close")
    r = client.post(f"{api_mod.API_PREFIX}/rooms/{rid}/close", headers=headers)
    assert r.status_code == 200
    st, _ = client.get(f"{api_mod.API_PREFIX}/rooms/{rid}").json(), None
    # check status changed
    detail = client.get(f"{api_mod.API_PREFIX}/rooms/{rid}").json()
    # preview-published rooms walk through cancelled -> refundable -> closed
    assert detail["status"] in ("closed", "refundable", "cancelled")


def test_non_host_cannot_close(tmp_path):
    client = _client(tmp_path)
    headers, _ = _sign_in(client, "0x" + "11" * 32)
    rid = _publish(client, headers, "Not Mine")
    other, _ = _sign_in(client, "0x" + "22" * 32)
    r = client.post(f"{api_mod.API_PREFIX}/rooms/{rid}/close", headers=other)
    assert r.status_code == 403


def test_get_room_exposes_timing(tmp_path):
    client = _client(tmp_path)
    headers, _ = _sign_in(client)
    rid = _publish(client, headers, "With Timing", open_at=int(__import__("time").time()) + 3600, close_at=int(__import__("time").time()) + 7200)
    detail = client.get(f"{api_mod.API_PREFIX}/rooms/{rid}").json()
    assert detail.get("timing", {}).get("open_at", 0) > 0
    assert detail.get("timing", {}).get("close_at", 0) > 0


def test_scheduler_enforce_schedules_transitions(tmp_path):
    """The scheduler's schedule-enforcement loop: a room past its open_at should
    move out of draft. Uses the internal method directly."""
    from center.lifecycle import PREVIEW_PUBLISHED, REGISTRATION
    now = __import__("time").time()

    class FakeRT:
        config = type("C", (), {"timing": type("T", (), {"open_at": now - 10, "close_at": 0})()})()
        status = PREVIEW_PUBLISHED
        def _set_status(self, t):
            self.status = t
            self._set_status_calls = getattr(self, "_set_status_calls", 0) + 1

    sched = Scheduler.__new__(Scheduler)
    fake = FakeRT()
    fake._set_status_calls = 0
    sched.runtimes = {"r1": fake}
    sched._enforce_schedules(now)
    assert fake.status == REGISTRATION


def test_scheduler_closes_past_close_at(tmp_path):
    from center.lifecycle import CLOSED, READY
    now = __import__("time").time()

    closed_calls = []
    class FakeRT:
        config = type("C", (), {"timing": type("T", (), {"open_at": 0, "close_at": now - 10})()})()
        status = READY
        def _set_status(self, t):
            self.status = t
        def close(self, reason):
            closed_calls.append(reason)
            self.status = CLOSED

    sched = Scheduler.__new__(Scheduler)
    fake = FakeRT()
    sched.runtimes = {"r1": fake}
    sched._enforce_schedules(now)
    assert closed_calls == ["schedule elapsed"]
    assert fake.status == CLOSED


def test_scheduler_reaps_closed_runtimes():
    import center.lifecycle as lc

    class FakeRT:
        status = lc.CLOSED
        config = None

        def hub_clients(self):
            return 0

    sched = Scheduler.__new__(Scheduler)
    rt = FakeRT()
    sched.runtimes = {"dead": rt}
    t0 = 1000.0
    sched._reap_closed(t0)  # first sight: start the timer
    assert "dead" in sched.runtimes
    sched._reap_closed(t0 + 200)  # after 200s: reaped
    assert "dead" not in sched.runtimes
