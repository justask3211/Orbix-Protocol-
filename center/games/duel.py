"""Versioned trusted-server duel. V1 retains manual SHA-256 commit/reveal;
V2 seals the received choice privately and resolves at the fixed server deadline.
The server receives cleartext choices in both versions.
"""

from __future__ import annotations

import hashlib

from center.games.base import ActionResult, Engine
from center.schema import DuelRules, RoomConfig

CLASSIC = ["rock", "paper", "scissors"]
EXTENDED = ["rock", "paper", "scissors", "lizard", "spock"]

BEATS = {
    "rock": {"scissors", "lizard"},
    "paper": {"rock", "spock"},
    "scissors": {"paper", "lizard"},
    "lizard": {"spock", "paper"},
    "spock": {"scissors", "rock"},
}


def _commit(choice: str, salt: str) -> str:
    return hashlib.sha256(f"orbix-center/duel/v1|{choice}|{salt}".encode()).hexdigest()


class LegacyDuelEngine(Engine):
    template_id = "reaction-duel"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: DuelRules = config.rules  # type: ignore[assignment]
        self.players: list[str] = []
        self.commits: dict[str, dict[int, str]] = {}
        self.reveals: dict[str, dict[int, str]] = {}
        self.wins: dict[str, int] = {}
        self.round_index: int = 0
        self.phase: str = "commit"     # commit -> reveal -> done
        self.history: list[dict] = []
        self.finished: bool = False
        self.phase_started_at: float = 0

    # ------------------------------------------------------------------ lifecycle

    def start(self, now: float = 0.0) -> None:
        self.phase_started_at = now
        self.players = list(self.participants)[:2]
        for p in self.players:
            self.commits[p] = {}
            self.reveals[p] = {}
            self.wins[p] = 0
        self.round_index = 0
        self.phase = "commit"

    @property
    def choices(self) -> list[str]:
        return CLASSIC if self.rules.choice_set == "classic" else EXTENDED

    def _target_wins(self) -> int:
        return self.rules.rounds // 2 + 1

    def phase_deadline(self) -> float:
        return self.phase_started_at + (self.rules.choice_window_seconds if self.phase == "commit" else self.rules.reveal_window_seconds)

    def tick(self, now: float) -> ActionResult | None:
        if self.finished or now < self.phase_deadline():
            return None
        submitted = self.commits if self.phase == "commit" else self.reveals
        active = [p for p in self.players if self.round_index in submitted.get(p, {})]
        if len(active) == 1:
            self.wins[active[0]] += 1
        self.history.append({"round": self.round_index, "a": "", "b": "", "outcome": "timeout", "winner": active[0] if len(active) == 1 else None})
        self.finished = self.round_index + 1 >= self.rules.rounds or max(self.wins.values(), default=0) >= self._target_wins()
        if self.finished:
            self.phase = "done"
        else:
            self.round_index += 1
            self.phase = "commit"
        self.phase_started_at = now
        return ActionResult(True, patch=self.public_state(), finished=self.finished, scores=self.scores())

    # ------------------------------------------------------------------ actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if who not in self.players:
            return ActionResult(False, "NOT_ADMITTED")
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if now >= self.phase_deadline():
            return ActionResult(False, "ROUND_NOT_OPEN")
        kind = action.get("kind")

        if kind == "commit":
            if self.phase != "commit":
                return ActionResult(False, "ROUND_NOT_OPEN")
            if self.round_index in self.commits[who]:
                return ActionResult(False, "ACTION_DUPLICATE")
            choice, salt = action.get("choice"), action.get("salt")
            if choice not in self.choices or not isinstance(salt, str) or not salt:
                return ActionResult(False, "BAD_ACTION")
            self.commits[who][self.round_index] = _commit(choice, salt)
            both = all(self.round_index in self.commits[p] for p in self.players)
            if both:
                self.phase = "reveal"
                self.phase_started_at = now
            return ActionResult(True, patch={"phase": self.phase, "committed": {p: self.round_index in self.commits[p] for p in self.players}})

        if kind == "reveal":
            if self.phase != "reveal":
                return ActionResult(False, "ROUND_NOT_OPEN")
            if self.round_index in self.reveals[who]:
                return ActionResult(False, "ACTION_DUPLICATE")
            choice, salt = action.get("choice"), action.get("salt")
            if choice not in self.choices or not isinstance(salt, str):
                return ActionResult(False, "BAD_ACTION")
            if _commit(choice, salt) != self.commits[who].get(self.round_index):
                return ActionResult(False, "BAD_PROOF")

            self.reveals[who][self.round_index] = choice
            if any(self.round_index not in self.reveals[p] for p in self.players):
                return ActionResult(True, patch={"revealed": {p: self.round_index in self.reveals[p] for p in self.players}})

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

            reached = max(self.wins.values()) >= self._target_wins()
            last = self.round_index + 1 >= self.rules.rounds
            if reached or last:
                self.finished = True
                self.phase = "done"
            else:
                self.round_index += 1
                self.phase = "commit"
            self.phase_started_at = now
            return ActionResult(
                True,
                patch={"outcome": outcome, "wins": dict(self.wins), "roundIndex": self.round_index, "phase": self.phase, "finished": self.finished},
                finished=self.finished,
                scores=self.scores(),
            )

        return ActionResult(False, "BAD_ACTION")

    def eligible(self) -> set[str]:
        """Only a player who won a round is eligible; a drawn duel pays nobody."""
        high = max(self.wins.values(), default=0)
        winners = [p for p in self.players if self.wins.get(p, 0) == high]
        return set(winners) if high > 0 and len(winners) == 1 else set()

    # ------------------------------------------------------------------ results

    def scores(self) -> dict[str, float]:
        return {p: float(self.wins.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.wins.get(p, 0), p))

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "rounds": self.rules.rounds,
            "roundIndex": self.round_index,
            "phase": self.phase,
            "phaseStartedAt": self.phase_started_at,
            "phaseDeadline": self.phase_deadline(),
            "committed": {p: self.round_index in self.commits.get(p, {}) for p in self.players},
            "revealed": {p: self.round_index in self.reveals.get(p, {}) for p in self.players},
            "roundId": self.round_id,
            "choiceSet": self.rules.choice_set,
            "players": self.players,
            "wins": dict(self.wins),
            "history": list(self.history),
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "phaseStartedAt": self.phase_started_at,
            "players": self.players,
            "commits": {k: {str(a): b for a, b in v.items()} for k, v in self.commits.items()},
            "reveals": {k: {str(a): b for a, b in v.items()} for k, v in self.reveals.items()},
            "wins": self.wins,
            "roundIndex": self.round_index,
            "phase": self.phase,
            "history": self.history,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.phase_started_at = float(snapshot.get("phaseStartedAt", 0))
        self.players = list(snapshot.get("players", []))
        self.commits = {k: {int(a): b for a, b in v.items()} for k, v in snapshot.get("commits", {}).items()}
        self.reveals = {k: {int(a): b for a, b in v.items()} for k, v in snapshot.get("reveals", {}).items()}
        self.wins = dict(snapshot.get("wins", {}))
        self.round_index = int(snapshot.get("roundIndex", 0))
        self.phase = str(snapshot.get("phase", "commit"))
        self.history = list(snapshot.get("history", []))
        self.finished = bool(snapshot.get("finished", False))


from center.games.sealed_duel import SealedDuelEngine

class DuelEngine(SealedDuelEngine):
    template_id = "reaction-duel"

    def __new__(cls, config, *args, **kwargs):
        if config.template_version == 1:
            return LegacyDuelEngine(config, *args, **kwargs)
        return super().__new__(cls)
