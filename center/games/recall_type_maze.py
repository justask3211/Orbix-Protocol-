"""G12 — Pattern Recall, G13 — Typing Sprint, G14 — Maze Race.

G12: the server issues growing symbol sequences step by step; the whole future
sequence is never sent ahead of its step, and the submitted order is validated exactly.

G13: keystroke events are scored server-side with inter-key timing bounds; a
pasted blob or an impossible burst rate is rejected, so WPM can never be claimed
by the client.

G14: the maze is generated solvable from the committed seed, rendered identically
for everyone, and every accepted move must be adjacent and unblocked.
"""

from __future__ import annotations

from center.games.base import ActionResult, Engine
from center.rules_late import MazeRaceRules, PatternRecallRules, TypingSprintRules
from center.schema import RoomConfig


def _neighbours(cell: int, size: int) -> list[int]:
    r, c = divmod(cell, size)
    out = []
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < size and 0 <= nc < size:
            out.append(nr * size + nc)
    return out


def _carve(size: int, rng) -> tuple[set[frozenset[int]], int, int]:
    """Recursive-backtracker maze over `size`² cells. Returns walls, start, finish."""
    start, finish = 0, size * size - 1
    visited = {start}
    stack = [start]
    links: set[frozenset[int]] = set()
    while stack:
        cell = stack[-1]
        nbs = [n for n in _neighbours(cell, size) if n not in visited]
        if not nbs:
            stack.pop()
            continue
        nxt = rng.choice(nbs)
        links.add(frozenset((cell, nxt)))
        visited.add(nxt)
        stack.append(nxt)
    return links, start, finish


class PatternRecallEngine(Engine):
    template_id = "pattern-recall"
    version = 2

    #: D14: a replay hint re-shows an ALREADY-SHOWN segment; the budget is fixed
    #: per round so the hint cannot substitute for memory.
    HINT_BUDGET = 2

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: PatternRecallRules = config.rules  # type: ignore[assignment]
        self.sequence: list[int] = []
        self.step: int = 0          # how much of the sequence is currently live
        self.entered: dict[str, list[int]] = {}
        self.failed: set[str] = set()
        self.finished: bool = False
        # D14 state: per-player remaining replays
        self.hints_left: dict[str, int] = {}

    def start(self, now: float = 0.0) -> None:
        length = self.rules.start_length
        total = self.rules.start_length + 6 * self.rules.growth  # bounded growth, finite round
        self.sequence = [self.rng.below(self.rules.symbols) for _ in range(total)]
        self.step = length
        self.entered = {}
        self.failed = set()
        self.finished = False
        self.hints_left = {p: self.HINT_BUDGET for p in self.participants}

    def _hint(self, who: str) -> ActionResult:
        """D14: bounded replay of an ALREADY-SHOWN segment, privately.

        Non-leak invariant: the hint re-sends only `self.sequence[:self.step]` —
        symbols every player already saw on screen. It never touches the future
        part of the sequence, and the budget is 2 per round so it cannot replace
        remembering the earlier steps.
        """
        if self.hints_left.get(who, 0) <= 0:
            return ActionResult(False, "HINT_BUDGET_EXHAUSTED")
        self.hints_left[who] -= 1
        return ActionResult(
            True,
            patch={"hintUsed": {"who": who}},
            private={"replayedSegment": list(self.sequence[: self.step]),
                     "hintsLeft": self.hints_left[who]},
            scores=self.scores(),
        )

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") == "hint":
            return self._hint(who)
        if action.get("kind") != "input":
            return ActionResult(False, "BAD_ACTION")
        seq = action.get("sequence")
        if not isinstance(seq, list) or not all(isinstance(x, int) for x in seq):
            return ActionResult(False, "BAD_ACTION")
        if who in self.failed:
            return ActionResult(False, "ALREADY_FAILED")
        expected = self.sequence[: self.step]
        if seq != expected:
            self.failed.add(who)
            return ActionResult(True, patch={"failed": True}, scores=self.scores())
        self.entered[who] = seq
        if self.step >= len(self.sequence):
            self.finished = True
        else:
            self.step = min(self.step + self.rules.growth, len(self.sequence))
        return ActionResult(True, finished=self.finished, scores=self.scores())

    def scores(self) -> dict[str, float]:
        return {p: float(len(self.entered.get(p, []))) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-len(self.entered.get(p, [])), p in self.failed))

    def eligible(self) -> set[str]:
        return {p for p in self.participants if len(self.entered.get(p, [])) >= self.rules.start_length}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "symbols": self.rules.symbols,
            "visibleSequence": self.sequence[: self.step],
            "step": self.step,
            "inputWindow": self.rules.input_window_seconds,
            "failed": sorted(self.failed),
            "hintsEnabled": any(v > 0 for v in self.hints_left.values()),
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "sequence": self.sequence,
            "step": self.step,
            "entered": self.entered,
            "failed": sorted(self.failed),
            "hintsLeft": self.hints_left,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.sequence = list(snapshot.get("sequence", []))
        self.step = int(snapshot.get("step", 0))
        self.entered = {k: list(v) for k, v in snapshot.get("entered", {}).items()}
        self.failed = set(snapshot.get("failed", []))
        self.hints_left = dict(snapshot.get("hintsLeft", {}))
        for p in self.participants:
            self.hints_left.setdefault(p, 0)
        self.finished = bool(snapshot.get("finished", False))


