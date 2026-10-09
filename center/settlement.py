"""Settlement: merkle allocation tree, EIP-712 signing and payment codes.

The leaf/root/signature encoding here MUST match src/center/CenterEscrow.sol exactly.
The end-to-end test in center/tests/test_settlement_matches_contract.py proves that by
having the real contract verify a root this module built.

Leaf (double-hashed, OpenZeppelin standard):
    claim_id = keccak256(abi.encode(chainId, escrow, roundId, winner, slotId, allocationNonce))
    inner    = keccak256(abi.encode(claim_id, chainId, escrow, roundId, winner,
                                   assetKind, assetContract, tokenId, amount))
    leaf     = keccak256(bytes.concat(inner))

Internal nodes hash the sorted pair, matching OZ `Hashes.commutativeKeccak256`:
    node = keccak256(concat(min(a,b), max(a,b)))
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass

from eth_account import Account
from eth_account.messages import encode_defunct
from eth_abi import encode as abi_encode
from eth_utils import keccak

DOMAIN_NAME = "OrbixCenterEscrow"
DOMAIN_VERSION = "1"
SETTLEMENT_TYPE = (
    "Settlement(bytes32 roundId,bytes32 configHash,bytes32 merkleRoot,bytes32 allocationsHash,"
    "bytes32 transcriptHash,uint64 deadline,uint32 epoch)"
)

ASSET_KIND_ID = {"erc20": 0, "erc721": 1, "erc1155": 2, "eth": 3, "preview-points": 0}


def b32(value: str | bytes) -> bytes:
    if isinstance(value, bytes):
        return value
    raw = value[2:] if value.startswith("0x") else value
    return bytes.fromhex(raw.rjust(64, "0"))


def h32(value: str | bytes) -> bytes:
    return b32(value)


def claim_id(chain_id: int, escrow: str, round_id: str, winner: str, slot_id: int, allocation_nonce: int) -> bytes:
    return keccak(
        abi_encode(
            ["uint256", "address", "bytes32", "address", "uint32", "uint256"],
            [chain_id, escrow, b32(round_id), winner, slot_id, allocation_nonce],
        )
    )


def entitlement_leaf(
    *,
    chain_id: int,
    escrow: str,
    round_id: str,
    winner: str,
    slot_id: int,
    allocation_nonce: int,
    asset_kind: str,
    asset_contract: str | None,
    token_id: int,
    amount: int,
) -> tuple[bytes, bytes]:
    """Return (claim_id, leaf) for one entitlement."""
    cid = claim_id(chain_id, escrow, round_id, winner, slot_id, allocation_nonce)
    inner = keccak(
        abi_encode(
            ["bytes32", "uint256", "address", "bytes32", "address", "uint8", "address", "uint256", "uint256"],
            [
                cid,
                chain_id,
                escrow,
                b32(round_id),
                winner,
                ASSET_KIND_ID[asset_kind],
                asset_contract or "0x" + "00" * 20,
                token_id,
                amount,
            ],
        )
    )
    return cid, keccak(inner)


def _hash_pair(a: bytes, b: bytes) -> bytes:
    lo, hi = (a, b) if a < b else (b, a)
    return keccak(lo + hi)


def merkle_root(leaves: list[bytes]) -> bytes:
    """OpenZeppelin-standard tree: sorted pair hashing, odd node promoted."""
    if not leaves:
        return b"\x00" * 32
    nodes = list(leaves)
    while len(nodes) > 1:
        nxt: list[bytes] = []
        for i in range(0, len(nodes), 2):
            if i + 1 < len(nodes):
                nxt.append(_hash_pair(nodes[i], nodes[i + 1]))
            else:
                nxt.append(nodes[i])
        nodes = nxt
    return nodes[0]


def merkle_proof(leaves: list[bytes], index: int) -> list[bytes]:
    proof: list[bytes] = []
    nodes = list(leaves)
    i = index
    while len(nodes) > 1:
        nxt: list[bytes] = []
        for j in range(0, len(nodes), 2):
            if j + 1 < len(nodes):
                if j == i:
                    proof.append(nodes[j + 1])
                elif j + 1 == i:
                    proof.append(nodes[j])
                nxt.append(_hash_pair(nodes[j], nodes[j + 1]))
            else:
                nxt.append(nodes[j])
        i //= 2
        nodes = nxt
    return proof


def allocations_hash(entries: list[dict]) -> bytes:
    """Hash of the ordered allocation list, so a settlement is bound to exact payouts."""
    canonical = json.dumps(entries, sort_keys=True, separators=(",", ":"))
    return keccak(text=canonical)


def transcript_hash(round_id: str, actions: list[dict]) -> bytes:
    h = hashlib.sha256(b"orbix-center/transcript/v1|" + round_id.encode())
    for a in actions:
        h.update(b"|" + json.dumps(a, sort_keys=True, separators=(",", ":")).encode())
    return h.digest()


def domain_separator(chain_id: int, escrow: str) -> bytes:
    return keccak(
        abi_encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                keccak(text="EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak(text=DOMAIN_NAME),
                keccak(text=DOMAIN_VERSION),
                chain_id,
                escrow,
            ],
        )
    )


def settlement_digest(
    *,
    chain_id: int,
    escrow: str,
    round_id: str,
    config_hash: str,
    root: bytes,
    allocations: bytes,
    transcript: bytes,
    deadline: int,
    epoch: int,
) -> bytes:
    struct_hash = keccak(
        abi_encode(
            ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint64", "uint32"],
            [keccak(text=SETTLEMENT_TYPE), b32(round_id), b32(config_hash), root, allocations, transcript, deadline, epoch],
        )
    )
    return keccak(b"\x19\x01" + domain_separator(chain_id, escrow) + struct_hash)


def sign_settlement(private_key: str, **kwargs) -> str:
    """Sign a settlement digest, returning a 65-byte 0x signature for publishSettlement."""
    digest = settlement_digest(**kwargs)
    signed = Account._sign_hash(digest, private_key) if hasattr(Account, "_sign_hash") else None
    if signed is None:  # pragma: no cover - depends on eth_account version
        signed = Account.sign_message(encode_defunct(primitive=digest), private_key=private_key)
    sig = getattr(signed, "signature", None)
    return sig.hex() if isinstance(sig, (bytes, bytearray)) else str(sig)


# --------------------------------------------------------------------- payment codes


def checksum(payload: str) -> str:
    """Short typo-detection suffix. NOT authentication — deliberately documented as such."""
    return hashlib.sha256(("orbix-center/code/v1|" + payload).encode()).hexdigest()[:12].upper()


def payment_code(claim_id_hex: str) -> str:
    """Encode the complete 256-bit claim ID; never expose an enumerable prefix."""
    if not isinstance(claim_id_hex, str) or len(claim_id_hex) != 66 or not claim_id_hex.startswith("0x"):
        raise ValueError("expected a 32-byte claim ID")
    try:
        int(claim_id_hex[2:], 16)
    except ValueError as exc:
        raise ValueError("expected a hexadecimal claim ID") from exc
    ref = claim_id_hex[2:].upper()
    return f"OC2-{ref}-{checksum('OC2-' + ref)[:12]}"


def parse_payment_code(code: str) -> str | None:
    """Accept only intact, canonical v2 codes; legacy short codes require migration."""
    if not isinstance(code, str):
        return None
    parts = code.split("-")
    if len(parts) != 3 or parts[0] != "OC2" or len(parts[1]) != 64 or len(parts[2]) != 12:
        return None
    ref = parts[1]
    if any(ch not in "0123456789ABCDEF" for ch in ref):
        return None
    expected = checksum("OC2-" + ref)[:12]
    if not hmac.compare_digest(parts[2], expected):
        return None
    return "0x" + ref.lower()


@dataclass
class SettlementBundle:
    round_id: str
    root: bytes
    allocations: bytes
    transcript: bytes
    deadline: int
    epoch: int
    entries: list[dict]

    def as_json(self) -> dict:
        return {
            "roundId": self.round_id,
            "merkleRoot": "0x" + self.root.hex(),
            "allocationsHash": "0x" + self.allocations.hex(),
            "transcriptHash": "0x" + self.transcript.hex(),
            "deadline": self.deadline,
            "epoch": self.epoch,
            "allocations": self.entries,
        }
