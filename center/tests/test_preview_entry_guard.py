from __future__ import annotations

from copy import deepcopy

from pydantic import ValidationError

from center.schema import RoomConfig
from center.tests.test_number_hunt_hints import HUNT


def test_preview_cannot_admit_paid_entry():
    config = deepcopy(HUNT)
    config["entry"] = {"kind": "erc20", "token": "0x" + "11" * 20, "amount": 1}
    try:
        RoomConfig(**config)
    except ValidationError as exc:
        assert "preview rooms cannot require on-chain entry payment" in str(exc)
    else:
        raise AssertionError("preview paid entry should be rejected")


def test_preview_free_entry_is_still_valid():
    config = deepcopy(HUNT)
    config["entry"] = {"kind": "free"}
    assert RoomConfig(**config).entry.kind == "free"
