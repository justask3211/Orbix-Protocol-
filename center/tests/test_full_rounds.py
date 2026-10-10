"""Full-round acceptance for all eight engines, driven through the room runtime.

For every template this asserts the real, non-negotiable outputs: the round reaches a
claimable state, the ranking is produced, entitlements are written, the merkle proof for
each entitlement rebuilds the recorded root, and the fairness record carries the
pre-round commitment and its reveal.

Plus: a mid-round restart must resume from the snapshot with identical secret state.
"""

from __future__ import annotations

import json

import pytest

from center import lifecycle as lc
from center import settlement as st
from center.games import ENGINES
from center.games.hash_hunt import proof_hash
from center.room import PLACEHOLDER_ESCROW, DEFAULT_CHAIN_ID, Hub, RoomRuntime
from center.schema import RoomConfig
from center.store import Store
from center.vault import VaultService

HOST = "0x" + "aa" * 20
GUEST = "0x" + "bb" * 20

SOLO = {"memory-match", "puzzle-sprint"}


def solve_puzzle(board: list[int], size: int) -> list[int]:
    """BFS over the 8-puzzle: returns the tile numbers to move, in order."""
    from collections import deque

    goal = tuple(list(range(1, size * size)) + [0])
    start = tuple(board)
    if start == goal:
        return []
    seen = {start: None}
    queue = deque([start])
    while queue:
        state = queue.popleft()
        blank = state.index(0)
        r, c = divmod(blank, size)
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if not (0 <= nr < size and 0 <= nc < size):
                continue
            j = nr * size + nc
            nxt = list(state)
            nxt[blank], nxt[j] = nxt[j], nxt[blank]
            key = tuple(nxt)
            if key in seen:
                continue
            seen[key] = (state, state[j])
            if key == goal:
                moves = []
                node = key
                while seen[node] is not None:
                    prev, tile = seen[node]
                    moves.append(tile)
                    node = prev
                return list(reversed(moves))
            queue.append(key)
    raise AssertionError("puzzle has no solution")


def draw_fingerprint(engine, template_id: str):
    """The pure seed-derived secret of a template, ignoring play-dependent state."""
    if template_id == "number-hunt":
        return list(engine.targets)
    if template_id == "hash-hunt":
        return (engine.public_seed, engine.target, engine.chain_id, engine.escrow)
    if template_id == "memory-match":
        return list(engine.layout)
    if template_id == "token-catch":
        return [(s.index, s.at_ms, s.lane, s.hazard, s.points) for s in engine.spawns]
    raise AssertionError(template_id)


def build(tmp_path, template_id: str, rules: dict, *, player_cap: int = 8, min_ready: int = 2,
          name: str | None = None) -> RoomRuntime:
    store = Store(str(tmp_path / f"{template_id}.db"))
    vault = VaultService(store)
    vault.deposit(HOST, 10_000)
    cfg = RoomConfig(
        template_id=template_id,
        template_version=1,  # Preserve historical manual-reveal contract coverage.
        name=name or f"{template_id} test room",
        visibility="public",
        mode="preview",
        rules={"templateId": template_id, **rules},
        admission={"player_cap": player_cap, "min_ready_to_start": min_ready},
        access={"vault_mode": "simulated", "required_amount": 10},
        rewards={"kind": "preview-points", "slots": [{"rank": 1, "points": 100}, {"rank": 2, "points": 50}]},
    )
    rt = RoomRuntime.create(store, vault, Hub(), owner=HOST, config=cfg)
    rt.join(HOST)
    if template_id not in SOLO:
        rt.join(GUEST)
    rt.set_ready(HOST)
    if template_id not in SOLO:
        rt.set_ready(GUEST)
    return rt


