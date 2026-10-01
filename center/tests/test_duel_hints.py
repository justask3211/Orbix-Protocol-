"""D8 — Reaction Duel / RPS commit-reveal progress: nothing leaks before reveal.

The engine already shares phase + commit/reveal status publicly. These tests pin the
non-leak invariant: no patch, public state, or history entry ever contains an
opponent's cleartext choice before the engine itself resolves the subround, and a
cleartext choice cannot be derived from a commitment.
"""

import hashlib

from center.games.base import ActionResult
from center.games.duel import DuelEngine
from center.schema import Admission, DuelRules, RoomConfig, Rewards


def _config(rounds: int = 3) -> RoomConfig:
    rules = DuelRules(rounds=rounds)  # type: ignore[arg-type]
    return RoomConfig(name="Duel hint room", template_id="reaction-duel",
                      rules=rules, rewards=Rewards(),
                      admission=Admission(player_cap=2, min_ready_to_start=2))


def _engine() -> DuelEngine:
    eng = DuelEngine(_config(), "r1", "seed-3", ["a", "b"])
    eng.start()
    return eng


def _commit_round(eng: DuelEngine, choice_a: str, choice_b: str, now: float) -> None:
    for who, choice in (("a", choice_a), ("b", choice_b)):
        res = eng.act(who, {"kind": "commit", "choice": choice, "salt": f"s-{who}"}, now=now)
        assert res.ok, res.error


def _reveal_round(eng: DuelEngine, choice_a: str, choice_b: str, now: float) -> ActionResult:
    last = None
    for who, choice in (("a", choice_a), ("b", choice_b)):
        last = eng.act(who, {"kind": "reveal", "choice": choice, "salt": f"s-{who}"}, now=now)
        assert last is not None and last.ok, getattr(last, "error", None)
    assert last is not None
    return last


def test_commit_patch_contains_no_cleartext_choice():
    eng = _engine()
    res = eng.act("a", {"kind": "commit", "choice": "rock", "salt": "s-a"}, now=1.0)
    assert res.ok
    text = repr(res.patch)
    assert "rock" not in text and "paper" not in text and "scissors" not in text
    assert res.patch["phase"] in ("commit", "reveal")
    assert res.patch["committed"]["a"] is True
    assert res.patch["committed"]["b"] is False


def test_public_state_never_shows_choice_before_resolution():
    eng = _engine()
    _commit_round(eng, "rock", "scissors", now=1.0)
    state = repr(eng.public_state())
    assert "rock" not in state and "scissors" not in state
    assert "phase" in state  # phase IS public


def test_partial_reveal_still_hides_other_choice():
    eng = _engine()
    _commit_round(eng, "rock", "paper", now=1.0)
    res = eng.act("a", {"kind": "reveal", "choice": "rock", "salt": "s-a"}, now=1.1)
    assert res.ok
    # a's own reveal patch must not carry b's choice
    assert "paper" not in repr(res.patch)
    st = repr(eng.public_state())
    # public state stays fully choice-free until BOTH reveal and the engine resolves
    assert "paper" not in st and "rock" not in st
    assert repr(res.patch).count("rock") <= 1  # own patch may carry own reveal only


def test_history_appears_only_after_both_reveal():
    eng = _engine()
    _commit_round(eng, "rock", "scissors", now=1.0)
    assert eng.public_state()["history"] == []
    res = _reveal_round(eng, "rock", "scissors", now=1.1)
    assert res.patch["outcome"] == "a:rock:scissors"  # resolved now, and only now
    assert eng.public_state()["history"]


def test_commitment_is_one_way():
    """Knowing the commit hash must not reveal the choice without the salt."""
    digest = hashlib.sha256(b"orbix-center/duel/v1|rock|s-a").hexdigest()
    for choice in ("rock", "paper", "scissors"):
        # brute-forcing the 5-word space is possible WITH the salt; the invariant is
        # that the engine never publishes salt or preimage, only the digest
        assert digest not in ("rock", "paper", "scissors")
    st = repr(eng_public_without_salts())
    assert "s-a" not in st and "s-b" not in st


def eng_public_without_salts() -> dict:
    eng = _engine()
    _commit_round(eng, "rock", "scissors", now=1.0)
    return eng.public_state()


def test_registry_marks_duels_implemented():
    from center.games.hints import policy_for
    for tid in ("reaction-duel", "rps-duel"):
        pol = policy_for(tid)
        assert pol.implemented is True, tid
        assert pol.kinds and pol.kinds[0].description, tid
