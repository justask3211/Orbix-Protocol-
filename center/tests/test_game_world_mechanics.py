"""Reward-bearing featured-game authority and private realtime regressions."""

from __future__ import annotations

import asyncio
import json

import pytest
from eth_account import Account
from fastapi.testclient import TestClient

from center.api import API_PREFIX
from center.games.boss import BossEngine
from center.games.catch import CatchEngine
from center.games.duel import DuelEngine
from center.room import Hub, RoomRuntime
from center.schema import RoomConfig
from center.store import Store
from center.tests.test_flow import WsReader, fund_and_publish, make_app, sign_in
from center.vault import VaultService


PLAYERS = ["0x" + f"{i + 1:02x}" * 20 for i in range(6)]
ALICE, BOB = PLAYERS[:2]
SEED, ROUND = "ab" * 32, "cd" * 32


def configuration(template: str, rules: dict, *, cap: int) -> RoomConfig:
    teams = template == "boss-raid" and rules.get("team_mode") == "teams"
    return RoomConfig(**{
        "name": "World Mechanics Test", "template_id": template,
        "rules": {"templateId": template, **({"min_players": 6} if teams else {}), **rules},
        "admission": {"player_cap": cap, "min_ready_to_start": 6 if teams else 2},
        "access": {"vault_mode": "simulated", "required_amount": 100, "joiner_fee": 0},
        "rewards": {"kind": "preview-points", "slots": [{"rank": i + 1, "points": 100} for i in range(3)]},
    })


def boss(**rules) -> BossEngine:
    config = configuration("boss-raid", {
        "max_players": 6, "duration_seconds": 60, "boss_health": 100,
        "team_mode": "teams", **rules,
    }, cap=6)
    engine = BossEngine(config, ROUND, SEED, PLAYERS)
    engine.teams = {player: "a" if i < 3 else "b" for i, player in enumerate(PLAYERS)}
    engine.start(100)
    return engine


def duel(**rules) -> DuelEngine:
    config = configuration("reaction-duel", {"rounds": 3, **rules}, cap=2)
    engine = DuelEngine(config, ROUND, SEED, [ALICE, BOB])
    engine.start(100)
    return engine


def resolve_duel(engine: DuelEngine, a: str, b: str, now: float) -> None:
    for player, choice in ((ALICE, a), (BOB, b)):
        assert engine.act(player, {"kind": "commit", "choice": choice, "salt": player}, now).ok
    for player, choice in ((ALICE, a), (BOB, b)):
        assert engine.act(player, {"kind": "reveal", "choice": choice, "salt": player}, now + .1).ok


@pytest.mark.parametrize("power", [1, 25, 100])
def test_team_strike_power_is_server_issued(power):
    engine = boss(boss_health=1000)
    result = engine.act(ALICE, {"kind": "hit", "power": power, "score": 10**20}, 101)
    assert result.ok
    assert result.patch["damage"] == 25
    assert engine.health == 975 and engine.contribution[ALICE] == 25
    assert engine.act(ALICE, {"kind": "hit", "power": 100}, 101.1).error == "SLOW_DOWN"


def test_team_strike_respects_contribution_cap_and_current_health():
    engine = boss(contribution_cap=40)
    assert engine.act(ALICE, {"kind": "hit", "power": 100}, 101).private["damage"] == 25
    assert engine.act(ALICE, {"kind": "hit", "power": 100}, 102).private["damage"] == 15
    assert engine.act(ALICE, {"kind": "hit"}, 103).error == "BUDGET_EXHAUSTED"
    engine.act(PLAYERS[1], {"kind": "hit"}, 104)
    engine.act(PLAYERS[3], {"kind": "hit"}, 105)
    final = engine.act(PLAYERS[4], {"kind": "hit"}, 106)
    assert final.private["damage"] == 10
    assert engine.health == 0 and engine.slain and engine.finished


