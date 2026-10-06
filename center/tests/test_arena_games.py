"""Movement arena authority, collision economy, and durable simulation regressions."""
import asyncio
import math
import pytest
from pydantic import ValidationError
from center.games.arena import CatchArenaEngine, BossArenaEngine, CombatDuelEngine, STEP
from center.games import engine_for
from center.room import RoomRuntime, Hub, Scheduler
from center.schema import RoomConfig
from center.store import Store
from center.vault import VaultService

ALICE, BOB = "0x" + "11" * 20, "0x" + "22" * 20
SEED, ROUND = "ab" * 32, "cd" * 32


def config(template="token-catch", cap=2, **rules):
    defaults = {
        "token-catch": {"arena_mode": True, "duration_seconds": 60, "spawn_per_second": 2, "lanes": 3, "win_threshold": 1},
        "boss-raid": {"arena_mode": True, "team_mode": "teams", "team_size": 3, "max_players": cap, "min_players": 2, "duration_seconds": 60, "boss_health": 1000, "contribution_cap": 1000, "min_contribution": 10},
        "combat-duel": {"duration_seconds": 60},
    }[template]
    return RoomConfig(**{
        "name": "Arena regression", "template_id": template,
        "rules": {"templateId": template, **defaults, **rules},
        "admission": {"player_cap": cap, "min_ready_to_start": 2},
        "access": {"vault_mode": "simulated", "required_amount": 100, "joiner_fee": 0},
        "rewards": {"kind": "preview-points", "slots": [{"rank": 1, "points": 100}, {"rank": 2, "points": 50}]},
    })


def arena(template="token-catch", players=None, **rules):
    players = players or [ALICE, BOB]
    cfg = config(template, cap=len(players), **rules)
    engine = engine_for(cfg)(cfg, ROUND, SEED, players)
    if template == "boss-raid":
        engine.teams = {player: f"team-{index // cfg.rules.team_size + 1}" for index, player in enumerate(players)}
    engine.start(100)
    return engine


def clear_world(engine):
    engine.crates, engine.drops = [], []
    engine.next_drop = 10**9
    for index, body in enumerate(engine.bodies.values()):
        body.update(x=index * 3.0, z=0.0)


def test_arena_routing_preserves_old_lanes_and_raid_engine():
    cfg = config()
    assert engine_for(cfg) is CatchArenaEngine
    cfg.rules.arena_mode = False
    assert engine_for(cfg) is not CatchArenaEngine
    raid = config("boss-raid", cap=6)
    assert engine_for(raid) is BossArenaEngine
    raid.rules.arena_mode = False
    assert engine_for(raid) is not BossArenaEngine
    assert engine_for(config("combat-duel")) is CombatDuelEngine


@pytest.mark.parametrize("field,value,error", [
    ("dx", float("nan"), "INVALID_DIRECTION"), ("dz", float("inf"), "INVALID_DIRECTION"),
    ("dx", 10000, "INVALID_DIRECTION"), ("dx", True, "INVALID_DIRECTION"),
    ("yaw", float("nan"), "INVALID_FACING"), ("yaw", 9999, "INVALID_FACING"),
    ("seq", 1.2, "INVALID_INPUT_SEQUENCE"), ("seq", True, "INVALID_INPUT_SEQUENCE"),
    ("seq", 2**53, "INVALID_INPUT_SEQUENCE"), ("seq", 0, "INVALID_INPUT_SEQUENCE"),
])
def test_malformed_movement_cannot_teleport_or_corrupt_simulation(field, value, error):
    engine = arena()
    clear_world(engine)
    action = {"kind": "move", "dx": 0, "dz": 0, "seq": 1, "yaw": 0, field: value}
    before = engine.bodies[ALICE].copy()
    result = engine.act(ALICE, action, 100)
    assert not result.ok and result.error == error
    assert engine.bodies[ALICE] == before
    assert not engine.inputs


def test_position_score_damage_and_weapon_fields_are_never_trusted():
    engine = arena("combat-duel")
    clear_world(engine)
    result = engine.act(ALICE, {"kind": "move", "dx": 0, "dz": 0, "seq": 1, "x": 9999, "score": 99999, "damage": 5000, "weapon": "gun"}, 100)
    assert result.ok
    assert engine.bodies[ALICE]["x"] == 0 and engine.bodies[ALICE]["score"] == 0
    assert engine.bodies[ALICE]["weapon"] == "hands" and engine.damage[ALICE] == 0
    assert not engine.act("outsider", {"kind": "attack"}, 100).ok


