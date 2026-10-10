"""Cross-engine patch-safety test.

The client merges every `game.patch` payload onto its last `public_state()` snapshot
(web/src/center/ws.ts: `{...prev, ...patch}`). That merge is only safe when a patch
never changes the *type* of a key the snapshot already defines. A `tick()` that emits
`{"live": <int>}` over a snapshot's `{"live": [<slots>]}` replaces an array with a
number, and the stage renderer calls `.slice()` on it -> the whole SPA white-screens.

This test drives every registered engine through start -> ticks -> actions and asserts
that no patch key collides with a snapshot key of a different kind.
"""

from __future__ import annotations

import pytest

from center.games import ENGINES
from center.games.base import Engine
from center.schema import Admission, RoomConfig, Rewards, RewardSlot, Access, SOLO_TEMPLATES, parse_rules

MIN_RULES = {
    "number-hunt": {"min": 111111, "max": 999999, "guess_budget": 3, "duration_seconds": 60},
    "live-quiz": {"question_seconds": 10},
    "memory-match": {"pairs": 6, "duration_seconds": 60},
    "token-catch": {"duration_seconds": 60, "spawn_per_second": 2, "lanes": 3},
    "hash-hunt": {"duration_seconds": 60},
    "boss-raid": {"max_players": 5, "duration_seconds": 60},
    "puzzle-sprint": {"duration_seconds": 60},
    "typing-sprint": {"prompt_id": "pack-1"},
    "airdrop-quest": {"campaign_name": "Test", "achievements": ["first-win"]},
}


def _kind(v) -> str:
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "object"
    if v is None:
        return "null"
    return type(v).__name__


@pytest.mark.parametrize("template_id", sorted(ENGINES.keys()))
def test_patch_keys_never_change_snapshot_types(template_id: str) -> None:
    payload = MIN_RULES.get(template_id, {})
    rules = parse_rules(template_id, payload)
    cap = 1 if template_id in SOLO_TEMPLATES else 2
    cfg = RoomConfig(
        template_id=template_id,
        name="patch safety room",
        description="",
        visibility="unlisted",
        mode="preview",
        rules=rules,
        admission=Admission(player_cap=cap, min_ready_to_start=2 if template_id in {"prism-lines", "relic-auction"} else 1),
        access=Access(vault_mode="simulated", required_amount=0),
        rewards=Rewards(kind="preview-points", slots=[RewardSlot(rank=1, points=10)]),
    )
    engine: Engine = ENGINES[template_id](cfg, "round-1", "seed-1", ["alice", "bob"])
    engine.start(now=0.0)

    snapshot = engine.public_state()
    kinds = {k: _kind(v) for k, v in snapshot.items()}
    patches: list[dict] = []

    for step in range(1, 60):
        res = engine.tick(now=float(step))
        if res is not None and res.patch:
            patches.append(res.patch)
        if res is not None and res.finished:
            break

    for who in ("alice", "bob"):
        for i, action in enumerate((
            {"kind": "capture", "slot": 0}, {"kind": "guess", "value": 123456},
            {"kind": "flip", "index": 0}, {"kind": "move", "to": 1},
            {"kind": "upgrade"}, {"kind": "complete", "achievement": "first-win"},
            {"kind": "commit", "choice": "rock", "salt": "s"},
            {"kind": "reveal", "choice": "rock", "salt": "s"},
            {"kind": "act", "lane": 1}, {"kind": "answer", "choice": 0},
            {"kind": "step", "direction": "up"}, {"kind": "claim", "tile": 0},
            {"kind": "submit", "text": "a" * 40},
        )):
            res = engine.act(who, {**action, "actionId": f"{who}-{i}"}, now=5.0)
            if res.ok and res.patch:
                patches.append(res.patch)

    collisions = []
    for p in patches:
        for k, v in p.items():
            if k in kinds and _kind(v) != kinds[k]:
                collisions.append((k, kinds[k], _kind(v), v))

    assert not collisions, (
        f"{template_id}: patch keys collide with public_state() types -> client merge corrupts state: {collisions}"
    )
