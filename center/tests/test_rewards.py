"""Reward service tests: graduation gating, fee policy, pool/nonce bookkeeping.

The chain is faked: a token with curve() -> curve with complete() -> 0 or 1.
No live RPC is used, so the tests pin the LOGIC (policy + replay safety).
"""

import pytest

from center.rewards import RewardService, orbix_graduated
from center.vault import ChainError

TOKEN_GRAD = "0x" + "aa" * 20
TOKEN_OPEN = "0x" + "bb" * 20
CURVE_DONE = "0x" + "cc" * 20
CURVE_LIVE = "0x" + "dd" * 20


class FakeRpc:
    """token.curve() -> curve address; curve.complete() -> 0 or 1."""

    def __init__(self) -> None:
        self.chain_id = 46630
        self.calls: list[tuple] = []

    def call(self, method, params):
        self.calls.append((method, params))
        if method != "eth_call":
            raise ChainError("unsupported")
        to = params[0]["to"].lower()
        data = params[0]["data"]
        if data.startswith("0x7681fb10"):  # curve() selector placeholder
            raise AssertionError("wrong selector")
        # curve()
        from center.rewards import SEL_CURVE, SEL_COMPLETE
        if data == SEL_CURVE:
            if to == TOKEN_GRAD:
                return "0x" + CURVE_DONE[2:].rjust(64, "0")
            if to == TOKEN_OPEN:
                return "0x" + CURVE_LIVE[2:].rjust(64, "0")
            raise ChainError("no curve()")
        if data == SEL_COMPLETE:
            if to == CURVE_DONE.lower():
                return hex(1)[2:].rjust(64, "0")
            if to == CURVE_LIVE.lower():
                return hex(0)[2:].rjust(64, "0")
            raise ChainError("no complete()")
        raise ChainError("unexpected call")


def test_token_curve_reads_address():
    svc = RewardService(FakeRpc(), "0x" + "11" * 20, "0x" + "22" * 20)
    assert svc.token_curve(TOKEN_GRAD).lower() == CURVE_DONE.lower()
    assert svc.token_curve(TOKEN_OPEN).lower() == CURVE_LIVE.lower()


def test_plain_erc20_has_no_curve():
    svc = RewardService(FakeRpc(), None, None)
    # an address that reverts curve() → None
    assert svc.token_curve("0x" + "99" * 20) is None


def test_graduation_true_and_false():
    svc = RewardService(FakeRpc(), None, None)
    assert svc.graduation(TOKEN_GRAD).graduated is True
    assert svc.graduation(TOKEN_GRAD).source == "curve-complete"
    assert svc.graduation(TOKEN_OPEN).graduated is False


def test_graduation_cached():
    rpc = FakeRpc()
    svc = RewardService(rpc, None, None)
    svc.graduation(TOKEN_GRAD)
    n = len(rpc.calls)
    svc.graduation(TOKEN_GRAD)   # cached, no new call
    assert len(rpc.calls) == n


def test_creation_free_until_orbix_graduates_for_everyone():
    svc = RewardService(FakeRpc(), None, None)
    free, why = svc.creation_is_free(orbix_graduated=False, creator_token=None)
    assert free is True
    assert "pre-graduation" in why
    # even a graduated creator token does not matter pre-graduation
    free2, _ = svc.creation_is_free(orbix_graduated=False, creator_token=TOKEN_GRAD)
    assert free2 is True


def test_after_orbix_graduates_fee_applies_unless_creator_token_graduated():
    svc = RewardService(FakeRpc(), None, None)
    free_plain, why_plain = svc.creation_is_free(orbix_graduated=True, creator_token=None)
    assert free_plain is False
    assert "standard creation fee" in why_plain
    # a NON-graduated creator token still pays
    free_open, _ = svc.creation_is_free(orbix_graduated=True, creator_token=TOKEN_OPEN)
    assert free_open is False
    # a GRADUATED creator token runs free
    free_grad, why_grad = svc.creation_is_free(orbix_graduated=True, creator_token=TOKEN_GRAD)
    assert free_grad is True
    assert "joiners pay the creator's token" in why_grad


def test_claim_nonces_are_monotonic_and_unique():
    svc = RewardService(None, None, None)
    a = svc.issue_claim_nonce(1)
    b = svc.issue_claim_nonce(1)
    c = svc.issue_claim_nonce(1)
    assert (a, b, c) == (1, 2, 3)
    assert len(svc.issued_nonces[1]) == 3
    # separate pools are independent
    assert svc.issue_claim_nonce(2) == 1


def test_pool_registry_maps_room_to_pool():
    svc = RewardService(None, None, None)
    svc.record_pool("room-1", 7)
    assert svc.pool_of_room("room-1") == 7
    assert svc.pool_of_room("nope") is None


def test_key_wallet_registration_is_per_pool():
    svc = RewardService(None, None, None)
    svc.register_key_wallet(3, "0xAbC")
    svc.register_key_wallet(3, "0xDeF")
    assert svc.key_wallets[3] == ["0xabc", "0xdef"]


def test_orbix_graduated_helper_uses_chain():
    assert orbix_graduated(FakeRpc(), TOKEN_GRAD) is True
    assert orbix_graduated(FakeRpc(), TOKEN_OPEN) is False
    assert orbix_graduated(None, TOKEN_GRAD) is False
