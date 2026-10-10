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
AssetKind = Literal["erc20", "erc721", "erc1155", "eth", "preview-points"]


# --------------------------------------------------------------------- rules


class NumberHuntRules(Strict):
    template_id: Literal["number-hunt"] = Field(default="number-hunt", alias="templateId")
    digits: Literal[4, 6] = 6
    min: int
    max: int
    guess_budget: int = Field(ge=1, le=50)
    duration_seconds: int = Field(ge=15, le=600)
    hints: Literal["off", "on"] = "off"
    hint_visibility: Literal["private", "public"] = "public"
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
    # D5 hint policy: elimination cues narrow the choice set without revealing the
    # answer. `hint_eliminations` caps how many choices a player may see struck out.
    hints: Literal["off", "on"] = "off"
    hint_eliminations: int = Field(default=1, ge=1, le=3)

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
    # D6 hint policy: a bounded pair reveal shows ONE hidden pair face-up briefly,
    # to the asking player only. It can never map the remaining board.
    hints: Literal["off", "on"] = "off"
    hint_budget: int = Field(default=2, ge=1, le=5)


class CatchRules(Strict):
    template_id: Literal["token-catch"] = Field(default="token-catch", alias="templateId")
    duration_seconds: int = Field(ge=15, le=600)
    arena_mode: bool = False
    world_version: Literal[2, 3, 4] = 2
    loot_budget: int = Field(default=500, ge=1, le=10000)
    airdrop_count: int = Field(default=10, ge=1, le=30)
    loot_chunk: int = Field(default=5, ge=1, le=100)
    gun_spawn_chance_pct: int = Field(default=30, ge=0, le=100)
    gun_knockout_seconds: int = Field(default=10, ge=1, le=15)
    gun_shots: int = Field(default=5, ge=1, le=30)
    punch_stun_seconds: int = Field(default=2, ge=1, le=5)
    spawn_per_second: int = Field(ge=1, le=8)
    lanes: int = Field(ge=3, le=5)
    fall_speed: Literal["slow", "normal", "fast"] = "normal"
    hazard_chance_pct: int = Field(default=0, ge=0, le=20)
    combo_cap: int = Field(default=3, ge=1, le=5)
    win_threshold: int = Field(default=30, ge=1, le=500)
    top_n: int = Field(default=3, ge=1, le=50)
    catch_window_ms: int = Field(default=1000, ge=250, le=2000)

    @model_validator(mode="after")
    def _loot_bounds(self):
        if self.world_version >= 3 and not self.arena_mode:
            raise ValueError('third-person loot requires arena_mode')
        if self.world_version >= 3 and self.airdrop_count > self.loot_budget:
            raise ValueError('airdrop_count cannot exceed loot_budget')
        if self.world_version >= 3 and (self.loot_budget + self.loot_chunk - 1)//self.loot_chunk + self.airdrop_count > 400:
            raise ValueError('use larger loot piles: at most 400 piles per match')
        return self


class DuelRules(Strict):
    template_id: Literal["reaction-duel"] = Field(default="reaction-duel", alias="templateId")
    rounds: Literal[3, 5, 7] = 3
    min_players: int = Field(default=2, ge=2, le=2)
    max_players: int = Field(default=2, ge=2, le=2)
    choice_window_seconds: int = Field(default=10, ge=5, le=20)
    reveal_window_seconds: int = Field(default=5, ge=3, le=10)
    choice_set: Literal["classic", "extended"] = "classic"


class CombatRules(Strict):
    template_id: Literal["combat-duel"] = Field(default="combat-duel", alias="templateId")
    duration_seconds: int = Field(default=180, ge=15, le=600)
    min_players: int = Field(default=2, ge=2, le=2)
    max_players: int = Field(default=2, ge=2, le=2)
    starting_health: int = Field(default=100, ge=50, le=300)
    attack_cooldown_ms: int = Field(default=500, ge=300, le=1000)
    world_version: Literal[2, 3, 4] = 2
    allow_guns: bool = False
    combo_window_ms: int = Field(default=800, ge=300, le=1500)


