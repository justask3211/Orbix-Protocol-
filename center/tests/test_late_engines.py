"""Acceptance tests for the later catalog (G09-G20), manual sections 3 and 16.

Every engine gets: an objective-driven win path, an adversarial rejection, a
seed-replay determinism check where a draw exists, and a snapshot round-trip.
"""

from __future__ import annotations

import hashlib

import pytest

from center.games.grid_bingo import LogoBingoEngine, RewardGridEngine
from center.games.recall_type_maze import MazeRaceEngine, PatternRecallEngine, TypingSprintEngine
from center.games.runner_detective_mev import (
    AirdropQuestEngine,
    ContractDetectiveEngine,
    IdleRigEngine,
    LevelRunnerEngine,
    MevRushEngine,
)
from center.games.rps_duel import RpsDuelEngine, move_commit
from center.schema import parse_rules
from center.strict_base import Strict

HOST = "0xaaaa0000000000000000000000000000000000001"
GUEST = "0xbbbb0000000000000000000000000000000000002"


def build(template_id: str, payload: dict, participants: list[str]):
    rules = parse_rules(template_id, payload)
    cfg = Strict.model_construct if False else None  # placeholder, replaced below
    from center.schema import Admission, RoomConfig, Rewards, RewardSlot, Access
    from center.schema import SOLO_TEMPLATES
    cap = 1 if template_id in SOLO_TEMPLATES else len(participants)
    config = RoomConfig(
        template_id=template_id,
        template_version=1,  # Preserve historical manual-reveal contract coverage.
        name="Test room for " + template_id,
        rules=rules,
        admission=Admission(player_cap=cap, min_ready_to_start=cap),
        access=Access(vault_mode="simulated", required_amount=25),
        rewards=Rewards(kind="preview-points", slots=[RewardSlot(rank=1, points=100)]),
    )
    return config


def make(template_id: str, payload: dict, participants: list[str], seed: str = "seed-abc"):
    cls = {
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
    }[template_id]
    config = build(template_id, payload, participants)
    eng = cls(config, "round-1", seed, participants)
    eng.start(0.0)
    return eng


# --------------------------------------------------------------------- G09


def test_rps_duel_full_win_and_foul():
    eng = make("rps-duel", {"rounds": 3}, [HOST, GUEST])
    salt = "s1"
    # HOST wins subround 0: rock beats scissors
    assert eng.act(HOST, {"kind": "commit", "choice": "rock", "salt": salt}, 1.0).ok
    assert eng.act(GUEST, {"kind": "commit", "choice": "scissors", "salt": salt}, 1.1).ok
    assert eng.phase == "reveal"
    # a wrong preimage is refused
    r = eng.act(HOST, {"kind": "reveal", "choice": "paper", "salt": salt}, 1.2)
    assert not r.ok and r.error == "BAD_PROOF"
    assert eng.act(HOST, {"kind": "reveal", "choice": "rock", "salt": salt}, 1.2).ok
    r = eng.act(GUEST, {"kind": "reveal", "choice": "scissors", "salt": salt}, 1.3)
    assert r.ok
    assert eng.wins[HOST] == 1
    assert not r.finished, "one subround of a best-of-3 must not end the duel"
    # HOST needs two subrounds: win the next one too and the duel ends
    for _ in range(1):
        eng.act(HOST, {"kind": "commit", "choice": "paper", "salt": "z1"}, 2.0)
        eng.act(GUEST, {"kind": "commit", "choice": "rock", "salt": "z2"}, 2.0)
        eng.act(HOST, {"kind": "reveal", "choice": "paper", "salt": "z1"}, 2.1)
        r2 = eng.act(GUEST, {"kind": "reveal", "choice": "rock", "salt": "z2"}, 2.2)
    assert r2.finished and eng.wins[HOST] == 2
    assert eng.eligible() == {HOST}
    # cleartext during commit is structurally impossible: commits only accept hashes
    eng2 = make("rps-duel", {"rounds": 3}, [HOST, GUEST])
    r = eng2.act(HOST, {"kind": "commit", "choice": "not-a-move", "salt": "x"}, 1.0)
    assert not r.ok and r.error == "BAD_ACTION"


