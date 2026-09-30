from center.games.number_hunt import NumberHuntEngine
from center.schema import RoomConfig

HUNT = {
    "template_id": "number-hunt", "name": "Four Digit Hunt", "visibility": "public", "mode": "preview",
    "rules": {"templateId": "number-hunt", "digits": 4, "min": 1111, "max": 9999, "guess_budget": 20,
              "duration_seconds": 60, "hints": "on", "target_count": 1, "win_mode": "first-hit",
              "guess_cooldown_ms": 300},
    "admission": {"player_cap": 8, "min_ready_to_start": 2},
    "access": {"vault_mode": "simulated", "required_amount": 100, "joiner_fee": 25, "creator_absorbs_joiner_fee": True},
    "rewards": {"kind": "preview-points", "slots": [{"rank": 1, "points": 100}]},
}


def test_number_hunt_public_hint_is_in_room_patch(tmp_path):
    """Public higher/lower hints must be broadcast, not silently private."""
    from center.games.number_hunt import NumberHuntEngine
    from center.schema import RoomConfig

    config = RoomConfig(**{
        **HUNT,
        "rules": {**HUNT["rules"], "hints": "on", "hint_visibility": "public"},
    })
    engine = NumberHuntEngine(config, "round-1", "seed-1", ["alice", "bob"])
    engine.start()
    result = engine.act("alice", {"kind": "guess", "number": 1111}, now=1.0)
    assert result.ok
    assert result.patch["lastGuess"]["hint"]["direction"] in {"higher", "lower"}
    assert result.patch["lastGuess"]["hint"]["number"] == 1111
    assert "hint" not in result.private


def test_number_hunt_private_hint_stays_private(tmp_path):
    from center.games.number_hunt import NumberHuntEngine
    from center.schema import RoomConfig

    config = RoomConfig(**{
        **HUNT,
        "rules": {**HUNT["rules"], "hints": "on", "hint_visibility": "private"},
    })
    engine = NumberHuntEngine(config, "round-2", "seed-2", ["alice", "bob"])
    engine.start()
    result = engine.act("alice", {"kind": "guess", "number": 1111}, now=1.0)
    assert result.ok
    assert result.private["hint"] in {"higher", "lower"}
    assert "hint" not in result.patch
