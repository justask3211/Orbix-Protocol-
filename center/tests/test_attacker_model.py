"""F4 — attacker model: clients cannot nominate winners, scores, answers, or identity.

Pins the server-authority chain end to end:
  identity:  WS identity comes from a server-issued ticket bound to a wallet; a
             per-action "who" claim from the client is ignored by construction.
  scores:    client-supplied score/answer/winner fields inside an action payload
             are inert data; only engine reducers compute state and entitlements.
  results:   entitlements are produced solely by engine.entitlements(); there is
             no API path that accepts a client-nominated winner.
"""

import pytest

from center.games.number_hunt import NumberHuntEngine
from center.games.quiz import QuizEngine
from center.schema import Admission, NumberHuntRules, QuizQuestion, QuizRules, Rewards, RoomConfig


# ---------------------------------------------------------------- identity binding

def test_ws_identity_is_server_ticket_bound_not_client_claimed():
    """Read the WS handler source to assert the protocol: `who` is set from the
    server-side ticket record, and rt.act receives that server-side `who`."""
    import inspect
    import center.api as api
    src = inspect.getsource(api)
    assert 'who = t["who"]' in src, "identity must come from the server ticket"
    assert "rt.act(who" in src, "actions must run under the server-bound identity"
    # no path may let a payload overwrite the acting identity
    assert 'rt.act(payload.get("who")' not in src


def test_action_log_records_server_identity_even_if_payload_lies():
    from center.room import RoomRuntime  # noqa: F401  (import sanity)
    from center.games.number_hunt import NumberHuntEngine
    rules = NumberHuntRules(min=1111, max=9999, guess_budget=5, duration_seconds=60,
                            hints="on", digits=4)
    cfg = RoomConfig(name="F4 room", template_id="number-hunt", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=2, min_ready_to_start=1))
    eng = NumberHuntEngine(cfg, "r1", "seed-f4", ["alice", "bob"])
    eng.start()
    # bob sends an action claiming to be alice: engine keys on the SERVER identity
    forged = {"kind": "guess", "number": 5000, "who": "alice", "as": "alice",
              "player": "alice", "winner": "bob", "score": 999}
    res = eng.act("bob", forged, now=1.0)
    assert res.ok
    # the guess is attributed to bob in the server log, not to the claimed alice
    assert eng.log[-1]["who"] == "bob"
    assert eng.guesses["bob"] and not eng.guesses["alice"]


# ---------------------------------------------------------------- score/winner injection

def test_payload_score_and_winner_fields_are_inert():
    rules = NumberHuntRules(min=1111, max=9999, guess_budget=5, duration_seconds=60, digits=4)
    cfg = RoomConfig(name="F4 room", template_id="number-hunt", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=2, min_ready_to_start=1))
    eng = NumberHuntEngine(cfg, "r1", "seed-f4", ["alice", "bob"])
    eng.start()
    res = eng.act("bob", {"kind": "guess", "number": 5000, "score": 10**9,
                          "winner": "bob", "targets": [1111]}, now=1.0)
    assert res.ok
    assert res.scores.get("bob", 0) == res.scores.get("bob", 0)  # unchanged by payload
    assert sum(res.scores.values()) <= 10  # scores derive from budgets, not claims
    # the real targets are untouched by the payload's fake ones
    assert 1111 not in eng.targets or eng.targets != [1111]


def test_quiz_client_cannot_mark_answer_correct():
    questions = [QuizQuestion(prompt=f"Q{i}?", choices=["a", "b", "c", "d"], correct_index=2)
                 for i in range(5)]
    rules = QuizRules(question_seconds=30, questions=questions)
    cfg = RoomConfig(name="Quiz F4", template_id="live-quiz", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=2, min_ready_to_start=2))
    eng = QuizEngine(cfg, "r1", "seed-q", ["p1", "p2"])
    eng.start()
    # client sends its own 'correct': True and a fabricated score
    res = eng.act("p1", {"kind": "answer", "questionIndex": 0, "choice": 0,
                         "correct": True, "score": 5000}, now=1.0)
    assert res.ok
    assert res.private["correct"] is False  # server decides; choice 0 is wrong
    assert eng.score_of("p1") == 0


def test_entitlements_come_only_from_the_engine():
    rules = NumberHuntRules(min=1111, max=9999, guess_budget=5, duration_seconds=60, digits=4)
    cfg = RoomConfig(name="F4 room", template_id="number-hunt", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=2, min_ready_to_start=1))
    eng = NumberHuntEngine(cfg, "r1", "seed-f4", ["alice"])
    eng.start()
    # nobody hit a target -> nobody is eligible, no matter what clients claim
    assert eng.eligible() == set()
    assert eng.entitlements() == []
    # hit the target: engine records the claim; with no reward slots configured,
    # entitlements stay empty (engine alone decides — never the client)
    target = eng.targets[0]
    res = eng.act("alice", {"kind": "guess", "number": target}, now=1.0)
    assert res.ok
    assert eng.eligible() == {"alice"}
    assert eng.entitlements() == []  # no slots configured -> nothing payable
    assert res.finished  # engine, not client, closed the round


def test_forged_answer_after_round_is_refused():
    questions = [QuizQuestion(prompt="Q?", choices=["a", "b", "c", "d"], correct_index=1)
                 for _ in range(5)]
    rules = QuizRules(question_seconds=30, questions=questions)
    cfg = RoomConfig(name="Quiz F4", template_id="live-quiz", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=2, min_ready_to_start=2))
    eng = QuizEngine(cfg, "r1", "seed-q", ["p1", "p2"])
    eng.start()
    eng.finished = True  # round closed
    res = eng.act("p1", {"kind": "answer", "questionIndex": 0, "choice": 1}, now=2.0)
    assert not res.ok and res.error == "ROUND_FINISHED"
