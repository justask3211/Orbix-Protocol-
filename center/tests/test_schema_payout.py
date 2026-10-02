"""Schema regression: the wizard's access block carries payout routing fields.

The publish endpoint rejected a room with `payout_mode`/`payout_address` before
these fields existed on the Access model ("Extra inputs are not permitted").
These tests pin the accepted shape so a future edit cannot silently break the
creator wizard again.
"""

import pytest
from pydantic import ValidationError

from center.schema import Access, Entry


def test_access_accepts_payout_routing_fields():
    a = Access(
        vault_mode="simulated",
        required_amount=0,
        joiner_fee=0,
        creator_absorbs_joiner_fee=True,
        payout_mode="burn",
        payout_address=None,
    )
    assert a.payout_mode == "burn"
    assert a.payout_address is None


def test_access_accepts_custom_payout_address():
    a = Access(payout_mode="custom", payout_address="0x" + "ab" * 20)
    assert a.payout_mode == "custom"
    assert a.payout_address == "0x" + "ab" * 20


def test_access_defaults_leave_payout_unset():
    a = Access()
    assert a.payout_mode is None
    assert a.payout_address is None


def test_access_rejects_unknown_payout_mode():
    with pytest.raises(ValidationError):
        Access(payout_mode="steal")


def test_entry_accepts_erc20_join_token():
    e = Entry(kind="erc20", token="0x" + "cd" * 20, amount=25)
    assert e.kind == "erc20"
    assert e.token == "0x" + "cd" * 20
    assert e.amount == 25


def test_entry_erc20_requires_token_and_amount():
    with pytest.raises(ValidationError):
        Entry(kind="erc20", token=None, amount=0)
    with pytest.raises(ValidationError):
        Entry(kind="erc20", token="0x" + "cd" * 20, amount=0)