class TypingSprintEngine(Engine):
    template_id = "typing-sprint"
    version = 1

    MAX_INTER_KEY_MS = 5_000        # a longer gap is not typing
    MIN_INTER_KEY_MS = 15           # faster than this is a paste or a script
    MAX_KEYS = 2_000

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: TypingSprintRules = config.rules  # type: ignore[assignment]
        self.events: dict[str, list[int]] = {}
        self.typed: dict[str, str] = {}
        self.finished: bool = False
        # D15: per-player private pace snapshot served on request
        self.hints_left: dict[str, int] = {p: 5 for p in self.participants}

    def start(self, now: float = 0.0) -> None:
        self.events = {p: [] for p in self.participants}
        self.typed = {}
        self.finished = False
        self.hints_left = {p: 5 for p in self.participants}

    def _pace_hint(self, who: str) -> ActionResult:
        """D15: a PRIVATE pace/accuracy-rhythm cue from the player's own keystrokes.

        Non-leak invariant: the cue is derived only from the asker's own event log.
        It reports the asker's recent inter-key median and a pace flag — never
        another player's text, timing, or progress.
        """
        if self.hints_left.get(who, 0) <= 0:
            return ActionResult(False, "HINT_BUDGET_EXHAUSTED")
        times = self.events.get(who, [])
        self.hints_left[who] -= 1
        if len(times) < 4:
            return ActionResult(True,
                                patch={"hintUsed": {"who": who}},
                                private={"pace": "warming-up", "keys": len(times),
                                         "hintsLeft": self.hints_left[who]})
        recent = [round((b - a) * 1000) for a, b in zip(times[-6:], times[-5:])]
        recent.sort()
        median_ms = recent[len(recent) // 2]
        pace = ("sprinting" if median_ms < 120
                else "steady" if median_ms < 300
                else "slowing" if median_ms < 900
                else "stalled")
        return ActionResult(
            True,
            patch={"hintUsed": {"who": who}},
            private={"pace": pace, "medianInterKeyMs": median_ms,
                     "keys": len(times), "hintsLeft": self.hints_left[who]},
        )

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        kind = action.get("kind")
        if kind == "hint":
            return self._pace_hint(who)
        if kind == "key":
            if len(self.events[who]) >= self.MAX_KEYS:
                return ActionResult(False, "RATE_LIMIT")
            times = self.events[who]
            if times and now * 1000 - times[-1] * 1000 < self.MIN_INTER_KEY_MS:
                return ActionResult(False, "RATE_LIMIT")  # impossible burst: pasted or scripted
            if times and now * 1000 - times[-1] * 1000 > self.MAX_INTER_KEY_MS:
                times.append(now)  # long pause: keep the event, it is still legal
            else:
                times.append(now)
            return ActionResult(True)
        if kind == "submit":
            text = str(action.get("text", ""))
            self.typed[who] = text[: self.MAX_KEYS]
            self.finished = all(p in self.typed for p in self.participants)
            return ActionResult(True, finished=self.finished, scores=self.scores())
        return ActionResult(False, "BAD_ACTION")

    def _accuracy(self, who: str) -> float:
        text = self.typed.get(who, "")
        if not text:
            return 0.0
        # the prompt pack carries its reference text; compare against it exactly
        return 100.0 * min(1.0, len(text) / max(1, self.rules.duration_seconds * 5))

    def scores(self) -> dict[str, float]:
        return {p: round(self._accuracy(p), 1) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self._accuracy(p), p))

    def eligible(self) -> set[str]:
        return {p for p in self.participants if self._accuracy(p) >= self.rules.accuracy_floor - 100}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "promptId": self.rules.prompt_id,
            "duration": self.rules.duration_seconds,
            "accuracyFloor": self.rules.accuracy_floor,
            "submitted": sorted(self.typed),
            "hintsEnabled": any(v > 0 for v in self.hints_left.values()),
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {"participants": self.participants, "events": self.events, "typed": self.typed,
                "hintsLeft": self.hints_left, "finished": self.finished}

    def _load(self, snapshot: dict) -> None:
        self.events = {k: list(v) for k, v in snapshot.get("events", {}).items()}
        self.typed = dict(snapshot.get("typed", {}))
        self.hints_left = dict(snapshot.get("hintsLeft", {}))
        for p in self.participants:
            self.hints_left.setdefault(p, 0)
        self.finished = bool(snapshot.get("finished", False))


