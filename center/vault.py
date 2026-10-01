"""Unified Liquidity Vault service (manual section 4).

One deposit. Software deducts per publication. The ledger is the source of truth in
preview mode, and mirrors on-chain events when a real vault is configured.

Guarantees implemented here:
  * a publication intent can be consumed once — a retried publish never double-charges
  * a deduction refund is capped at the original deduction and happens once
  * the balance can never go negative
  * fee-on-transfer tokens are refused by the contract, and the ledger unit is recorded
    so a simulated balance can never be mistaken for real funds
"""

from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass

from eth_account import Account
from eth_abi import encode as abi_encode
from eth_utils import keccak

from center.store import Store

SIMULATED_UNIT = "simulated"
JOINER_FEE_KIND = "joiner-absorbed"


class VaultError(Exception):
    pass


class InsufficientBalance(VaultError):
    pass


class IntentAlreadyConsumed(VaultError):
    pass


class ChainError(VaultError):
    pass


def publication_intent(creator: str, config_hash: str, nonce: str) -> str:
    """Deterministic id for one publication attempt, derived from the frozen config."""
    return "0x" + keccak(text=f"orbix-center/publish/v1|{creator.lower()}|{config_hash}|{nonce}").hex()


# --------------------------------------------------------------------- json-rpc


class JsonRpc:
    """Minimal JSON-RPC client so the on-chain adapter needs no web3 dependency."""

    def __init__(self, url: str, chain_id: int) -> None:
        self.url = url
        self.chain_id = chain_id
        self._id = 0

    def call(self, method: str, params: list) -> object:
        self._id += 1
        body = json.dumps({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params}).encode()
        req = urllib.request.Request(self.url, data=body, headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read())
        if "error" in payload:
            raise ChainError(f"{method}: {payload['error']}")
        return payload.get("result")

    def send_raw(self, raw_tx_hex: str) -> str:
        return str(self.call("eth_sendRawTransaction", [raw_tx_hex]))

    def receipt(self, tx_hash: str) -> dict:
        return dict(self.call("eth_getTransactionReceipt", [tx_hash]) or {})


# --------------------------------------------------------------------- on-chain adapter

SELECTORS = {
    "approve": keccak(text="approve(address,uint256)")[:4],
    "deposit": keccak(text="deposit(uint256)")[:4],
    "deduct": keccak(text="deduct(bytes32,uint256,bytes32)")[:4],
    "balanceOf": keccak(text="balanceOf(address)")[:4],
}


@dataclass
class OnchainVault:
    """Signs real transactions against a deployed CenterVault."""

    rpc: JsonRpc
    vault_address: str
    token_address: str
    private_key: str
    chain_id: int = 46630

    @property
    def account(self):
        return Account.from_key(self.private_key)

    def _send(self, to: str, data: bytes, value: int = 0) -> str:
        acct = self.account
        nonce = int(self.rpc.call("eth_getTransactionCount", [acct.address, "pending"]), 16)
        gas_price = int(self.rpc.call("eth_gasPrice", []), 16)
        tx = {
            "nonce": nonce,
            "gasPrice": gas_price,
            "gas": 400_000,
            "to": to,
            "value": value,
            "data": "0x" + data.hex(),
            "chainId": self.chain_id,
        }
        signed = acct.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        return self.rpc.send_raw(raw.hex() if not raw.startswith("0x") else raw)

    def approve(self, amount: int) -> str:
        data = SELECTORS["approve"] + abi_encode(["address", "uint256"], [self.vault_address, amount])
        return self._send(self.token_address, data)

    def deposit(self, amount: int) -> str:
        return self._send(self.vault_address, SELECTORS["deposit"] + abi_encode(["uint256"], [amount]))

    def deduct(self, intent_id: str, amount: int, room_id: str) -> str:
        data = SELECTORS["deduct"] + abi_encode(
            ["bytes32", "uint256", "bytes32"],
            [bytes.fromhex(intent_id.removeprefix("0x")), amount, bytes.fromhex(room_id.removeprefix("0x"))],
        )
        return self._send(self.vault_address, data)

    def balance_of(self, who: str) -> int:
        data = SELECTORS["balanceOf"] + abi_encode(["address"], [who])
        res = self.rpc.call("eth_call", [{"to": self.vault_address, "data": "0x" + data.hex()}, "latest"])
        return int(res, 16) if res and res != "0x" else 0


# --------------------------------------------------------------------- service


