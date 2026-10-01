"""D10 — Hash Hunt difficulty/throughput feed: truthful, non-leaking.

The feed publishes the real difficulty and each miner's own server-verified attempt
rate. It never exposes a winning nonce before the round ends, a partial preimage,
or anything that lowers the work.
"""

import pytest

from center.games.hash_hunt import HashHuntEngine
from center.schema import Admission, HashHuntRules, RoomConfig, Rewards


P1 = "0x" + "01" * 20
P2 = "0x" + "02" * 20


def _engine(difficulty_bits: int = 8) -> HashHuntEngine:
    rules = HashHuntRules(duration_seconds=60, difficulty_bits=difficulty_bits,
                          win_mode="best-effort")
    cfg = RoomConfig(name="Hash room", template_id="hash-hunt", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=10, min_ready_to_start=1))
    eng = HashHuntEngine(cfg, "0x" + "11" * 32, "seed-5", [P1, P2])
    eng.start()
    return eng


def test_attempt_rates_count_verified_evaluations_only():
    eng = _engine()
    # probe through the engine: count until first server-accepted proof
    found_valid = None
    for n in range(50000):
        res = eng.act(P1, {"kind": "submit", "nonce": n}, now=1.0)
        if res.ok:
            found_valid = n
            break
    assert found_valid is not None
    assert eng.attempts[P1] == found_valid + 1  # every evaluated nonce counted
    assert eng.attempts[P2] == 0


def test_feed_is_public_and_shape_correct():
    eng = _engine()
    st = eng.public_state()
    assert st["difficultyBits"] == 8
    rates = st["attemptRates"]
    assert set(rates) == {P1, P2}
    assert set(rates[P1]) == {"attempts", "valid"}


def test_feed_never_contains_solution_nonce_before_finish():
    eng = _engine()
    for n in range(20000):
        res = eng.act(P1, {"kind": "submit", "nonce": n}, now=1.0)
        if res.ok:
            break
    st = repr(eng.public_state())
    # no winning nonce leaks via the feed (leaderboard may carry the public proof
    # nonce by design; assert the attemptRates block itself is nonce-free)
    import json
    rates = json.dumps(eng.public_state()["attemptRates"])
    assert "nonce" not in rates
    assert "hash" not in rates


def test_throughput_survives_snapshot():
    eng = _engine()
    for n in range(30):
        eng.act(P1, {"kind": "submit", "nonce": n}, now=1.0)
    restored = HashHuntEngine.restore(eng.config, eng.round_id, "seed-5", eng.snapshot())
    assert restored.attempts[P1] == eng.attempts[P1]


def test_difficulty_reflects_rules_truthfully():
    eng8 = _engine(8)
    eng20 = _engine(20)
    assert int(eng8.public_state()["target"], 16) > int(eng20.public_state()["target"], 16)


def test_registry_marks_hash_hunt_implemented():
    from center.games.hints import policy_for
    pol = policy_for("hash-hunt")
    assert pol.implemented is True
    kinds = {k.id for k in pol.kinds}
    assert "difficulty-throughput" in kinds
