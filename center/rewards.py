"""Reward pools + creator-token gating (backend module).

Two capabilities:
  * Graduated creator tokens: a creator whose bound token has graduated on its
    bonding curve can run free rooms (no ORBIX creation fee) and charge joiners
    in their OWN token through CreatorTokenGate. Until ORBIX graduates, the
    platform creation fee stays disabled for everyone (owner policy).
  * Reward pools: typed assets (ERC20/721/1155/ETH) + claim modes
    (auto / code / merkle / open) with wallet-bound claim codes and
    private-key wallet rewards delivered off-chain.

Chain reads (graduation status, pool state) go through the same JsonRpc helper
used elsewhere, so a test can inject a fake.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from center.vault import ChainError, JsonRpc

# ------------------------------------------------ selectors (computed once)

def _sel(sig: str) -> str:
    from eth_utils import keccak
    return "0x" + keccak(text=sig)[:4].hex()


SEL_COMPLETE = _sel("complete()")
SEL_CURVE = _sel("curve()")
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


class RewardService:
    """Read-only chain checks + bookkeeping helpers for reward pools."""

    def __init__(self, rpc: JsonRpc | None, reward_engine: str | None, gate: str | None) -> None:
        self.rpc = rpc
        self.reward_engine = reward_engine
        self.gate = gate
        self._grad_cache: dict[str, tuple[float, GraduationStatus]] = {}
        # roomId => pool id (set when the creator creates the on-chain pool)
        self.room_pool: dict[str, int] = {}
        # poolId => list of wallet-bound claim codes issued (never reused)
        self.issued_nonces: dict[int, set[int]] = {}
        # private-key wallets created for key-rewards: poolId -> list of addresses
        self.key_wallets: dict[int, list[str]] = {}

    # ------------------------------------------------------------- graduation

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
        """Is `token` graduated? Cached briefly; the chain stays the authority."""
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

    # ------------------------------------------------------------- policy

    def creation_is_free(self, *, orbix_graduated: bool, creator_token: str | None) -> tuple[bool, str]:
        """Whether a publish is free, and why.

        Owner policy: while ORBIX itself has not graduated, NO creator pays the
        platform creation fee. After ORBIX graduates, everyone pays it — except
        creators binding their own GRADUATED token, who run free rooms and
        charge joiners in their token instead.
        """
        if not orbix_graduated:
            return True, "orbix-pre-graduation: creation fees are disabled platform-wide"
        if creator_token:
            status = self.graduation(creator_token)
            if status.graduated:
                return True, "creator-token-graduated: free room, joiners pay the creator's token"
        return False, "orbix-graduated: standard creation fee applies"

    # ------------------------------------------------------------- pool state

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
    svc = RewardService(rpc, None, None)
    return svc.graduation(orbix).graduated
