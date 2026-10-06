"""Fail-closed paid admission against the deployed v2 CreatorTokenGate ABI."""

from __future__ import annotations

import pytest
from eth_abi import decode, encode
from eth_utils import keccak

from center.entry_gate import (
    BURN_ADDRESS, DEPLOYED_GATE, GATE_CHAIN_ID, JOIN_EVENT, LOG_BLOCK_RANGE,
    EntryGateError, EntryGateVerifier, room_id_bytes32,
)

ROOM = "1234567890abcdef"
PLAYER = "0x" + "11" * 20
CREATOR = "0x" + "22" * 20
TOKEN = "0x" + "33" * 20
OTHER = "0x" + "44" * 20
TRANSACTION = "0x" + "55" * 32


def selector(signature):
    return "0x" + keccak(text=signature)[:4].hex()


class FakeRpc:
    def __init__(self, *, decimals=6, amount=7, joined=True):
        self.decimals, self.amount, self.joined = decimals, amount, joined
        self.chain_id, self.head, self.code = GATE_CHAIN_ID, 100, "0x6080604052"
        self.creator, self.token, self.fee = CREATOR, TOKEN, amount * 10**decimals
        self.payout, self.payee, self.paused = CREATOR, 0, False
        self.calls = []
        self.fail_method = None
        self.event_fee, self.event_token = self.fee, TOKEN
        self.event_block, self.removed = 95, False
        self.logs = None

    def call(self, method, params):
        self.calls.append((method, params))
        if method == self.fail_method:
            raise RuntimeError("private-provider-credential: never disclose")
        if method == "eth_chainId":
            return hex(self.chain_id)
        if method == "eth_blockNumber":
            return hex(self.head)
        if method == "eth_getCode":
            return self.code
        if method == "eth_call":
            target, data = params[0]["to"], params[0]["data"]
            encoded = bytes.fromhex(data[10:])
            if data.startswith(selector("bindingOf(bytes32)")):
                assert target == DEPLOYED_GATE and decode(["bytes32"], encoded)[0] == room_id_bytes32(ROOM)
                result = encode(["address", "address", "uint256", "address", "uint8", "bool"], [self.creator, self.token, self.fee, self.payout, self.payee, self.paused])
            elif data.startswith(selector("joined(bytes32,address)")):
                assert target == DEPLOYED_GATE
                room, player = decode(["bytes32", "address"], encoded)
                assert room == room_id_bytes32(ROOM) and player == PLAYER
                result = encode(["bool"], [self.joined])
            elif data.startswith(selector("decimals()")):
                assert target == TOKEN and not encoded
                result = encode(["uint256"], [self.decimals])
            else:
                raise AssertionError(f"Unexpected selector {data[:10]}")
            return "0x" + result.hex()
        if method == "eth_getLogs":
            if self.logs is not None:
                return self.logs
            return [{
                "address": DEPLOYED_GATE, "topics": [JOIN_EVENT, "0x" + room_id_bytes32(ROOM).hex(), "0x" + encode(["address"], [PLAYER]).hex()],
                "blockNumber": hex(self.event_block), "transactionHash": TRANSACTION,
                "removed": self.removed, "data": "0x" + encode(["uint256", "address"], [self.event_fee, self.event_token]).hex(),
            }]
        raise AssertionError(f"Unexpected RPC method {method}")


def verify(rpc, **overrides):
    fields = {"room_id": ROOM, "player": PLAYER, "creator": CREATOR, "token": TOKEN, "amount": rpc.amount, **overrides}
    return EntryGateVerifier(rpc).verify(**fields)


@pytest.mark.parametrize("decimals", [0, 6, 8, 18])
def test_confirmed_join_uses_token_decimals_and_single_confirmed_block(decimals):
    rpc = FakeRpc(decimals=decimals)
    result = verify(rpc)
    assert result.ok and result.code == "ENTRY_CONFIRMED"
    assert result.block == 98 and result.decimals == decimals
    assert result.amount_base_units == 7 * 10**decimals
    assert result.transaction_hash == TRANSACTION
    assert all(params[1] == "0x62" for method, params in rpc.calls if method in {"eth_call", "eth_getCode"})
    log_query = next(params[0] for method, params in rpc.calls if method == "eth_getLogs")
    assert log_query["toBlock"] == "0x62" and log_query["address"] == DEPLOYED_GATE
    assert log_query["topics"][1:] == ["0x" + room_id_bytes32(ROOM).hex(), "0x" + encode(["address"], [PLAYER]).hex()]
    assert not any(method.startswith("eth_send") for method, _ in rpc.calls)


def test_unpaid_wallet_is_never_admitted_and_does_not_query_events():
    rpc = FakeRpc(joined=False)
    result = verify(rpc)
    assert not result.ok and result.code == "ENTRY_PAYMENT_REQUIRED"
    assert not any(method == "eth_getLogs" for method, _ in rpc.calls)


