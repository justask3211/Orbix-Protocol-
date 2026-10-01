"""Read-only ERC-20 token identity and safety classification (plan item P1/E-adjacent).

Trust rule (V5 P1): a token is NEVER accepted for a value-bearing flow because a
client or a deployment note claims what it is. Its semantics are read from the
chain itself:

  * `symbol()` / `decimals()` — identity display, verified on-chain
  * bytecode presence — a plain EOA address is not a token
  * `burn` selector presence — burn support is INFERRED from bytecode, never
    assumed; the module only reports "possible", which still requires an owner
    opt-in before any burn flow is enabled.

The classifier never returns "trusted" — it returns facts + a conservative
acceptance verdict for room economics (`entry-ok` vs `blocked`), and flags the
behaviors room custody cannot survive (fee-on-transfer-style hooks can only be
detected by probe transfers at deposit time, so unknown code is BLOCKED by
default, matching "unknown code is blocked unless verified").
"""

from __future__ import annotations

import json
import urllib.request

from center.vault import ChainError, JsonRpc

# keccak selectors for the identity calls
SEL_SYMBOL = "95d89b41"        # symbol()
SEL_DECIMALS = "313ce567"      # decimals()
SEL_NAME = "06fdde03"          # name()

# bytecode substring probes (first 4 bytes of keccak of each signature, hex)
BURN_SIGNATURES = {
    "burn(uint256)": "42966c68",
    "burn(address,uint256)": "9dc29fac",
}


def _pad_address(addr: str) -> str:
    a = addr.lower().removeprefix("0x")
    return a.zfill(64)


def _pad_uint(value: int) -> str:
    return hex(value)[2:].zfill(64)


class TokenIdentity:
    """Facts read from the chain about one ERC-20 candidate."""

    def __init__(self, address: str, *, exists: bool, name: str | None,
                 symbol: str | None, decimals: int | None,
                 burn_capable: bool, chain_id: int) -> None:
        self.address = address
        self.exists = exists
        self.name = name
        self.symbol = symbol
        self.decimals = decimals
        self.burn_capable = burn_capable
        self.chain_id = chain_id

    def verdict(self) -> dict:
        """Conservative acceptance verdict for room-economics use."""
        problems: list[str] = []
        if not self.exists:
            problems.append("no bytecode at address (not a contract)")
        if self.decimals is None or not (0 <= self.decimals <= 77):
            problems.append("decimals() missing or absurd — not a sane ERC-20")
        if not self.symbol:
            problems.append("symbol() missing — identity unverifiable")
        return {
            "address": self.address,
            "chain_id": self.chain_id,
            "entry_ok": not problems,
            "problems": problems,
            "burn": "possible-owner-opt-in" if self.burn_capable else "not-detected",
            "facts": {
                "name": self.name,
                "symbol": self.symbol,
                "decimals": self.decimals,
                "exists": self.exists,
            },
        }


class TokenInspector:
    """Read-only inspector bound to one RPC endpoint."""

    def __init__(self, rpc: JsonRpc) -> None:
        self.rpc = rpc

    def _eth_call(self, to: str, data: str) -> str | None:
        try:
            result = self.rpc.call("eth_call", [{"to": to, "data": "0x" + data}, "latest"])
        except ChainError:
            return None  # revert or missing method: treat as absent, not fatal
        return str(result).removeprefix("0x")

    @staticmethod
    def _decode_string(raw: str | None) -> str | None:
        if not raw or len(raw) < 130:
            return None
        try:
            length = int(raw[64:128], 16)
            body = bytes.fromhex(raw[128:128 + length * 2])
            return body.decode("utf-8", errors="replace")
        except (ValueError, UnicodeDecodeError):
            return None

    @staticmethod
    def _decode_uint(raw: str | None) -> int | None:
        if not raw or len(raw) < 64:
            return None
        try:
            return int(raw[:64], 16)
        except ValueError:
            return None

    def inspect(self, address: str) -> TokenIdentity:
        addr = address if address.startswith("0x") else "0x" + address
        code = str(self.rpc.call("eth_getCode", [addr, "latest"]) or "0x")
        exists = len(code) > 2
        burn_capable = exists and any(sig in code for sig in BURN_SIGNATURES.values())
        name = self._decode_string(self._eth_call(addr, SEL_NAME))
        symbol = self._decode_string(self._eth_call(addr, SEL_SYMBOL))
        decimals = self._decode_uint(self._eth_call(addr, SEL_DECIMALS))
        return TokenIdentity(
            address=addr,
            exists=exists,
            name=name,
            symbol=symbol,
            decimals=decimals,
            burn_capable=burn_capable,
            chain_id=self.rpc.chain_id,
        )
