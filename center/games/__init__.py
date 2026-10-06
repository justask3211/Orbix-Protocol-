"""Engine registry: templateId -> engine class.

Each template has its own reducer, validator and tests. Re-skinning one engine as another
is explicitly out of scope (manual section 3, final paragraph).
"""

from __future__ import annotations

from center.games.base import ActionResult, Engine, Entitlement, StreamRNG, commit_hash, verify_commit
from center.games.boss import BossEngine
from center.games.catch import CatchEngine
from center.games.duel import DuelEngine
from center.games.grid_bingo import LogoBingoEngine, RewardGridEngine
from center.games.hash_hunt import HashHuntEngine
from center.games.memory import MemoryEngine
from center.games.number_hunt import NumberHuntEngine
from center.games.puzzle import PuzzleEngine
from center.games.quiz import QuizEngine
from center.games.recall_type_maze import MazeRaceEngine, PatternRecallEngine, TypingSprintEngine
from center.games.runner_detective_mev import (
    AirdropQuestEngine,
    ContractDetectiveEngine,
    IdleRigEngine,
    LevelRunnerEngine,
    MevRushEngine,
)
from center.games.rps_duel import RpsDuelEngine
from center.games.arena import BossArenaEngine, CatchArenaEngine, CombatDuelEngine

ENGINES: dict[str, type[Engine]] = {
    "number-hunt": NumberHuntEngine,
    "live-quiz": QuizEngine,
    "memory-match": MemoryEngine,
    "token-catch": CatchEngine,
    "reaction-duel": DuelEngine,
    "combat-duel": CombatDuelEngine,
    "puzzle-sprint": PuzzleEngine,
    "hash-hunt": HashHuntEngine,
    "boss-raid": BossEngine,
    # ---- later catalog (G09-G20) ----
    "rps-duel": RpsDuelEngine,
    "reward-grid": RewardGridEngine,
    "logo-bingo": LogoBingoEngine,
    "pattern-recall": PatternRecallEngine,
    "typing-sprint": TypingSprintEngine,
    "maze-race": MazeRaceEngine,
    "level-runner": LevelRunnerEngine,
    "contract-detective": ContractDetectiveEngine,
    "mev-rush": MevRushEngine,
    "idle-rig": IdleRigEngine,
    "airdrop-quest": AirdropQuestEngine,
}


def engine_for(config):
    if getattr(config.rules, 'arena_mode', False):
        return {'token-catch': CatchArenaEngine, 'boss-raid': BossArenaEngine}[config.template_id]
    return ENGINES[config.template_id]

__all__ = [
    "ENGINES",
    "Engine",
    "ActionResult",
    "Entitlement",
    "StreamRNG",
    "commit_hash",
    "verify_commit",
    "AirdropQuestEngine",
    "BossEngine",
    "CatchEngine",
    "ContractDetectiveEngine",
    "DuelEngine",
    "HashHuntEngine",
    "IdleRigEngine",
    "LevelRunnerEngine",
    "LogoBingoEngine",
    "MazeRaceEngine",
    "MemoryEngine",
    "MevRushEngine",
    "NumberHuntEngine",
    "PatternRecallEngine",
    "PuzzleEngine",
    "QuizEngine",
    "RewardGridEngine",
    "RpsDuelEngine",
    "TypingSprintEngine",
]