def test_movement_rate_sequence_diagonal_speed_and_input_lease():
    engine = arena()
    clear_world(engine)
    assert engine.act(ALICE, {"kind": "move", "dx": 1, "dz": 1, "seq": 1}, 100).ok
    assert engine.act(ALICE, {"kind": "move", "dx": 1, "dz": 0, "seq": 1}, 100.01).error == "STALE_INPUT"
    assert engine.act(ALICE, {"kind": "move", "dx": 1, "dz": 0, "seq": 2}, 100.01).error == "INPUT_RATE_LIMIT"
    engine.tick(100.2)
    body = engine.bodies[ALICE]
    assert math.hypot(body["x"], body["z"]) <= engine.speed * .2 + 1e-6
    assert abs(body["x"] - body["z"]) < 1e-8
    engine.tick(100.5)
    stopped = (body["x"], body["z"])
    engine.tick(101)
    assert (body["x"], body["z"]) == stopped
    assert math.hypot(*stopped) <= engine.speed * .25 + 1e-6


def test_movement_clamped_and_recovery_cannot_fast_forward_teleport():
    engine = arena()
    clear_world(engine)
    engine.bodies[ALICE].update(x=9.4, z=7.4)
    assert engine.act(ALICE, {"kind": "move", "dx": 1, "dz": 1, "seq": 1}, 100).ok
    engine.tick(100.2)
    body = engine.bodies[ALICE]
    assert body["x"] <= 9.45 and body["z"] <= 7.45
    before = (body["x"], body["z"])
    engine.tick(130)
    assert not engine.inputs and (body["x"], body["z"]) == before
    engine.tick(200)
    assert engine.finished


def test_coins_cannot_be_picked_before_landing_or_twice():
    engine = arena()
    clear_world(engine)
    engine._drop("coin", 0, 0, 0, fall=1000, value=7)
    engine.tick(100.5)
    assert engine.bodies[ALICE]["score"] == 0 and len(engine.drops) == 1
    engine.tick(101.1)
    assert engine.bodies[ALICE]["score"] == 7 and not engine.drops
    engine.tick(101.3)
    assert engine.bodies[ALICE]["score"] == 7


@pytest.mark.parametrize("score", [1, 2, 3, 33, 100, 1001])
def test_bomb_scatters_exact_integer_half_and_conserves_points(score):
    engine = arena()
    clear_world(engine)
    engine.bodies[ALICE]["score"] = score
    engine._drop("bomb", 0, 0, 0, fall=0)
    engine.tick(100 + STEP)
    scattered = sum(drop["value"] for drop in engine.drops if drop["kind"] == "coin")
    assert scattered == score // 2
    assert engine.bodies[ALICE]["score"] + scattered == score
    assert len(engine.drops) <= 16


def test_bomb_that_knocks_out_still_only_scatters_half_once():
    engine = arena()
    clear_world(engine)
    engine.bodies[ALICE].update(score=100, hp=5)
    engine._drop("bomb", 0, 0, 0, fall=0)
    engine.tick(100 + STEP)
    assert engine.bodies[ALICE]["hp"] == 0
    assert engine.bodies[ALICE]["score"] == 50
    assert sum(drop["value"] for drop in engine.drops) == 50


def test_scattered_coins_land_and_can_be_recollected_by_other_player():
    engine = arena()
    clear_world(engine)
    engine.bodies[ALICE]["score"] = 8
    engine._scatter(ALICE)
    target = engine.drops[0]
    engine.bodies[BOB].update(x=target["x"], z=target["z"])
    engine.tick(100.3)
    assert engine.bodies[BOB]["score"] == 0
    engine.tick(100.6)
    assert engine.bodies[BOB]["score"] >= target["value"]


def test_push_requires_power_has_cooldown_and_stuns_nearby_target():
    engine = arena()
    clear_world(engine)
    engine.bodies[BOB].update(x=1, z=0)
    assert engine.act(ALICE, {"kind": "push"}, 100).error == "NO_PUSH_POWER"
    engine.bodies[ALICE]["pushCharges"] = 2
    assert engine.act(ALICE, {"kind": "push"}, 100).ok
    assert engine.bodies[BOB]["x"] == 4
    assert engine.bodies[BOB]["stunnedUntil"] == 100900
    assert engine.act(ALICE, {"kind": "push"}, 100.1).error == "COOLDOWN"
    assert engine.bodies[ALICE]["pushCharges"] == 1


