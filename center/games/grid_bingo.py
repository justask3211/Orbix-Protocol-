"""G10 — Six-Digit Reward Grid + G11 — Token-Logo Bingo.

G10: a grid of tiles; up to N prefunded reward slots are hidden behind tiles by a
server-side draw bound to the round seed. Each reveal is authorised, bound to the
wallet+round, capped per wallet, and cannot be replayed or enumerated client-side.

G11: a shared draw stream issues logo calls at a fixed cadence; win claims are
verified server-side against the player's board and the calls actually issued.
"""

from __future__ import annotations

from center.games.base import ActionResult, Engine
from center.rules_late import BingoRules, RewardGridRules
from center.schema import RoomConfig


class RewardGridEngine(Engine):
    template_id = "reward-grid"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: RewardGridRules = config.rules  # type: ignore[assignment]
        self.reward_tiles: set[int] = set()
        self.revealed: dict[str, set[int]] = {}
        self.won: dict[str, int] = {}
        self.slots_left: int = 0
        self.finished: bool = False

    def start(self, now: float = 0.0) -> None:
        """Place the reward tiles behind random tiles; never sent to any client."""
        self.reward_tiles = set()
        while len(self.reward_tiles) < self.rules.reward_slots:
            self.reward_tiles.add(self.rng.below(self.rules.tiles))
        self.slots_left = self.rules.reward_slots
        self.revealed = {p: set() for p in self.participants}
        self.won = {}

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "reveal":
            return ActionResult(False, "BAD_ACTION")
        tile = action.get("tile")
        if not isinstance(tile, int) or not (0 <= tile < self.rules.tiles):
            return ActionResult(False, "BAD_TILE")
        mine = self.revealed.setdefault(who, set())
        if tile in mine:
            return ActionResult(False, "ACTION_DUPLICATE")
        if len(mine) >= self.rules.reveal_cap_per_wallet:
            return ActionResult(False, "REVEAL_CAP")
        mine.add(tile)
        if tile in self.reward_tiles and self.slots_left > 0:
            self.slots_left -= 1
            self.won[who] = self.won.get(who, 0) + 1
        if self.slots_left == 0 or all(
            len(v) >= self.rules.reveal_cap_per_wallet for v in self.revealed.values()
        ):
            self.finished = True
        return ActionResult(True, finished=self.finished, scores=self.scores())

    def scores(self) -> dict[str, float]:
        return {p: float(self.won.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.won.get(p, 0), p))

    def eligible(self) -> set[str]:
        """No reward tile found, no slot: a grid round nobody hit pays nobody."""
        return {p for p in self.participants if self.won.get(p, 0) > 0}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "tiles": self.rules.tiles,
            "rewardSlots": self.rules.reward_slots,
            "slotsLeft": self.slots_left,
            "revealCap": self.rules.reveal_cap_per_wallet,
            "revealed": {p: sorted(v) for p, v in self.revealed.items()},
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "rewardTiles": sorted(self.reward_tiles),
            "revealed": {k: sorted(v) for k, v in self.revealed.items()},
            "won": self.won,
            "slotsLeft": self.slots_left,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.reward_tiles = set(snapshot.get("rewardTiles", []))
        self.revealed = {k: set(v) for k, v in snapshot.get("revealed", {}).items()}
        self.won = dict(snapshot.get("won", {}))
        self.slots_left = int(snapshot.get("slotsLeft", self.rules.reward_slots))
        self.finished = bool(snapshot.get("finished", False))


LINE_CHECKS = {
    3: [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)],
    4: [
        (0, 1, 2, 3), (4, 5, 6, 7), (8, 9, 10, 11), (12, 13, 14, 15),
        (0, 4, 8, 12), (1, 5, 9, 13), (2, 6, 10, 14), (3, 7, 11, 15),
        (0, 5, 10, 15), (3, 6, 9, 12),
    ],
}


class LogoBingoEngine(Engine):
    template_id = "logo-bingo"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: BingoRules = config.rules  # type: ignore[assignment]
        size = self.rules.board * self.rules.board
        self.pool: list[int] = []
        self.calls: list[int] = []
        self.claimed: dict[str, bool] = {}
        self.finished: bool = False
        self._next_call_at: float = 0.0
        self._pool_size = size * 2  # calls drawn from a pool twice the board size

    def start(self, now: float = 0.0) -> None:
        self.pool = self.rng.shuffled(list(range(self._pool_size)))
        self.calls = []
        self.claimed = {}
        self.finished = False
        self._next_call_at = now

    def tick(self, now: float) -> ActionResult | None:
        if self.finished:
            return None
        if now >= self._next_call_at and len(self.calls) < len(self.pool):
            self.calls.append(self.pool[len(self.calls)])
            self._next_call_at = now + self.rules.call_cadence_seconds
            # patch must not carry "calls" (public_state()["calls"] is the array of called
            # numbers): a count here would overwrite the array client-side and crash the stage.
            return ActionResult(True, patch={"call": self.calls[-1], "callsCount": len(self.calls)})
        if len(self.calls) >= len(self.pool):
            self.finished = True
            return ActionResult(True, finished=True, scores=self.scores())
        return None

    def _marks(self, who: str) -> set[int]:
        marks = set(self.calls)
        if self.rules.free_centre and self.rules.board == 3:
            marks.add(4)  # the free centre square
        return marks

    def _has_line(self, who: str) -> bool:
        marks = self._marks(who)
        return any(set(line) <= marks for line in LINE_CHECKS[self.rules.board])

    def _full_board(self, who: str) -> bool:
        marks = self._marks(who)
        return all(cell in marks for cell in (range(self.rules.board * self.rules.board)))

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "claim":
            return ActionResult(False, "BAD_ACTION")
        if self.claimed.get(who):
            return ActionResult(False, "ACTION_DUPLICATE")
        win = self._full_board(who) if self.rules.win_mode == "full-board" else self._has_line(who)
        if not win:
            return ActionResult(False, "NOT_A_WIN")  # a forged board claim is just refused
        self.claimed[who] = True
        self.finished = True
        return ActionResult(True, finished=True, scores=self.scores())

    def scores(self) -> dict[str, float]:
        return {p: (1.0 if self.claimed.get(p) else 0.0) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (not self.claimed.get(p, False), p))

    def eligible(self) -> set[str]:
        return {p for p in self.participants if self.claimed.get(p)}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "board": self.rules.board,
            "winMode": self.rules.win_mode,
            "calls": list(self.calls),
            "freeCentre": self.rules.free_centre,
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "pool": self.pool,
            "calls": self.calls,
            "claimed": self.claimed,
            "finished": self.finished,
            "nextCallAt": self._next_call_at,
        }

    def _load(self, snapshot: dict) -> None:
        self.pool = list(snapshot.get("pool", []))
        self.calls = list(snapshot.get("calls", []))
        self.claimed = dict(snapshot.get("claimed", {}))
        self.finished = bool(snapshot.get("finished", False))
        self._next_call_at = float(snapshot.get("nextCallAt", 0.0))