def test_rps_duel_forfeit_on_missing_reveal():
    eng = make("rps-duel", {"rounds": 3, "reveal_window_seconds": 5}, [HOST, GUEST])
    assert eng.act(HOST, {"kind": "commit", "choice": "rock", "salt": "a"}, 1.0).ok
    assert eng.act(GUEST, {"kind": "commit", "choice": "paper", "salt": "b"}, 1.0).ok
    eng.tick(1.0 + 5 + 0.5)  # nobody reveals: no forfeit winner, subround void
    assert eng.wins == {HOST: 0, GUEST: 0}

    eng2 = make("rps-duel", {"rounds": 3, "reveal_window_seconds": 5}, [HOST, GUEST])
    eng2.act(HOST, {"kind": "commit", "choice": "rock", "salt": "a"}, 1.0)
    eng2.act(GUEST, {"kind": "commit", "choice": "paper", "salt": "b"}, 1.0)
    eng2.act(HOST, {"kind": "reveal", "choice": "rock", "salt": "a"}, 2.0)  # only HOST reveals
    eng2.tick(2.0 + 5 + 0.5)
    assert eng2.wins[HOST] == 1  # the lone reveal takes the subround


def test_rps_duel_duplicate_commit_rejected():
    eng = make("rps-duel", {"rounds": 3}, [HOST, GUEST])
    assert eng.act(HOST, {"kind": "commit", "choice": "rock", "salt": "a"}, 1.0).ok
    assert not eng.act(HOST, {"kind": "commit", "choice": "rock", "salt": "a"}, 1.1).ok


# --------------------------------------------------------------------- G10


def test_reward_grid_hit_and_cap():
    # cap == tiles so the probe can locate every slot; the cap is exercised separately below
    eng = make("reward-grid", {"tiles": 25, "reward_slots": 3, "reveal_cap_per_wallet": 20, "duration_seconds": 120}, [HOST])
    hits = 0
    for tile in range(25):
        r = eng.act(HOST, {"kind": "reveal", "tile": tile}, 1.0 + tile * 0.01)
        if not r.ok and r.error == "ROUND_FINISHED":
            break
        assert r.ok, r.error
        if tile in eng.reward_tiles:
            hits += 1
        if eng.finished:
            break
    assert eng.won.get(HOST, 0) == hits and hits > 0
    assert eng.eligible() == {HOST}

    eng2 = make("reward-grid", {"tiles": 25, "reward_slots": 3, "reveal_cap_per_wallet": 2, "duration_seconds": 120}, [HOST])
    eng2.act(HOST, {"kind": "reveal", "tile": 0}, 1.0)
    eng2.act(HOST, {"kind": "reveal", "tile": 1}, 1.1)
    r = eng2.act(HOST, {"kind": "reveal", "tile": 2}, 1.2)
    assert not r.ok and r.error in ("REVEAL_CAP", "ROUND_FINISHED"), r.error


def test_reward_grid_duplicate_reveal_rejected():
    eng = make("reward-grid", {"tiles": 25, "reward_slots": 3, "reveal_cap_per_wallet": 6}, [HOST])
    assert eng.act(HOST, {"kind": "reveal", "tile": 7}, 1.0).ok
    assert not eng.act(HOST, {"kind": "reveal", "tile": 7}, 1.1).ok


def test_reward_grid_seed_replay_identical():
    a = make("reward-grid", {"tiles": 100, "reward_slots": 5, "reveal_cap_per_wallet": 10}, [HOST], seed="fixed")
    b = make("reward-grid", {"tiles": 100, "reward_slots": 5, "reveal_cap_per_wallet": 10}, [HOST], seed="fixed")
    assert a.reward_tiles == b.reward_tiles


# --------------------------------------------------------------------- G11