async def play(rt: RoomRuntime, start: float = 1000.0) -> dict:
    """Drive one round to completion using server-visible secret state, as a scripted client."""
    await rt.start(start)
    e = rt.engine
    tid = rt.config.template_id
    now = start + 0.5
    guard = 0

    if tid == "number-hunt":
        out = await rt.act(HOST, {"kind": "guess", "number": e.targets[0]}, now)
        assert out["ok"], out
    elif tid == "live-quiz":
        while not e.finished and guard < 60:
            guard += 1
            i = e.q_index
            q = rt.config.rules.questions[i]
            for p in (HOST, GUEST):
                r = await rt.act(p, {"kind": "answer", "questionIndex": i, "choice": q.correct_index}, now)
                assert r["ok"], r
            now += rt.config.rules.question_seconds + 0.2
            await rt.tick(now)
    elif tid == "memory-match":
        by_icon: dict[object, list[int]] = {}
        for idx, icon in enumerate(e.layout):
            by_icon.setdefault(icon, []).append(idx)
        for pair in by_icon.values():
            for idx in pair:
                assert (await rt.act(HOST, {"kind": "flip", "index": idx}, now))["ok"]
        assert e.finished, "matching every pair must finish the round"
    elif tid == "token-catch":
        for i, spawn in enumerate(e.spawns):
            if spawn.hazard:
                continue
            at = start + spawn.at_ms / 1000.0
            assert (await rt.act(HOST, {"kind": "lane", "lane": spawn.lane}, at))["ok"]
            await rt.act(HOST, {"kind": "catch", "spawn": i}, at + 0.005)
        now = start + rt.config.rules.duration_seconds + 1
        await rt.tick(now)
    elif tid == "reaction-duel":
        while not e.finished and guard < 40:
            guard += 1
            r = e.round_index
            if e.phase == "commit":
                assert (await rt.act(HOST, {"kind": "commit", "choice": "rock", "salt": f"s{r}"}, now))["ok"]
                assert (await rt.act(GUEST, {"kind": "commit", "choice": "scissors", "salt": f"t{r}"}, now))["ok"]
            elif e.phase == "reveal":
                assert (await rt.act(HOST, {"kind": "reveal", "choice": "rock", "salt": f"s{r}"}, now))["ok"]
                assert (await rt.act(GUEST, {"kind": "reveal", "choice": "scissors", "salt": f"t{r}"}, now))["ok"]
            now += 1.0
    elif tid == "puzzle-sprint":
        # Solve it for real by breadth-first search over the board, then play the moves.
        for tile in solve_puzzle(list(e.board), e.size):
            out = await rt.act(HOST, {"kind": "move", "tile": tile}, now)
            assert out["ok"], out
        assert e.completed_by == HOST, "the solved board must be recorded"
    elif tid == "hash-hunt":
        nonce = 0
        while nonce < 200_000:
            value = proof_hash(e.chain_id, e.escrow, e.round_id, e.public_seed, HOST, nonce)
            if value < e.target:
                break
            nonce += 1
        out = await rt.act(HOST, {"kind": "submit", "nonce": nonce}, now)
        assert out["ok"], out
    elif tid == "boss-raid":
        while not e.finished and guard < 60:
            guard += 1
            now += 0.5
            await rt.act(HOST, {"kind": "hit", "power": 100}, now)
            await rt.act(GUEST, {"kind": "hit", "power": 100}, now)
        assert e.slain, "the boss must be slain"

    if not e.finished:
        now = start + max(getattr(rt.config.rules, "duration_seconds", 120), 200) + 5
        await rt.tick(now)
    assert e.finished or rt.status == lc.CLAIMABLE, f"{tid} never finished (status={rt.status})"
    if rt.status != lc.CLAIMABLE:
        await rt.finish(now)
    return {"roundId": rt.round_id, "templateId": tid}


RULES = {
    "number-hunt": dict(digits=4, min=1111, max=9999, guess_budget=20, duration_seconds=60, hints="on",
                        target_count=1, win_mode="first-hit", guess_cooldown_ms=300),
    "live-quiz": dict(
        question_seconds=10, scoring="accuracy", pass_percentage=60, top_n=3,
        questions=[{"prompt": f"Q{i}", "choices": ["a", "b", "c"], "correct_index": i % 3} for i in range(5)],
    ),
    "memory-match": dict(pairs=6, duration_seconds=120, move_cap=100, score_mode="moves", top_n=3),
    "token-catch": dict(duration_seconds=15, spawn_per_second=2, lanes=3, fall_speed="normal",
                        hazard_chance_pct=0, combo_cap=3, win_threshold=5, top_n=3),
    "reaction-duel": dict(rounds=3, choice_window_seconds=5, reveal_window_seconds=3, choice_set="classic"),
    "puzzle-sprint": dict(board=3, duration_seconds=60, move_cap=300, score_mode="time", top_n=3),
    "hash-hunt": dict(duration_seconds=30, difficulty_bits=8, win_mode="first-valid", leaderboard_size=10),
    "boss-raid": dict(min_players=2, max_players=4, duration_seconds=60, boss_health=200,
                      action_cooldown_ms=300, contribution_cap=1000, min_contribution=10,
                      reward_rule="proportional", top_n=3),
}


