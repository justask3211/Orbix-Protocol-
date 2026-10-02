"""Reward pools, creator join-token binding, and the ORBIX fee policy.

Three deliberately independent concerns:

1. PLATFORM FEE POLICY
   Owner decision: while ORBIX itself has not graduated, no creator pays the
   platform creation fee. Once ORBIX graduates, the standard creation fee
   applies to EVERY creator — there is no exemption in either direction.
   The admin panel owns the schedule; this module only reports the current
   waiver state.

2. CREATOR JOIN TOKEN (any ERC-20)
   A creator may bind ANY ERC-20 as the room's join token: one they hold, do
   not hold, created, or never created. Only the contract address and the
   per-joiner amount are required. There is no ownership check and no
   graduation requirement — the on-chain gate (CreatorTokenGate) only verifies
   that the address answers decimals(), so a joiner ends up paying the token
   the creator chose.

3. REWARD POOLS
   Typed assets (ERC20/721/1155/ETH) + claim modes (auto / code / merkle /
   open) with wallet-bound claim codes and private-key wallet rewards whose
   key is delivered off-chain.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from center.vault import ChainError, JsonRpc


def _sel(sig: str) -> str:
    from eth_utils import keccak
    return "0x" + keccak(text=sig)[:4].hex()


SEL_COMPLETE = _sel("complete()")
SEL_CURVE = _sel("curve()")
SEL_DECIMALS = _sel("decimals()")
SEL_SYMBOL = _sel("symbol()")
SEL_POOL_INFO = _sel("poolInfo(uint256)")
SEL_POOL_ASSETS = _sel("poolAssets(uint256)")
SEL_IS_CLAIMED = _sel("isClaimed(uint256,address)")
BALANCE_OF = "0x70a08231"


@dataclass
class GraduationStatus:
    token: str
    curve: str | None
    graduated: bool
    source: str  # "curve-complete" | "no-curve" | "unreadable"


@dataclass
class JoinTokenCheck:
    """Validation of a creator's chosen join token.

    `ok` means the address behaves like an ERC-20 (decimals() answers).
    Ownership by the creator is NOT required and NOT checked — a creator may
    bind a token they have never held or never created.
    """

    address: str
    ok: bool
    symbol: str | None
    decimals: int | None
    reason: str | None = None


class RewardService:
    """Read-only chain checks + bookkeeping helpers for reward pools."""

    def __init__(self, rpc: JsonRpc | None, reward_engine: str | None, gate: str | None) -> None:
        self.rpc = rpc
        self.reward_engine = reward_engine
        self.gate = gate
        self._grad_cache: dict[str, tuple[float, GraduationStatus]] = {}
        self._token_cache: dict[str, tuple[float, JoinTokenCheck]] = {}
        self.room_pool: dict[str, int] = {}
        self.issued_nonces: dict[int, set[int]] = {}
        self.key_wallets: dict[int, list[str]] = {}

    # ------------------------------------------------------------- chain reads

    def token_curve(self, token: str) -> str | None:
        """vibe.fun tokens expose curve(); a plain ERC-20 reverts here."""
        if not self.rpc:
            return None
        try:
            res = self.rpc.call("eth_call", [{"to": token, "data": SEL_CURVE}, "latest"])
            raw = str(res or "")
            if len(raw) == 66:
                addr = "0x" + raw[-40:]
                if int(addr, 16) != 0:
                    return addr
            return None
        except ChainError:
            return None

    def graduation(self, token: str, *, ttl: float = 60.0) -> GraduationStatus:
        """Whether a token has graduated on its bonding curve (informational)."""
        key = token.lower()
        hit = self._grad_cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        curve = self.token_curve(token)
        if not curve:
            status = GraduationStatus(token=token, curve=None, graduated=False, source="no-curve")
        elif not self.rpc:
            status = GraduationStatus(token=token, curve=curve, graduated=False, source="unreadable")
        else:
            try:
                res = self.rpc.call("eth_call", [{"to": curve, "data": SEL_COMPLETE}, "latest"])
                graduated = int(str(res or "0x0"), 16) == 1
                status = GraduationStatus(token=token, curve=curve, graduated=graduated,
                                          source="curve-complete")
            except ChainError:
                status = GraduationStatus(token=token, curve=curve, graduated=False, source="unreadable")
        self._grad_cache[key] = (time.time(), status)
        return status

    def check_join_token(self, token: str, *, ttl: float = 300.0) -> JoinTokenCheck:
        """Any ERC-20 is an acceptable join token.

        We verify only that the address answers decimals(), so joiners are not
        sent to a non-token address. No other condition applies: the address
        is used exactly as provided, and nothing about its provenance matters.
        """
        key = token.lower()
        hit = self._token_cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        if not self.rpc:
            check = JoinTokenCheck(address=token, ok=False, symbol=None, decimals=None,
                                   reason="chain reads unavailable")
        else:
            try:
                dec_res = self.rpc.call("eth_call", [{"to": token, "data": SEL_DECIMALS}, "latest"])
                decimals = int(str(dec_res or "0x0"), 16)
                symbol: str | None = None
                try:
                    sym_res = self.rpc.call("eth_call", [{"to": token, "data": SEL_SYMBOL}, "latest"])
                    raw = str(sym_res or "").removeprefix("0x")
                    if len(raw) >= 128:
                        length = int(raw[64:128], 16)
                        symbol = bytes.fromhex(raw[128:128 + length * 2]).decode("utf-8", "replace")
                except ChainError:
                    symbol = None
                ok = 0 <= decimals <= 77
                check = JoinTokenCheck(address=token, ok=ok, symbol=symbol, decimals=decimals,
                                       reason=None if ok else "decimals() out of range")
            except ChainError:
                check = JoinTokenCheck(address=token, ok=False, symbol=None, decimals=None,
                                       reason="not a readable ERC-20")
        self._token_cache[key] = (time.time(), check)
        return check

    # ------------------------------------------------------------- policy

    def creation_is_free(self, *, orbix_graduated: bool) -> tuple[bool, str]:
        """Platform creation fee policy.

        Pre-graduation: waived for every creator (the owner's current call, so
        the platform is usable today). Post-graduation: the standard fee
        applies to everyone. Join-token binding is independent of this and
        always available.
        """
        if not orbix_graduated:
            return True, "orbix-pre-graduation: creation fees are disabled platform-wide"
        return False, "orbix-graduated: the standard creation fee applies"

    def can_bind_join_token(self, creator_absorbs_orbix_fee: bool) -> tuple[bool, str]:
        """Binding a join token requires the creator to absorb the ORBIX joiner
        fee — that is what lets a joiner pay ONLY the creator's chosen token.
        Which token, and whether the creator owns any of it, is entirely the
        creator's choice."""
        if not creator_absorbs_orbix_fee:
            return False, "enable 'I pay all ORBIX joiner fees' to bind a join token"
        return True, "join token enabled: the creator absorbs ORBIX fees, joiners pay the chosen token"

    # ------------------------------------------------------------- pool bookkeeping

    def pool_of_room(self, room_id: str) -> int | None:
        return self.room_pool.get(room_id)

    def record_pool(self, room_id: str, pool_id: int) -> None:
        self.room_pool[room_id] = pool_id

    def issue_claim_nonce(self, pool_id: int) -> int:
        """Monotonic per-pool nonce so a claim code can never be replayed."""
        used = self.issued_nonces.setdefault(pool_id, set())
        n = (max(used) + 1) if used else 1
        used.add(n)
        return n

    def register_key_wallet(self, pool_id: int, address: str) -> None:
        self.key_wallets.setdefault(pool_id, []).append(address.lower())


def orbix_graduated(rpc: JsonRpc | None, orbix: str | None) -> bool:
    """Convenience: is the platform ORBIX token itself graduated?"""
    if not rpc or not orbix:
        return False
    return RewardService(rpc, None, None).graduation(orbix).graduated
