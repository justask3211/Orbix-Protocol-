"""G09-G20 rules schemas — the later catalog (manual section 3).

Same discipline as the release-one schemas: bounded fields, `extra=\"forbid\"`,
cross-field validation, and no float money anywhere.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from center.strict_base import Strict


class RpsDuelRules(Strict):
    template_id: Literal["rps-duel"] = Field(default="rps-duel", alias="templateId")
    rounds: int = Field(default=5, ge=3, le=11)            # best-of 3/5/7/9/11
    choice_window_seconds: int = Field(default=10, ge=5, le=20)
    reveal_window_seconds: int = Field(default=5, ge=3, le=10)
    choice_set: str = Field(default="classic", pattern=r"^(classic|extended)$")
    min_players: int = Field(default=2, ge=2, le=2)
    max_players: int = Field(default=2, ge=2, le=2)

    @model_validator(mode="after")
    def _odd_rounds(self) -> "RpsDuelRules":
        if self.rounds % 2 == 0:
            raise ValueError("rounds must be odd so a duel always has a winner")
        return self


class RewardGridRules(Strict):
    template_id: Literal["reward-grid"] = Field(default="reward-grid", alias="templateId")
    tiles: int = Field(default=36, ge=9, le=100)
    reward_slots: int = Field(default=4, ge=1, le=20)
    reveal_cap_per_wallet: int = Field(default=6, ge=1, le=20)
    duration_seconds: int = Field(default=180, ge=30, le=600)
    max_players: int = Field(default=50, ge=2, le=100)

    @model_validator(mode="after")
    def _sane(self) -> "RewardGridRules":
        if self.reward_slots > self.tiles:
            raise ValueError("reward_slots cannot exceed the tile count")
        return self


class BingoRules(Strict):
    template_id: Literal["logo-bingo"] = Field(default="logo-bingo", alias="templateId")
    board: int = Field(default=3, ge=3, le=4)              # 3x3 or 4x4
    call_cadence_seconds: int = Field(default=4, ge=2, le=8)
    win_mode: str = Field(default="first-line", pattern=r"^(first-line|full-board)$")
    free_centre: bool = True
    duration_seconds: int = Field(default=240, ge=60, le=600)
    max_players: int = Field(default=20, ge=2, le=100)


class PatternRecallRules(Strict):
    template_id: Literal["pattern-recall"] = Field(default="pattern-recall", alias="templateId")
    symbols: int = Field(default=6, ge=3, le=12)
    start_length: int = Field(default=3, ge=2, le=4)
    growth: int = Field(default=1, ge=1, le=2)
    input_window_seconds: int = Field(default=5, ge=2, le=10)
    max_players: int = Field(default=1, ge=1, le=1)


class TypingSprintRules(Strict):
    template_id: Literal["typing-sprint"] = Field(default="typing-sprint", alias="templateId")
    prompt_id: str = Field(min_length=1, max_length=60)
    duration_seconds: int = Field(default=60, ge=30, le=120)
    accuracy_floor: int = Field(default=85, ge=70, le=99)
    max_players: int = Field(default=20, ge=1, le=100)


class MazeRaceRules(Strict):
    template_id: Literal["maze-race"] = Field(default="maze-race", alias="templateId")
    maze_size: int = Field(default=15, ge=10, le=30)
    duration_seconds: int = Field(default=240, ge=60, le=600)
    max_players: int = Field(default=10, ge=1, le=100)


class LevelRunnerRules(Strict):
    template_id: Literal["level-runner"] = Field(default="level-runner", alias="templateId")
    lane_template: str = Field(default="classic", pattern=r"^(classic|tight|wide)$")
    duration_seconds: int = Field(default=60, ge=30, le=120)
    score_cap: int = Field(default=1000, ge=100, le=100_000)
    max_players: int = Field(default=1, ge=1, le=1)


class ContractDetectiveRules(Strict):
    template_id: Literal["contract-detective"] = Field(default="contract-detective", alias="templateId")
    categories: list[str] = Field(default_factory=list, max_length=10)
    question_seconds: int = Field(default=25, ge=10, le=60)
    duration_seconds: int = Field(default=240, ge=60, le=600)
    max_players: int = Field(default=30, ge=1, le=100)


class MevRushRules(Strict):
    template_id: Literal["mev-rush"] = Field(default="mev-rush", alias="templateId")
    duration_seconds: int = Field(default=120, ge=60, le=300)
    opportunity_cadence_seconds: int = Field(default=5, ge=2, le=15)
    bot_policy: str = Field(default="allowed", pattern=r"^(discouraged|allowlisted|allowed)$")
    max_players: int = Field(default=30, ge=2, le=100)


class IdleRigRules(Strict):
    template_id: Literal["idle-rig"] = Field(default="idle-rig", alias="templateId")
    session_seconds: int = Field(default=900, ge=120, le=3600)
    upgrade_tiers: int = Field(default=5, ge=3, le=10)
    inventory_cap: int = Field(default=5000, ge=100, le=1_000_000)
    max_players: int = Field(default=1, ge=1, le=1)


class AirdropQuestRules(Strict):
    template_id: Literal["airdrop-quest"] = Field(default="airdrop-quest", alias="templateId")
    campaign_name: str = Field(min_length=3, max_length=60)
    start_at: int = Field(default=0, ge=0)
    stop_at: int = Field(default=1, ge=0)
    budget_points: int = Field(default=10000, ge=100, le=10_000_000)
    achievements: list[str] = Field(min_length=1, max_length=20)
    max_players: int = Field(default=100, ge=1, le=100)

    @model_validator(mode="after")
    def _window(self) -> "AirdropQuestRules":
        if self.stop_at <= self.start_at:
            raise ValueError("stop_at must be after start_at")
        return self