def test_push_off_boundary_scatter_then_respawn():
    engine = arena()
    clear_world(engine)
    engine.bodies[ALICE].update(x=8, z=0, pushCharges=1)
    engine.bodies[BOB].update(x=9, z=0, score=40)
    assert engine.act(ALICE, {"kind": "push"}, 100).ok
    assert engine.bodies[BOB]["hp"] == 0 and engine.bodies[BOB]["score"] == 20
    assert engine.act(BOB, {"kind": "attack"}, 100.1).error == "RESPAWNING"
    engine.tick(102.3)
    assert engine.bodies[BOB]["hp"] == engine.bodies[BOB]["maxHp"]
    assert engine.bodies[BOB]["respawnAt"] == 0


@pytest.mark.parametrize("protection,expected", [("shield", 2), ("block", 3), ("none", 8)])
def test_combat_facing_reach_and_defense_damage(protection, expected):
    engine = arena("combat-duel")
    clear_world(engine)
    engine.bodies[ALICE]["yaw"] = math.pi / 2
    engine.bodies[BOB].update(x=1, z=0)
    if protection == "shield": engine.bodies[BOB]["shieldUntil"] = 110000
    if protection == "block": assert engine.act(BOB, {"kind": "block", "active": True}, 100).ok
    assert engine.act(ALICE, {"kind": "attack", "damage": 9999}, 100).ok
    assert engine.bodies[BOB]["hp"] == 100 - expected
    assert engine.act(ALICE, {"kind": "attack"}, 100.1).error == "COOLDOWN"
    engine.bodies[ALICE]["yaw"] = -math.pi / 2
    engine.act(ALICE, {"kind": "attack"}, 100.6)
    assert engine.bodies[BOB]["hp"] == 100 - expected


def test_spear_reach_and_weapon_use_exhaustion():
    engine = arena("combat-duel")
    clear_world(engine)
    engine.bodies[ALICE].update(yaw=math.pi / 2, weapon="spear", weaponUses=1)
    engine.act(ALICE, {"kind": "attack"}, 100)
    assert engine.bodies[BOB]["hp"] == 88
    assert engine.bodies[ALICE]["weapon"] == "hands"
    engine.act(ALICE, {"kind": "attack"}, 100.6)
    assert engine.bodies[BOB]["hp"] == 88


def test_gun_projectile_has_travel_time_and_no_client_target_selection():
    engine = arena("combat-duel")
    clear_world(engine)
    engine.bodies[ALICE].update(yaw=math.pi / 2, weapon="gun", weaponUses=5)
    assert engine.act(ALICE, {"kind": "attack", "target": BOB}, 100).ok
    assert engine.bodies[BOB]["hp"] == 100 and len(engine.projectiles) == 1
    engine.tick(100.3)
    assert engine.bodies[BOB]["hp"] == 88 and not engine.projectiles


def test_gun_projectile_damages_and_breaks_distant_crate():
    engine = arena("combat-duel")
    clear_world(engine)
    engine.crates = [{"id": "ranged-crate", "x": 4, "z": 0, "hp": 12}]
    engine.bodies[BOB].update(x=0, z=7)
    engine.bodies[ALICE].update(yaw=math.pi / 2, weapon="gun", weaponUses=5)
    engine.act(ALICE, {"kind": "attack"}, 100)
    engine.tick(100.4)
    assert engine.crates[0]["hp"] == 0
    assert any(event["kind"] == "crate-break" for event in engine.events)


def test_suspended_players_projectiles_cannot_keep_causing_damage():
    engine = arena("combat-duel")
    clear_world(engine)
    engine.bodies[ALICE].update(yaw=math.pi / 2, weapon="gun", weaponUses=5)
    engine.act(ALICE, {"kind": "attack"}, 100)
    engine.suspended.add(ALICE)
    engine.tick(100.3)
    assert engine.bodies[BOB]["hp"] == 100
    assert engine.damage[ALICE] == 0


def test_blocking_reduces_movement_speed_and_invalid_flag_is_rejected():
    engine = arena("combat-duel")
    clear_world(engine)
    assert engine.act(ALICE, {"kind": "block", "active": "yes"}, 100).error == "INVALID_BLOCK"
    assert engine.act(ALICE, {"kind": "block", "active": True}, 100).ok
    assert engine.act(ALICE, {"kind": "move", "dx": 1, "dz": 0, "seq": 1}, 100).ok
    engine.tick(100.2)
    assert engine.bodies[ALICE]["x"] == pytest.approx(engine.speed * .2 / 2)


