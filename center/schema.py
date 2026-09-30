"""Center configuration schema — the single source of truth for what a room may be.

Mirrors ORBIX CENTER BUILD MANUAL V4 sections 3 and 5:
  * every template has its own bounded rule set, selected by a `templateId` discriminator
  * extra fields are rejected (`extra="forbid"`)
  * cross-field validation rejects impossible payouts and timing conflicts
  * money is always an integer in base units, never a float
"""

from __future__ import annotations

import json
import re
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from center.strict_base import Strict

SCHEMA_VERSION = 1

Visibility = Literal["public", "unlisted", "private"]
Mode = Literal["preview", "testnet"]
BotPolicy = Literal["discouraged", "allowlisted", "allowed"]
AssetKind = Literal["erc20", "erc721", "erc1155", "preview-points"]


# --------------------------------------------------------------------- rules


class NumberHuntRules(Strict):
    template_id: Literal["number-hunt"] = Field(default="number-hunt", alias="templateId")
    digits: Literal[4, 6] = 6
    min: int
    max: int
    guess_budget: int = Field(ge=1, le=50)
    duration_seconds: int = Field(ge=15, le=300)
    hints: Literal["off", "on"] = "off"
    hint_visibility: Literal["private", "public"] = "private"
    target_count: int = Field(default=1, ge=1, le=20)
    win_mode: Literal["first-hit", "split-at-end"] = "first-hit"
    guess_cooldown_ms: int = Field(default=500, ge=300, le=2000)

    @model_validator(mode="after")
    def _bounds_match_digits(self) -> "NumberHuntRules":
        lo, hi = (1111, 9999) if self.digits == 4 else (111111, 999999)
        if not (lo <= self.min < self.max <= hi):
            raise ValueError(f"min/max must satisfy {lo} <= min < max <= {hi} for {self.digits}-digit mode")
        if self.target_count > (self.max - self.min + 1):
            raise ValueError("target_count exceeds the number of possible values")
        return self


class QuizQuestion(Strict):
    prompt: str = Field(min_length=1, max_length=500)
    choices: list[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0, le=5)
    explanation: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _correct_in_range(self) -> "QuizQuestion":
        if self.correct_index >= len(self.choices):
            raise ValueError("correct_index is outside the choices list")
        return self


class QuizRules(Strict):
    template_id: Literal["live-quiz"] = Field(default="live-quiz", alias="templateId")
    question_seconds: int = Field(ge=10, le=60)
    scoring: Literal["accuracy", "accuracy+speed"] = "accuracy"
    speed_bonus_max: int = Field(default=0, ge=0, le=20)
    shuffle_questions: bool = False
    shuffle_choices: bool = False
    pass_percentage: int = Field(default=60, ge=0, le=100)
    top_n: int = Field(default=3, ge=1, le=50)
    questions: list[QuizQuestion] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def _rules(self) -> "QuizRules":
        if self.scoring == "accuracy" and self.speed_bonus_max != 0:
            raise ValueError("speed_bonus_max must be 0 when scoring is accuracy-only")
        if self.questions and not (5 <= len(self.questions) <= 30):
            raise ValueError("a quiz needs between 5 and 30 questions")
        return self


class MemoryRules(Strict):
    template_id: Literal["memory-match"] = Field(default="memory-match", alias="templateId")
    pairs: int = Field(ge=6, le=18)
    duration_seconds: int = Field(ge=30, le=180)
    move_cap: int = Field(default=100, ge=10, le=200)
    score_mode: Literal["moves", "time"] = "moves"
    top_n: int = Field(default=3, ge=1, le=50)


class CatchRules(Strict):
    template_id: Literal["token-catch"] = Field(default="token-catch", alias="templateId")
    duration_seconds: int = Field(ge=15, le=120)
    spawn_per_second: int = Field(ge=1, le=8)
    lanes: int = Field(ge=3, le=5)
    fall_speed: Literal["slow", "normal", "fast"] = "normal"
    hazard_chance_pct: int = Field(default=0, ge=0, le=20)
    combo_cap: int = Field(default=3, ge=1, le=5)
    win_threshold: int = Field(default=30, ge=1, le=500)
    top_n: int = Field(default=3, ge=1, le=50)


class DuelRules(Strict):
    template_id: Literal["reaction-duel"] = Field(default="reaction-duel", alias="templateId")
    rounds: Literal[3, 5, 7] = 3
    min_players: int = Field(default=2, ge=2, le=2)
    max_players: int = Field(default=2, ge=2, le=2)
    choice_window_seconds: int = Field(default=10, ge=5, le=20)
    reveal_window_seconds: int = Field(default=5, ge=3, le=10)
    choice_set: Literal["classic", "extended"] = "classic"


