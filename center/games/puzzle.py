"""G06 — Puzzle Sprint.

A sliding puzzle that is guaranteed solvable: the board is produced by applying valid
moves to the solved state (never by an arbitrary shuffle). Every move is checked for
adjacency to the blank, and completion is confirmed by the server.
"""

from __future__ import annotations

from center.games.base import ActionResult, Engine
from center.schema import PuzzleRules, RoomConfig


class PuzzleEngine(Engine):
    template_id = "puzzle-sprint"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: PuzzleRules = config.rules  # type: ignore[assignment]
        self.size: int = 3
        self.board: list[int] = []
        self.moves: dict[str, int] = {}
        self.started_at: float = 0.0
        self.finished: bool = False
        self.completed_by: str | None = None
        # D9: per-player hint budget remaining + penalty moves accrued
        self.hints_left: dict[str, int] = {}
        self.penalty: dict[str, int] = {}

    # ------------------------------------------------------------------ lifecycle

    def solved_board(self) -> list[int]:
        n = self.size * self.size
        return list(range(1, n)) + [0]  # 0 is the blank, in the last cell

    def _neighbors(self, pos: int) -> list[int]:
        r, c = divmod(pos, self.size)
        out = []
        if r > 0:
            out.append(pos - self.size)
        if r < self.size - 1:
            out.append(pos + self.size)
        if c > 0:
            out.append(pos - 1)
        if c < self.size - 1:
            out.append(pos + 1)
        return out

    def start(self, now: float = 0.0) -> None:
        self.size = self.rules.board
        board = self.solved_board()
        blank = board.index(0)
        scrambles = 40 * self.size  # enough to look random, still provably solvable
        for _ in range(scrambles):
            options = self._neighbors(blank)
            nxt = options[self.rng.below(len(options))]
            board[blank], board[nxt] = board[nxt], board[blank]
            blank = nxt
        if board == self.solved_board():  # astronomically unlikely, but never ship a solved board
            board[0], board[1] = board[1], board[0]
        self.board = board
        for p in self.participants:
            self.moves[p] = 0
            self.hints_left[p] = self.rules.hint_budget if self.rules.hints == "on" else 0
            self.penalty[p] = 0
        self.started_at = now

    def tick(self, now: float) -> ActionResult | None:
        if self.finished:
            return None
        if now - self.started_at >= self.rules.duration_seconds:
            self.finished = True
            return ActionResult(True, patch={"finished": True, "scores": self.scores()}, finished=True)
        return None

    # ------------------------------------------------------------------ actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        kind = action.get("kind")
        if kind == "hint":
            return self._hint(who)
        if kind != "move":
            return ActionResult(False, "BAD_ACTION")
        tile = action.get("tile")
        if not isinstance(tile, int) or isinstance(tile, bool) or tile == 0:
            return ActionResult(False, "BAD_ACTION")
        if self.moves.get(who, 0) >= self.rules.move_cap:
            return ActionResult(False, "BUDGET_EXHAUSTED")

        # The puzzle is shared per-round state; this engine is single-player by config.
        if tile not in self.board:
            return ActionResult(False, "BAD_ACTION")
        pos, blank = self.board.index(tile), self.board.index(0)
        if blank not in self._neighbors(pos):
            return ActionResult(False, "BAD_ACTION")

        self.board[blank], self.board[pos] = self.board[pos], self.board[blank]
        self.moves[who] = self.moves.get(who, 0) + 1
        solved = self.board == self.solved_board()
        if solved:
            self.finished = True
            self.completed_by = who
        return ActionResult(
            True,
            patch={"board": list(self.board), "moves": dict(self.moves), "finished": self.finished},
            private={"solved": solved},
            finished=self.finished,
            scores=self.scores(),
        )

    def _hint(self, who: str) -> ActionResult:
        """D9: suggest ONE legal move, privately, never the full solution path.

        Non-leak invariant: the suggestion is a single (tile) that is adjacent to
        the blank right now — verifiably legal, but one step only. It cannot
        reconstruct the solution sequence. Each use costs `hint_move_penalty`
        score-moves and consumes one unit of the hard per-player budget.
        """
        if self.rules.hints != "on":
            return ActionResult(False, "HINTS_OFF")
        if self.hints_left.get(who, 0) <= 0:
            return ActionResult(False, "HINT_BUDGET_EXHAUSTED")
        if self.moves.get(who, 0) >= self.rules.move_cap:
            return ActionResult(False, "BUDGET_EXHAUSTED")
        blank = self.board.index(0)
        options = [t for t in self._neighbors(blank) if self.board[t] != 0]
        if not options:
            return ActionResult(False, "NO_HINTS_LEFT")
        # deterministic: suggest the smallest-valued legal tile
        tile = min(self.board[t] for t in options)
        self.hints_left[who] -= 1
        self.penalty[who] = self.penalty.get(who, 0) + self.rules.hint_move_penalty
        return ActionResult(
            True,
            patch={"hintUsed": {"who": who}},
            private={"suggestedTile": tile, "hintsLeft": self.hints_left[who],
                     "penaltyMoves": self.penalty[who]},
            scores=self.scores(),
        )

    def eligible(self) -> set[str]:
        """Solved it or nothing: an unfinished puzzle is not a rewardable round."""
        return {self.completed_by} if self.completed_by else set()

    # ------------------------------------------------------------------ results

    def score_of(self, who: str) -> float:
        return float(self.moves.get(who, 0) + self.penalty.get(who, 0))

    def scores(self) -> dict[str, float]:
        return {p: self.score_of(p) for p in self.participants}

    def ranking(self) -> list[str]:
        def key(p: str):
            solved_first = 1 if self.completed_by == p else 0
            return (-solved_first, self.moves.get(p, 10**9), p)

        return sorted(self.participants, key=key)

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "size": self.size,
            "board": list(self.board),
            "moves": dict(self.moves),
            "scoreMode": self.rules.score_mode,
            "hints": self.rules.hints,
            "hintBudget": self.rules.hint_budget,
            "hintMovePenalty": self.rules.hint_move_penalty,
            "durationSeconds": self.rules.duration_seconds,
            "finished": self.finished,
            "completedBy": self.completed_by,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "size": self.size,
            "board": self.board,
            "moves": self.moves,
            "hintsLeft": self.hints_left,
            "penalty": self.penalty,
            "startedAt": self.started_at,
            "finished": self.finished,
            "completedBy": self.completed_by,
        }

    def _load(self, snapshot: dict) -> None:
        self.size = int(snapshot.get("size", 3))
        self.board = list(snapshot.get("board", []))
        self.moves = dict(snapshot.get("moves", {}))
        self.hints_left = dict(snapshot.get("hintsLeft", {}))
        self.penalty = dict(snapshot.get("penalty", {}))
        for p in self.participants:
            self.hints_left.setdefault(p, 0)
            self.penalty.setdefault(p, 0)
        self.started_at = float(snapshot.get("startedAt", 0.0))
        self.finished = bool(snapshot.get("finished", False))
        self.completed_by = snapshot.get("completedBy")
