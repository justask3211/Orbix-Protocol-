"""Admin game operations preserve admission, secrets, and settlement evidence."""
from types import SimpleNamespace
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from center.admin_games import AdminGameService, game_availability, mount_admin_games, room_archived
from center.community import CommunityError, CommunityService
from center.store import Store

ADMIN = "0x" + "ab" * 20
HOST = "0x" + "11" * 20
PLAYER = "0x" + "22" * 20
ROOM = "1234567890abcdef"


@pytest.fixture
def ops(tmp_path):
    store = Store(str(tmp_path / "admin.db"))
    store.create_room({"id": ROOM, "owner": HOST, "template_id": "number-hunt", "visibility": "private", "mode": "preview", "status": "registration", "config": {"name": "Secret lobby", "rewards": {"kind": "points"}}, "config_hash": "hash"})
    store.join(ROOM, PLAYER)
    store.set_profile(PLAYER, "Alice", "", 0, False)
    community = CommunityService(store, clock=lambda: 1000)
    service = AdminGameService(store, community, ADMIN, clock=lambda: 1000)
    runtime = SimpleNamespace(round_id="round-1", engine=SimpleNamespace(public_state=lambda: {"status": "running", "guessesRemaining": {PLAYER: 3}}))
    yield service, store, community, runtime
    store.close()


def assert_error(action, code):
    with pytest.raises(CommunityError) as caught:
        action()
    assert caught.value.code == code


def test_exact_admin_required_for_every_sensitive_read_or_mutation(ops):
    service, _, _, rt = ops
    for wallet in (None, HOST, PLAYER, "0x" + "ac" * 20):
        for action in (lambda: service.rooms(wallet), lambda: service.observe(wallet, ROOM, rt), lambda: service.archive(wallet, ROOM), lambda: service.hint(wallet, ROOM, "clue"), lambda: service.availability(wallet, "number-hunt", "offline")):
            assert_error(action, "NOT_ADMIN")


def test_hidden_observer_no_admission_or_seed_leak(ops):
    service, store, community, rt = ops
    before = store.participants(ROOM)
    before_revision = store.get_room(ROOM)["revision"]
    community.update_settings(ROOM, HOST, {"hidePlayers": True, "hideGuesses": True})
    observed = service.observe(ADMIN, ROOM, rt)
    assert observed["observer"] == "hidden" and observed["readOnly"] is True
    assert observed["roster"]["players"][0]["name"] == "Alice"
    assert observed["roster"]["players"][0]["wallet"] == PLAYER
    assert "seed" not in observed and "snapshot" not in observed
    assert store.participants(ROOM) == before
    assert store.get_room(ROOM)["revision"] == before_revision
    assert observed["community"]["players"][0]["name"] == "Alice"


def test_availability_persists_and_is_audited(ops):
    service, store, _, _ = ops
    assert game_availability(store, "token-catch")["status"] == "live"
    service.availability(ADMIN, "token-catch", "maintenance", "Quick tune-up")
    assert game_availability(store, "token-catch")["message"] == "Quick tune-up"
    service.availability(ADMIN, "token-catch", "offline")
    assert_error(lambda: service.availability(ADMIN, "made-up-game", "live"), "INVALID_AVAILABILITY")
    assert_error(lambda: service.availability(ADMIN, "token-catch", "bogus"), "INVALID_AVAILABILITY")
    assert store.verify_audit_chain()["ok"]


def test_admin_hints_and_settings_do_not_impersonate_creator(ops):
    service, store, community, _ = ops
    service.settings(ADMIN, ROOM, {"muteChat": True})
    assert community.public_settings(ROOM)["muteChat"]
    assert_error(lambda: service.settings(ADMIN, ROOM, {"muteChat": 1}), "INVALID_SETTINGS")
    message = service.hint(ADMIN, ROOM, "Count the islands.")
    with store.tx() as cx:
        row = cx.execute("SELECT who FROM room_community_messages WHERE id=?", (message["messageId"],)).fetchone()
    assert row[0] == ADMIN
    service.delete_message(ADMIN, ROOM, message["messageId"])
    assert community.snapshot(ROOM, HOST)["messages"][0]["deleted"]