def test_team_winners_require_final_team_win_and_individual_contribution():
    engine = boss()
    for offset, player in enumerate([PLAYERS[0], PLAYERS[1], PLAYERS[3], PLAYERS[2]]):
        assert engine.act(player, {"kind": "hit"}, 101 + offset).ok
    assert engine.public_state()["teamDamage"] == {"a": 75, "b": 25}
    assert engine.winning_team() == "a"
    assert set(engine.eligible()) == set(PLAYERS[:3])
    assert {entry.winner for entry in engine.entitlements()} == set(PLAYERS[:3])
    assert engine.act(PLAYERS[4], {"kind": "hit"}, 110).error == "ROUND_FINISHED"


def test_tied_team_damage_produces_no_winners_or_entitlements():
    engine = boss()
    for offset, player in enumerate([PLAYERS[0], PLAYERS[3], PLAYERS[1], PLAYERS[4]]):
        engine.act(player, {"kind": "hit"}, 101 + offset)
    assert engine.finished and engine.slain
    assert engine.winning_team() is None
    assert engine.eligible() == [] and engine.entitlements() == []


def test_team_duration_and_minimum_contribution_gate_rewards():
    engine = boss(boss_health=1000, min_contribution=26)
    engine.act(ALICE, {"kind": "hit"}, 101)
    engine.act(ALICE, {"kind": "hit"}, 102)
    engine.act(PLAYERS[1], {"kind": "hit"}, 103)
    assert engine.winning_team() is None and engine.eligible() == []
    assert engine.tick(159.9) is None
    assert engine.tick(160).finished
    assert not engine.slain and engine.winning_team() == "a"
    assert engine.eligible() == [ALICE]


@pytest.mark.parametrize("teams", [{}, {player: "a" for player in PLAYERS}, {player: "a" if i < 2 else "b" for i, player in enumerate(PLAYERS)}])
def test_team_round_cannot_start_without_two_groups_of_three(teams):
    engine = boss()
    engine.teams = teams
    with pytest.raises(ValueError, match="TEAMS_REQUIRE_THREE_EACH"):
        engine.start(101)


def test_team_snapshot_restores_cooldowns_scores_and_team_membership():
    engine = boss(boss_health=1000)
    engine.act(ALICE, {"kind": "hit"}, 101)
    restored = BossEngine.restore(engine.config, ROUND, SEED, json.loads(json.dumps(engine.snapshot())))
    assert restored.public_state() == engine.public_state()
    assert restored.act(ALICE, {"kind": "hit"}, 101.1).error == "SLOW_DOWN"
    assert restored.act(PLAYERS[3], {"kind": "hit"}, 102).ok
    assert restored.public_state()["teamDamage"] == {"a": 25, "b": 25}


def test_duel_public_phase_deadlines_reset_at_actual_phase_transition():
    engine = duel(choice_window_seconds=10, reveal_window_seconds=5)
    assert engine.public_state()["phaseDeadline"] == 110
    engine.act(ALICE, {"kind": "commit", "choice": "rock", "salt": "a-secret"}, 101)
    assert engine.public_state()["phaseDeadline"] == 110
    engine.act(BOB, {"kind": "commit", "choice": "scissors", "salt": "b-secret"}, 104)
    assert engine.phase == "reveal" and engine.public_state()["phaseDeadline"] == 109
    assert engine.act(ALICE, {"kind": "reveal", "choice": "rock", "salt": "a-secret"}, 109).error == "ROUND_NOT_OPEN"


def test_duel_partial_reveal_and_commit_preimages_stay_private():
    engine = duel()
    engine.act(ALICE, {"kind": "commit", "choice": "rock", "salt": "a-secret-preimage"}, 101)
    public = engine.public_state()
    assert public["committed"] == {ALICE: True, BOB: False}
    engine.act(BOB, {"kind": "commit", "choice": "scissors", "salt": "b-secret-preimage"}, 102)
    engine.act(ALICE, {"kind": "reveal", "choice": "rock", "salt": "a-secret-preimage"}, 103)
    public = engine.public_state()
    assert public["revealed"] == {ALICE: True, BOB: False} and public["history"] == []
    assert not any(secret in json.dumps(public) for secret in ["rock", "scissors", "a-secret-preimage", "b-secret-preimage"])
    assert engine.act(BOB, {"kind": "reveal", "choice": "scissors", "salt": "b-secret-preimage"}, 104).ok
    assert engine.public_state()["history"][0]["a"] == "rock"