@pytest.mark.parametrize("template_id", sorted(RULES))
async def test_full_round_for_every_engine(tmp_path, template_id):
    solo = template_id in SOLO
    rt = build(
        tmp_path, template_id, RULES[template_id],
        player_cap=1 if solo else (2 if template_id == "reaction-duel" else 4),
        min_ready=1 if solo else 2,
    )
    await play(rt)

    assert rt.status == lc.CLAIMABLE
    rnd = rt.store.get_round(rt.round_id)
    assert rnd["state"] == lc.CLAIMABLE
    assert rnd["commit_hash"].startswith("0x") and rnd["seed"]

    rows = rt.store.entitlements_for_round(rt.round_id)
    assert rows, f"{template_id} produced no entitlement"
    assert rows[0]["claim_id"].startswith("0x")
    assert st.payment_code(rows[0]["claim_id"]).startswith("OC2-")

    # Every stored proof must rebuild the recorded merkle root.
    for row in rows:
        _, leaf = st.entitlement_leaf(
            chain_id=DEFAULT_CHAIN_ID, escrow=PLACEHOLDER_ESCROW, round_id=row["round_id"],
            winner=row["winner"], slot_id=row["slot_id"], allocation_nonce=0,
            asset_kind=row["asset_kind"], asset_contract=row["asset_contract"] or ("0x" + "00" * 20),
            token_id=row["token_id"], amount=int(row["amount"]),
        )
        node = leaf
        for step in json.loads(row["proof_json"]):
            node = st._hash_pair(node, bytes.fromhex(step.removeprefix("0x")))
        assert "0x" + node.hex() == rnd["merkle_root"], f"{template_id}: proof did not rebuild the root"

    fair = rt.fairness()
    assert fair["commitHash"] == rnd["commit_hash"]
    assert fair["seed"] == rnd["seed"] and fair["merkleRoot"].startswith("0x")

    results = rt.results()
    assert results["results"], "no ranking produced"
    assert all(entry["who"] in {HOST, GUEST} for entry in results["results"])

    # The revealed seed reproduces the same secret draw: anyone can re-derive the
    # commitment's contents after the fact. (Action-dependent state is not re-derived.)
    if template_id in {"number-hunt", "hash-hunt", "memory-match", "token-catch"}:
        replay = ENGINES[template_id](rt.config, rt.round_id, rnd["seed"], list(rt.engine.participants))
        replay.start(1000.0)
        assert draw_fingerprint(replay, template_id) == draw_fingerprint(rt.engine, template_id)

    # A terminal room never accepts further play.
    late = await rt.act(HOST, {"kind": "guess", "number": 1111}, 10_000.0)
    assert late["ok"] is False


async def test_restart_resumes_the_round_from_snapshot(tmp_path):
    rt = build(tmp_path, "number-hunt", RULES["number-hunt"], player_cap=4, min_ready=2)
    await rt.start(1000.0)
    target = rt.engine.targets[0]
    await rt.act(HOST, {"kind": "guess", "number": 9999 if target == 1111 else 1111}, 1001.0)
    before = rt.engine.snapshot()

    # Simulate a process restart: fresh handles onto the same database file.
    store2 = Store(str(tmp_path / "number-hunt.db"))
    vault2 = VaultService(store2)
    resumed = RoomRuntime.load(store2, vault2, Hub(), rt.room_id)
    assert resumed is not None
    assert resumed.status == lc.RUNNING
    assert resumed.round_id == rt.round_id
    assert resumed.engine is not None, "the round must resume with a live engine"
    assert resumed.engine.snapshot() == before, "secret state must survive a restart"
    assert resumed.engine.targets == rt.engine.targets

    # The resumed runtime can still settle the round.
    await resumed.act(GUEST, {"kind": "guess", "number": target}, 1002.0)
    assert resumed.status == lc.CLAIMABLE
    rows = store2.entitlements_for_round(rt.round_id)
    assert rows and rows[0]["winner"] == GUEST


async def test_a_round_nobody_wins_pays_nobody(tmp_path):
    """The server must never invent a winner: no objective met means no allocation."""
    rt = build(tmp_path, "number-hunt", RULES["number-hunt"], player_cap=4, min_ready=2)
    await rt.start(1000.0)
    await rt.act(HOST, {"kind": "guess", "number": 1111}, 1001.0)
    # Close the round on the clock without anyone finding the target.
    await rt.tick(1000.0 + rt.config.rules.duration_seconds + 1)
    assert rt.status == lc.CLAIMABLE
    assert rt.engine.claimed == {}, "nobody should have claimed a target"
    assert rt.store.entitlements_for_round(rt.round_id) == [], "a round with no winner must pay nothing"
    assert rt.results()["results"], "the ranking is still reported for transparency"

    # And a catch round where every player only ever missed pays nobody either.
    rt2 = build(tmp_path, "token-catch", RULES["token-catch"], player_cap=4, min_ready=2)
    await rt2.start(1000.0)
    await rt2.tick(1000.0 + rt2.config.rules.duration_seconds + 1)
    assert rt2.store.entitlements_for_round(rt2.round_id) == []
