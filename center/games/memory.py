"""G03 — Memory Match.

The card layout is a server secret: the client is told only which indices exist and which
have been revealed. Every flip is validated against the layout, and the score is computed
server-side (never submitted by the client).
"""

from __future__ import annotations

from center.games.base import ActionResult, Engine
from center.schema import MemoryRules, RoomConfig

ICONS = [
    "flame", "gem", "bolt", "orbit", "coin", "key", "shield", "rocket", "star",
    "crown", "leaf", "wave", "cube", "ring", "spark", "moon", "sun", "comet",
]


class MemoryEngine(Engine):
    template_id = "memory-match"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: MemoryRules = config.rules  # type: ignore[assignment]
        self.layout: list[int] = []        # card index -> icon id (secret)
        self.matched: set[int] = set()
        self.open_cards: list[int] = []    # currently face-up, unresolved
        self.moves: dict[str, int] = {}
        self.mismatches: dict[str, int] = {}
        self.started_at: float = 0.0
        self.finished: bool = False

    # ------------------------------------------------------------------ lifecycle

    def start(self, now: float = 0.0) -> None:
        icons = [i % len(ICONS) for i in range(self.rules.pairs)]
        deck = icons + icons
        self.layout = self.rng.shuffled(deck)
        for p in self.participants:
            self.moves[p] = 0
            self.mismatches[p] = 0
        self.started_at = now

    # ------------------------------------------------------------------ actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "flip":
            return ActionResult(False, "BAD_ACTION")
        if self.moves.get(who, 0) >= self.rules.move_cap:
            return ActionResult(False, "BUDGET_EXHAUSTED")
        idx = action.get("index")
        if not isinstance(idx, int) or isinstance(idx, bool) or not (0 <= idx < len(self.layout)):
            return ActionResult(False, "BAD_ACTION")
        if idx in self.matched or idx in self.open_cards:
            return ActionResult(False, "ACTION_DUPLICATE")

        self.open_cards.append(idx)
        resolution = None
        if len(self.open_cards) == 2:
            a, b = self.open_cards
            self.moves[who] = self.moves.get(who, 0) + 1
            if self.layout[a] == self.layout[b]:
                self.matched.update(self.open_cards)
                resolution = "match"
            else:
                self.mismatches[who] = self.mismatches.get(who, 0) + 1
                resolution = "mismatch"
            self.open_cards = []
            if len(self.matched) == len(self.layout):
                self.finished = True

        patch = {
            "flipped": {"index": idx, "icon": ICONS[self.layout[idx]]},
            "resolution": resolution,
            "matchedCount": len(self.matched) // 2,
            "finished": self.finished,
        }
        return ActionResult(
            True,
            patch=patch,
            private={"moves": self.moves[who], "movesLeft": self.rules.move_cap - self.moves[who]},
            finished=self.finished,
            scores=self.scores(),
        )

    # ------------------------------------------------------------------ scoring

    def score_of(self, who: str) -> float:
        if self.rules.score_mode == "moves":
            return float(self.moves.get(who, 0))
        return float(self.mismatches.get(who, 0))

    def elapsed(self, now: float) -> float:
        return max(0.0, now - self.started_at)

    def scores(self) -> dict[str, float]:
        return {p: self.score_of(p) for p in self.participants}

    def ranking(self) -> list[str]:
        # Fewer moves / fewer mismatches wins; a completed board outranks an unfinished one.
        def key(p: str):
            complete = 1 if len(self.matched) == len(self.layout) else 0
            return (-complete, self.score_of(p), p)

        return sorted(self.participants, key=key)

    # ------------------------------------------------------------------ state

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "cards": len(self.layout) if self.finished else None,
            "pairs": self.rules.pairs,
            "moveCap": self.rules.move_cap,
            "scoreMode": self.rules.score_mode,
            "matched": sorted(self.matched),
            "moves": dict(self.moves),
            "mismatches": dict(self.mismatches),
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "layout": self.layout,
            "matched": sorted(self.matched),
            "openCards": self.open_cards,
            "moves": self.moves,
            "mismatches": self.mismatches,
            "startedAt": self.started_at,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.layout = list(snapshot.get("layout", []))
        self.matched = set(snapshot.get("matched", []))
        self.open_cards = list(snapshot.get("openCards", []))
        self.moves = dict(snapshot.get("moves", {}))
        self.mismatches = dict(snapshot.get("mismatches", {}))
        self.started_at = float(snapshot.get("startedAt", 0.0))
        self.finished = bool(snapshot.get("finished", False))
