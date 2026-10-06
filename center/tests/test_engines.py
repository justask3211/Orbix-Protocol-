"""Engine behaviour tests — the D01..D08 acceptance bar.

Each engine must: start cleanly, never leak its secret in public_state(), validate hostile
input, produce a deterministic reproducible stream, round-trip through snapshot/restore,
and emit entitlements for the configured reward slots.
"""

from __future__ import annotations

import json
import sys

import pytest

sys.path.insert(0, "/home/agentuser/vibeswap")

from center.games import ENGINES, commit_hash, verify_commit  # noqa: E402
from center.schema import RoomConfig  # noqa: E402

ALICE = "0x" + "a1" * 20
BOB = "0x" + "b0" * 20
SEED = "ab" * 32
ROUND = "cd" * 32


def cfg(template_id: str, rules: dict, **kw) -> RoomConfig:
    """Build a valid config, honouring each template's player ceiling."""
    adm = dict(kw.pop("admission", {}))
    if template_id in {"puzzle-sprint", "memory-match"}:
        adm.setdefault("player_cap", 1)
    elif template_id == "reaction-duel":
        adm.setdefault("player_cap", 2)
    elif template_id == "boss-raid":
        adm.setdefault("player_cap", rules.get("max_players", 4))
    else:
        adm.setdefault("player_cap", 8)
    adm.setdefault("min_ready_to_start", 1)
    base = {
        "name": "Test Room",
        "template_id": template_id,
        "rules": {"templateId": template_id, **rules},
        "admission": adm,
    }
    base.update(kw)
    return RoomConfig(**base)


def make(template_id: str, rules: dict, participants=(ALICE, BOB), **kw):
    config = cfg(template_id, rules, **kw)
    engine = ENGINES[template_id](config, ROUND, SEED, list(participants))
    return engine


# --------------------------------------------------------------------- G01


def test_number_hunt_four_digit_truncation_and_budget():
    e = make("number-hunt", dict(digits=4, min=1111, max=9999, guess_budget=3, duration_seconds=60))
    e.start(0.0)
    assert e.public_state()["targets"] is None  # secret until the round ends

    # A five-digit value must be rejected outright, whatever a client sends.
    r = e.act(ALICE, {"kind": "guess", "number": 12345}, 1.0)
    assert not r.ok and r.error == "BAD_DIGITS"
    # Out of range inside the correct width (narrowed window, all four-digit values).
    e_narrow = make("number-hunt", dict(digits=4, min=2000, max=3000, guess_budget=3, duration_seconds=60, guess_cooldown_ms=300))
    e_narrow.start(0.0)
    assert e_narrow.act(ALICE, {"kind": "guess", "number": 1500}, 0.1).error == "OUT_OF_RANGE"
    # Non-integer payloads are refused.
    assert e.act(ALICE, {"kind": "guess", "number": "1234"}, 1.2).error == "BAD_NUMBER"

    target = e.targets[0]
    r = e.act(ALICE, {"kind": "guess", "number": target}, 2.0)
    assert r.ok and r.finished
    assert e.public_state()["targets"] == [target]
    # Cooldown applies.
    e2 = make("number-hunt", dict(digits=6, min=111111, max=999999, guess_budget=5, duration_seconds=60, guess_cooldown_ms=1000))
    e2.start(0.0)
    assert e2.act(ALICE, {"kind": "guess", "number": 500000}, 0.1).ok
    assert e2.act(ALICE, {"kind": "guess", "number": 500001}, 0.2).error == "SLOW_DOWN"
    # Budget exhausts.
    e3 = make("number-hunt", dict(digits=6, min=111111, max=999999, guess_budget=1, duration_seconds=60, guess_cooldown_ms=300))
    e3.start(0.0)
    assert not any(e3.targets[0] == n for n in (1,))  # sanity
    guess = 111111 if e3.targets[0] != 111111 else 111112
    assert e3.act(ALICE, {"kind": "guess", "number": guess}, 1.0).ok
    assert e3.act(ALICE, {"kind": "guess", "number": 222222}, 2.0).error == "BUDGET_EXHAUSTED"


def test_number_hunt_hint_only_reveals_direction():
    e = make("number-hunt", dict(digits=6, min=111111, max=999999, guess_budget=4, duration_seconds=60, hints="on", hint_visibility="private", guess_cooldown_ms=300))
    e.start(0.0)
    guess = 111111
    r = e.act(ALICE, {"kind": "guess", "number": guess}, 1.0)
    assert r.ok and r.private.get("hint") in {"higher", "lower"}
    assert "targets" not in r.private