class PuzzleRules(Strict):
    template_id: Literal["puzzle-sprint"] = Field(default="puzzle-sprint", alias="templateId")
    board: Literal[3, 4] = 3
    max_players: int = Field(default=1, ge=1, le=1)
    duration_seconds: int = Field(ge=60, le=300)
    move_cap: int = Field(default=300, ge=10, le=1000)
    score_mode: Literal["time", "moves"] = "time"
    top_n: int = Field(default=3, ge=1, le=50)
    # D9 hint policy: one legal-move suggestion per use, capped per player; each
    # use adds a small move-count penalty so hints cannot beat pure play.
    hints: Literal["off", "on"] = "off"
    hint_budget: int = Field(default=3, ge=1, le=10)
    hint_move_penalty: int = Field(default=2, ge=0, le=10)


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
    duration_seconds: int = Field(ge=60, le=600)
    arena_mode: bool = False
    world_version: Literal[2, 3, 4] = 2
    winning_teams: int = Field(default=3, ge=1, le=3)
    team_reward_shares: list[int] = Field(default_factory=lambda: [60,25,15], min_length=1, max_length=3)
    team_member_split: Literal['equal', 'damage'] = 'equal'
    starting_gun_damage: int = Field(default=12, ge=5, le=40)
    upgrade_interval_seconds: int = Field(default=30, ge=10, le=120)
    knockout_seconds: int = Field(default=10, ge=3, le=15)
    team_size: int = Field(default=3, ge=2, le=5)
    boss_health: int = Field(default=10000, ge=100, le=10_000_000)
    action_cooldown_ms: int = Field(default=500, ge=300, le=2000)
    contribution_cap: int = Field(default=1000, ge=10, le=1_000_000)
    min_contribution: int = Field(default=10, ge=1, le=1_000_000)
    reward_rule: Literal["proportional", "top-n", "milestone"] = "proportional"
    top_n: int = Field(default=3, ge=1, le=100)
    team_mode: Literal["coop", "teams"] = "coop"

    @model_validator(mode="after")
    def _crew_reward_bounds(self):
        if self.world_version >= 3 and (not self.arena_mode or self.team_mode != 'teams'):
            raise ValueError('third-person raids require arena teams')
        if len(self.team_reward_shares) != self.winning_teams or any(type(n) is not int or n < 0 or n > 100 for n in self.team_reward_shares) or sum(self.team_reward_shares) != 100:
            raise ValueError('team reward shares must match winning teams and total 100 percent')
        return self