class PuzzleRules(Strict):
    template_id: Literal["puzzle-sprint"] = Field(default="puzzle-sprint", alias="templateId")
    board: Literal[3, 4] = 3
    max_players: int = Field(default=1, ge=1, le=1)
    duration_seconds: int = Field(ge=60, le=300)
    move_cap: int = Field(default=300, ge=10, le=1000)
    score_mode: Literal["time", "moves"] = "time"
    top_n: int = Field(default=3, ge=1, le=50)


class HashHuntRules(Strict):
    template_id: Literal["hash-hunt"] = Field(default="hash-hunt", alias="templateId")
    duration_seconds: int = Field(ge=30, le=300)
    difficulty_bits: int = Field(default=20, ge=8, le=32)
    win_mode: Literal["first-valid", "best-effort"] = "first-valid"
    leaderboard_size: int = Field(default=10, ge=1, le=50)


class BossRules(Strict):
    template_id: Literal["boss-raid"] = Field(default="boss-raid", alias="templateId")
    min_players: int = Field(default=2, ge=2, le=100)
    max_players: int = Field(ge=2, le=100)
    duration_seconds: int = Field(ge=60, le=180)
    boss_health: int = Field(default=10000, ge=100, le=10_000_000)
    action_cooldown_ms: int = Field(default=500, ge=300, le=2000)
    contribution_cap: int = Field(default=1000, ge=10, le=1_000_000)
    min_contribution: int = Field(default=10, ge=1, le=1_000_000)
    reward_rule: Literal["proportional", "top-n", "milestone"] = "proportional"
    top_n: int = Field(default=3, ge=1, le=100)



TEMPLATE_RULES: dict[str, type[BaseModel]] = {
    "number-hunt": NumberHuntRules,
    "live-quiz": QuizRules,
    "memory-match": MemoryRules,
    "token-catch": CatchRules,
    "reaction-duel": DuelRules,
    "puzzle-sprint": PuzzleRules,
    "hash-hunt": HashHuntRules,
    "boss-raid": BossRules,
}

#: Templates that are single-player by nature; the wizard forces player_cap to 1.
SOLO_TEMPLATES = frozenset({"puzzle-sprint", "memory-match", "pattern-recall", "level-runner", "idle-rig"})

# ---- later catalog (G09-G20) ----
# Imported last so `center.games.rules_late` (which needs only `strict_base`) resolves
# before the engines package is pulled in. These names extend TEMPLATE_RULES and the
# RulesUnion above; the modules that need them import them from here.
from center.rules_late import (  # noqa: E402
    AirdropQuestRules,
    ContractDetectiveRules,
    IdleRigRules,
    LevelRunnerRules,
    MazeRaceRules,
    MevRushRules,
)
from center.rules_late import BingoRules as LogoBingoRules  # noqa: E402
from center.rules_late import (  # noqa: E402
    PatternRecallRules,
    RewardGridRules,
    RpsDuelRules,
    TypingSprintRules,
)

TEMPLATE_RULES.update({
    "rps-duel": RpsDuelRules,
    "reward-grid": RewardGridRules,
    "logo-bingo": LogoBingoRules,
    "pattern-recall": PatternRecallRules,
    "typing-sprint": TypingSprintRules,
    "maze-race": MazeRaceRules,
    "level-runner": LevelRunnerRules,
    "contract-detective": ContractDetectiveRules,
    "mev-rush": MevRushRules,
    "idle-rig": IdleRigRules,
    "airdrop-quest": AirdropQuestRules,
})

RulesUnion = Annotated[
    Union[
        NumberHuntRules, QuizRules, MemoryRules, CatchRules, DuelRules, PuzzleRules,
        HashHuntRules, BossRules,
        RpsDuelRules, RewardGridRules, LogoBingoRules, PatternRecallRules, TypingSprintRules,
        MazeRaceRules, LevelRunnerRules, ContractDetectiveRules, MevRushRules, IdleRigRules,
        AirdropQuestRules,
    ],
    Field(discriminator="template_id"),
]

