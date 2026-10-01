"""D16-D21 — Maze directional clue, Detective evidence, MEV queue, Idle efficiency,
Airdrop remaining requirements: the last catalog hint feeds, all non-leaking."""

import pytest

from center.games.recall_type_maze import MazeRaceEngine
from center.games.runner_detective_mev import (
    AirdropQuestEngine,
    ContractDetectiveEngine,
    IdleRigEngine,
    LevelRunnerEngine,
    MevRushEngine,
)
from center.rules_late import (
    AirdropQuestRules,
    ContractDetectiveRules,
    IdleRigRules,
    LevelRunnerRules,
    MazeRaceRules,
    MevRushRules,
)
from center.schema import Admission, RoomConfig, Rewards


SOLO = {"level-runner", "pattern-recall", "memory-match", "idle-rig", "puzzle-sprint"}


def _cfg(template_id: str, rules) -> RoomConfig:
    cap = 1 if template_id in SOLO else 2
    return RoomConfig(name=f"{template_id} room", template_id=template_id, rules=rules,
                      rewards=Rewards(),
                      admission=Admission(player_cap=cap, min_ready_to_start=1))


# ---------------------------------------------------------------- D16 Maze

def _maze() -> MazeRaceEngine:
    rules = MazeRaceRules(maze_size=15, duration_seconds=240, max_players=2)
    eng = MazeRaceEngine(_cfg("maze-race", rules), "r1", "seed-m", ["p1", "p2"])
    eng.start()
    return eng


def test_maze_hint_names_only_a_direction():
    eng = _maze()
    res = eng.act("p1", {"kind": "hint"}, now=1.0)
    assert res.ok, res.error
    assert res.private["direction"] in {"north", "south", "east", "west",
                                        "north-east", "north-west",
                                        "south-east", "south-west",
                                        "no-improving-move", "stay"}


def test_maze_hint_budget_and_snapshot():
    eng = _maze()
    for i in range(3):
        assert eng.act("p1", {"kind": "hint"}, now=1.0 + i).ok
    assert eng.act("p1", {"kind": "hint"}, now=5.0).error == "HINT_BUDGET_EXHAUSTED"
    restored = MazeRaceEngine.restore(eng.config, "r1", "seed-m", eng.snapshot())
    assert restored.hints_left["p1"] == 0


# ---------------------------------------------------------------- D17 Level Runner

def _runner() -> LevelRunnerEngine:
    rules = LevelRunnerRules(lane_template="classic", duration_seconds=60, score_cap=500)
    return LevelRunnerEngine(_cfg("level-runner", rules), "r1", "seed-l", ["p1"])


def test_runner_hint_reports_own_telemetry_only():
    eng = _runner()
    eng.start()
    eng.act("p1", {"kind": "step", "lane": 1}, now=1.0)
    res = eng.act("p1", {"kind": "hint"}, now=1.1)
    assert res.ok
    assert res.private["distance"] == eng.progress["p1"]
    assert set(res.private) <= {"distance", "lane", "crashed", "hintsLeft"}
    # the hint never reveals the obstacle stream
    assert "obstacles" not in str(res.private)


def test_runner_hint_budget():
    eng = _runner()
    eng.start()
    for i in range(3):
        assert eng.act("p1", {"kind": "hint"}, now=1.0 + i).ok
    assert eng.act("p1", {"kind": "hint"}, now=5.0).error == "HINT_BUDGET_EXHAUSTED"


# ---------------------------------------------------------------- D18 Detective

def _detective() -> ContractDetectiveEngine:
    rules = ContractDetectiveRules(duration_seconds=300, question_seconds=25)
    return ContractDetectiveEngine(_cfg("contract-detective", rules), "r1", "seed-d", ["p1"])


def test_detective_evidence_hint_is_guidance_not_answer():
    eng = _detective()
    eng.start()
    res = eng.act("p1", {"kind": "hint", "question": 0}, now=1.0)
    assert res.ok
    text = res.private["evidence"].lower()
    assert "focus" in text or "order" in text or "compare" in text or "boundary" in text
    # the correct choice text must not appear
    correct = eng.picks[0]["choices"][eng.picks[0]["answer"]]
    assert correct.lower() not in text


