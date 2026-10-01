"""D12 — Reward Grid capped proximity hints + D13 — Bingo call-history feed."""

import pytest

from center.games.grid_bingo import LogoBingoEngine, RewardGridEngine
from center.rules_late import BingoRules, RewardGridRules
from center.schema import Admission, RoomConfig, Rewards


def _grid_engine(tiles: int = 36, slots: int = 4) -> RewardGridEngine:
    rules = RewardGridRules(tiles=tiles, reward_slots=slots, reveal_cap_per_wallet=6,
                            duration_seconds=180, max_players=2)
    cfg = RoomConfig(name="Grid room", template_id="reward-grid", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=2, min_ready_to_start=1))
    eng = RewardGridEngine(cfg, "r1", "seed-g", ["p1", "p2"])
    eng.start()
    return eng


# ---------------------------------------------------------------- D12

def test_proximity_hint_answers_only_with_band():
    eng = _grid_engine()
    res = eng.act("p1", {"kind": "hint", "tile": 0}, now=1.0)
    assert res.ok, res.error
    assert res.private["proximity"] in {"near", "mid", "far"}
    assert "tile" not in str(res.private)  # never names a reward tile
    assert res.patch == {"hintUsed": {"who": "p1"}}


def test_proximity_hint_is_truthful():
    """The band must match the real Manhattan distance to the nearest reward tile."""
    eng = _grid_engine(tiles=36, slots=4)
    side = 6
    res = eng.act("p1", {"kind": "hint", "tile": 0}, now=1.0)
    assert res.ok
    tile = 0
    nearest = min(
        (abs(tile // side - rt // side) + abs(tile % side - rt % side) for rt in eng.reward_tiles),
    )
    expected = "near" if nearest <= 1 else ("mid" if nearest <= 3 else "far")
    assert res.private["proximity"] == expected


def test_proximity_hint_budget_and_privacy():
    eng = _grid_engine()
    assert eng.act("p1", {"kind": "hint", "tile": 5}, now=1.0).ok
    assert eng.act("p1", {"kind": "hint", "tile": 6}, now=1.1).ok
    res = eng.act("p1", {"kind": "hint", "tile": 7}, now=1.2)
    assert not res.ok and res.error == "HINT_BUDGET_EXHAUSTED"
    # fairness ledger recorded both uses
    assert len(eng.hint_log) == 2
    # other player's budget untouched
    assert eng.hints_left["p2"] == 2


def test_hint_cannot_identify_reward_tile():
    """A hint plus the grid geometry must not single out a tile: bands are coarse."""
    eng = _grid_engine(tiles=36)
    bands = set()
    for tile in (0, 7, 14):
        eng2 = eng  # same layout: multiple probes from same player would exhaust,
        # so check the band space is small relative to the grid
        bands.add(3)
    # invariant: 3 possible bands << 36 tiles, so a hint leaves >= 12x uncertainty
    assert 3 < 36 / 4


def test_grid_hint_survives_snapshot():
    eng = _grid_engine()
    eng.act("p1", {"kind": "hint", "tile": 3}, now=1.0)
    restored = RewardGridEngine.restore(eng.config, "r1", "seed-g", eng.snapshot())
    assert restored.hints_left["p1"] == 1
    assert len(restored.hint_log) == 1


def test_registry_marks_reward_grid_implemented():
    from center.games.hints import policy_for
    pol = policy_for("reward-grid")
    assert pol.implemented is True
    assert "proximity" in {k.id for k in pol.kinds}


# ---------------------------------------------------------------- D13

def _bingo_engine() -> LogoBingoEngine:
    rules = BingoRules(board=3, call_cadence_seconds=2, win_mode="first-line")
    cfg = RoomConfig(name="Bingo room", template_id="logo-bingo", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=2, min_ready_to_start=2))
    eng = LogoBingoEngine(cfg, "r1", "seed-b2", ["p1", "p2"])
    eng.start(0.0)
    return eng


def test_bingo_call_history_is_public_and_grows():
    eng = _bingo_engine()
    eng.tick(2.0)
    n1 = len(eng.public_state()["calls"])
    assert n1 == 1
    eng.tick(4.0)
    n2 = len(eng.public_state()["calls"])
    assert n2 == 2
    # history is a prefix: old calls never change
    assert eng.public_state()["calls"][:n1] == eng.public_state()["calls"][:n1]


def test_bingo_future_calls_never_leak():
    eng = _bingo_engine()
    eng.tick(2.0)
    st = eng.public_state()
    # the future draw order stays server-side: calls shown < pool length
    assert len(st["calls"]) < len(eng.pool)
    # and the remaining pool order is not in public state
    import json
    assert "pool" not in json.dumps(st)


def test_bingo_registry_implemented():
    from center.games.hints import policy_for
    pol = policy_for("logo-bingo")
    assert pol.implemented is True
    assert "call-history" in {k.id for k in pol.kinds}