def test_crate_requires_proximity_then_spawns_powerup_exactly_once():
    engine = arena()
    clear_world(engine)
    engine.crates = [{"id": "test-crate", "x": 6, "z": 0, "hp": 30}]
    assert engine.act(ALICE, {"kind": "interact", "crateId": "test-crate"}, 100).error == "NO_CRATE_IN_REACH"
    assert engine.crates[0]["hp"] == 30
    engine.bodies[ALICE]["x"] = 4
    assert engine.act(ALICE, {"kind": "interact", "crateId": "test-crate"}, 100.6).ok
    assert engine.crates[0]["hp"] == 15
    assert engine.act(ALICE, {"kind": "interact", "crateId": "test-crate"}, 101.2).ok
    assert engine.crates[0]["hp"] == 0 and len(engine.drops) == 1
    engine.act(ALICE, {"kind": "interact", "crateId": "test-crate"}, 101.8)
    assert len(engine.drops) == 1


def test_ko_finishes_combat_and_only_winner_is_entitled():
    engine = arena("combat-duel")
    clear_world(engine)
    engine.bodies[ALICE]["yaw"] = math.pi / 2
    engine.bodies[BOB].update(x=1, hp=8)
    assert engine.act(ALICE, {"kind": "attack"}, 100).finished
    assert engine.winner == ALICE and engine.eligible() == {ALICE}
    assert [entry.winner for entry in engine.entitlements()] == [ALICE]
    assert engine.act(BOB, {"kind": "attack"}, 100).error == "ROUND_NOT_OPEN"


def test_combat_deadline_draw_without_action_has_no_claim():
    engine = arena("combat-duel", duration_seconds=15)
    engine.tick(120)
    assert engine.finished and engine.winner is None and not engine.entitlements()


def test_suspended_token_leader_does_not_consume_top_n_reward_slot():
    engine = arena(top_n=1)
    engine.bodies[ALICE]["score"] = 99
    engine.bodies[BOB]["score"] = 50
    engine.suspended.add(ALICE)
    engine._finish()
    assert engine.eligible() == {BOB}


def test_boss_team_damage_and_minimum_contribution_determine_eligible():
    players = ["0x" + f"{i + 1:040x}" for i in range(6)]
    engine = arena("boss-raid", players=players, boss_health=100)
    engine._boss_damage(players[0], 30)
    engine._boss_damage(players[1], 5)
    engine._boss_damage(players[3], 10)
    engine._finish()
    assert engine.winning_team == "team-1"
    assert engine.eligible() == {players[0]}
    engine.suspended.add(players[0])
    assert not engine.eligible()


def test_boss_contribution_cap_and_tie_cannot_award_arbitrary_team():
    players = ["0x" + f"{i + 1:040x}" for i in range(6)]
    engine = arena("boss-raid", players=players, contribution_cap=20)
    engine._boss_damage(players[0], 100)
    engine._boss_damage(players[3], 100)
    assert engine.damage[players[0]] == 20
    engine._finish()
    assert engine.winning_team is None and not engine.entitlements()


def test_50_player_cap_and_deep_public_state_are_enforced():
    players = ["0x" + f"{i + 1:040x}" for i in range(50)]
    engine = arena("boss-raid", players=players)
    assert len(engine.bodies) == 50
    state = engine.public_state()
    state["bodies"][players[0]]["hp"] = -900
    assert engine.bodies[players[0]]["hp"] == 100
    with pytest.raises(ValidationError):
        config("boss-raid", cap=51)


def test_snapshot_rng_and_inputs_restore_deterministic_world():
    engine = arena("boss-raid", players=["0x" + f"{i + 1:040x}" for i in range(6)])
    clear_world(engine)
    engine.next_drop = 0
    engine.act(engine.participants[0], {"kind": "move", "dx": 1, "dz": 0, "seq": 1}, 100)
    engine.tick(100.2)
    restored = BossArenaEngine.restore(engine.config, ROUND, SEED, engine.snapshot())
    for now in [100.4, 100.8, 101.1, 101.8, 102.5, 103.1, 104.2, 105.5, 106.1]:
        engine.tick(now); restored.tick(now)
    assert restored.snapshot() == engine.snapshot()
    assert restored.public_state() == engine.public_state()


