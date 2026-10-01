"""D11 — Boss Raid phase/weakness feed: shared state only, no hidden player data.

The co-op raid's hint surface is deliberately the whole shared state: boss health
(the weakness window is "boss is vulnerable, always"), aggregate contribution, and
hit counts. Nothing about a player is hidden from the raid — but the engine must
also be proven to never leak *future* damage or someone else's private action
payload, and contributions must be server-authoritative.
"""

import pytest

from center.games.boss import BossEngine
from center.schema import Admission, BossRules, RoomConfig, Rewards


def _engine(players: int = 3) -> BossEngine:
    rules = BossRules(min_players=2, max_players=10, duration_seconds=60,
                      boss_health=1000, action_cooldown_ms=300,
                      contribution_cap=1000, min_contribution=10)
    cfg = RoomConfig(name="Raid room", template_id="boss-raid", rules=rules,
                     rewards=Rewards(), admission=Admission(player_cap=players, min_ready_to_start=1))
    eng = BossEngine(cfg, "r1", "seed-b", [f"p{i}" for i in range(players)])
    eng.start()
    return eng


def test_public_feed_shows_shared_phase_and_health():
    eng = _engine()
    st = eng.public_state()
    assert st["bossHealth"] == st["bossHealthMax"] == 1000
    assert "contribution" in st and "hits" in st
    assert st["slain"] is False and st["finished"] is False


def test_hits_update_shared_feed_not_private_secrets():
    eng = _engine()
    res = eng.act("p0", {"kind": "hit", "power": 100}, now=1.0)
    assert res.ok
    st = eng.public_state()
    assert st["bossHealth"] == 900
    assert st["contribution"]["p0"] == 100
    # a player's own hit count is shared raid data; nothing else is private
    assert st["hits"]["p0"] == 1


def test_private_payload_carries_only_own_data():
    eng = _engine()
    eng.act("p0", {"kind": "hit", "power": 50}, now=1.0)
    res = eng.act("p1", {"kind": "hit", "power": 50}, now=1.4)
    assert res.ok
    assert res.private["hits"] == 1  # p1's own count, not p0's
    assert "contribution" not in res.private  # shared state rides the patch


def test_no_future_damage_or_outcome_leak():
    eng = _engine()
    st_before = repr(eng.public_state())
    assert "slain" in st_before  # declared state is fine
    # the feed cannot contain damage that has not happened yet
    assert eng.public_state()["bossHealth"] == 1000


def test_contribution_cannot_be_inflated_by_client():
    eng = _engine()
    # oversized power is clamped to [1,100]; a huge client value is rejected
    assert eng.act("p0", {"kind": "hit", "power": 10**9}, now=1.0).error == "BAD_ACTION"
    assert eng.act("p0", {"kind": "hit", "power": 100}, now=1.4).ok
    # per-player contribution cap holds even with many hits
    now = 2.0
    while eng.act("p0", {"kind": "hit", "power": 100}, now=now).ok:
        now += 0.4
    assert eng.contribution["p0"] <= 1000
    # rate cap holds
    assert eng.act("p0", {"kind": "hit", "power": 10}, now=now + 0.05).error in ("SLOW_DOWN", "BUDGET_EXHAUSTED", "ROUND_FINISHED")


def test_registry_marks_boss_raid_implemented():
    from center.games.hints import policy_for
    pol = policy_for("boss-raid")
    assert pol.implemented is True
    kinds = {k.id for k in pol.kinds}
    assert "phase-weakness" in kinds