def test_detective_hint_one_use_then_refused():
    eng = _detective()
    eng.start()
    assert eng.act("p1", {"kind": "hint", "question": 0}, now=1.0).ok
    assert eng.act("p1", {"kind": "hint", "question": 1}, now=1.1).error == "HINT_BUDGET_EXHAUSTED"


# ---------------------------------------------------------------- D19 MEV Rush

def _mev() -> MevRushEngine:
    rules = MevRushRules(duration_seconds=120, opportunity_cadence_seconds=5,
                         bot_policy="allowed")
    return MevRushEngine(_cfg("mev-rush", rules), "r1", "seed-v", ["p1", "p2"])


def test_mev_queue_hint_is_explicitly_simulated():
    eng = _mev()
    eng.start(0.0)
    eng.tick(5.0)  # open the first opportunity
    res = eng.act("p1", {"kind": "hint"}, now=5.5)
    assert res.ok
    assert res.private["simulated"] is True
    assert isinstance(res.private["queuePosition"], int)
    assert res.private["myCaptures"] == 0


def test_mev_hint_budget():
    eng = _mev()
    eng.start(0.0)
    for i in range(3):
        assert eng.act("p1", {"kind": "hint"}, now=1.0 + i).ok
    assert eng.act("p1", {"kind": "hint"}, now=6.0).error == "HINT_BUDGET_EXHAUSTED"


# ---------------------------------------------------------------- D20 Idle Rig

def test_idle_efficiency_hint_is_own_and_server_clocked():
    rules = IdleRigRules(session_seconds=900, upgrade_tiers=5, inventory_cap=5000)
    eng = IdleRigEngine(_cfg("idle-rig", rules), "r1", "seed-i", ["p1"])
    eng.start(0.0)
    res = eng.act("p1", {"kind": "hint"}, now=5.0)
    assert res.ok
    assert res.private["ratePerSecond"] == eng._rate(eng.level["p1"])
    assert res.private["earned"] == eng.earned["p1"]
    assert set(res.private) == {"ratePerSecond", "nextUpgradeCost", "earned"}


# ---------------------------------------------------------------- D21 Airdrop Quest

def test_airdrop_remaining_requirements_is_wallet_bound():
    rules = AirdropQuestRules(campaign_name="Launch Week", budget_points=10000,
                              start_at=0, stop_at=4102444800,
                              achievements=["first-win", "share-run"])
    eng = AirdropQuestEngine(_cfg("airdrop-quest", rules), "r1", "seed-a", ["p1", "p2"])
    eng.start()
    eng.act("p1", {"kind": "complete", "achievement": "first-win"}, now=1.0)
    res = eng.act("p1", {"kind": "hint"}, now=1.1)
    assert res.ok
    assert res.private["remaining"] == ["share-run"]
    assert res.private["completed"] == ["first-win"]
    # p2's own view is independent
    res2 = eng.act("p2", {"kind": "hint"}, now=1.2)
    assert sorted(res2.private["remaining"]) == ["first-win", "share-run"]


def test_airdrop_hint_never_issues_entitlement():
    rules = AirdropQuestRules(campaign_name="Launch Week", budget_points=10000,
                              start_at=0, stop_at=4102444800, achievements=["first-win"])
    eng = AirdropQuestEngine(_cfg("airdrop-quest", rules), "r1", "seed-a", ["p1"])
    eng.start()
    eng.act("p1", {"kind": "hint"}, now=1.0)
    assert eng.achieved["p1"] == set()  # a hint cannot complete a quest


def test_all_19_formats_now_implemented_in_registry():
    from center.games.hints import HINT_POLICIES
    expected = {
        "number-hunt", "live-quiz", "memory-match", "token-catch", "reaction-duel",
        "puzzle-sprint", "hash-hunt", "boss-raid", "rps-duel", "reward-grid",
        "logo-bingo", "pattern-recall", "typing-sprint", "maze-race", "level-runner",
        "contract-detective", "mev-rush", "idle-rig", "airdrop-quest",
    }
    assert expected <= set(HINT_POLICIES)
    for tid in expected:
        pol = HINT_POLICIES[tid]
        assert pol.implemented, f"{tid} still marked unimplemented"