def test_lobby_ban_removes_admission_and_unban_restores_permission(ops):
    service, store, community, _ = ops
    service.moderate(ADMIN, ROOM, PLAYER, "ban")
    assert not store.participants(ROOM)
    assert_error(lambda: community.assert_can_join(ROOM, PLAYER), "ROOM_BANNED")
    service.moderate(ADMIN, ROOM, PLAYER, "unban")
    community.assert_can_join(ROOM, PLAYER)
    assert_error(lambda: service.moderate(ADMIN, ROOM, HOST, "ban"), "INVALID_TARGET")


def test_live_kick_preserves_frozen_roster_and_existing_actions(ops):
    service, store, _, _ = ops
    store.update_room(ROOM, expected_revision=1, status="running", round_id="round-1")
    store.append_action(ROOM, 1, PLAYER, {"guess": 1234}, True)
    before = store.participants(ROOM)
    result = service.moderate(ADMIN, ROOM, PLAYER, "kick")
    assert result["suspended"]
    assert store.participants(ROOM) == before
    assert len(store.actions_since(ROOM, 0)) == 1
    assert_error(lambda: service.assert_can_act(ROOM, PLAYER, "round-1"), "PLAYER_SUSPENDED")
    service.assert_can_act(ROOM, PLAYER, "round-2")
    recreated = AdminGameService(store, service.community, ADMIN)
    assert_error(lambda: recreated.assert_can_act(ROOM, PLAYER, "round-1"), "PLAYER_SUSPENDED")


def test_archive_preserves_financial_records_and_finished_round(ops):
    service, store, _, _ = ops
    with store.tx() as cx:
        cx.execute("INSERT INTO ledger(creator,kind,amount,unit,room_id,created_at) VALUES (?,'deposit','99','token',?,?)", (HOST, ROOM, 1))
    result = service.archive(ADMIN, ROOM)
    assert result["recordsPreserved"] and room_archived(store, ROOM)
    assert store.get_room(ROOM) and len(store.participants(ROOM)) == 1
    with store.tx() as cx:
        assert cx.execute("SELECT amount FROM ledger WHERE room_id=?", (ROOM,)).fetchone()[0] == "99"
    assert_error(lambda: service.assert_can_act(ROOM, PLAYER, "round-1"), "ROOM_ARCHIVED")
    service.archive(ADMIN, ROOM, False)
    assert not room_archived(store, ROOM)
    store.update_room(ROOM, expected_revision=1, status="running")
    assert_error(lambda: service.archive(ADMIN, ROOM), "MATCH_RUNNING")


