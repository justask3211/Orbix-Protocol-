"""G01 — Number Hunt.

Server-authoritative. The target set is drawn once from the committed seed and never
leaves the server until the round is over. Clients cannot send a score, only a guess.

Handles the requested 4-digit mode: range 1111-9999. Digit width is enforced here too,
so an over-long or non-numeric guess is rejected even if a client somehow sends one.
"""

from __future__ import annotations

from center.games.base import ActionResult, Engine
from center.schema import NumberHuntRules, RoomConfig


class NumberHuntEngine(Engine):
    template_id = "number-hunt"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: NumberHuntRules = config.rules  # type: ignore[assignment]
        self.targets: list[int] = []
        self.claimed: dict[int, str] = {}
        self.budget: dict[str, int] = {}
        self.guesses: dict[str, list[int]] = {}
        self.last_guess_at: dict[str, float] = {}
        self.log: list[dict] = []
        self.guess_log: list[dict] = []  # public guess log (who, number, hit)
        self.order: list[str] = []

    # ------------------------------------------------------------------ lifecycle

    def start(self, now: float = 0.0) -> None:
        span = self.rules.max - self.rules.min + 1
        picked: set[int] = set()
        while len(picked) < self.rules.target_count:
            picked.add(self.rng.between(self.rules.min, self.rules.max))
        self.targets = sorted(picked)
        for p in self.participants:
            self.budget[p] = self.rules.guess_budget
            self.guesses[p] = []
            self.last_guess_at[p] = -1e9  # first guess is never rate-limited

    # ------------------------------------------------------------------ actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "guess":
            return ActionResult(False, "BAD_ACTION")
        if self.budget.get(who, 0) <= 0:
            return ActionResult(False, "BUDGET_EXHAUSTED")

        raw = action.get("number")
        # Reject anything that is not a plain integer of the configured width.
        if isinstance(raw, bool) or not isinstance(raw, int):
            return ActionResult(False, "BAD_NUMBER")
        text = str(raw)
        if len(text) != self.rules.digits:
            return ActionResult(False, "BAD_DIGITS")
        if not (self.rules.min <= raw <= self.rules.max):
            return ActionResult(False, "OUT_OF_RANGE")

        cooldown = self.rules.guess_cooldown_ms / 1000.0
        if now - self.last_guess_at.get(who, 0.0) < cooldown:
            return ActionResult(False, "SLOW_DOWN")
        self.last_guess_at[who] = now

        if raw in self.guesses[who]:
            # A duplicate guess still costs nothing extra and is reported honestly.
            return ActionResult(False, "DUPLICATE_GUESS")

        self.budget[who] -= 1
        self.guesses[who].append(raw)
        hit = raw in self.targets and raw not in self.claimed

        patch: dict = {"lastGuess": {"who": who, "number": raw, "hit": hit}}
        private: dict = {"remaining": self.budget[who]}

        if hit:
            self.claimed[raw] = who
            self.order.append(who)
            patch["claimedTargets"] = len(self.claimed)
            if self.rules.win_mode == "first-hit" or len(self.claimed) == len(self.targets):
                self.finished = True
                patch["targets"] = list(self.targets)
        elif self.rules.hints == "on":
            nearest = min(self.targets, key=lambda t: abs(t - raw))
            direction = "higher" if nearest > raw else "lower"
            if self.rules.hint_visibility == "public":
                patch["lastGuess"]["hint"] = {"who": who, "number": raw, "direction": direction}
            else:
                private["hint"] = direction

        self.log.append({"who": who, "number": raw, "hit": hit, "at": round(now, 3)})
        self.guess_log.append({"who": who, "number": raw, "hit": hit})
        return ActionResult(
            True,
            patch=patch,
            private=private,
            finished=self.finished,
            scores=self.scores(),
        )

    def eligible(self) -> set[str]:
        """Only a player who actually found a target earns a slot."""
        return set(self.claimed.values())

    # ------------------------------------------------------------------ results

    def scores(self) -> dict[str, float]:
        # Winners first; ties broken by fewest guesses spent.
        return {p: float(self.budget.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        winners = [p for p in self.order]
        losers = sorted(
            (p for p in self.participants if p not in winners),
            key=lambda p: (-self.budget.get(p, 0), self.guesses.get(p, [9999])[0] if self.guesses.get(p) else 9999),
        )
        return winners + losers

    # ------------------------------------------------------------------ state

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "digits": self.rules.digits,
            "min": self.rules.min,
            "max": self.rules.max,
            "hints": self.rules.hints,
            "hintVisibility": self.rules.hint_visibility,
            "guessBudget": self.rules.guess_budget,
            "targetCount": self.rules.target_count,
            "claimedTargets": len(self.claimed),
            "guessCount": {p: len(self.guesses.get(p, [])) for p in self.participants},
            "remaining": {p: self.budget.get(p, 0) for p in self.participants},
            # targets are revealed only after the round ends, for the fairness receipt
            "targets": list(self.targets) if self.finished else None,
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "targets": self.targets,
            "claimed": {str(k): v for k, v in self.claimed.items()},
            "budget": self.budget,
            "guesses": {k: v for k, v in self.guesses.items()},
            "lastGuessAt": self.last_guess_at,
            "guessLog": self.guess_log,
            "log": self.log,
            "guessLog": self.guess_log,
            "order": self.order,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.targets = [int(t) for t in snapshot.get("targets", [])]
        self.claimed = {int(k): v for k, v in snapshot.get("claimed", {}).items()}
        self.budget = dict(snapshot.get("budget", {}))
        self.guesses = {k: list(v) for k, v in snapshot.get("guesses", {}).items()}
        self.last_guess_at = dict(snapshot.get("lastGuessAt", {}))
        self.log = list(snapshot.get("log", []))
        self.guess_log = list(snapshot.get("guessLog", []))
        self.order = list(snapshot.get("order", []))
        self.finished = bool(snapshot.get("finished", False))