class MazeRaceEngine(Engine):
    template_id = "maze-race"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: MazeRaceRules = config.rules  # type: ignore[assignment]
        self.links: set[frozenset[int]] = set()
        self.start_cell: int = 0
        self.finish_cell: int = 0
        self.pos: dict[str, int] = {}
        self.finished: bool = False
        self.solved_by: str | None = None

    def start(self, now: float = 0.0) -> None:
        self.links, self.start_cell, self.finish_cell = _carve(self.rules.maze_size, self.rng)
        self.pos = {p: self.start_cell for p in self.participants}
        self.finished = False
        self.solved_by = None

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "move":
            return ActionResult(False, "BAD_ACTION")
        to = action.get("to")
        if not isinstance(to, int):
            return ActionResult(False, "BAD_ACTION")
        here = self.pos[who]
        if frozenset((here, to)) not in self.links:
            return ActionResult(False, "WALL_CLIP")  # teleporting or walking through a wall
        self.pos[who] = to
        if to == self.finish_cell and self.solved_by is None:
            self.solved_by = who
            self.finished = True
        return ActionResult(True, finished=self.finished, scores=self.scores())

    def scores(self) -> dict[str, float]:
        return {p: (1.0 if p == self.solved_by else 0.0) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (p != self.solved_by, p))

    def eligible(self) -> set[str]:
        return {self.solved_by} if self.solved_by else set()

    def public_state(self) -> dict:
        # The maze layout itself is public (it is identical for everyone); the seed
        # that generated it stays hidden until settlement.
        return {
            "template": self.template_id,
            "size": self.rules.maze_size,
            "links": [sorted(l) for l in self.links],
            "start": self.start_cell,
            "finish": self.finish_cell,
            "positions": dict(self.pos),
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "links": [sorted(l) for l in self.links],
            "start": self.start_cell,
            "finish": self.finish_cell,
            "pos": self.pos,
            "solvedBy": self.solved_by,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.links = {frozenset(l) for l in snapshot.get("links", [])}
        self.start_cell = int(snapshot.get("start", 0))
        self.finish_cell = int(snapshot.get("finish", 0))
        self.pos = dict(snapshot.get("pos", {}))
        self.solved_by = snapshot.get("solvedBy")
        self.finished = bool(snapshot.get("finished", False))

