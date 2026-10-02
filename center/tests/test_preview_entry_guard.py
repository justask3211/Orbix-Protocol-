"""Entry-mode guards.

History: preview rooms used to reject `entry.kind == "erc20"` outright, because
the only payment path at the time was the vault contract (which preview mode
keeps simulated). That guard is now intentionally relaxed: a joiner's token
payment runs through the separate CreatorTokenGate contract, which is deployed
independently of the room's vault mode. The vault stays simulated for the
software balance that pays room-creation fees; the gate is the real money path
for join tokens.

These tests pin both sides: a paid entry with a well-formed ERC-20 entry is
accepted, and a malformed one is still rejected by Entry's own validator.
"""

from __future__ import annotations

from copy import deepcopy

import pytest
from pydantic import ValidationError

from center.schema import RoomConfig
from center.tests.test_number_hunt_hints import HUNT


def test_preview_allows_paid_join_entry_through_the_gate():
    """A preview room may set an ERC-20 entry: the joiner pays via CreatorTokenGate,
    not via the (simulated) vault contract."""
    config = deepcopy(HUNT)
    config["entry"] = {"kind": "erc20", "token": "0x" + "11" * 20, "amount": 1}
    cfg = RoomConfig(**config)
    assert cfg.entry.kind == "erc20"
    assert cfg.entry.token == "0x" + "11" * 20
    assert cfg.entry.amount == 1


def test_paid_entry_still_requires_a_token_and_amount():
    config = deepcopy(HUNT)
    config["entry"] = {"kind": "erc20", "token": None, "amount": 0}
    with pytest.raises(ValidationError):
        RoomConfig(**config)


def test_preview_free_entry_is_valid():
    config = deepcopy(HUNT)
    config["entry"] = {"kind": "free"}
    assert RoomConfig(**config).entry.kind == "free"