#: Catalog blurb per template (used by GET /templates and the wizard).
TEMPLATE_META: dict[str, dict] = {
    "number-hunt": {"label": "Number Hunt", "blurb": "Guess the hidden number before the budget runs out.", "modes": "4 or 6 digits", "multiplayer": True},
    "live-quiz": {"label": "Live Quiz", "blurb": "Timed questions, live leaderboard.", "modes": "accuracy / +speed", "multiplayer": True},
    "memory-match": {"label": "Memory Match", "blurb": "Flip and match every pair.", "modes": "moves / time", "multiplayer": False},
    "token-catch": {"label": "Token Catch", "blurb": "Catch the falling tokens, dodge the hazards.", "modes": "3-5 lanes", "multiplayer": True},
    "reaction-duel": {"label": "Reaction Duel", "blurb": "Head-to-head reaction rounds, best of 3/5/7.", "modes": "commits", "multiplayer": True},
    "puzzle-sprint": {"label": "Puzzle Sprint", "blurb": "Solve the sliding puzzle against the clock.", "modes": "3x3 / 4x4", "multiplayer": False},
    "hash-hunt": {"label": "Hash Hunt", "blurb": "Proof-of-work race. Bots and agents welcome.", "modes": "first-valid / best-effort", "multiplayer": True},
    "boss-raid": {"label": "Co-op Boss Raid", "blurb": "Everyone hits the same boss. Contribution decides the split.", "modes": "2-100 players", "multiplayer": True},
    # later catalog (G09-G20)
    "rps-duel": {"label": "RPS Duel", "blurb": "Commit-reveal rock-paper-scissors, extended moves, best of 3-11.", "modes": "1v1", "multiplayer": True},
    "reward-grid": {"label": "Reward Grid", "blurb": "Reveal tiles, find the hidden reward slots. Demo points only.", "modes": "9-100 tiles", "multiplayer": True},
    "logo-bingo": {"label": "Token-Logo Bingo", "blurb": "Shared call stream, claim your line first.", "modes": "3x3 / 4x4", "multiplayer": True},
    "pattern-recall": {"label": "Pattern Recall", "blurb": "Repeat the growing sequence exactly. Solo.", "modes": "3-12 symbols", "multiplayer": False},
    "typing-sprint": {"label": "Typing Sprint", "blurb": "Server-scored keystrokes with timing bounds. No pasted WPM.", "modes": "30-120s", "multiplayer": True},
    "maze-race": {"label": "Maze Race", "blurb": "Seed-generated maze, first to the finish.", "modes": "10-30 grid", "multiplayer": True},
    "level-runner": {"label": "Level Runner", "blurb": "Seeded obstacle lane, server-replayed movement. Solo.", "modes": "lane templates", "multiplayer": False},
    "contract-detective": {"label": "Contract Detective", "blurb": "Spot the vulnerability in mock snippets. Educational.", "modes": "curated bank", "multiplayer": True},
    "mev-rush": {"label": "MEV Rush", "blurb": "Simulated pending-queue race. Not a real-chain service.", "modes": "bot friendly", "multiplayer": True},
    "idle-rig": {"label": "Idle Rig", "blurb": "Server-clock progression with a hard inventory cap. Solo.", "modes": "3-10 tiers", "multiplayer": False},
    "airdrop-quest": {"label": "Airdrop Quest", "blurb": "Wallet-bound achievements from accepted actions, budget-capped.", "modes": "campaigns", "multiplayer": True},
}


def parse_rules(template_id: str, data: dict):
    """Validate a rules dict for a template. Raises ValueError on any violation."""
    if template_id not in TEMPLATE_RULES:
        raise ValueError(f"unknown templateId {template_id!r}")
    payload = dict(data)
    payload["templateId"] = template_id
    return TEMPLATE_RULES[template_id](**payload)


# --------------------------------------------------------------------- parts


class Admission(Strict):
    player_cap: int = Field(default=50, ge=1, le=100)
    spectators: bool = False
    bot_policy: BotPolicy = "discouraged"
    min_ready_to_start: int = Field(default=2, ge=1, le=100)


class Access(Strict):
    """Vault-access descriptor. In preview the token is unset and nothing is charged."""

    vault_mode: Literal["simulated", "onchain"] = "simulated"
    token: str | None = None
    required_amount: int | None = Field(default=None, ge=0)
    joiner_fee: int = Field(default=0, ge=0)
    creator_absorbs_joiner_fee: bool = False


class Entry(Strict):
    kind: Literal["free", "erc20"] = "free"
    token: str | None = None
    amount: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _erc20_needs_token(self) -> "Entry":
        if self.kind == "erc20" and (not self.token or self.amount <= 0):
            raise ValueError("erc20 entry requires a token address and amount > 0")
        return self


class RewardSlot(Strict):
    rank: int = Field(ge=1, le=100)
    points: int = Field(default=0, ge=0)
    asset_kind: AssetKind | None = None
    asset_contract: str | None = None
    token_id: int = Field(default=0, ge=0)
    amount: int = Field(default=0, ge=0)


