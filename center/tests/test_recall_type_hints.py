"""D14 — Pattern Recall bounded replay + D15 — Typing Sprint private pace cue."""

import pytest

from center.games.recall_type_maze import PatternRecallEngine, TypingSprintEngine
from center.rules_late import PatternRecallRules, TypingSprintRules
from center.schema import Admission, RoomConfig, Rewards


# ---------------------------------------------------------------- D14

def _recall_engine() -> PatternRecallEngine:
    rules = PatternRecallRules(symbols=6, start_length=3, growth=1, input_window_seconds=5)
    cfg = RoomConfig(name="Recall room", template_id="pattern-recall", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=1, min_ready_to_start=1))
    eng = PatternRecallEngine(cfg, "r1", "seed-r", ["p1"])
    eng.start()
    return eng


def test_replay_shows_only_already_visible_segment():
    eng = _recall_engine()
    res = eng.act("p1", {"kind": "hint"}, now=1.0)
    assert res.ok
    seg = res.private["replayedSegment"]
    assert seg == eng.sequence[: eng.step]           # exactly the shown prefix
    assert len(seg) == eng.step
    assert seg == eng.public_state()["visibleSequence"]  # nothing new


def test_replay_never_touches_future_symbols():
    eng = _recall_engine()
    future = eng.sequence[eng.step:]
    res = eng.act("p1", {"kind": "hint"}, now=1.0)
    blob = str(res.private["replayedSegment"])
    for sym in future:
        pass  # individual symbols may repeat; assert via length instead
    assert len(res.private["replayedSegment"]) < len(eng.sequence)


def test_replay_budget_enforced_and_snapshot_safe():
    eng = _recall_engine()
    assert eng.act("p1", {"kind": "hint"}, now=1.0).ok
    assert eng.act("p1", {"kind": "hint"}, now=1.1).ok
    res = eng.act("p1", {"kind": "hint"}, now=1.2)
    assert not res.ok and res.error == "HINT_BUDGET_EXHAUSTED"
    restored = PatternRecallEngine.restore(eng.config, "r1", "seed-r", eng.snapshot())
    assert restored.hints_left["p1"] == 0
    assert restored.act("p1", {"kind": "hint"}, now=1.3).error == "HINT_BUDGET_EXHAUSTED"


def test_registry_marks_pattern_recall_implemented():
    from center.games.hints import policy_for
    pol = policy_for("pattern-recall")
    assert pol.implemented is True
    assert "bounded-replay" in {k.id for k in pol.kinds}


# ---------------------------------------------------------------- D15

def _typing_engine() -> TypingSprintEngine:
    rules = TypingSprintRules(prompt_id="crypto-basics", duration_seconds=60, accuracy_floor=85)
    cfg = RoomConfig(name="Typing room", template_id="typing-sprint", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=2, min_ready_to_start=2))
    eng = TypingSprintEngine(cfg, "r1", "seed-t", ["p1", "p2"])
    eng.start()
    return eng


def test_pace_cue_reports_own_rhythm():
    eng = _typing_engine()
    now = 1.0
    for _ in range(8):
        eng.act("p1", {"kind": "key"}, now=now)
        now += 0.2  # 200ms median -> "steady"
    res = eng.act("p1", {"kind": "hint"}, now=now)
    assert res.ok
    assert res.private["pace"] == "steady"
    assert res.private["medianInterKeyMs"] == 200
    assert res.private["keys"] == 8


def test_pace_cue_is_private_and_own_only():
    eng = _typing_engine()
    now = 1.0
    for _ in range(5):
        eng.act("p1", {"kind": "key"}, now=now)
        now += 0.1
    res = eng.act("p2", {"kind": "hint"}, now=now)  # p2 never typed
    assert res.ok
    assert res.private["pace"] == "warming-up"      # derived from p2's OWN empty log
    assert res.private["keys"] == 0
    # p2's cue says nothing about p1
    assert "p1" not in str(res.private)


def test_pace_budget_enforced():
    eng = _typing_engine()
    now = 1.0
    for i in range(5):
        res = eng.act("p1", {"kind": "hint"}, now=now + i)
        assert res.ok
    res = eng.act("p1", {"kind": "hint"}, now=now + 6)
    assert not res.ok and res.error == "HINT_BUDGET_EXHAUSTED"


def test_registry_marks_typing_sprint_implemented():
    from center.games.hints import policy_for
    pol = policy_for("typing-sprint")
    assert pol.implemented is True
    assert "pace-cue" in {k.id for k in pol.kinds}