@pytest.mark.parametrize("phase", ["commit", "reveal"])
def test_duel_timeout_awards_only_single_player_who_submitted(phase):
    engine = duel()
    engine.act(ALICE, {"kind": "commit", "choice": "rock", "salt": "a"}, 101)
    if phase == "reveal":
        engine.act(BOB, {"kind": "commit", "choice": "scissors", "salt": "b"}, 102)
        engine.act(ALICE, {"kind": "reveal", "choice": "rock", "salt": "a"}, 103)
    deadline = engine.phase_deadline()
    assert engine.tick(deadline - .001) is None
    result = engine.tick(deadline)
    assert result.ok and engine.wins == {ALICE: 1, BOB: 0}
    assert engine.public_state()["history"][-1]["winner"] == ALICE
    assert engine.public_state()["history"][-1]["a"] == ""
    assert engine.public_state()["phase"] == "commit"
    assert engine.public_state()["phaseDeadline"] == deadline + 10


def test_no_duel_input_finishes_on_deadlines_without_rewarding_inactivity():
    engine = duel()
    for _ in range(3):
        assert engine.tick(engine.phase_deadline()).ok
    assert engine.finished and engine.phase == "done"
    assert engine.wins == {ALICE: 0, BOB: 0}
    assert engine.eligible() == set() and engine.entitlements() == []


def test_drawn_final_duel_does_not_reward_arbitrary_address_order():
    engine = duel()
    resolve_duel(engine, "rock", "scissors", 101)
    resolve_duel(engine, "rock", "paper", 103)
    resolve_duel(engine, "paper", "paper", 105)
    assert engine.finished and engine.wins == {ALICE: 1, BOB: 1}
    assert engine.eligible() == set() and engine.entitlements() == []


def test_duel_snapshot_restores_pending_reveal_and_phase_deadline():
    engine = duel()
    engine.act(ALICE, {"kind": "commit", "choice": "rock", "salt": "a"}, 101)
    engine.act(BOB, {"kind": "commit", "choice": "scissors", "salt": "b"}, 102)
    engine.act(ALICE, {"kind": "reveal", "choice": "rock", "salt": "a"}, 103)
    restored = DuelEngine.restore(engine.config, ROUND, SEED, json.loads(json.dumps(engine.snapshot())))
    assert restored.public_state() == engine.public_state()
    assert restored.act(BOB, {"kind": "reveal", "choice": "scissors", "salt": "wrong"}, 104).error == "BAD_PROOF"
    assert restored.act(BOB, {"kind": "reveal", "choice": "scissors", "salt": "b"}, 104).ok
    assert restored.wins[ALICE] == 1


def test_long_duel_runtime_does_not_settle_before_all_phase_deadlines(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / "long-duel.db"))
        config = configuration("reaction-duel", {
            "rounds": 7, "choice_window_seconds": 20, "reveal_window_seconds": 10,
        }, cap=2)
        runtime = RoomRuntime.create(store, VaultService(store), Hub(), owner=ALICE, config=config)
        for player in [ALICE, BOB]:
            runtime.join(player)
            runtime.set_ready(player)
        await runtime.start(100)
        # The outer room deadline must allow every configured commit and reveal window.
        assert runtime.deadline() >= 100 + 7 * (20 + 10)
        for number in range(1, 7):
            assert not await runtime.tick(100 + number * 20)
        assert not runtime.engine.finished and runtime.engine.round_index == 6
        assert await runtime.tick(240)
        assert runtime.engine.finished and runtime.engine.entitlements() == []
    asyncio.run(scenario())


def test_private_hub_frames_are_scoped_to_recipient_and_room():
    async def scenario():
        hub = Hub()
        for connection, room, player in [("a", "room-a", ALICE), ("b", "room-b", ALICE), ("c", "room-a", BOB)]:
            await hub.register(connection, room, player, None)
        frame = {"type": "action.ack", "payload": {"hint": "higher"}}
        await hub.send(ALICE, frame, "room-a")
        assert hub._conns["a"]["queue"].get_nowait() == frame
        assert hub._conns["b"]["queue"].empty()
        assert hub._conns["c"]["queue"].empty()
    asyncio.run(scenario())