class VaultService:
    """Ledger-backed vault. Simulated in preview, mirrored on-chain when configured."""

    def __init__(self, store: Store, *, onchain: OnchainVault | None = None) -> None:
        self.store = store
        self.onchain = onchain

    # ------------------------------------------------------------------ mode

    @property
    def real(self) -> bool:
        return self.onchain is not None and os.environ.get("CENTER_REAL_BURN", "false").lower() == "true"

    def unit_for(self, mode: str, token: str | None) -> str:
        if mode == "onchain" and token:
            return token.lower()
        return SIMULATED_UNIT

    def is_simulated(self, unit: str) -> bool:
        return unit == SIMULATED_UNIT

    def label(self, unit: str) -> str:
        return "simulated" if self.is_simulated(unit) else "on-chain"

    # ------------------------------------------------------------------ balance

    def balance_of(self, creator: str, unit: str = SIMULATED_UNIT) -> int:
        return self.store.balance(creator.lower(), unit)

    def ledger(self, creator: str, limit: int = 100) -> list[dict]:
        return self.store.ledger(creator.lower(), limit)

    def ledger_csv(self, creator: str) -> str:
        rows = self.ledger(creator, limit=1000)
        out = ["kind,intent_id,amount,unit,room_id,created_at"]
        for r in rows:
            out.append(
                ",".join(
                    str(x if x is not None else "")
                    for x in (r["kind"], r["intent_id"], r["amount"], r["unit"], r["room_id"], r["created_at"])
                )
            )
        return "\n".join(out) + "\n"

    # ------------------------------------------------------------------ money in

    def deposit(self, creator: str, amount: int, unit: str = SIMULATED_UNIT, tx_hash: str | None = None) -> None:
        if amount <= 0:
            raise VaultError("deposit amount must be positive")
        self.store.add_ledger(creator.lower(), "deposit", amount, unit)
        if tx_hash:
            self.store.add_ledger(creator.lower(), "deposit-tx", 0, unit)

    # ------------------------------------------------------------------ money out

    def deduct_for_publish(self, creator: str, intent_id: str, amount: int, room_id: str,
                           unit: str = SIMULATED_UNIT) -> bool:
        """Charge one publication. Idempotent per intent.

        Returns True when this call performed the deduction, False when the intent had
        already been consumed (a retry) — in both cases the caller may proceed.
        """
        creator = creator.lower()
        if amount < 0:
            raise VaultError("amount must not be negative")

        existing = self.store.get_intent(intent_id)
        if existing:
            if existing["creator"] != creator:
                raise VaultError("intent belongs to a different creator")
            if existing["state"] == "consumed":
                return False  # already charged: safe retry
            if existing["state"] == "refunded":
                raise VaultError("intent was refunded and cannot be reused")

        if amount == 0:
            self.store.create_intent(intent_id, creator, "", 0, room_id)
            self.store.set_intent_state(intent_id, "consumed")
            return True

        balance = self.balance_of(creator, unit)
        if balance < amount:
            raise InsufficientBalance(f"vault balance {balance} < required {amount}")

        if self.real and self.onchain and not self.is_simulated(unit):
            self.onchain.deduct(intent_id, amount, room_id)

        self.store.create_intent(intent_id, creator, "", amount, room_id)
        self.store.add_ledger(creator, "room-creation", amount, unit, intent_id=intent_id, room_id=room_id)
        self.store.set_intent_state(intent_id, "consumed")
        return True

    def refund_deduction(self, creator: str, intent_id: str, unit: str = SIMULATED_UNIT) -> None:
        creator = creator.lower()
        existing = self.store.get_intent(intent_id)
        if not existing or existing["creator"] != creator:
            raise VaultError("unknown intent for this creator")
        if existing["state"] != "consumed":
            raise VaultError(f"intent is {existing['state']}, not consumed")
        amount = int(existing["amount"])
        self.store.add_ledger(creator, "refund", amount, unit, intent_id=intent_id, room_id=existing.get("room_id"))
        self.store.set_intent_state(intent_id, "refunded")

    def charge_joiner_fee(self, creator: str, room_id: str, amount: int, joiner: str,
                          unit: str = SIMULATED_UNIT) -> bool:
        """Absorb one joiner fee from the creator's balance. Idempotent per joiner+room."""
        creator = creator.lower()
        if amount <= 0:
            return False
        intent_id = "0x" + keccak(text=f"orbix-center/joiner/v1|{room_id}|{joiner.lower()}").hex()
        existing = self.store.get_intent(intent_id)
        if existing:
            return False  # already absorbed for this joiner
        if self.balance_of(creator, unit) < amount:
            raise InsufficientBalance("creator balance cannot cover the joiner fee")
        self.store.create_intent(intent_id, creator, "", amount, room_id)
        self.store.add_ledger(creator, JOINER_FEE_KIND, amount, unit, intent_id=intent_id, room_id=room_id)
        self.store.set_intent_state(intent_id, "consumed")
        return True
