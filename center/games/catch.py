"""G04 — Token Catch.

The spawn stream is generated from the committed seed, so a claim ("I caught spawn 12")
can be verified against a reproducible timeline instead of trusting a client score. A
catch is accepted only when the player's lane matches the spawn lane AND the spawn's
scheduled time is inside a bounded latency window around the player's action.
"""

from __future__ import annotations

from dataclasses import dataclass

from center.games.base import ActionResult, Engine
from center.schema import CatchRules, RoomConfig

#: How much clock skew a catch may carry before it is rejected (server-side tolerance).
CATCH_WINDOW_MS = 250


@dataclass
class Spawn:
    index: int
    at_ms: int
    lane: int
    hazard: bool
    points: int


class CatchEngine(Engine):
    template_id = "token-catch"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: CatchRules = config.rules  # type: ignore[assignment]
        self.spawns: list[Spawn] = []
        self.caught: dict[str, set[int]] = {}
        self.score: dict[str, int] = {}
        self.lane: dict[str, int] = {}
        self.last_catch_ms: dict[str, int] = {}
        self.started_at: float = 0.0
        self.finished: bool = False

    # ------------------------------------------------------------------ lifecycle

    def start(self, now: float = 0.0) -> None:
        count = self.rules.duration_seconds * self.rules.spawn_per_second
        step_ms = int(1000 / self.rules.spawn_per_second)
        spawns: list[Spawn] = []
        for i in range(count):
            lane = self.rng.below(self.rules.lanes)
            hazard = self.rng.below(100) < self.rules.hazard_chance_pct
            points = -1 if hazard else 1 + (1 if self.rng.below(100) < 15 else 0)
            spawns.append(Spawn(index=i, at_ms=i * step_ms, lane=lane, hazard=hazard, points=points))
        self.spawns = spawns
        for p in self.participants:
            self.caught[p] = set()
            self.score[p] = 0
            self.lane[p] = 0
            self.last_catch_ms[p] = -10_000
        self.started_at = now
        self.now = now

    def elapsed_ms(self, now: float) -> int:
        return int(max(0.0, now - self.started_at) * 1000)

    def tick(self, now: float) -> ActionResult | None:
        self.now = now
        if self.finished:
            return None
        if self.elapsed_ms(now) >= self.rules.duration_seconds * 1000:
            self.finished = True
            return ActionResult(True, patch={"finished": True, "scores": self.scores()}, finished=True)
        return None

    # ------------------------------------------------------------------ actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self.now = now
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        kind = action.get("kind")
        now_ms = self.elapsed_ms(now)

        if kind == "lane":
            lane = action.get("lane")
            if not isinstance(lane, int) or not (0 <= lane < self.rules.lanes):
                return ActionResult(False, "BAD_ACTION")
            self.lane[who] = lane
            return ActionResult(True, patch={"lane": {who: lane}})

        if kind != "catch":
            return ActionResult(False, "BAD_ACTION")

        idx = action.get("spawn")
        if not isinstance(idx, int) or not (0 <= idx < len(self.spawns)):
            return ActionResult(False, "BAD_ACTION")
        if idx in self.caught[who]:
            return ActionResult(False, "ACTION_DUPLICATE")
        if now_ms - self.last_catch_ms[who] < 60:
            return ActionResult(False, "SLOW_DOWN")

        spawn = self.spawns[idx]
        if spawn.at_ms > now_ms + CATCH_WINDOW_MS:
            return ActionResult(False, "ROUND_NOT_OPEN")  # spawn has not happened yet
        if self.lane[who] != spawn.lane:
            return ActionResult(False, "BAD_PROOF")  # paddle was not in that lane
        if now_ms - spawn.at_ms > CATCH_WINDOW_MS:
            return ActionResult(False, "STALE_REVISION")  # missed the window

        self.caught[who].add(idx)
        self.last_catch_ms[who] = now_ms
        self.score[who] = max(0, self.score[who] + spawn.points)
        return ActionResult(
            True,
            patch={"caught": {who: len(self.caught[who])}, "scores": self.scores()},
            private={"points": spawn.points, "total": self.score[who]},
            scores=self.scores(),
        )

    def eligible(self) -> set[str]:
        """A slot requires a positive score: catching hazards is not a rewardable round."""
        return {p for p in self.participants if self.score.get(p, 0) > 0}

    # ------------------------------------------------------------------ results

    def scores(self) -> dict[str, float]:
        return {p: float(self.score.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.score.get(p, 0), p))

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "lanes": self.rules.lanes,
            "durationSeconds": self.rules.duration_seconds,
            "spawnPerSecond": self.rules.spawn_per_second,
            "winThreshold": self.rules.win_threshold,
            "scores": dict(self.score),
            "lanesNow": dict(self.lane),
            # A short live window only. The full timeline stays secret so a bot cannot
            # pre-solve the round; the server still enforces lane, time window and rate.
            "nowMs": self.elapsed_ms(getattr(self, "now", self.started_at)),
            "recent": [
                {"index": s.index, "lane": s.lane, "atMs": s.at_ms, "points": s.points}
                for s in self.spawns
                if self.elapsed_ms(getattr(self, "now", self.started_at)) - 300 <= s.at_ms
                <= self.elapsed_ms(getattr(self, "now", self.started_at)) + 500
            ],
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "spawns": [[s.index, s.at_ms, s.lane, s.hazard, s.points] for s in self.spawns],
            "caught": {k: sorted(v) for k, v in self.caught.items()},
            "score": self.score,
            "lane": self.lane,
            "lastCatchMs": self.last_catch_ms,
            "startedAt": self.started_at,
            "now": self.now,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.spawns = [Spawn(*row) for row in snapshot.get("spawns", [])]
        self.caught = {k: set(v) for k, v in snapshot.get("caught", {}).items()}
        self.score = dict(snapshot.get("score", {}))
        self.lane = dict(snapshot.get("lane", {}))
        self.last_catch_ms = dict(snapshot.get("lastCatchMs", {}))
        self.started_at = float(snapshot.get("startedAt", 0.0))
        self.now = float(snapshot.get("now", self.started_at))
        self.finished = bool(snapshot.get("finished", False))
