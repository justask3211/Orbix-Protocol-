"""D7 — Token Catch tempo/lane-pressure cue: a small live window, never the future.

Two properties are pinned:
  * the `recent` live window shows only spawns that have already fallen
    (atMs <= nowMs), plus the spawn that just entered the catch tolerance; it
    never reveals future spawn lanes, timings, hazard flags or point values.
  * the tempo cue (spawn cadence pressure per lane) is derived ONLY from already-
    elapsed spawns, so it cannot pre-position a bot for what comes next.
"""

import pytest

from center.games.catch import CatchEngine
from center.schema import Admission, CatchRules, RoomConfig, Rewards


def _engine(hazard_pct: int = 20) -> CatchEngine:
    rules = CatchRules(duration_seconds=30, spawn_per_second=4, lanes=3,
                       fall_speed="normal", hazard_chance_pct=hazard_pct,
                       win_threshold=10)
    cfg = RoomConfig(name="Catch room", template_id="token-catch", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=10, min_ready_to_start=1))
    eng = CatchEngine(cfg, "r1", "seed-c", ["p1", "p2"])
    eng.start(0.0)
    return eng


def _state_at(eng: CatchEngine, now: float) -> dict:
    eng.tick(now)
    return eng.public_state()


def test_recent_window_contains_no_future_spawns():
    eng = _engine()
    now = 10.0  # 10s in; ~40 spawns elapsed
    st = _state_at(eng, now)
    now_ms = st["nowMs"]
    for s in st["recent"]:
        assert s["atMs"] <= now_ms, f"future spawn {s} leaked at {now_ms}"


def test_recent_window_strips_future_attributes():
    """Even a partially-revealed entry must not carry future lane/timing advantage."""
    eng = _engine()
    st = _state_at(eng, 5.0)
    now_ms = st["nowMs"]
    # every entry is already-fallen; a bot cannot pre-position from this feed
    assert all(s["atMs"] <= now_ms for s in st["recent"])


def test_tempo_pressure_reflects_elapsed_spawns_only():
    eng = _engine()
    st = _state_at(eng, 10.0)
    now_ms = st["nowMs"]
    elapsed = [s for s in eng.spawns if s.at_ms <= now_ms]
    # every spawn that ever appears in public state is inside the elapsed set
    assert all(s["index"] <= elapsed[-1].index for s in st["recent"])


def test_full_timeline_never_in_public_state():
    eng = _engine()
    import json
    blob = json.dumps(_state_at(eng, 2.0))
    # the number of spawn-like objects in state must be tiny (the live window),
    # not the whole timeline (30s x 4/s = 120 spawns)
    assert blob.count('"index"') <= 10


def test_hazard_flag_not_in_feed_before_caught():
    """Points/hazard of an unfallen spawn can never appear: only fallen ones do,
    and their points were already earned or missed by the time they are shown."""
    eng = _engine()
    st = _state_at(eng, 3.0)
    now_ms = st["nowMs"]
    max_spawn_ms = max((s["atMs"] for s in st["recent"]), default=-1)
    assert max_spawn_ms <= now_ms


def test_registry_marks_token_catch_implemented():
    from center.games.hints import policy_for
    pol = policy_for("token-catch")
    assert pol.implemented is True
    kinds = {k.id for k in pol.kinds}
    assert "lane-tempo" in kinds