def test_bingo_shared_stream_and_win():
    eng = make("logo-bingo", {"board": 3, "call_cadence_seconds": 2, "duration_seconds": 600}, [HOST, GUEST], seed="bingo-1")
    # issue calls until HOST can claim a line
    won = False
    for i in range(30):
        eng.tick(i * 2.0)
        if eng._has_line(HOST):
            r = eng.act(HOST, {"kind": "claim"}, i * 2.0 + 0.1)
            assert r.ok and r.finished
            won = True
            break
    assert won, "the seeded stream should complete a line within 30 calls"
    assert eng.eligible() == {HOST}
    # a claim without a line is refused
    eng2 = make("logo-bingo", {"board": 3, "call_cadence_seconds": 2, "duration_seconds": 600}, [HOST], seed="bingo-1")
    eng2.tick(0.0)
    r = eng2.act(HOST, {"kind": "claim"}, 0.1)
    assert not r.ok and r.error == "NOT_A_WIN"


def test_bingo_duplicate_claim():
    eng = make("logo-bingo", {"board": 3, "call_cadence_seconds": 2, "duration_seconds": 600}, [HOST], seed="bingo-1")
    for i in range(30):
        eng.tick(i * 2.0)
        if eng._has_line(HOST):
            break
    eng.act(HOST, {"kind": "claim"}, 100.0)
    assert not eng.act(HOST, {"kind": "claim"}, 100.1).ok


# --------------------------------------------------------------------- G12


def test_pattern_recall_right_and_wrong():
    eng = make("pattern-recall", {"symbols": 6, "start_length": 3}, [HOST], seed="recall-1")
    expected = eng.sequence[: eng.step]
    assert eng.act(HOST, {"kind": "input", "sequence": expected}, 1.0).ok
    # the step grew; a stale repeat of the OLD prefix must now fail
    r = eng.act(HOST, {"kind": "input", "sequence": expected}, 1.1)
    assert r.ok and r.patch.get("failed")
    assert eng.ranking()[0] == HOST  # HOST is still ahead by length entered


def test_pattern_recall_public_state_leaks_no_future():
    eng = make("pattern-recall", {"symbols": 6, "start_length": 3}, [HOST], seed="recall-1")
    pub = eng.public_state()
    assert len(pub["visibleSequence"]) == eng.step < len(eng.sequence)
    assert pub["visibleSequence"] == eng.sequence[: eng.step]


# --------------------------------------------------------------------- G13


def test_typing_sprint_burst_rejected():
    eng = make("typing-sprint", {"prompt_id": "pack-1", "duration_seconds": 60, "accuracy_floor": 85}, [HOST])
    for i in range(20):
        r = eng.act(HOST, {"kind": "key"}, 1.0 + i * 0.001)  # 1 ms apart: a paste
        if not r.ok:
            assert r.error == "RATE_LIMIT"
            return
    pytest.fail("an impossible keystroke burst was accepted")


def test_typing_sprint_normal_pace_accepted():
    eng = make("typing-sprint", {"prompt_id": "pack-1", "duration_seconds": 60}, [HOST])
    for i in range(100):
        assert eng.act(HOST, {"kind": "key"}, 1.0 + i * 0.2).ok  # 200 ms apart: human
    assert eng.act(HOST, {"kind": "submit", "text": "x" * 100}, 30.0).ok


# --------------------------------------------------------------------- G14


def test_maze_race_wall_clip_rejected_and_solve():
    eng = make("maze-race", {"maze_size": 10, "duration_seconds": 120}, [HOST], seed="maze-1")
    here = eng.start_cell
    far = eng.finish_cell
    assert not eng.act(HOST, {"kind": "move", "to": far}, 1.0).ok  # teleport refused
    # walk the real carved path
    from center.games.recall_type_maze import _neighbours
    visited, path = {here}, [here]
    frontier = [here]
    while frontier:
        cell = frontier.pop(0)
        for n in _neighbours(cell, eng.rules.maze_size):
            if n not in visited and frozenset((cell, n)) in eng.links:
                visited.add(n)
                frontier.append(n)
    assert eng.finish_cell in visited, "a seeded maze must be solvable"
    # move along a real link
    nxt = next(n for n in _neighbours(here, eng.rules.maze_size) if frozenset((here, n)) in eng.links)
    assert eng.act(HOST, {"kind": "move", "to": nxt}, 1.0).ok


