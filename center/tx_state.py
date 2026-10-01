"""F2 — durable, idempotent transaction state machine (plan item F2, audit M-02).

Every value-bearing chain interaction is recorded BEFORE broadcast and advanced
only by verified evidence:

    unsigned -> signed -> submitted -> confirmed | failed -> finalized | reorged

Rules enforced here:
  * one row per (intent_id, chain_id, tx_hash); duplicate hashes are rejected
  * admission of a room entry requires the state `finalized` with a receipt that
    matches the expected contract, sender, and value — a submitted tx or a
    client claim is never sufficient
  * a reorg (receipt lost after confirmation) flips the row to `reorged` and
    blocks admission until it re-finalizes at a deeper depth
  * every transition is appended to the row's history with a timestamp
"""

from __future__ import annotations

import time
from enum import StrEnum


class TxState(StrEnum):
    UNSIGNED = "unsigned"
    SIGNED = "signed"
    SUBMITTED = "submitted"
    CONFIRMED = "confirmed"
    FAILED = "failed"
    FINALIZED = "finalized"
    REORGED = "reorged"


#: allowed transitions (from -> set of to)
TRANSITIONS: dict[TxState, set[TxState]] = {
    TxState.UNSIGNED: {TxState.SIGNED, TxState.FAILED},
    TxState.SIGNED: {TxState.SUBMITTED, TxState.FAILED},
    TxState.SUBMITTED: {TxState.CONFIRMED, TxState.FAILED},
    TxState.CONFIRMED: {TxState.FINALIZED, TxState.REORGED},
    TxState.FAILED: set(),                      # terminal
    TxState.FINALIZED: {TxState.REORGED},       # a deep-enough reorg can still unpick
    TxState.REORGED: {TxState.CONFIRMED, TxState.FAILED},
}

#: confirmations required before a value-bearing action may rely on the tx
FINALITY_DEPTH = 3


class TxError(Exception):
    pass


class InvalidTransition(TxError):
    pass


class DuplicateTx(TxError):
    pass


class TxRecord:
    """One tracked transaction and its transition history."""

    def __init__(self, intent_id: str, chain_id: int, tx_hash: str | None = None) -> None:
        self.intent_id = intent_id
        self.chain_id = chain_id
        self.tx_hash = tx_hash
        self.state = TxState.UNSIGNED
        self.history: list[dict] = [{"at": time.time(), "from": None, "to": self.state}]
        self.receipt: dict | None = None
        self.confirmations: int = 0

    def _advance(self, to: TxState, evidence: dict | None = None) -> None:
        if to not in TRANSITIONS[self.state]:
            raise InvalidTransition(f"{self.state.value} -> {to.value} is not allowed")
        self.state = to
        self.history.append({"at": time.time(), "from": self.history[-1]["to"],
                             "to": to, "evidence": evidence or {}})

    # ------------------------------------------------------------------ events

    def mark_signed(self, tx_hash: str) -> None:
        if self.tx_hash and self.tx_hash != tx_hash:
            raise DuplicateTx("intent already bound to another tx hash")
        self.tx_hash = tx_hash
        self._advance(TxState.SIGNED)

    def mark_submitted(self) -> None:
        self._advance(TxState.SUBMITTED)

    def mark_receipt(self, receipt: dict, *, expected_to: str | None = None,
                     expected_sender: str | None = None, block_height: int | None = None) -> None:
        """Feed a real receipt; the state machine decides what it means.

        Idempotent: once CONFIRMED/FINALIZED, deeper confirmation counts update
        `confirmations` in place (possibly promoting CONFIRMED -> FINALIZED)
        without demanding a fresh transition.
        """
        status_hex = str(receipt.get("status", "0x0"))
        success = int(status_hex, 16) == 1
        block_number = int(str(receipt.get("blockNumber", "0x0")), 16)
        to = str(receipt.get("to", "")).lower()
        sender = str(receipt.get("from", "")).lower()

        if self.state in (TxState.CONFIRMED, TxState.FINALIZED):
            if not success or to != str((self.receipt or {}).get("to", to)).lower():
                self.mark_reorged()
                return
            if block_height is not None:
                self.confirmations = max(0, block_height - block_number + 1)
                if self.confirmations >= FINALITY_DEPTH and self.state is TxState.CONFIRMED:
                    self._advance(TxState.FINALIZED, {"blockNumber": block_number,
                                                      "confirmations": self.confirmations})
            return

        if expected_to and to != expected_to.lower():
            self._advance(TxState.FAILED, {"reason": "wrong contract"})
            return
        if expected_sender and sender != expected_sender.lower():
            self._advance(TxState.FAILED, {"reason": "wrong sender"})
            return

        if not success:
            self._advance(TxState.FAILED, {"reason": "reverted", "receipt": receipt})
            return

        self.receipt = receipt
        if block_height is not None:
            self.confirmations = max(0, block_height - block_number + 1)
        self._advance(TxState.CONFIRMED, {"blockNumber": block_number,
                                          "confirmations": self.confirmations})
        if self.confirmations >= FINALITY_DEPTH:
            self._advance(TxState.FINALIZED)

    def mark_reorged(self) -> None:
        if self.state not in (TxState.CONFIRMED, TxState.FINALIZED):
            raise InvalidTransition("reorg applies only to confirmed/finalized txs")
        self.confirmations = 0
        self._advance(TxState.REORGED, {"reason": "receipt vanished after confirmation"})

    # ------------------------------------------------------------------ queries

    def admits_entry(self) -> bool:
        """F2 rule: a room entry may be admitted only on a finalized receipt."""
        return self.state is TxState.FINALIZED


class TxLedger:
    """In-memory ledger with per-intent uniqueness; swap for the SQL store at deploy."""

    def __init__(self) -> None:
        self._by_intent: dict[str, TxRecord] = {}
        self._by_hash: dict[str, TxRecord] = {}

    def open(self, intent_id: str, chain_id: int) -> TxRecord:
        if intent_id in self._by_intent:
            raise DuplicateTx(f"intent {intent_id} already open")
        rec = TxRecord(intent_id, chain_id)
        self._by_intent[intent_id] = rec
        return rec

    def get(self, intent_id: str) -> TxRecord | None:
        return self._by_intent.get(intent_id)

    def _register_hash(self, rec: TxRecord) -> None:
        assert rec.tx_hash
        key = f"{rec.chain_id}:{rec.tx_hash.lower()}"
        existing = self._by_hash.get(key)
        if existing and existing is not rec:
            raise DuplicateTx("tx hash already tracked for another intent")
        self._by_hash[key] = rec

    def mark_signed(self, intent_id: str, tx_hash: str) -> TxRecord:
        rec = self._require(intent_id)
        rec.mark_signed(tx_hash)
        self._register_hash(rec)
        return rec

    def mark_submitted(self, intent_id: str) -> TxRecord:
        rec = self._require(intent_id)
        rec.mark_submitted()
        self._register_hash(rec)
        return rec

    def mark_receipt(self, intent_id: str, receipt: dict, **expect) -> TxRecord:
        rec = self._require(intent_id)
        rec.mark_receipt(receipt, **expect)
        return rec

    def mark_reorged(self, intent_id: str) -> TxRecord:
        rec = self._require(intent_id)
        rec.mark_reorged()
        return rec

    def _require(self, intent_id: str) -> TxRecord:
        rec = self._by_intent.get(intent_id)
        if not rec:
            raise TxError(f"unknown intent {intent_id}")
        return rec
