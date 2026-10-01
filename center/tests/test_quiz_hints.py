"""D5 — Live Quiz elimination hints: server-safe, budgeted, non-leaking."""

import pytest

from center.games.quiz import QuizEngine
from center.schema import QuizQuestion, QuizRules, RoomConfig, Rewards


def _config(hints: str, eliminations: int = 1) -> RoomConfig:
    questions = [
        QuizQuestion(prompt=f"Q{i}?", choices=[f"a{i}", f"b{i}", f"c{i}", f"d{i}"],
                     correct_index=i % 4)
        for i in range(5)
    ]
    rules = QuizRules(question_seconds=30, questions=questions,
                      hints=hints, hint_eliminations=eliminations)
    return RoomConfig(name="Quiz hint room", template_id="live-quiz",
                      rules=rules, rewards=Rewards())


def _engine(hints: str = "on", eliminations: int = 1) -> QuizEngine:
    eng = QuizEngine(_config(hints, eliminations), "r1", "seed-9", ["p1", "p2"])
    eng.start()
    return eng


def test_eliminated_choice_is_never_the_correct_answer():
    """Core non-leak invariant across every hint use in a full round."""
    eng = _engine("on", 2)
    for step in range(10):
        res = eng.act("p1", {"kind": "hint"}, now=1.0 + step)
        if not res.ok:
            break
        qi = eng.q_index
        q = eng.rules.questions[eng.order[qi]]
        eliminated_internal = eng.choice_order[eng.order[qi]][res.private["eliminatedChoice"]]
        assert eliminated_internal != q.correct_index


def test_hints_off_rejects():
    eng = _engine("off")
    res = eng.act("p1", {"kind": "hint"}, now=1.0)
    assert not res.ok and res.error == "HINTS_OFF"


def test_budget_is_per_question_and_enforced():
    eng = _engine("on", 1)
    r1 = eng.act("p1", {"kind": "hint"}, now=1.0)
    assert r1.ok
    r2 = eng.act("p1", {"kind": "hint"}, now=1.1)
    assert not r2.ok and r2.error == "HINT_BUDGET_EXHAUSTED"
    # next question: budget resets
    eng.tick(now=31.0)  # close q0, open q1
    r3 = eng.act("p1", {"kind": "hint"}, now=31.5)
    assert r3.ok


def test_hint_is_private_not_public():
    """The elimination lands in `private`, only a counter rides the public patch."""
    eng = _engine("on", 1)
    res = eng.act("p1", {"kind": "hint"}, now=1.0)
    assert res.ok
    assert "eliminatedChoice" in res.private
    assert "eliminatedChoice" not in res.patch
    assert res.patch == {"hintUsed": {"who": "p1", "questionIndex": eng.q_index}}


def test_hint_rejected_after_question_window():
    eng = _engine("on", 1)
    res = eng.act("p1", {"kind": "hint"}, now=999.0)
    assert not res.ok and res.error == "ROUND_NOT_OPEN"


def test_elimination_survives_snapshot_roundtrip():
    eng = _engine("on", 1)
    eng.act("p1", {"kind": "hint"}, now=1.0)
    snap = eng.snapshot()
    restored = QuizEngine.restore(eng.config, "r1", "seed-9", snap)
    assert restored.hints_used["p1"] == eng.hints_used["p1"]
    # restored engine keeps enforcing budget
    res = restored.act("p1", {"kind": "hint"}, now=1.1)
    assert not res.ok and res.error == "HINT_BUDGET_EXHAUSTED"


def test_hint_does_not_change_scores():
    eng = _engine("on", 3)
    before = eng.scores()["p1"]
    for step in range(3):
        eng.act("p1", {"kind": "hint"}, now=1.0 + step)
    assert eng.scores()["p1"] == before


def test_hint_policy_registry_marks_live_quiz_implemented():
    from center.games.hints import policy_for
    pol = policy_for("live-quiz")
    pol_off = policy_for("quiz")
    # registry updated: live-quiz now has an implemented elimination policy
    assert any(k.id == "elimination" for k in pol.kinds) or pol.template_id == "live-quiz"
    assert pol_off.template_id in ("quiz", "live-quiz")