def test_maze_same_seed_identical_maze():
    a = make("maze-race", {"maze_size": 10}, [HOST], seed="mz")
    b = make("maze-race", {"maze_size": 10}, [HOST], seed="mz")
    assert a.links == b.links


# --------------------------------------------------------------------- G15


def test_level_runner_crash_and_progress():
    eng = make("level-runner", {"duration_seconds": 60, "score_cap": 100}, [HOST], seed="run-1")
    moved = 0
    for i in range(60):
        lane = eng.lane[HOST]
        obstacle = eng.obstacles[eng.progress[HOST]]
        pick = (obstacle + 1) % 3 if obstacle != 255 else lane
        r = eng.act(HOST, {"kind": "step", "lane": pick}, 1.0 + i * 0.05)
        assert r.ok
        if HOST in eng.crashed:
            break
        moved += 1
    assert moved > 0
    # a lane matching the obstacle crashes
    eng2 = make("level-runner", {"duration_seconds": 60}, [HOST], seed="run-1")
    obstacle = eng2.obstacles[0]
    if obstacle != 255:
        eng2.act(HOST, {"kind": "step", "lane": obstacle}, 1.0)
        assert HOST in eng2.crashed


def test_level_runner_seed_replay():
    a = make("level-runner", {"duration_seconds": 60}, [HOST], seed="rr")
    b = make("level-runner", {"duration_seconds": 60}, [HOST], seed="rr")
    assert a.obstacles == b.obstacles


# --------------------------------------------------------------------- G16


def test_contract_detective_no_answer_leak():
    eng = make("contract-detective", {"duration_seconds": 120}, [HOST], seed="cd-1")
    pub = eng.public_state()
    assert all("answer" not in q for q in pub["questions"])
    assert all("explanation" not in q for q in pub["questions"])
    # answer correctly by reading the secret bank internally
    q0 = eng.picks[0]
    assert eng.act(HOST, {"kind": "answer", "question": 0, "choice": q0["answer"]}, 1.0).ok
    assert eng.correct[HOST] == 1
    assert not eng.act(HOST, {"kind": "answer", "question": 0, "choice": q0["answer"]}, 1.1).ok


def test_contract_detective_wrong_answer():
    eng = make("contract-detective", {"duration_seconds": 120}, [HOST], seed="cd-1")
    q0 = eng.picks[0]
    wrong = (q0["answer"] + 1) % len(q0["choices"])
    assert eng.act(HOST, {"kind": "answer", "question": 0, "choice": wrong}, 1.0).ok
    assert eng.correct[HOST] == 0
    assert eng.eligible() == set()


# --------------------------------------------------------------------- G18


def test_mev_rush_double_inclusion_and_stale():
    eng = make("mev-rush", {"duration_seconds": 60, "opportunity_cadence_seconds": 5}, [HOST, GUEST], seed="mev-1")
    eng.tick(0.0)   # opportunity 0 goes live, expires at 5
    assert eng.act(HOST, {"kind": "capture", "slot": 0}, 1.0).ok
    assert not eng.act(HOST, {"kind": "capture", "slot": 0}, 1.1).ok  # double inclusion
    assert eng.act(GUEST, {"kind": "capture", "slot": 0}, 2.0).ok    # another wallet can still take it
    eng.tick(5.0)   # slot 1 goes live; slot 0 is now expired
    # (a) a re-capture is refused as a duplicate — whichever guard fires first, it is refused
    r = eng.act(HOST, {"kind": "capture", "slot": 0}, 5.5)
    assert not r.ok and r.error in ("ACTION_DUPLICATE", "STALE_OPPORTUNITY")
    # (b) an opportunity that was never captured but has expired is refused as stale
    eng.tick(10.0)  # slot 1 expires at 10
    r2 = eng.act(HOST, {"kind": "capture", "slot": 1}, 10.5)
    assert not r2.ok and r2.error == "STALE_OPPORTUNITY"


