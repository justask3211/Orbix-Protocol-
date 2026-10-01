"""D6 — Memory Match bounded pair-reveal hints: private, budgeted, non-leaking."""

import pytest

from center.games.memory import MemoryEngine
from center.schema import MemoryRules, RoomConfig, Rewards


def _config(hints: str, budget: int = 2) -> RoomConfig:
    from center.schema import Admission
    rules = MemoryRules(pairs=6, duration_seconds=60, hints=hints, hint_budget=budget)
    return RoomConfig(name="Memory hint room", template_id="memory-match",
                      rules=rules, rewards=Rewards(),
                      admission=Admission(player_cap=1, min_ready_to_start=1))


def _engine(hints: str = "on", budget: int = 2) -> MemoryEngine:
    eng = MemoryEngine(_config(hints, budget), "r1", "seed-7", ["p1"])
    eng.start()
    return eng


def test_revealed_pair_actually_matches():
    eng = _engine("on", 3)
    for step in range(3):
        res = eng.act("p1", {"kind": "hint"}, now=1.0 + step)
        assert res.ok, res.error
        a, b = res.private["revealedPair"]
        assert eng.layout[a] == eng.layout[b]
        assert a not in eng.matched and b not in eng.matched


def test_hint_exposes_exactly_two_indices():
    """Non-leak invariant: a hint reveals one pair, never the board."""
    eng = _engine("on", 5)
    revealed: set[int] = set()
    for step in range(5):
        res = eng.act("p1", {"kind": "hint"}, now=1.0 + step)
        if not res.ok:
            break
        pair = res.private["revealedPair"]
        assert len(pair) == 2
        revealed.update(pair)
    assert len(revealed) <= 10  # 5 hints x 2 cards, not the full 12-card board


def test_hints_off_rejects():
    eng = _engine("off")
    res = eng.act("p1", {"kind": "hint"}, now=1.0)
    assert not res.ok and res.error == "HINTS_OFF"


def test_budget_is_enforced_and_private():
    eng = _engine("on", 2)
    r1 = eng.act("p1", {"kind": "hint"}, now=1.0)
    r2 = eng.act("p1", {"kind": "hint"}, now=1.1)
    assert r1.ok and r2.ok
    assert r2.private["hintsLeft"] == 0
    r3 = eng.act("p1", {"kind": "hint"}, now=1.2)
    assert not r3.ok and r3.error == "HINT_BUDGET_EXHAUSTED"
    assert eng.hints_left["p1"] == 0


def test_hint_is_private_not_public():
    eng = _engine("on", 1)
    res = eng.act("p1", {"kind": "hint"}, now=1.0)
    assert res.ok
    assert "revealedPair" in res.private
    assert "revealedPair" not in res.patch


def test_hint_does_not_cost_moves_or_change_scores():
    eng = _engine("on", 3)
    before = dict(eng.scores())
    for step in range(3):
        eng.act("p1", {"kind": "hint"}, now=1.0 + step)
    assert eng.scores() == before
    assert eng.moves["p1"] == 0


def test_hint_survives_snapshot_roundtrip():
    eng = _engine("on", 2)
    eng.act("p1", {"kind": "hint"}, now=1.0)
    restored = MemoryEngine.restore(eng.config, "r1", "seed-7", eng.snapshot())
    assert restored.hints_left["p1"] == 1
    res = restored.act("p1", {"kind": "hint"}, now=1.1)
    assert res.ok
    res2 = restored.act("p1", {"kind": "hint"}, now=1.2)
    assert not res2.ok and res2.error == "HINT_BUDGET_EXHAUSTED"


def test_registry_marks_memory_match_implemented():
    from center.games.hints import policy_for
    pol = policy_for("memory-match")
    assert pol.implemented is True
    kinds = {k.id for k in pol.kinds}
    assert "bounded-reveal" in kinds