@pytest.mark.parametrize("team_size", [2, 3, 4, 5])
def test_runtime_50_player_raid_autoassigns_capacity_bounded_teams(tmp_path, team_size):
    async def scenario():
        players = ["0x" + f"{i + 1:040x}" for i in range(50)]
        store = Store(str(tmp_path / "teams.db"))
        runtime = RoomRuntime.create(store, VaultService(store), Hub(), owner=ALICE, config=config("boss-raid", cap=50, team_size=team_size))
        for player in players:
            runtime.join(player); runtime.set_ready(player)
        await runtime.start(100)
        teams = runtime.engine.teams
        assert set(teams) == set(players)
        assert len(teams.values()) == 50 and len(set(teams.values())) >= 2
        assert all(sum(value == team for value in teams.values()) <= team_size for team in set(teams.values()))
        recovered = RoomRuntime.load(store, VaultService(store), Hub(), runtime.room_id)
        assert recovered.engine.teams == teams
        store.close()
    asyncio.run(scenario())


def test_runtime_batches_movement_atomically_and_restores_checkpoint(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / "arena-runtime.db"))
        runtime = RoomRuntime.create(store, VaultService(store), Hub(), owner=ALICE, config=config())
        for player in [ALICE, BOB]:
            runtime.join(player); runtime.set_ready(player)
        await runtime.start(100)
        clear_world(runtime.engine)
        writes = []
        store._conn.set_trace_callback(lambda statement: writes.append(statement) if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) else None)
        await runtime.act(ALICE, {"kind": "move", "dx": 1, "dz": 0, "seq": 1}, 100.05)
        first_writes = len(writes)
        for seq in range(2, 12):
            assert (await runtime.act(ALICE, {"kind": "move", "dx": 1, "dz": 0, "seq": seq}, 100.05 + seq * .05))["ok"]
        assert len(writes) == first_writes
        await runtime.tick(101.2)
        actions = store.actions_since(runtime.room_id, 0)
        assert len(actions) == 11
        checkpoint = runtime.engine.snapshot()
        restored = RoomRuntime.load(store, VaultService(store), Hub(), runtime.room_id)
        assert restored.engine.snapshot() == checkpoint
        assert restored.deadline() == 160
        assert (await restored.act(ALICE, {"kind": "move", "dx": 1, "dz": 0, "seq": 12}, 101.3))["ok"]
        assert store.actions_since(runtime.room_id, 0)[-1]["seq"] == 12
        store.close()
    asyncio.run(scenario())


def test_invalid_team_selection_can_be_corrected_and_started(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / 'retry-teams.db'))
        runtime = RoomRuntime.create(store, VaultService(store), Hub(), owner=ALICE,
                                     config=config('boss-raid', cap=2))
        for player in [ALICE, BOB]:
            runtime.join(player); runtime.set_ready(player)
        store.set_setting(f'teams:{runtime.room_id}', {'teams': {ALICE:'team-1', BOB:'team-1'}})
        with pytest.raises(ValueError, match='CHOOSE_AT_LEAST_TWO_TEAMS'):
            await runtime.start(100)
        assert runtime.engine is None
        store.set_setting(f'teams:{runtime.room_id}', {'teams': {ALICE:'team-1', BOB:'team-2'}})
        await runtime.start(101)
        assert runtime.engine.public_state()['template'] == 'boss-raid'
        store.close()
    asyncio.run(scenario())


def test_graceful_shutdown_commits_pending_movement_for_restart(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / 'shutdown.db'))
        runtime = RoomRuntime.create(store, VaultService(store), Hub(), owner=ALICE, config=config())
        for player in [ALICE, BOB]:
            runtime.join(player); runtime.set_ready(player)
        await runtime.start(100)
        await runtime.act(ALICE, {'kind':'move','dx':1,'dz':0,'seq':1}, 100.05)
        await runtime.act(ALICE, {'kind':'move','dx':0,'dz':1,'seq':2}, 100.1)
        assert len(store.actions_since(runtime.room_id, 0)) == 1
        await Scheduler({runtime.room_id:runtime}).stop()
        assert len(store.actions_since(runtime.room_id, 0)) == 2
        restored = RoomRuntime.load(store, VaultService(store), Hub(), runtime.room_id)
        assert restored.engine.snapshot() == runtime.engine.snapshot()
        store.close()
    asyncio.run(scenario())
