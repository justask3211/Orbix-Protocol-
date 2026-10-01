"""Tests for the read-only token identity layer (P1/E trust primitive).

The RPC is faked with deterministic canned responses so the tests verify the
DECODING and CLASSIFICATION logic, not a live chain.
"""

import pytest

from center.token_identity import TokenInspector
from center.vault import ChainError, JsonRpc


def _pad_string(s: str) -> str:
    body = s.encode().hex()
    return "00" * 32 + hex(len(s))[2:].zfill(64) + body + "00" * ((32 - len(body) % 32) % 32 or 0)


def _response_for(data: str) -> str:
    """Return canned ABI-encoded answers keyed by selector."""
    if data.startswith("06fdde03"):  # name()
        return "0x" + _pad_string("Orbix Token")
    if data.startswith("95d89b41"):  # symbol()
        return "0x" + _pad_string("ORBIX")
    if data.startswith("313ce567"):  # decimals()
        return "0x" + hex(18)[2:].zfill(64)
    return "0x"


class FakeRpc:
    def __init__(self, code: str = "0x" + "6080" + "ab" * 100, fail_calls: set[str] | None = None):
        self.code = code
        self.fail_calls = fail_calls or set()
        self.chain_id = 46630
        self.calls: list[tuple] = []

    def call(self, method: str, params: list):
        self.calls.append((method, params))
        if method in self.fail_calls:
            raise ChainError(f"{method}: reverted")
        if method == "eth_getCode":
            return self.code
        if method == "eth_call":
            return _response_for(params[0]["data"].removeprefix("0x"))
        raise AssertionError(f"unexpected method {method}")


def test_healthy_token_decodes_fully():
    insp = TokenInspector(FakeRpc())
    v = insp.inspect("0x" + "a1" * 20).verdict()
    assert v["entry_ok"] is True
    assert v["facts"]["symbol"] == "ORBIX"
    assert v["facts"]["name"] == "Orbix Token"
    assert v["facts"]["decimals"] == 18
    assert v["problems"] == []


def test_eoa_address_is_blocked():
    insp = TokenInspector(FakeRpc(code="0x"))
    v = insp.inspect("0x" + "b2" * 20).verdict()
    assert v["entry_ok"] is False
    assert any("not a contract" in p for p in v["problems"])


def test_reverting_decimals_blocks():
    insp = TokenInspector(FakeRpc(fail_calls={"eth_call"}))
    v = insp.inspect("0x" + "c3" * 20).verdict()
    assert v["entry_ok"] is False
    assert any("decimals()" in p for p in v["problems"])


def test_burn_detection_is_bytecode_not_assumption():
    # code WITHOUT any burn selector -> not detected
    insp = TokenInspector(FakeRpc())
    assert insp.inspect("0x" + "d4" * 20).burn_capable is False
    # code WITH burn(address,uint256) selector -> "possible", owner opt-in required
    burn_code = "0x" + "9dc29fac" + "ab" * 50
    insp2 = TokenInspector(FakeRpc(code=burn_code))
    assert insp2.inspect("0x" + "e5" * 20).burn_capable is True
    v = insp2.inspect("0x" + "e5" * 20).verdict()
    assert v["burn"] == "possible-owner-opt-in"


def test_burn_capability_alone_does_not_make_entry_ok():
    burn_code = "0x" + "42966c68" + "cd" * 50
    v = TokenInspector(FakeRpc(code=burn_code)).inspect("0x" + "f6" * 20).verdict()
    assert v["burn"] == "possible-owner-opt-in"
    # burn is NOT auto-enabled: verdict still requires healthy identity, and the
    # word "trusted" appears nowhere in the verdict vocabulary
    assert "trusted" not in v["burn"]