@pytest.mark.parametrize("field,value,code", [
    ("creator", OTHER, "ENTRY_CREATOR_MISMATCH"),
    ("token", OTHER, "ENTRY_TOKEN_MISMATCH"),
    ("fee", 1, "ENTRY_AMOUNT_MISMATCH"),
    ("paused", True, "ENTRY_PAUSED"),
    ("creator", "0x" + "00" * 20, "ENTRY_NOT_BOUND"),
    ("chain_id", 1, "ENTRY_WRONG_CHAIN"),
    ("code", "0x", "ENTRY_GATE_UNAVAILABLE"),
    ("head", 1, "ENTRY_CONFIRMATIONS_PENDING"),
    ("payee", 3, "ENTRY_PAYOUT_MISMATCH"),
    ("payout", OTHER, "ENTRY_PAYOUT_MISMATCH"),
])
def test_wrong_or_unavailable_gate_configuration_fails_closed(field, value, code):
    rpc = FakeRpc()
    setattr(rpc, field, value)
    result = verify(rpc)
    assert not result.ok and result.code == code


@pytest.mark.parametrize("method", ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call", "eth_getLogs"])
def test_rpc_failure_never_grants_entry_or_exposes_provider_credentials(method):
    rpc = FakeRpc()
    rpc.fail_method = method
    result = verify(rpc)
    assert not result.ok and result.code == "ENTRY_RPC_UNAVAILABLE"
    assert "private-provider-credential" not in result.message


@pytest.mark.parametrize("field,value", [
    ("event_fee", 1), ("event_token", OTHER), ("event_block", 99), ("removed", True), ("logs", []),
])
def test_lifetime_joined_mapping_cannot_validate_changed_or_unconfirmed_payment(field, value):
    rpc = FakeRpc(joined=True)
    setattr(rpc, field, value)
    result = verify(rpc)
    assert not result.ok and result.code == "ENTRY_PAYMENT_MISMATCH"


def test_repeat_verification_is_idempotent_and_rechecks_current_chain():
    rpc = FakeRpc()
    assert verify(rpc).ok
    assert verify(rpc).ok
    assert len([1 for method, _ in rpc.calls if method == "eth_chainId"]) == 2
    rpc.paused = True
    assert verify(rpc).code == "ENTRY_PAUSED"


@pytest.mark.parametrize("mode,payee,payout", [("creator", 0, CREATOR), ("custom", 1, OTHER), ("burn", 2, BURN_ADDRESS)])
def test_payout_mode_and_destination_must_match_the_configured_binding(mode, payee, payout):
    rpc = FakeRpc()
    rpc.payee, rpc.payout = payee, payout
    assert verify(rpc, payout_mode=mode, payout_address=OTHER if mode == "custom" else None).ok
    assert verify(rpc, payout_mode="custom", payout_address=TOKEN).code == "ENTRY_PAYOUT_MISMATCH"


@pytest.mark.parametrize("amount", [0, -1, True, 1.5, "7"])
def test_invalid_whole_token_amount_is_rejected_before_rpc(amount):
    rpc = FakeRpc()
    result = verify(rpc, amount=amount)
    assert not result.ok and result.code == "ENTRY_INVALID_CONFIG" and not rpc.calls


@pytest.mark.parametrize("field,value", [("room_id", "../../../room"), ("room_id", "1" * 65), ("room_id", "1" * 17), ("player", OTHER + "0"), ("creator", "0x0"), ("token", "0x" + "00" * 20)])
def test_malformed_identity_or_room_is_rejected_before_rpc(field, value):
    rpc = FakeRpc()
    result = verify(rpc, **{field: value})
    assert result.code == "ENTRY_INVALID_CONFIG" and not rpc.calls


def test_exact_integer_conversion_avoids_float_rounding_for_large_amounts():
    amount = 123456789123456789
    rpc = FakeRpc(decimals=18, amount=amount)
    assert verify(rpc).amount_base_units == amount * 10**18


def test_historical_logs_respect_provider_block_range_and_find_old_paid_entry():
    rpc = FakeRpc()
    rpc.head = LOG_BLOCK_RANGE + 100
    result = verify(rpc)
    assert result.ok
    queries = [params[0] for method, params in rpc.calls if method == "eth_getLogs"]
    assert len(queries) == 2
    assert all(int(query["toBlock"], 16) - int(query["fromBlock"], 16) + 1 <= LOG_BLOCK_RANGE for query in queries)
    assert int(queries[1]["toBlock"], 16) + 1 == int(queries[0]["fromBlock"], 16)


def test_unsupported_token_decimals_fail_closed():
    rpc = FakeRpc()
    rpc.decimals = 256
    assert verify(rpc).code == "ENTRY_RPC_UNAVAILABLE"


def test_gate_requires_at_least_three_confirmations_and_expected_chain():
    with pytest.raises(EntryGateError, match="three confirmations"):
        EntryGateVerifier(FakeRpc(), confirmations=1)
    with pytest.raises(EntryGateError, match="chain 46630"):
        EntryGateVerifier(FakeRpc(), chain_id=1)
    with pytest.raises(EntryGateError):
        EntryGateVerifier(FakeRpc(), gate_address="0x0")


def test_require_raises_structured_error_for_root_admission_callback():
    rpc = FakeRpc(joined=False)
    with pytest.raises(EntryGateError) as error:
        EntryGateVerifier(rpc).require(ROOM, PLAYER, CREATOR, TOKEN, 7)
    assert error.value.code == "ENTRY_PAYMENT_REQUIRED"
    rpc.joined = True
    assert EntryGateVerifier(rpc).require(ROOM, PLAYER, CREATOR, TOKEN, 7).ok
