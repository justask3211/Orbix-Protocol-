"""G09 — Rock-Paper-Scissors Duel.

Extended commit-reveal duel: the release-one Reaction Duel skeleton with a 5-move
dominance matrix, a configurable odd best-of, and an explicit forfeit when a
player commits but never reveals before the reveal deadline.

Integrity rules enforced here:
  * a cleartext choice is never accepted during the commit phase
  * a reveal must hash to that player's own commit for the same subround
  * a late or missing reveal forfeits the subround, it does not silently tie
"""

from __future__ import annotations

import hashlib

from center.games.base import ActionResult, Engine
from center.rules_late import RpsDuelRules
from center.schema import RoomConfig

CLASSIC = ["rock", "paper", "scissors"]
EXTENDED = ["rock", "paper", "scissors", "lizard", "spock"]

BEATS = {
    "rock": {"scissors", "lizard"},
    "paper": {"rock", "spock"},
    "scissors": {"paper", "lizard"},
    "lizard": {"spock", "paper"},
    "spock": {"scissors", "rock"},
}

DOMAIN = "orbix-center/rps-duel/v1"


def move_commit(choice: str, salt: str) -> str:
    return hashlib.sha256(f"{DOMAIN}|{choice}|{salt}".encode()).hexdigest()


class RpsDuelEngine(Engine):
    template_id = "rps-duel"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: RpsDuelRules = config.rules  # type: ignore[assignment]
        self.players: list[str] = []
        self.commits: dict[str, dict[int, str]] = {}
        self.reveals: dict[str, dict[int, str]] = {}
        self.wins: dict[str, int] = {}
        self.round_index: int = 0
        self.phase: str = "commit"
        self.phase_started: float = 0.0
        self.history: list[dict] = []
        self.finished: bool = False

    # ------------------------------------------------------------- lifecycle

    def start(self, now: float = 0.0) -> None:
        self.players = list(self.participants)[:2]
        for p in self.players:
            self.commits[p] = {}
            self.reveals[p] = {}
            self.wins[p] = 0
        self.round_index = 0
        self.phase = "commit"
        self.phase_started = now

    @property
    def choices(self) -> list[str]:
        return CLASSIC if self.rules.choice_set == "classic" else EXTENDED

    def _target(self) -> int:
        return self.rules.rounds // 2 + 1

    def _next_subround(self, now: float) -> None:
        reached = bool(self.wins) and max(self.wins.values()) >= self._target()
        if reached or self.round_index + 1 >= self.rules.rounds:
            self.finished = True
            self.phase = "done"
        else:
            self.round_index += 1
            self.phase = "commit"
            self.phase_started = now

    # --------------------------------------------------------------- actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if who not in self.players:
            return ActionResult(False, "NOT_ADMITTED")
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        kind = action.get("kind")

        if kind == "commit":
            if self.phase != "commit":
                return ActionResult(False, "ROUND_NOT_OPEN")
            if self.round_index in self.commits[who]:
                return ActionResult(False, "ACTION_DUPLICATE")
            choice, salt = action.get("choice"), action.get("salt")
            if choice not in self.choices or not isinstance(salt, str) or not salt:
                return ActionResult(False, "BAD_ACTION")
            self.commits[who][self.round_index] = move_commit(choice, salt)
            if all(self.round_index in self.commits[p] for p in self.players):
                self.phase = "reveal"
                self.phase_started = now
            return ActionResult(True, patch={"phase": self.phase})

        if kind == "reveal":
            if self.phase != "reveal":
                return ActionResult(False, "ROUND_NOT_OPEN")
            if self.round_index in self.reveals[who]:
                return ActionResult(False, "ACTION_DUPLICATE")
            choice, salt = action.get("choice"), action.get("salt")
            if choice not in self.choices or not isinstance(salt, str):
                return ActionResult(False, "BAD_ACTION")
            if move_commit(choice, salt) != self.commits[who].get(self.round_index):
                return ActionResult(False, "BAD_PROOF")
            self.reveals[who][self.round_index] = choice
            if any(self.round_index not in self.reveals[p] for p in self.players):
                return ActionResult(True, patch={"phase": self.phase})
            return self._resolve(now)

        return ActionResult(False, "BAD_ACTION")

    def _resolve(self, now: float) -> ActionResult:
        a, b = self.players[0], self.players[1]
        ca, cb = self.reveals[a][self.round_index], self.reveals[b][self.round_index]
        if ca == cb:
            outcome = f"tie:{ca}:{cb}"
        elif cb in BEATS[ca]:
            self.wins[a] += 1
            outcome = f"{a}:{ca}:{cb}"
        else:
            self.wins[b] += 1
            outcome = f"{b}:{ca}:{cb}"
        self.history.append({"round": self.round_index, "a": ca, "b": cb, "outcome": outcome})
        self._next_subround(now)
        return ActionResult(True, patch={"outcome": outcome, "wins": dict(self.wins), "phase": self.phase},
                            finished=self.finished, scores=self.scores())

    def tick(self, now: float) -> ActionResult | None:
        if self.finished or self.phase not in ("commit", "reveal"):
            return None
        window = self.rules.reveal_window_seconds if self.phase == "reveal" else self.rules.choice_window_seconds
        if now <= self.phase_started + window:
            return None
        if self.phase == "reveal":
            revealed = [p for p in self.players if self.round_index in self.reveals[p]]
            if len(revealed) == 1:  # a lone reveal takes the subround by forfeit
                self.wins[revealed[0]] += 1
                self.history.append({"round": self.round_index, "outcome": f"forfeit:{revealed[0]}"})
            else:
                self.history.append({"round": self.round_index, "outcome": "no-reveal"})
        # Nothing revealed in the commit window: the subround is simply void.
        self._next_subround(now)
        return ActionResult(True, patch={"wins": dict(self.wins), "phase": self.phase},
                            finished=self.finished, scores=self.scores())

    # --------------------------------------------------------------- results

    def scores(self) -> dict[str, float]:
        return {p: float(self.wins.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.wins.get(p, 0), p))

    def eligible(self) -> set[str]:
        """A duel with no subround won pays nobody."""
        return {p for p in self.participants if self.wins.get(p, 0) > 0}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "rounds": self.rules.rounds,
            "roundIndex": self.round_index,
            "phase": self.phase,
            "choiceSet": self.rules.choice_set,
            "moves": self.choices,
            "players": self.players,
            "wins": dict(self.wins),
            "commitsIn": {p: (self.round_index in self.commits.get(p, {})) for p in self.players},
            "revealsIn": {p: (self.round_index in self.reveals.get(p, {})) for p in self.players},
            "history": list(self.history),
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "players": self.players,
            "commits": {k: {str(a): b for a, b in v.items()} for k, v in self.commits.items()},
            "reveals": {k: {str(a): b for a, b in v.items()} for k, v in self.reveals.items()},
            "wins": self.wins,
            "roundIndex": self.round_index,
            "phase": self.phase,
            "phaseStarted": self.phase_started,
            "history": self.history,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.players = list(snapshot.get("players", []))
        self.commits = {k: {int(a): b for a, b in v.items()} for k, v in snapshot.get("commits", {}).items()}
        self.reveals = {k: {int(a): b for a, b in v.items()} for k, v in snapshot.get("reveals", {}).items()}
        self.wins = dict(snapshot.get("wins", {}))
        self.round_index = int(snapshot.get("roundIndex", 0))
        self.phase = str(snapshot.get("phase", "commit"))
        self.phase_started = float(snapshot.get("phaseStarted", 0.0))
        self.history = list(snapshot.get("history", []))
        self.finished = bool(snapshot.get("finished", False))