class Rewards(Strict):
    kind: Literal["preview-points", "funded-assets"] = "preview-points"
    slots: list[RewardSlot] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _funded_needs_assets(self) -> "Rewards":
        if self.kind == "funded-assets":
            if not self.slots:
                raise ValueError("funded-assets rewards require at least one slot")
            for s in self.slots:
                if not s.asset_kind or s.asset_kind == "preview-points" or not s.asset_contract:
                    raise ValueError("each funded slot needs an asset_kind and asset_contract")
                if s.asset_kind == "erc20" and s.amount <= 0:
                    raise ValueError("erc20 slots need amount > 0")
        return self


class Branding(Strict):
    preset: Literal["solar", "teal", "graphite"] = "solar"
    logo_asset_id: str | None = None
    cover_asset_id: str | None = None


# --------------------------------------------------------------------- room config


class RoomConfig(Strict):
    schema_version: int = SCHEMA_VERSION
    template_id: str
    template_version: int = 1
    name: str = Field(min_length=3, max_length=60)
    description: str = Field(default="", max_length=1000)
    visibility: Visibility = "unlisted"
    mode: Mode = "preview"
    rules: RulesUnion
    admission: Admission = Field(default_factory=Admission)
    access: Access = Field(default_factory=Access)
    entry: Entry = Field(default_factory=Entry)
    rewards: Rewards = Field(default_factory=Rewards)
    branding: Branding = Field(default_factory=Branding)

    @model_validator(mode="after")
    def _cross_checks(self) -> "RoomConfig":
        if self.template_id not in TEMPLATE_RULES:
            raise ValueError(f"unknown template_id {self.template_id!r}")
        if not isinstance(self.rules, TEMPLATE_RULES[self.template_id]):
            raise ValueError(f"rules object does not match template {self.template_id!r}")
        if self.mode == "preview" and self.access.vault_mode != "simulated":
            raise ValueError("preview rooms must use the simulated vault")
        if self.mode == "preview" and self.entry.kind != "free":
            raise ValueError("preview rooms cannot require on-chain entry payment")
        if self.access.vault_mode == "simulated" and self.access.token:
            raise ValueError("simulated vault must not name a token")
        if self.rewards.kind == "funded-assets" and self.mode != "testnet":
            raise ValueError("funded-asset rewards require mode=testnet")
        ranks = [s.rank for s in self.rewards.slots]
        if len(ranks) != len(set(ranks)):
            raise ValueError("reward slot ranks must be unique")

        ceiling = getattr(self.rules, "max_players", None)
        if ceiling is not None and self.admission.player_cap > ceiling:
            raise ValueError(f"player_cap {self.admission.player_cap} exceeds this template's ceiling of {ceiling}")
        if self.template_id in SOLO_TEMPLATES and self.admission.player_cap != 1:
            raise ValueError(f"{self.template_id} is single-player; player_cap must be 1")
        if self.admission.min_ready_to_start > self.admission.player_cap:
            raise ValueError("min_ready_to_start cannot exceed player_cap")
        return self

    # ---------------------------------------------------------------- helpers

    def public_dict(self) -> dict:
        """Payload safe for an unauthenticated client (answers stripped)."""
        d = self.model_dump(mode="json")
        if isinstance(self.rules, QuizRules):
            for question in d.get("rules", {}).get("questions", []) or []:
                question.pop("correct_index", None)
        return d

    def config_hash_input(self) -> str:
        """Canonical string hashed into the round's immutable config hash.

        Includes hidden answers so a settled round is bound to the exact quiz key.
        """
        return json.dumps(self.model_dump(mode="json", by_alias=True), sort_keys=True, separators=(",", ":"))

    def reward_slot_count(self) -> int:
        if self.rewards.kind == "funded-assets":
            return max(1, len(self.rewards.slots))
        return max(1, len(self.rewards.slots) or 1)

# --------------------------------------------------------------------- key casing

_CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")


def to_snake(key: str) -> str:
    """`templateId` -> `template_id`. Rule keys keep their name; only case changes."""
    return _CAMEL_BOUNDARY.sub("_", key).lower()


def normalise_keys(raw: object) -> object:
    """Recursively accept camelCase from a web client while the model stays snake_case."""
    if isinstance(raw, dict):
        return {to_snake(str(k)): normalise_keys(v) for k, v in raw.items()}
    if isinstance(raw, list):
        return [normalise_keys(v) for v in raw]
    return raw