def test_catch_scene_window_matches_authority_and_never_exposes_future_spawns():
    config = configuration("token-catch", {
        "duration_seconds": 30, "spawn_per_second": 2, "lanes": 3,
        "catch_window_ms": 1000, "hazard_chance_pct": 0,
    }, cap=2)
    engine = CatchEngine(config, ROUND, SEED, [ALICE, BOB])
    engine.start(100)
    future = engine.spawns[1]
    assert future.at_ms == 500
    engine.act(ALICE, {"kind": "lane", "lane": future.lane}, 100.1)
    assert engine.act(ALICE, {"kind": "catch", "spawn": future.index}, 100.1).error == "ROUND_NOT_OPEN"
    first = engine.spawns[0]
    engine.act(ALICE, {"kind": "lane", "lane": first.lane}, 100.2)
    assert engine.act(ALICE, {"kind": "catch", "spawn": first.index}, 100.999).ok
    engine.act(BOB, {"kind": "lane", "lane": first.lane}, 101.001)
    assert engine.act(BOB, {"kind": "catch", "spawn": first.index}, 101.001).error == "STALE_REVISION"
    public = engine.public_state()
    assert public["catchWindowMs"] == 1000
    assert all(0 <= public["nowMs"] - spawn["atMs"] <= public["catchWindowMs"] for spawn in public["recent"])
    assert "spawns" not in public and "seed" not in public


def test_live_fairness_and_websocket_resync_do_not_expose_secret_actions(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        host, guest = Account.create(), Account.create()
        config = configuration("reaction-duel", {"rounds": 3}, cap=2).public_dict()
        headers, room = fund_and_publish(client, host, cfg=config)
        room_id = room["roomId"]
        guest_headers = sign_in(client, guest)
        assert client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=guest_headers).status_code == 200
        ticket = client.post(f"{API_PREFIX}/rooms/{room_id}/join", json={}, headers=headers).json()["ticket"]
        for wallet_headers in [headers, guest_headers]:
            assert client.post(f"{API_PREFIX}/rooms/{room_id}/ready", json={"ready": True}, headers=wallet_headers).status_code == 200
        start = client.post(f"{API_PREFIX}/rooms/{room_id}/start", headers=headers).json()
        round_id = start["roundId"]
        runtime = app.state.runtimes[room_id]
        assert runtime.seed
        assert client.get(f"{API_PREFIX}/rounds/{round_id}/fairness").json()["seed"] is None
        # Exercise the stored-round fallback path as well as the in-memory runtime.
        app.state.runtimes.pop(room_id)
        assert client.get(f"{API_PREFIX}/rounds/{round_id}/fairness").json()["seed"] is None
        app.state.runtimes[room_id] = runtime
        with client.websocket_connect(f"{API_PREFIX}/ws/rooms/{room_id}") as ws:
            reader = WsReader(ws)
            ws.send_text(json.dumps({"type": "session.hello", "ticket": ticket}))
            reader.want("session.ready")
            ws.send_text(json.dumps({"type": "action", "payload": {"kind": "commit", "choice": "rock", "salt": "private-sync-salt"}}))
            assert reader.want("action.ack")["payload"]["accepted"]
            ws.send_text(json.dumps({"type": "room.sync", "seq": 0}))
            snapshot = reader.want("room.snapshot")
            encoded = json.dumps(snapshot)
            assert "private-sync-salt" not in encoded and '"rock"' not in encoded
            assert "actions" not in snapshot["payload"]
            assert snapshot["payload"]["state"]["committed"][host.address.lower()] is True
            fairness = client.get(f"{API_PREFIX}/rounds/{round_id}/fairness").json()
            assert fairness["seed"] is None
            assert all(set(action) == {"who", "at", "kind"} for action in fairness["actions"])
            assert "private-sync-salt" not in json.dumps(fairness)
        client.portal.call(runtime.finish)
        finished = client.get(f"{API_PREFIX}/rounds/{round_id}/fairness").json()
        assert finished["seed"] == runtime.seed