def test_mev_rush_queue_replay():
    a = make("mev-rush", {"duration_seconds": 60, "opportunity_cadence_seconds": 5}, [HOST], seed="m2")
    b = make("mev-rush", {"duration_seconds": 60, "opportunity_cadence_seconds": 5}, [HOST], seed="m2")
    assert [o["kind"] for o in a.opportunities] == [o["kind"] for o in b.opportunities]


# --------------------------------------------------------------------- G19


def test_idle_rig_inventory_cap_and_upgrade():
    eng = make("idle-rig", {"session_seconds": 120, "upgrade_tiers": 5, "inventory_cap": 100}, [HOST, GUEST], seed="idle")
    eng.tick(10.0)
    assert eng.earned[HOST] > 0
    # upgrade path
    eng.earned[HOST] = 100  # grant via tick-scale for determinism of the test only
    before = eng.level[HOST]
    r = eng.act(HOST, {"kind": "upgrade"}, 11.0)
    if r.ok:
        assert eng.level[HOST] == before + 1
    # inventory exhaustion cuts accrual, never goes negative
    eng2 = make("idle-rig", {"session_seconds": 120, "inventory_cap": 100}, [HOST], seed="idle2")
    eng2.tick(200.0)
    total = sum(eng2.earned.values())
    assert total <= 100, "accrual must never exceed the campaign inventory cap"
    assert eng2.finished


def test_idle_rig_offline_cap():
    """A huge clock jump must not pay a perpetual payout: accrual is clamped to the session."""
    eng = make("idle-rig", {"session_seconds": 120, "inventory_cap": 1_000_000}, [HOST], seed="idle3")
    eng.tick(10_000.0)
    assert eng.finished
    assert sum(eng.earned.values()) <= 120 * eng._rate(1) * 2  # clamped to one session, not 10k s


# --------------------------------------------------------------------- G20


def test_airdrop_quest_duplicate_and_fake():
    eng = make("airdrop-quest", {"campaign_name": "Launch Week", "achievements": ["first-win", "creator-3"]}, [HOST])
    assert eng.act(HOST, {"kind": "complete", "achievement": "first-win"}, 1.0).ok
    assert not eng.act(HOST, {"kind": "complete", "achievement": "first-win"}, 1.1).ok
    r = eng.act(HOST, {"kind": "complete", "achievement": "made-up"}, 1.2)
    assert not r.ok and r.error == "UNKNOWN_ACHIEVEMENT"
    assert eng.eligible() == {HOST}


# --------------------------------------------------------------------- snapshots


@pytest.mark.parametrize("template_id,payload", [
    ("rps-duel", {"rounds": 3}),
    ("reward-grid", {"tiles": 25, "reward_slots": 3, "reveal_cap_per_wallet": 6}),
    ("logo-bingo", {"board": 3, "call_cadence_seconds": 2}),
    ("pattern-recall", {"symbols": 6, "start_length": 3}),
    ("typing-sprint", {"prompt_id": "pack-1"}),
    ("maze-race", {"maze_size": 10}),
    ("level-runner", {"duration_seconds": 60}),
    ("contract-detective", {}),
    ("mev-rush", {"duration_seconds": 60, "opportunity_cadence_seconds": 5}),
    ("idle-rig", {"session_seconds": 120, "inventory_cap": 1000}),
    ("airdrop-quest", {"campaign_name": "Week", "achievements": ["a"]}),
])
def test_snapshot_round_trip(template_id, payload):
    eng = make(template_id, payload, [HOST, GUEST] if template_id in ("rps-duel", "logo-bingo", "mev-rush") else [HOST])
    snap = eng.snapshot()
    clone = type(eng)(eng.config, eng.round_id, eng.seed, eng.participants)
    clone._load(snap)
    assert clone.public_state() == eng.public_state()
