"""Reward service tests: fee policy, join-token validation (any ERC-20), graduation
status (informational), pool/nonce bookkeeping. The chain is faked — tests pin LOGIC."""

import pytest

from center.rewards import RewardService, orbix_graduated, JoinTokenCheck
from center.vault import ChainError

TOKEN_GRAD = "0x" + "aa" * 20
TOKEN_OPEN = "0x" + "bb" * 20
TOKEN_PLAIN = "0x" + "ee" * 20      # plain ERC-20, never on a curve
TOKEN_NOT_TOKEN = "0x" + "99" * 20  # an EOA, not a token
CURVE_DONE = "0x" + "cc" * 20
CURVE_LIVE = "0x" + "dd" * 20


class FakeRpc:
    """Reads: curve() -> address; complete() -> 0/1; decimals() -> 18; symbol()."""

    def __init__(self) -> None:
        self.chain_id = 46630
        self.calls: list[tuple] = []

    def call(self, method, params):
        self.calls.append((method, params))
        if method != "eth_call":
            raise ChainError("unsupported")
        to = params[0]["to"].lower()
        data = params[0]["data"]
        from center.rewards import SEL_CURVE, SEL_COMPLETE, SEL_DECIMALS, SEL_SYMBOL

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
        if data == SEL_DECIMALS:
            if to == TOKEN_NOT_TOKEN:
                raise ChainError("not a contract")
            return hex(18)[2:].rjust(64, "0")
        if data == SEL_SYMBOL:
            if to == TOKEN_GRAD:
                raw = (32).to_bytes(32, "big").hex() + (4).to_bytes(32, "big").hex() + b"GRAD".hex() + "00" * 28
                return "0x" + raw
            return "0x" + (32).to_bytes(32, "big").hex() + (0).to_bytes(32, "big").hex() + "00" * 32
        raise ChainError("unexpected call")


# ------------------------------------------------------------- fee policy

def test_creation_free_until_orbix_graduates_for_everyone():
    svc = RewardService(FakeRpc(), None, None)
    free, why = svc.creation_is_free(orbix_graduated=False)
    assert free is True
    assert "pre-graduation" in why


def test_after_orbix_graduates_fee_applies_to_everyone():
    svc = RewardService(FakeRpc(), None, None)
    free, why = svc.creation_is_free(orbix_graduated=True)
    assert free is False
    assert "standard creation fee" in why


def test_no_creator_exemption_post_graduation():
    """Even a graduated-token creator pays the ORBIX fee after ORBIX graduates."""
    svc = RewardService(FakeRpc(), None, None)
    free, _ = svc.creation_is_free(orbix_graduated=True)
    assert free is False


# ------------------------------------------------------------- join token (any ERC-20)

def test_join_token_any_erc20_accepted():
    """A creator can bind a plain ERC-20 they never held or created."""
    svc = RewardService(FakeRpc(), None, None)
    check = svc.check_join_token(TOKEN_PLAIN)
    assert check.ok is True
    assert check.decimals == 18
    assert check.reason is None


def test_join_token_eoa_rejected():
    svc = RewardService(FakeRpc(), None, None)
    check = svc.check_join_token(TOKEN_NOT_TOKEN)
    assert check.ok is False
    assert "not a readable ERC-20" in check.reason


def test_join_token_does_not_check_ownership():
    """No code path references whether the creator owns or created the token."""
    import inspect
    src = inspect.getsource(RewardService.check_join_token)
    assert "owner" not in src.lower()
    assert "creator" not in src.lower()
    assert "balance" not in src.lower()


def test_join_token_validation_cached():
    rpc = FakeRpc()
    svc = RewardService(rpc, None, None)
    svc.check_join_token(TOKEN_PLAIN)
    n = len(rpc.calls)
    svc.check_join_token(TOKEN_PLAIN)  # cached
    assert len(rpc.calls) == n


def test_binding_requires_creator_absorbing_orbix_fee():
    svc = RewardService(FakeRpc(), None, None)
    ok, why = svc.can_bind_join_token(creator_absorbs_orbix_fee=False)
    assert ok is False
    assert "I pay all ORBIX joiner fees" in why
    ok2, why2 = svc.can_bind_join_token(creator_absorbs_orbix_fee=True)
    assert ok2 is True
    assert "joiners pay the chosen token" in why2


# ------------------------------------------------------------- graduation (informational)

def test_graduation_true_and_false():
    svc = RewardService(FakeRpc(), None, None)
    assert svc.graduation(TOKEN_GRAD).graduated is True
    assert svc.graduation(TOKEN_OPEN).graduated is False


def test_graduation_is_informational_not_a_gate():
    """The graduation status exists for display but does not block anything."""
    svc = RewardService(FakeRpc(), None, None)
    check = svc.check_join_token(TOKEN_OPEN)
    assert check.ok is True


def test_graduation_cached():
    rpc = FakeRpc()
    svc = RewardService(rpc, None, None)
    svc.graduation(TOKEN_GRAD)
    n = len(rpc.calls)
    svc.graduation(TOKEN_GRAD)
    assert len(rpc.calls) == n


def test_orbix_graduated_helper_uses_chain():
    assert orbix_graduated(FakeRpc(), TOKEN_GRAD) is True
    assert orbix_graduated(FakeRpc(), TOKEN_OPEN) is False
    assert orbix_graduated(None, TOKEN_GRAD) is False


# ------------------------------------------------------------- bookkeeping

def test_claim_nonces_are_monotonic_and_unique():
    svc = RewardService(None, None, None)
    a = svc.issue_claim_nonce(1)
    b = svc.issue_claim_nonce(1)
    c = svc.issue_claim_nonce(1)
    assert (a, b, c) == (1, 2, 3)
    assert len(svc.issued_nonces[1]) == 3
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