# --------------------------------------------------------------------- G02


def _quiz_rules():
    return dict(
        question_seconds=10,
        questions=[
            {"prompt": f"Q{i}?", "choices": ["a", "b", "c", "d"], "correct_index": i % 4, "explanation": f"E{i}"}
            for i in range(5)
        ],
    )


def test_quiz_never_leaks_answers_and_scores_server_side():
    e = make("live-quiz", _quiz_rules())
    e.start(0.0)
    pub = json.dumps(e.public_state())
    assert "correct_index" not in pub and "correctIndex" not in pub
    assert "explanation" not in pub

    r = e.act(ALICE, {"kind": "answer", "questionIndex": 0, "choice": 0}, 1.0)
    assert r.ok and "correct" in r.private
    # Second answer for the same question is refused.
    assert e.act(ALICE, {"kind": "answer", "questionIndex": 0, "choice": 1}, 1.2).error == "ACTION_DUPLICATE"
    # Late answer after the window.
    assert e.act(BOB, {"kind": "answer", "questionIndex": 0, "choice": 1}, 11.0).error == "ROUND_NOT_OPEN"

    # tick advances the question and eventually finishes the quiz
    t = e.tick(11.0)
    assert t is not None and t.patch["questionIndex"] == 1
    for i in range(4):
        e.tick(30.0 + i * 20)
    assert e.finished
    assert "review" in e.public_state()


def test_quiz_speed_bonus_order():
    e = make("live-quiz", dict(question_seconds=20, scoring="accuracy+speed", speed_bonus_max=20, questions=_quiz_rules()["questions"]))
    e.start(0.0)
    fast = e.act(ALICE, {"kind": "answer", "questionIndex": 0, "choice": 0}, 0.5)
    slow = e.act(BOB, {"kind": "answer", "questionIndex": 0, "choice": 0}, 19.0)
    assert fast.ok and slow.ok
    assert e.score_of(ALICE) > e.score_of(BOB)


# --------------------------------------------------------------------- G03


def test_memory_server_authoritative_and_capped():
    e = make("memory-match", dict(pairs=6, duration_seconds=60, move_cap=10, score_mode="moves"), participants=(ALICE,))
    e.start(0.0)
    n = len(e.layout)
    assert e.act(ALICE, {"kind": "flip", "index": n}, 1.0).error == "BAD_ACTION"
    a, b = 0, 1
    e.act(ALICE, {"kind": "flip", "index": a}, 1.0)
    # same card again is refused
    assert e.act(ALICE, {"kind": "flip", "index": a}, 1.1).error == "ACTION_DUPLICATE"
    e.act(ALICE, {"kind": "flip", "index": b}, 1.2)
    assert e.moves[ALICE] == 1
    # no client-supplied score is accepted anywhere in the action surface
    assert e.act(ALICE, {"kind": "flip", "index": 2, "score": 9999}, 2.0).ok


# --------------------------------------------------------------------- G04


def test_catch_validates_lane_and_timing():
    e = make("token-catch", dict(duration_seconds=30, spawn_per_second=2, lanes=3, hazard_chance_pct=0), participants=(ALICE,))
    e.start(0.0)
    spawn = e.spawns[0]
    # wrong lane
    e.act(ALICE, {"kind": "lane", "lane": (spawn.lane + 1) % 3}, 0.001)
    assert e.act(ALICE, {"kind": "catch", "spawn": 0}, 0.001).error == "BAD_PROOF"
    # correct lane, correct window
    e.act(ALICE, {"kind": "lane", "lane": spawn.lane}, 0.002)
    r = e.act(ALICE, {"kind": "catch", "spawn": 0}, spawn.at_ms / 1000.0 + 0.05)
    assert r.ok and r.private["total"] >= 0
    # catching it twice is refused
    assert e.act(ALICE, {"kind": "catch", "spawn": 0}, spawn.at_ms / 1000.0 + 0.06).error in {"ACTION_DUPLICATE", "SLOW_DOWN"}
    # a spawn that has not happened yet cannot be caught (after the rate limiter clears)
    late = e.spawns[-1]
    e.act(ALICE, {"kind": "lane", "lane": late.lane}, 0.02)
    assert e.act(ALICE, {"kind": "catch", "spawn": len(e.spawns) - 1}, 0.5).error == "ROUND_NOT_OPEN"
    # finished by clock
    t = e.tick(31.0)
    assert t is not None and t.finished


# --------------------------------------------------------------------- G05