TEMPLATE_RULES: dict[str, type[BaseModel]] = {
    "number-hunt": NumberHuntRules,
    "live-quiz": QuizRules,
    "memory-match": MemoryRules,
    "token-catch": CatchRules,
    "reaction-duel": DuelRules,
    "combat-duel": CombatRules,
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

from center.rules_portfolio import (ClosestCallRules, WordForgeRules, PrismLinesRules, RelicAuctionRules, AtlasQuestRules)
PORTFOLIO_TEMPLATES = frozenset({'closest-call', 'word-forge', 'prism-lines', 'relic-auction', 'atlas-quest'})
TEMPLATE_RULES.update({model.model_fields['template_id'].default: model for model in
    (ClosestCallRules, WordForgeRules, PrismLinesRules, RelicAuctionRules, AtlasQuestRules)})

RulesUnion = Annotated[
    Union[
        NumberHuntRules, QuizRules, MemoryRules, CatchRules, DuelRules, PuzzleRules,
        HashHuntRules, BossRules, CombatRules,
        RpsDuelRules, RewardGridRules, LogoBingoRules, PatternRecallRules, TypingSprintRules,
        MazeRaceRules, LevelRunnerRules, ContractDetectiveRules, MevRushRules, IdleRigRules,
        AirdropQuestRules, ClosestCallRules, WordForgeRules, PrismLinesRules, RelicAuctionRules, AtlasQuestRules,
    ],
    Field(discriminator="template_id"),
]

#: Catalog blurb per template (used by GET /templates and the wizard).
TEMPLATE_META: dict[str, dict] = {
    "number-hunt": {"label": "Number Hunt", "blurb": "Guess the hidden number before the budget runs out.", "modes": "4 or 6 digits", "multiplayer": True},
    "live-quiz": {"label": "Live Quiz", "blurb": "Timed questions, live leaderboard.", "modes": "accuracy / +speed", "multiplayer": True},
    "memory-match": {"label": "Memory Match", "blurb": "Flip and match every pair.", "modes": "moves / time", "multiplayer": False},
    "token-catch": {"label": "Token Catch", "blurb": "Race to shared airdrops, loot coin piles and outplay rivals.", "modes": "character world / legacy lanes", "multiplayer": True},
    "reaction-duel": {"label": "Rock Paper Scissors Duel", "blurb": "Choose once. Automatic reveal. Best of 3/5/7.", "modes": "commits", "multiplayer": True},
    "combat-duel": {"label": "Arena Duel", "blurb": "Move, block and battle with fists, swords and spears.", "modes": "1 vs 1 arena", "multiplayer": True},
    "puzzle-sprint": {"label": "Puzzle Sprint", "blurb": "Solve the sliding puzzle against the clock.", "modes": "3x3 / 4x4", "multiplayer": False},
    "hash-hunt": {"label": "Hash Hunt", "blurb": "Proof-of-work race. Bots and agents welcome.", "modes": "first-valid / best-effort", "multiplayer": True},
    "boss-raid": {"label": "Co-op Boss Raid", "blurb": "Choose a crew, dodge the guardian and compete for the podium.", "modes": "2-50 arena players / legacy raid", "multiplayer": True},
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

TEMPLATE_META.update({
    'closest-call': dict(label='Closest Call', blurb='Seal an estimate, then discover how close you came.', modes='Estimation', multiplayer=True),
    'word-forge': dict(label='Word Forge', blurb='Build one strong English word from glowing letter tiles.', modes='Word puzzle', multiplayer=True),
    'prism-lines': dict(label='Prism Lines', blurb='Drop crystals and connect four in a thoughtful duel.', modes='Board strategy', multiplayer=True),
    'relic-auction': dict(label='Relic Auction', blurb='Bid game credits for relics and complete colour sets.', modes='Auction strategy', multiplayer=True),
    'atlas-quest': dict(label='Atlas Quest', blurb='Place a map pin and learn from the revealed location.', modes='Geography', multiplayer=True),
})


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


class Timing(Strict):
    """Room opening + closing schedule. Both optional; 0 = no schedule."""

    open_at: int = Field(default=0, ge=0)
    close_at: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _sane(self) -> "Timing":
        if self.open_at and self.close_at and self.close_at <= self.open_at:
            raise ValueError("close_at must be after open_at")
        return self


class Access(Strict):
    """Vault-access descriptor. In preview the token is unset and nothing is charged."""

    vault_mode: Literal["simulated", "onchain"] = "simulated"
    token: str | None = None
    required_amount: int | None = Field(default=None, ge=0)
    joiner_fee: int = Field(default=0, ge=0)
    creator_absorbs_joiner_fee: bool = False
    payout_mode: Literal["creator", "custom", "burn"] | None = None
    payout_address: str | None = None


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


class FormReward(Strict):
    kind: Literal["waitlist-form", "qa-form"]
    eligibility: Literal["winners-only", "top3", "anyone", "custom"] = "winners-only"
    custom_count: int = Field(default=1, ge=1, le=100, strict=True)
    message: str = Field(default="", max_length=280)
    fields: list[str] = Field(default_factory=list, max_length=3)
    questions: list[str] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def _form(self) -> "FormReward":
        for text in [self.message, *self.fields, *self.questions]:
            if any(ord(c) < 32 and c not in "\n\t" for c in text):
                raise ValueError("form text must be readable")
        for text in [*self.fields, *self.questions]:
            if not text.strip() or len(text) > 160:
                raise ValueError("field labels and questions require 1–160 characters")
        self.fields = [s.strip() for s in self.fields]
        self.questions = [s.strip() for s in self.questions]
        self.message = self.message.strip()
        if self.kind == "qa-form" and (not self.questions or self.fields):
            raise ValueError("Q&A requires 1–5 questions and no wallet fields")
        if self.kind == "waitlist-form" and self.questions:
            raise ValueError("waitlist forms use custom fields, not questions")
        if len(set(self.fields)) != len(self.fields) or len(set(self.questions)) != len(self.questions):
            raise ValueError("form labels must be distinct")
        return self


class Rewards(Strict):
    kind: Literal["preview-points", "funded-assets", "waitlist-form", "qa-form"] = "preview-points"
    forms: list[FormReward] = Field(default_factory=list, max_length=2)
    slots: list[RewardSlot] = Field(default_factory=list, max_length=50)
    claim_mode: Literal["auto", "code", "merkle", "open"] = "code"
    claim_deadline: int = Field(default=0, ge=0)
    merkle_winners: list[str] = Field(default_factory=list, max_length=50)
    distribution: Literal["match", "drop"] = "match"
    waitlist_source: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _funded_needs_assets(self) -> "Rewards":
        kinds = [form.kind for form in self.forms]
        if len(kinds) != len(set(kinds)):
            raise ValueError("only one form of each type per room")
        if self.kind in {"waitlist-form", "qa-form"}:
            if self.slots or self.waitlist_source or self.kind not in kinds:
                raise ValueError("form rewards require a matching form and no asset/point slots")
        if self.kind == "funded-assets":
            if not self.slots:
                raise ValueError("funded-assets rewards require at least one slot")
            if self.distribution == "drop" and self.claim_mode not in {"merkle", "open"}:
                raise ValueError("drops require Merkle or Open mode")
            if self.waitlist_source and (self.distribution != "drop" or self.claim_mode != "merkle"):
                raise ValueError("waitlist rewards require a Merkle drop")
            nfts = set()
            for s in self.slots:
                import re
                if not re.fullmatch(r"0x[0-9a-fA-F]{40}", s.asset_contract or ""):
                    raise ValueError("funded assets require a valid contract address")
                if s.amount >= 2**256 or s.token_id >= 2**256:
                    raise ValueError("asset amount and token ID must fit uint256")
                if s.asset_kind == "eth" and int(s.asset_contract, 16) != 0 or s.asset_kind != "eth" and int(s.asset_contract, 16) == 0:
                    raise ValueError("ETH uses zero address; token assets require nonzero contracts")
                if s.asset_kind == "erc721":
                    identity = (s.asset_contract.lower(), s.token_id)
                    if identity in nfts:
                        raise ValueError("a specific ERC721 can only fund one prize slot")
                    nfts.add(identity)
                if not s.asset_kind or s.asset_kind == "preview-points" or not s.asset_contract:
                    raise ValueError("each funded slot needs an asset_kind and asset_contract")
                if s.amount <= 0:
                    raise ValueError("funded slots need amount > 0")
                if s.asset_kind == "erc721" and s.amount != 1:
                    raise ValueError("ERC721 reward amount must be one")
        return self


class Waitlist(Strict):
    enabled: bool = Field(default=False, strict=True)
    message: str = Field(default="", max_length=280)

    @model_validator(mode="after")
    def _readable(self) -> "Waitlist":
        if any(ord(char) < 32 and char not in "\n\t" for char in self.message):
            raise ValueError("waitlist message must contain readable text")
        self.message = self.message.strip()
        return self


class Branding(Strict):
    preset: Literal["solar", "teal", "graphite"] = "solar"
    logo_asset_id: str | None = None
    cover_asset_id: str | None = None


class TimedHint(Strict):
    delay_seconds: int = Field(ge=0, le=3600, strict=True)
    text: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def _hint_text(self) -> "TimedHint":
        if not self.text.strip() or any(ord(char) < 32 and char not in "\n\t" for char in self.text):
            raise ValueError("hints require readable text without control characters")
        self.text = self.text.strip()
        return self


class CommunityOptions(Strict):
    mute_chat: bool = Field(default=False, strict=True)
    hide_players: bool = Field(default=False, strict=True)
    hide_guesses: bool = Field(default=False, strict=True)
    timed_hints: list[TimedHint] = Field(default_factory=list, max_length=20)


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
    timing: Timing = Field(default_factory=Timing)
    access: Access = Field(default_factory=Access)
    entry: Entry = Field(default_factory=Entry)
    rewards: Rewards = Field(default_factory=Rewards)
    waitlist: Waitlist = Field(default_factory=Waitlist)
    branding: Branding = Field(default_factory=Branding)
    community_settings: CommunityOptions = Field(default_factory=CommunityOptions)

    @model_validator(mode="before")
    @classmethod
    def _default_version(cls, value):
        if isinstance(value, dict) and 'template_version' not in value and value.get('template_id') in {'reaction-duel', 'rps-duel'}:
            value = {**value, 'template_version': 2}
        return value

    @model_validator(mode="after")
    def _cross_checks(self) -> "RoomConfig":
        if self.template_id not in TEMPLATE_RULES:
            raise ValueError(f"unknown template_id {self.template_id!r}")
        if not isinstance(self.rules, TEMPLATE_RULES[self.template_id]):
            raise ValueError(f"rules object does not match template {self.template_id!r}")
        allowed_versions = {1, 2} if self.template_id in {'reaction-duel', 'rps-duel'} else {1}
        if self.template_version not in allowed_versions:
            raise ValueError('UNSUPPORTED_TEMPLATE_VERSION')
        if self.mode == "preview" and self.access.vault_mode != "simulated":
            raise ValueError("preview rooms must use the simulated vault")
        # entry.kind == 'erc20' is allowed in preview: the joiner's token payment
        # goes through CreatorTokenGate (separate deployed contract), not through
        # the vault contract. The vault remains simulated for the software
        # balance that powers room-creation fees. The gate is the real money path.
        if self.access.vault_mode == "simulated" and self.access.token:
            raise ValueError("simulated vault must not name a token")
        if self.rewards.kind == "funded-assets" and self.mode != "testnet":
            raise ValueError("funded-asset rewards require mode=testnet")
        if getattr(self.rules, 'world_version', 2) >= 3 and self.template_id in {'token-catch', 'boss-raid'} and self.rewards.kind == 'funded-assets' and self.rewards.distribution == 'match':
            if any(s.asset_kind != 'erc20' for s in self.rewards.slots) or len({(s.asset_contract or '').lower() for s in self.rewards.slots}) != 1:
                raise ValueError('shared loot and team pools require one ERC-20 reward asset')
        if self.template_id in PORTFOLIO_TEMPLATES:
            if self.community_settings.timed_hints:
                raise ValueError('HOST_HINTS_DISABLED')
            minimum = getattr(self.rules, 'min_players', 1)
            if self.admission.min_ready_to_start < minimum or self.admission.player_cap < minimum:
                raise ValueError('Too few ready players for this game')
            if self.template_id == 'prism-lines' and (self.admission.player_cap != 2 or self.admission.min_ready_to_start != 2):
                raise ValueError('Prism Lines requires exactly two ready players')
            if self.rewards.distribution == 'match' and any(slot.rank > (1 if self.template_id == 'prism-lines' else self.admission.player_cap) for slot in self.rewards.slots):
                raise ValueError('Reward rank exceeds the game player cap')
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
        if getattr(self.rules, "arena_mode", False) and self.admission.player_cap > 50:
            raise ValueError("movement arenas support at most 50 players")
        if isinstance(self.rules, BossRules) and self.rules.team_mode == "teams" and not self.rules.arena_mode:
            if self.admission.player_cap != 6 or self.admission.min_ready_to_start != 6:
                raise ValueError("team raids require six players, with all six ready")
        return self

    # ---------------------------------------------------------------- helpers

    def public_dict(self) -> dict:
        """Payload safe for an unauthenticated client (answers stripped)."""
        d = self.model_dump(mode="json")
        # Future host hints are durable private schedule records, not early clues.
        d.get("community_settings", {}).pop("timed_hints", None)
        if isinstance(self.rules, QuizRules):
            for question in d.get("rules", {}).get("questions", []) or []:
                question.pop("correct_index", None)
        return d

    def config_hash_input(self) -> str:
        """Canonical string hashed into the round's immutable config hash.

        Includes hidden answers so a settled round is bound to the exact quiz key.
        """
        # Moderation, creator hints and optional address collection are room metadata. They
        # must not change a gameplay/reward commitment or its restart hash.
        return json.dumps(self.model_dump(mode="json", by_alias=True, exclude={"community_settings", "waitlist"}), sort_keys=True, separators=(",", ":"))

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

