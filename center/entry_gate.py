"""Read-only, fail-closed CreatorTokenGate admission verification.

The deployed v2 ABI is defined in src/center/CreatorTokenGate.sol. Entry.amount
is a whole-token count in the existing room schema; joinFee is in base units.
Every state read uses the same block with at least three confirmations. A
CreatorJoined event binds the historical payment to the configured token/fee,
because the contract allows a creator to mutate a binding after somebody joins.
No submitted hash, client assertion, wallet balance, or allowance is admission.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from eth_abi import decode, encode
from eth_utils import keccak

from center.vault import JsonRpc

DEPLOYED_GATE = "0xcfc161d02225eceb97aa9b8ff791a407a3bb3cff"
GATE_CHAIN_ID = 46630
BURN_ADDRESS = "0x000000000000000000000000000000000000dead"
ZERO_ADDRESS = "0x" + "00" * 20
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
ROOM_ID = re.compile(r"^(?:0x)?[0-9a-fA-F]{16,64}$")
JOIN_EVENT = "0x" + keccak(text="CreatorJoined(bytes32,address,uint256,address)").hex()
# Verified public Robinhood RPC restriction: a log query may span at most 10m blocks.
LOG_BLOCK_RANGE = 10_000_000
MAX_LOG_PAGES = 32


@dataclass(frozen=True)
class EntryVerification:
    ok: bool
    code: str
    message: str
    block: int | None = None
    decimals: int | None = None
    amount_base_units: int | None = None
    transaction_hash: str | None = None


class EntryGateError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def room_id_bytes32(room_id: str) -> bytes:
    """Match gate.ts left-padding for valid ids; reject its permissive stripping."""
    if not isinstance(room_id, str) or not ROOM_ID.fullmatch(room_id):
        raise EntryGateError("ENTRY_INVALID_CONFIG", "Room identifier must be 16–64 hexadecimal characters.")
    value = room_id.removeprefix("0x")
    if len(value) % 2:
        raise EntryGateError("ENTRY_INVALID_CONFIG", "Room identifier must contain whole hexadecimal bytes.")
    return bytes.fromhex(value).rjust(32, b"\0")


def _address(value: str, field: str) -> str:
    if not isinstance(value, str) or not ADDRESS.fullmatch(value) or value.lower() == ZERO_ADDRESS:
        raise EntryGateError("ENTRY_INVALID_CONFIG", f"A valid nonzero {field} address is required.")
    return value.lower()


def _hex_bytes(value: object) -> bytes:
    if not isinstance(value, str) or not value.startswith("0x") or len(value) <= 2 or len(value) % 2:
        raise ValueError("Malformed RPC hex response")
    return bytes.fromhex(value[2:])


def _quantity(value: object) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]+", value):
        raise ValueError("Malformed RPC block/chain quantity")
    return int(value, 16)


class EntryGateVerifier:
    def __init__(self, rpc: JsonRpc, gate_address: str = DEPLOYED_GATE, *, chain_id: int = GATE_CHAIN_ID, confirmations: int = 3) -> None:
        self.rpc = rpc
        self.gate_address = _address(gate_address, "entry gate")
        if chain_id != GATE_CHAIN_ID or not isinstance(confirmations, int) or isinstance(confirmations, bool) or confirmations < 3:
            raise EntryGateError("ENTRY_INVALID_CONFIG", "Entry verification requires chain 46630 and at least three confirmations.")
        self.chain_id = chain_id
        self.confirmations = confirmations

    def _read(self, destination: str, signature: str, types: list[str], values: list, outputs: list[str], block: str) -> tuple:
        data = keccak(text=signature)[:4] + encode(types, values)
        raw = self.rpc.call("eth_call", [{"to": destination, "data": "0x" + data.hex()}, block])
        encoded = _hex_bytes(raw)
        if len(encoded) != len(outputs) * 32:
            raise ValueError("Unexpected static ABI response length")
        return decode(outputs, encoded)

    def verify(self, room_id: str, player: str, creator: str, token: str, amount: int, *, payout_mode: str | None = None, payout_address: str | None = None) -> EntryVerification:
        block_number: int | None = None
        decimals: int | None = None
        base_amount: int | None = None
        try:
            room = room_id_bytes32(room_id)
            player, creator, token = _address(player, "player"), _address(creator, "creator"), _address(token, "entry token")
            if not isinstance(amount, int) or isinstance(amount, bool) or amount <= 0:
                raise EntryGateError("ENTRY_INVALID_CONFIG", "Entry amount must be a positive whole-token integer.")
            if payout_mode not in {None, "creator", "custom", "burn"}:
                raise EntryGateError("ENTRY_INVALID_CONFIG", "Unknown entry payout mode.")
            if payout_mode == "custom":
                payout_address = _address(payout_address, "custom payout")
            elif payout_address is not None:
                payout_address = _address(payout_address, "payout")

            if _quantity(self.rpc.call("eth_chainId", [])) != self.chain_id:
                raise EntryGateError("ENTRY_WRONG_CHAIN", "The entry verifier RPC is connected to the wrong chain.")
            head = _quantity(self.rpc.call("eth_blockNumber", []))
            if head < self.confirmations - 1:
                raise EntryGateError("ENTRY_CONFIRMATIONS_PENDING", "The chain has too few blocks for confirmed entry verification.")
            block_number = head - self.confirmations + 1
            block = hex(block_number)
            gate_code = self.rpc.call("eth_getCode", [self.gate_address, block])
            if gate_code in {"0x", "0x0", None}:
                raise EntryGateError("ENTRY_GATE_UNAVAILABLE", "The configured entry gate is not deployed at the confirmed block.")
            _hex_bytes(gate_code)
            binding = self._read(self.gate_address, "bindingOf(bytes32)", ["bytes32"], [room], ["address", "address", "uint256", "address", "uint8", "bool"], block)
            bound_creator, bound_token, fee, payout, payee, paused = binding
            if bound_creator.lower() == ZERO_ADDRESS:
                raise EntryGateError("ENTRY_NOT_BOUND", "The creator has not confirmed a token binding for this room.")
            if bound_creator.lower() != creator:
                raise EntryGateError("ENTRY_CREATOR_MISMATCH", "The gate binding belongs to a different creator.")
            if bound_token.lower() != token:
                raise EntryGateError("ENTRY_TOKEN_MISMATCH", "The gate binding uses a different entry token.")
            if paused:
                raise EntryGateError("ENTRY_PAUSED", "The creator has paused token admission for this room.")

            decimals = int(self._read(token, "decimals()", [], [], ["uint8"], block)[0])
            base_amount = amount * 10**decimals
            if base_amount >= 2**256:
                raise EntryGateError("ENTRY_INVALID_CONFIG", "Entry amount exceeds the token's uint256 base-unit limit.")
            if fee != base_amount:
                raise EntryGateError("ENTRY_AMOUNT_MISMATCH", "The confirmed gate fee does not match the room's configured entry amount.")
            expected_payee = {"creator": 0, "custom": 1, "burn": 2}.get(payout_mode)
            expected_payout = creator if payout_mode == "creator" else BURN_ADDRESS if payout_mode == "burn" else payout_address
            if payee not in {0, 1, 2} or payout.lower() == ZERO_ADDRESS or (payee == 0 and payout.lower() != creator) or (payee == 2 and payout.lower() != BURN_ADDRESS):
                raise EntryGateError("ENTRY_PAYOUT_MISMATCH", "The entry gate payout is inconsistent with its payout mode.")
            if expected_payee is not None and (payee != expected_payee or payout.lower() != expected_payout):
                raise EntryGateError("ENTRY_PAYOUT_MISMATCH", "The confirmed entry payout differs from the room configuration.")

            joined = self._read(self.gate_address, "joined(bytes32,address)", ["bytes32", "address"], [room, player], ["bool"], block)[0]
            if not joined:
                raise EntryGateError("ENTRY_PAYMENT_REQUIRED", "Pay this room's entry fee and wait for three block confirmations before joining.")

            room_topic = "0x" + room.hex()
            player_topic = "0x" + encode(["address"], [player]).hex()
            end = block_number
            for _ in range(MAX_LOG_PAGES):
                begin = max(0, end - LOG_BLOCK_RANGE + 1)
                logs = self.rpc.call("eth_getLogs", [{"address": self.gate_address, "fromBlock": hex(begin), "toBlock": hex(end), "topics": [JOIN_EVENT, room_topic, player_topic]}])
                if not isinstance(logs, list):
                    raise ValueError("Malformed entry event response")
                for log in reversed(logs):
                    if not isinstance(log, dict) or log.get("removed") is True:
                        continue
                    if str(log.get("address", "")).lower() != self.gate_address or [str(topic).lower() for topic in log.get("topics", [])] != [JOIN_EVENT, room_topic, player_topic]:
                        continue
                    log_block = _quantity(log.get("blockNumber"))
                    transaction = log.get("transactionHash")
                    if not begin <= log_block <= end or not isinstance(transaction, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", transaction):
                        continue
                    event_data = _hex_bytes(log.get("data"))
                    if len(event_data) != 64:
                        continue
                    paid_fee, paid_token = decode(["uint256", "address"], event_data)
                    if paid_fee == base_amount and paid_token.lower() == token:
                        return EntryVerification(True, "ENTRY_CONFIRMED", "Token entry payment is confirmed.", block_number, decimals, base_amount, transaction)
                    # This non-proxy gate permits one payment per room/player, so an
                    # actual historical payment cannot be replaced by another event.
                    raise EntryGateError("ENTRY_PAYMENT_MISMATCH", "The recorded entry payment does not match this room's token and fee.")
                if begin == 0:
                    break
                end = begin - 1
            else:
                raise ValueError("Entry history exceeds bounded verification range")
            raise EntryGateError("ENTRY_PAYMENT_MISMATCH", "The recorded entry payment does not match this room's token and fee.")
        except EntryGateError as exc:
            return EntryVerification(False, exc.code, exc.message, block_number, decimals, base_amount)
        except Exception:
            # Provider messages can contain credentials, payloads or implementation details.
            return EntryVerification(False, "ENTRY_RPC_UNAVAILABLE", "Confirmed entry payment could not be verified. Retry when the chain connection is available.", block_number, decimals, base_amount)

    def require(self, room_id: str, player: str, creator: str, token: str, amount: int, *, payout_mode: str | None = None, payout_address: str | None = None) -> EntryVerification:
        result = self.verify(room_id, player, creator, token, amount, payout_mode=payout_mode, payout_address=payout_address)
        if not result.ok:
            raise EntryGateError(result.code, result.message)
        return result