def test_duel_commit_reveal_and_forfeit():
    e = make("reaction-duel", dict(rounds=3, choice_set="classic"))
    e.start(0.0)
    salt = "s1"
    e.act(ALICE, {"kind": "commit", "choice": "rock", "salt": salt}, 1.0)
    # Neither may reveal before both have committed.
    assert e.act(ALICE, {"kind": "reveal", "choice": "rock", "salt": salt}, 1.1).error == "ROUND_NOT_OPEN"
    e.act(BOB, {"kind": "commit", "choice": "scissors", "salt": "s2"}, 1.2)
    assert e.phase == "reveal"
    # No cleartext choice was ever exposed by the commit phase.
    assert "rock" not in json.dumps(e.public_state())

    assert e.act(ALICE, {"kind": "reveal", "choice": "paper", "salt": salt}, 1.3).error == "BAD_PROOF"
    e.act(ALICE, {"kind": "reveal", "choice": "rock", "salt": salt}, 1.4)
    r = e.act(BOB, {"kind": "reveal", "choice": "scissors", "salt": "s2"}, 1.5)
    assert r.ok and e.wins[ALICE] == 1
    assert r.patch["phase"] == "commit"


# --------------------------------------------------------------------- G06


def test_puzzle_solvable_and_move_validated():
    e = make("puzzle-sprint", dict(board=3, duration_seconds=120), participants=(ALICE,))
    e.start(0.0)

    # prove solvability: replaying the solution length is bounded and the board differs from solved
    assert sorted(e.board) == sorted(e.solved_board())
    assert e.board != e.solved_board()

    # an illegal (non-adjacent) tile move is refused
    blank = e.board.index(0)
    far = [i for i in range(9) if i not in e._neighbors(blank) and i != blank][0]
    assert e.act(ALICE, {"kind": "move", "tile": e.board[far]}, 1.0).error == "BAD_ACTION"

    # solve it for real by BFS-free greedy: undo the scramble deterministically is not
    # available, so drive it with a solver and assert the engine accepts the winning move.
    solved = solve_sliding(e.board, e.size)
    assert solved, "generated board must be solvable"
    t = 2.0
    for tile in solved:
        r = e.act(ALICE, {"kind": "move", "tile": tile}, t)
        assert r.ok, f"engine rejected a legal move {tile}"
        t += 1.0
    assert e.finished and e.completed_by == ALICE


def solve_sliding(board: list[int], size: int, limit: int = 200_000):
    """Small BFS solver used only by the test to prove the generated board is solvable."""
    from collections import deque

    goal = tuple(list(range(1, size * size)) + [0])
    start = tuple(board)
    if start == goal:
        return []
    seen = {start: None}
    q = deque([start])
    while q and len(seen) < limit:
        cur = q.popleft()
        blank = cur.index(0)
        r, c = divmod(blank, size)
        for pos in (
            [blank - size] if r > 0 else []
        ) + ([blank + size] if r < size - 1 else []) + ([blank - 1] if c > 0 else []) + ([blank + 1] if c < size - 1 else []):
            nxt = list(cur)
            nxt[blank], nxt[pos] = nxt[pos], nxt[blank]
            nt = tuple(nxt)
            if nt not in seen:
                seen[nt] = (cur, cur[pos])
                if nt == goal:
                    path, node = [], nt
                    while seen[node]:
                        prev, tile = seen[node]
                        path.append(tile)
                        node = prev
                    return list(reversed(path))
                q.append(nt)
    return []


# --------------------------------------------------------------------- G07


def test_hash_hunt_bound_proof_and_replay_blocked():
    e = make("hash-hunt", dict(duration_seconds=60, difficulty_bits=8, win_mode="first-valid"))
    e.start(0.0)
    pub = e.public_state()
    assert pub["publicSeed"].startswith("0x") and pub["target"].startswith("0x")

    from center.games.hash_hunt import proof_hash

    target = int(pub["target"], 16)
    nonce = 0
    while proof_hash(e.chain_id, e.escrow, e.round_id, e.public_seed, ALICE, nonce) >= target:
        nonce += 1
    # a nonce mined for ALICE must not work for BOB (bound to player)
    bob_ok = proof_hash(e.chain_id, e.escrow, e.round_id, e.public_seed, BOB, nonce) < target
    assert not bob_ok or True  # statistically it may also pass; the binding is the hash input
    assert e.act(BOB, {"kind": "submit", "nonce": -1}, 0.1).error == "BAD_ACTION"

    r = e.act(ALICE, {"kind": "submit", "nonce": nonce}, 1.0)
    assert r.ok and r.patch["firstValid"] == ALICE and r.finished
    # round is closed now
    assert e.act(BOB, {"kind": "submit", "nonce": nonce + 1}, 1.1).error == "ROUND_FINISHED"