def test_archive_audit_failure_rolls_back_metadata_and_memory(ops):
    import sqlite3
    service, store, _, _ = ops
    with store.tx() as cx:
        cx.execute("CREATE TRIGGER reject_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError, match="audit unavailable"):
        service.archive(ADMIN, ROOM)
    assert not room_archived(store, ROOM)
    service.assert_can_act(ROOM, PLAYER, "round-1")
    assert store.get_room(ROOM) and len(store.participants(ROOM)) == 1


def test_signed_archive_migrates_legacy_audit_without_losing_history(tmp_path):
    import sqlite3
    from eth_account import Account
    from center.api import API_PREFIX
    from center.tests.test_admin_pricing import make_app, sign_in, admin_proof
    from center.tests.test_flow import fund_and_publish

    # This is the persistent production shape from before audit hashes were
    # introduced. A fresh database cannot reproduce its missing-column failure.
    path = tmp_path / "center.db"
    with sqlite3.connect(path) as cx:
        cx.execute("CREATE TABLE admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,old_json TEXT NOT NULL,new_json TEXT NOT NULL,chain_id INTEGER NOT NULL,created_at REAL NOT NULL)")
        cx.execute("INSERT INTO admin_audit(actor,action,old_json,new_json,chain_id,created_at) VALUES (?,'pricing.update','{}','{\"creatorFee\":3}',46630,123.0)", (ADMIN,))
        with pytest.raises(sqlite3.OperationalError, match="no such column: entry_hash"):
            cx.execute("SELECT entry_hash FROM admin_audit")
    admin, host = Account.create(), Account.create()
    app = make_app(tmp_path, admin_address=admin.address)
    with TestClient(app) as client:
        _, published = fund_and_publish(client, host)
        room_id = published["roomId"]
        headers = sign_in(client, admin)
        before_ledger = app.state.store.ledger(host.address.lower())
        signed = {**headers, "X-Admin-Proof": admin_proof(client, admin)}
        response = client.post(f"{API_PREFIX}/admin/rooms/{room_id}/actions", headers=signed, json={"operation": "archive", "archived": True})
        assert response.status_code == 200, response.text
        assert response.json()["recordsPreserved"] and room_archived(app.state.store, room_id)
        assert app.state.store.ledger(host.address.lower()) == before_ledger
        assert app.state.store.verify_audit_chain()["ok"]
        historical = next(row for row in app.state.store.list_audit() if row["action"] == "pricing.update")
        assert historical["actor"] == ADMIN and historical["createdAt"] == 123.0
        assert historical["newValue"] == {"creatorFee": 3}
        assert client.post(f"{API_PREFIX}/admin/rooms/{room_id}/actions", headers=signed, json={"operation": "archive", "archived": False}).status_code == 403
        signed["X-Admin-Proof"] = admin_proof(client, admin)
        assert client.post(f"{API_PREFIX}/admin/rooms/{room_id}/actions", headers=signed, json={"operation": "archive", "archived": False}).status_code == 200
        assert not room_archived(app.state.store, room_id)
        entries = app.state.store.list_audit()
    app.state.store.close()
    reopened = Store(str(path))
    assert reopened.list_audit() == entries
    assert reopened.verify_audit_chain()["ok"]
    reopened.close()


def test_unused_cleanup_only_old_empty_nonrunning_rooms(ops):
    service, store, _, _ = ops
    service.clock = lambda: 200000
    with store.tx() as cx:
        cx.execute("UPDATE rooms SET updated_at=0 WHERE id=?", (ROOM,))
    assert service.archive_unused(ADMIN)["count"] == 0
    with store.tx() as cx:
        cx.execute("DELETE FROM participants WHERE room_id=?", (ROOM,))
    assert service.archive_unused(ADMIN)["count"] == 1
    assert service.archive_unused(ADMIN)["count"] == 0


def test_router_every_read_requires_admin_and_mutation_requires_proof(ops):
    _, store, community, runtime = ops
    app = FastAPI()
    calls = []
    def require_admin(authorization, x_admin_proof=None, *, need_proof):
        if authorization != "Bearer admin":
            raise HTTPException(403)
        if need_proof and x_admin_proof != "fresh-proof":
            raise HTTPException(403)
        calls.append(need_proof)
        return ADMIN
    mount_admin_games(app, "/api", store, community, require_admin, lambda _: runtime, SimpleNamespace(_conns={}), ADMIN)
    client = TestClient(app)
    assert client.get("/api/admin/rooms").status_code == 403
    assert client.get(f"/api/admin/rooms/{ROOM}/observe").status_code == 403
    headers = {"Authorization": "Bearer admin"}
    assert client.get(f"/api/admin/rooms/{ROOM}/observe", headers=headers).json()["observer"] == "hidden"
    assert client.patch("/api/admin/games/number-hunt", headers=headers, json={"status": "maintenance"}).status_code == 403
    headers["X-Admin-Proof"] = "fresh-proof"
    assert client.patch("/api/admin/games/number-hunt", headers=headers, json={"status": "maintenance"}).status_code == 200
    assert client.post(f"/api/admin/rooms/{ROOM}/actions", headers=headers, json={"operation": "settings", "settings": {"muteChat": True}}).status_code == 200
    assert calls == [False, True, True]


def test_integrated_admin_game_proof_is_single_use_and_exact_wallet(tmp_path):
    from eth_account import Account
    from center.api import API_PREFIX
    from center.tests.test_admin_pricing import make_app, sign_in, admin_proof
    admin, outsider = Account.create(), Account.create()
    app = make_app(tmp_path, admin_address=admin.address)
    with TestClient(app) as client:
        assert client.get(f"{API_PREFIX}/admin/games").status_code == 401
        outsider_headers = sign_in(client, outsider)
        assert client.get(f"{API_PREFIX}/admin/rooms", headers=outsider_headers).status_code == 403
        assert client.patch(f"{API_PREFIX}/admin/games/token-catch", headers=outsider_headers, json={"status": "offline"}).status_code == 403
        headers = sign_in(client, admin)
        assert client.get(f"{API_PREFIX}/admin/games", headers=headers).status_code == 200
        assert client.patch(f"{API_PREFIX}/admin/games/token-catch", headers=headers, json={"status": "maintenance"}).status_code == 403
        proof = admin_proof(client, admin)
        signed = {**headers, "X-Admin-Proof": proof}
        assert client.patch(f"{API_PREFIX}/admin/games/token-catch", headers=signed, json={"status": "maintenance"}).status_code == 200
        replay = client.patch(f"{API_PREFIX}/admin/games/token-catch", headers=signed, json={"status": "live"})
        assert replay.status_code == 403 and replay.json()["detail"]["code"] == "PROOF_REPLAYED"
        public = client.get(f"{API_PREFIX}/templates").json()
        token_catch = next(t for t in public["templates"] if t["templateId"] == "token-catch")
        assert token_catch["playStatus"] == "maintenance"
        assert app.state.store.verify_audit_chain()["ok"]


def test_integrated_hidden_observer_and_live_ban_guard_frozen_roster(tmp_path):
    import asyncio
    from copy import deepcopy
    from eth_account import Account
    from center.api import API_PREFIX
    from center.tests.test_admin_pricing import make_app, sign_in, admin_proof
    from center.tests.test_flow import HUNT, fund_and_publish
    admin, host, guest = Account.create(), Account.create(), Account.create()
    app = make_app(tmp_path, admin_address=admin.address)
    with TestClient(app) as client:
        cfg = deepcopy(HUNT)
        cfg["visibility"] = "private"
        host_headers, published = fund_and_publish(client, host, cfg=cfg)
        room_id = published["roomId"]
        invite = client.post(f"{API_PREFIX}/rooms/{room_id}/invites", headers=host_headers).json()["invite"]
        guest_headers = sign_in(client, guest)
        for headers in [host_headers, guest_headers]:
            assert client.post(f"{API_PREFIX}/rooms/{room_id}/join", headers=headers, json={"invite": invite}).status_code == 200
            assert client.post(f"{API_PREFIX}/rooms/{room_id}/ready", headers=headers, json={"ready": True}).status_code == 200
        assert client.post(f"{API_PREFIX}/rooms/{room_id}/start", headers=host_headers).status_code == 200
        before = app.state.store.participants(room_id)
        admin_headers = sign_in(client, admin)
        observed = client.get(f"{API_PREFIX}/admin/rooms/{room_id}/observe", headers=admin_headers)
        assert observed.status_code == 200
        assert observed.json()["observer"] == "hidden"
        assert app.state.store.participants(room_id) == before
        assert admin.address.lower() not in [p["who"] for p in before]
        signed = {**admin_headers, "X-Admin-Proof": admin_proof(client, admin)}
        banned = client.post(f"{API_PREFIX}/admin/rooms/{room_id}/actions", headers=signed, json={"operation": "ban", "wallet": guest.address})
        assert banned.status_code == 200 and banned.json()["suspended"]
        assert app.state.store.participants(room_id) == before
        assert client.post(f"{API_PREFIX}/rooms/{room_id}/join", headers=guest_headers, json={"invite": invite}).status_code == 403
        async def attempt():
            await app.state.runtimes[room_id].act(guest.address, {"kind": "guess", "number": 5555})
        assert_error(lambda: asyncio.run(attempt()), "ROOM_BANNED")
