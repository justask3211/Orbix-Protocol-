"""D9 — Puzzle Sprint legal-move hints: one legal step, budgeted, penalized.

Non-leak invariant: a hint suggests a single tile adjacent to the blank (verifiably
legal) and never a sequence that reconstructs the solution path. Hints cost budget
AND a score penalty, so hint-assisted play cannot beat pure play.
"""

import pytest

from center.games.puzzle import PuzzleEngine
from center.schema import Admission, PuzzleRules, RoomConfig, Rewards


def _config(hints: str, budget: int = 3, penalty: int = 2) -> RoomConfig:
    rules = PuzzleRules(duration_seconds=120, hints=hints, hint_budget=budget,
                        hint_move_penalty=penalty)
    return RoomConfig(name="Puzzle room", template_id="puzzle-sprint", rules=rules,
                      rewards=Rewards(), admission=Admission(player_cap=1, min_ready_to_start=1))


def _engine(hints: str = "on", budget: int = 3, penalty: int = 2) -> PuzzleEngine:
    eng = PuzzleEngine(_config(hints, budget, penalty), "r1", "seed-p", ["solo"])
    eng.start()
    return eng


def test_suggested_tile_is_legal_now():
    eng = _engine("on", 5)
    for _ in range(5):
        res = eng.act("solo", {"kind": "hint"}, now=1.0)
        assert res.ok, res.error
        tile = res.private["suggestedTile"]
        pos, blank = eng.board.index(tile), eng.board.index(0)
        assert blank in eng._neighbors(pos)  # the move is legal on the CURRENT board
        # execute the suggestion to prove it is playable
        mv = eng.act("solo", {"kind": "move", "tile": tile}, now=1.1)
        assert mv.ok


def test_hint_suggests_one_tile_not_a_path():
    eng = _engine("on", 5)
    res = eng.act("solo", {"kind": "hint"}, now=1.0)
    assert res.ok
    assert isinstance(res.private["suggestedTile"], int)
    assert set(res.private) <= {"suggestedTile", "hintsLeft", "penaltyMoves"}


def test_hints_off_rejects():
    eng = _engine("off")
    assert eng.act("solo", {"kind": "hint"}, now=1.0).error == "HINTS_OFF"


def test_budget_enforced():
    eng = _engine("on", 2)
    assert eng.act("solo", {"kind": "hint"}, now=1.0).ok
    assert eng.act("solo", {"kind": "hint"}, now=1.1).ok
    res = eng.act("solo", {"kind": "hint"}, now=1.2)
    assert not res.ok and res.error == "HINT_BUDGET_EXHAUSTED"


def test_penalty_inflates_score_beyond_raw_moves():
    eng = _engine("on", 3, penalty=2)
    eng.act("solo", {"kind": "move", "tile": eng.board[eng.board.index(0) - 1] if eng.board.index(0) > 0 else eng.board[1]}, now=1.0)
    raw_moves = eng.moves["solo"]
    before = eng.score_of("solo")
    eng.act("solo", {"kind": "hint"}, now=1.1)
    assert eng.score_of("solo") == before + 2  # penalty added, not raw moves
    assert eng.penalty["solo"] == 2


def test_hint_is_private():
    eng = _engine("on", 1)
    res = eng.act("solo", {"kind": "hint"}, now=1.0)
    assert res.ok
    assert "suggestedTile" in res.private and "suggestedTile" not in res.patch


def test_snapshot_roundtrip_keeps_budget_and_penalty():
    eng = _engine("on", 3, penalty=2)
    eng.act("solo", {"kind": "hint"}, now=1.0)
    restored = PuzzleEngine.restore(eng.config, "r1", "seed-p", eng.snapshot())
    assert restored.hints_left["solo"] == 2
    assert restored.penalty["solo"] == 2
    res = restored.act("solo", {"kind": "hint"}, now=1.1)
    assert res.ok and res.private["hintsLeft"] == 1


def test_registry_marks_puzzle_sprint_implemented():
    from center.games.hints import policy_for
    pol = policy_for("puzzle-sprint")
    assert pol.implemented is True
    kinds = {k.id for k in pol.kinds}
    assert "legal-move" in kinds