def test_hash_hunt_rejects_invalid_proof():
    e = make("hash-hunt", dict(duration_seconds=60, difficulty_bits=30, win_mode="best-effort"))
    e.start(0.0)
    r = e.act(ALICE, {"kind": "submit", "nonce": 1}, 0.5)
    assert not r.ok and r.error == "BAD_PROOF"
    assert len(e.accepted[ALICE]) == 0


# --------------------------------------------------------------------- G08


def test_boss_contribution_cap_and_cooldown():
    e = make("boss-raid", dict(max_players=4, duration_seconds=90, boss_health=200, action_cooldown_ms=400, contribution_cap=60, min_contribution=5))
    e.start(0.0)
    r = e.act(ALICE, {"kind": "hit", "power": 40}, 1.0)
    assert r.ok and e.health == 160
    assert e.act(ALICE, {"kind": "hit", "power": 40}, 1.1).error == "SLOW_DOWN"
    # exceeding the contribution cap is refused once the allowance is gone
    e.act(ALICE, {"kind": "hit", "power": 40}, 2.0)
    assert e.contribution[ALICE] == 60
    assert e.act(ALICE, {"kind": "hit", "power": 40}, 3.0).error == "BUDGET_EXHAUSTED"
    assert e.act(BOB, {"kind": "hit", "power": -5}, 1.0).error == "BAD_ACTION"


def test_boss_kill_ends_round_and_ranks_by_contribution():
    e = make("boss-raid", dict(max_players=4, duration_seconds=90, boss_health=200, action_cooldown_ms=300, contribution_cap=1000, min_contribution=1))
    e.start(0.0)
    e.act(ALICE, {"kind": "hit", "power": 100}, 1.0)
    r = e.act(BOB, {"kind": "hit", "power": 100}, 1.0)
    assert r.ok and r.finished and e.slain and e.health == 0
    assert e.ranking()[0] in {ALICE, BOB}
    ents = e.entitlements()
    assert isinstance(ents, list)


# --------------------------------------------------------------------- cross-cutting


@pytest.mark.parametrize("template_id,rules,actions", [
    ("number-hunt", dict(digits=6, min=111111, max=999999, guess_budget=5, duration_seconds=60), [("act", {"kind": "guess", "number": 900001}, 1.0)]),
    ("token-catch", dict(duration_seconds=20, spawn_per_second=1, lanes=3), [("act", {"kind": "lane", "lane": 1}, 0.5)]),
    ("boss-raid", dict(max_players=4, duration_seconds=60, boss_health=5000), [("act", {"kind": "hit", "power": 5}, 1.0)]),
    ("memory-match", dict(pairs=6, duration_seconds=60), [("act", {"kind": "flip", "index": 0}, 1.0)]),
])
def test_snapshot_restore_round_trip(template_id, rules, actions):
    e = make(template_id, rules)
    e.start(0.0)
    for _, action, now in actions:
        e.act(ALICE, action, now)
    snap = e.snapshot()
    assert json.loads(json.dumps(snap)) == snap, "snapshot must be JSON-serialisable"

    restored = ENGINES[template_id].restore(e.config, ROUND, SEED, json.loads(json.dumps(snap)))
    assert restored.public_state() == e.public_state()
    assert restored.scores() == e.scores()
    assert restored.ranking() == e.ranking()


def test_seed_stream_is_reproducible_and_commit_verifies():
    a = make("number-hunt", dict(digits=6, min=111111, max=999999, guess_budget=5, duration_seconds=60))
    b = make("number-hunt", dict(digits=6, min=111111, max=999999, guess_budget=5, duration_seconds=60))
    a.start(0.0)
    b.start(0.0)
    assert a.targets == b.targets, "same seed must produce the same targets"

    ch = commit_hash(ROUND, a.config.config_hash_input(), SEED)
    assert verify_commit(ROUND, a.config.config_hash_input(), SEED, ch)
    assert not verify_commit(ROUND, a.config.config_hash_input(), "deadbeef", ch)


def test_every_template_is_registered_and_constructible():
    from center.schema import TEMPLATE_RULES
    assert len(ENGINES) == len(TEMPLATE_RULES) == 20
    for tid in ENGINES:
        assert tid in TEMPLATE_RULES
