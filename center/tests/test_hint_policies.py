"""Tests for the typed hint-policy layer (D3): server-safe, versioned, non-leaking."""

import pytest

from center.games.hints import HINT_POLICIES, policy_for


def test_every_catalog_template_has_a_policy():
    templates = {
        "number-hunt", "live-quiz", "memory-match", "token-catch", "reaction-duel",
        "puzzle-sprint", "hash-hunt", "boss-raid", "rps-duel", "reward-grid",
        "grid-bingo", "pattern-recall", "typing-sprint", "maze-race", "level-runner",
        "contract-detective", "mev-rush", "idle-rig", "airdrop-quest",
    }
    have = set(HINT_POLICIES)
    missing = templates - have
    assert not missing, f"templates without a declared policy: {missing}"


def test_number_hunt_hint_never_leaks_target():
    """The only string values a hint can carry are higher/lower - never a number."""
    from center.games.number_hunt import NumberHuntEngine
    from center.schema import NumberHuntRules, RoomConfig, Rewards

    rules = NumberHuntRules(min=1111, max=9999, guess_budget=10, duration_seconds=60,
                            hints="on", hint_visibility="public", digits=4)
    cfg = RoomConfig(name="Hint test room", template_id="number-hunt", rules=rules, rewards=Rewards())
    eng = NumberHuntEngine(cfg, "r1", "seed-1", ["p1", "p2"])
    eng.start()
    leaked = []
    for g in range(1111, 9999, 173):
        res = eng.act("p1", {"kind": "guess", "number": g}, now=g * 0.001)
        hint = res.patch.get("lastGuess", {}).get("hint")
        if hint:
            leaked.append(hint["direction"])
            assert set(hint) <= {"who", "number", "direction"}
    assert leaked, "expected some misses to produce public hints"
    assert set(leaked) <= {"higher", "lower"}


def test_private_hint_ride_private_payload():
    from center.games.number_hunt import NumberHuntEngine
    from center.schema import NumberHuntRules, RoomConfig, Rewards

    rules = NumberHuntRules(min=1111, max=9999, guess_budget=10, duration_seconds=60,
                            hints="on", hint_visibility="private", digits=4)
    cfg = RoomConfig(name="Hint test room", template_id="number-hunt", rules=rules, rewards=Rewards())
    eng = NumberHuntEngine(cfg, "r1", "seed-1", ["p1", "p2"])
    eng.start()
    res = eng.act("p1", {"kind": "guess", "number": 5000}, now=1.0)
    assert res.ok
    assert "hint" in res.private or res.patch.get("lastGuess", {}).get("hit") is True


def test_off_policy_produces_no_hint():
    from center.games.number_hunt import NumberHuntEngine
    from center.schema import NumberHuntRules, RoomConfig, Rewards

    rules = NumberHuntRules(min=1111, max=9999, guess_budget=10, duration_seconds=60,
                            hints="off", digits=4)
    cfg = RoomConfig(name="Hint test room", template_id="number-hunt", rules=rules, rewards=Rewards())
    eng = NumberHuntEngine(cfg, "r1", "seed-1", ["p1"])
    eng.start()
    res = eng.act("p1", {"kind": "guess", "number": 5000}, now=1.0)
    assert res.ok
    assert "hint" not in res.private
    assert "hint" not in res.patch.get("lastGuess", {})


def test_later_templates_are_honestly_unimplemented():
    for tid in ("mev-rush", "airdrop-quest"):
        pol = policy_for(tid)
        assert pol.implemented is False, tid


def test_token_catch_is_now_implemented():
    pol = policy_for("token-catch")
    assert pol.implemented is True
    assert "lane-tempo" in {k.id for k in pol.kinds}


def test_live_quiz_has_implemented_elimination_policy():
    pol = policy_for("live-quiz")
    assert pol.implemented is True
    kinds = {k.id for k in pol.kinds}
    assert "elimination" in kinds
    assert all(k.description for k in pol.kinds)


def test_policy_version_is_present_and_positive():
    for tid, pol in HINT_POLICIES.items():
        assert pol.version >= 1, tid
        assert pol.template_id == tid


def test_unknown_template_gets_safe_empty_policy():
    pol = policy_for("not-a-template")
    assert pol.implemented is False
    assert pol.kind("anything") is None
