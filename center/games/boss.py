"""G08 — Co-op Boss Raid.

Everyone hits the same boss. Damage is issued by the server under a per-player rate cap
and a contribution cap, so a client cannot inflate its own contribution. Rewards follow
the configured rule (proportional, top-N, or milestone).
"""

from __future__ import annotations

from center.games.base import ActionResult, Entitlement, Engine
from center.schema import BossRules, RoomConfig


class BossEngine(Engine):
    template_id = "boss-raid"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: BossRules = config.rules  # type: ignore[assignment]
        self.health: int = 0
        self.contribution: dict[str, int] = {}
        self.hits: dict[str, int] = {}
        self.last_hit_at: dict[str, float] = {}
        self.started_at: float = 0.0
        self.finished: bool = False
        self.slain: bool = False

    # ------------------------------------------------------------------ lifecycle

    def start(self, now: float = 0.0) -> None:
        self.health = self.rules.boss_health
        for p in self.participants:
            self.contribution[p] = 0
            self.hits[p] = 0
            self.last_hit_at[p] = -1e9  # first hit is never rate-limited
        self.started_at = now

    def tick(self, now: float) -> ActionResult | None:
        if self.finished:
            return None
        if now - self.started_at >= self.rules.duration_seconds:
            self.finished = True
            return ActionResult(True, patch={"finished": True, "slain": self.slain, "scores": self.scores()}, finished=True)
        return None

    # ------------------------------------------------------------------ actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "hit":
            return ActionResult(False, "BAD_ACTION")
        if who not in self.participants:
            return ActionResult(False, "NOT_ADMITTED")

        cooldown = self.rules.action_cooldown_ms / 1000.0
        if now - self.last_hit_at.get(who, 0.0) < cooldown:
            return ActionResult(False, "SLOW_DOWN")
        self.last_hit_at[who] = now

        power = action.get("power", 1)
        if not isinstance(power, int) or isinstance(power, bool) or not (1 <= power <= 100):
            return ActionResult(False, "BAD_ACTION")

        remaining_allowance = self.rules.contribution_cap - self.contribution.get(who, 0)
        if remaining_allowance <= 0:
            return ActionResult(False, "BUDGET_EXHAUSTED")
        damage = min(power, remaining_allowance, self.health)

        self.contribution[who] = self.contribution.get(who, 0) + damage
        self.hits[who] = self.hits.get(who, 0) + 1
        self.health -= damage
        if self.health <= 0:
            self.health = 0
            self.slain = True
            self.finished = True

        return ActionResult(
            True,
            patch={
                "health": self.health,
                "damage": damage,
                "contribution": dict(self.contribution),
                "finished": self.finished,
                "slain": self.slain,
            },
            private={"damage": damage, "hits": self.hits[who]},
            finished=self.finished,
            scores=self.scores(),
        )

    # ------------------------------------------------------------------ results

    def eligible(self) -> list[str]:
        return [p for p in self.participants if self.contribution.get(p, 0) >= self.rules.min_contribution]

    def scores(self) -> dict[str, float]:
        return {p: float(self.contribution.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.contribution.get(p, 0), p))

    def entitlements(self) -> list[Entitlement]:
        """Contribution-weighted allocation honouring the configured reward rule."""
        slots = self.config.rewards.slots
        eligible = [p for p in self.ranking() if p in self.eligible()]
        if self.rules.reward_rule == "top-n":
            eligible = eligible[: self.rules.top_n]
        out: list[Entitlement] = []

        if self.config.rewards.kind != "funded-assets":
            for slot in slots:
                idx = slot.rank - 1
                if idx < len(eligible):
                    out.append(Entitlement(slot_id=slot.rank, winner=eligible[idx], points=slot.points))
            return out

        # Proportional split of each fungible slot by contribution share.
        total = sum(self.contribution.get(p, 0) for p in eligible) or 1
        for slot in slots:
            idx = slot.rank - 1
            if idx < len(eligible):
                winner = eligible[idx]
                share = self.contribution.get(winner, 0) / total
                amount = int(slot.amount * share) if slot.asset_kind == "erc20" else slot.amount
                if amount <= 0:
                    continue
                out.append(
                    Entitlement(
                        slot_id=slot.rank,
                        winner=winner,
                        asset_kind=slot.asset_kind,
                        asset_contract=slot.asset_contract,
                        token_id=slot.token_id,
                        amount=amount,
                    )
                )
        return out

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "bossHealth": self.health,
            "bossHealthMax": self.rules.boss_health,
            "contribution": dict(self.contribution),
            "hits": dict(self.hits),
            "minContribution": self.rules.min_contribution,
            "rewardRule": self.rules.reward_rule,
            "durationSeconds": self.rules.duration_seconds,
            "slain": self.slain,
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "health": self.health,
            "contribution": self.contribution,
            "hits": self.hits,
            "lastHitAt": self.last_hit_at,
            "startedAt": self.started_at,
            "finished": self.finished,
            "slain": self.slain,
        }

    def _load(self, snapshot: dict) -> None:
        self.health = int(snapshot.get("health", 0))
        self.contribution = dict(snapshot.get("contribution", {}))
        self.hits = dict(snapshot.get("hits", {}))
        self.last_hit_at = dict(snapshot.get("lastHitAt", {}))
        self.started_at = float(snapshot.get("startedAt", 0.0))
        self.finished = bool(snapshot.get("finished", False))
        self.slain = bool(snapshot.get("slain", False))
