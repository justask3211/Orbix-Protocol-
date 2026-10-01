"""F2 — transaction state machine: idempotent, evidence-driven, admission-gating."""

import pytest

from center.tx_state import (
    FINALITY_DEPTH,
    DuplicateTx,
    InvalidTransition,
    TxError,
    TxLedger,
    TxState,
)


def _receipt(status: int = 1, block: int = 100) -> dict:
    return {"status": hex(status), "blockNumber": hex(block),
            "to": "0x" + "aa" * 20, "from": "0x" + "bb" * 20}


def _signed_rec(ledger: TxLedger, intent: str = "i1") -> object:
    rec = ledger.open(intent, 46630)
    rec.mark_signed("0x" + "c" * 64)
    ledger.mark_submitted(intent)
    return rec


def test_happy_path_reaches_finalized_and_admits():
    ledger = TxLedger()
    ledger.open("i1", 46630)
    ledger.mark_signed("i1", "0x" + "c" * 64)
    ledger.mark_submitted("i1")
    # confirmations accumulate over blocks (tx mined at block 100)
    for height in (100, 101, 102):
        rec = ledger.mark_receipt("i1", _receipt(block=100), block_height=height)
    assert rec.state is TxState.FINALIZED
    assert rec.admits_entry() is True


def test_entry_requires_full_finality_not_just_confirmation():
    ledger = TxLedger()
    rec = _signed_rec(ledger)
    rec.mark_receipt(_receipt(block=100), block_height=100)  # 1 confirmation
    assert rec.state is TxState.CONFIRMED
    assert rec.admits_entry() is False, "a merely-confirmed tx must not admit entry"


def test_reverted_tx_fails_and_never_admits():
    ledger = TxLedger()
    _signed_rec(ledger, "r1")
    rec = ledger.mark_receipt("r1", _receipt(status=0, block=100), block_height=100)
    assert rec.state is TxState.FAILED
    assert rec.admits_entry() is False
    # terminal: no further transitions
    with pytest.raises(InvalidTransition):
        rec.mark_receipt(_receipt(block=101))


def test_wrong_contract_or_sender_fails_the_tx():
    ledger = TxLedger()
    _signed_rec(ledger, "w1")
    evil_receipt = dict(_receipt(block=100))
    evil_receipt["to"] = "0x" + "de" * 20   # not the vault
    rec = ledger.mark_receipt("w1", evil_receipt,
                              expected_to="0x" + "aa" * 20)
    assert rec.state is TxState.FAILED
    assert rec.history[-1]["evidence"]["reason"] == "wrong contract"


def test_duplicate_tx_hash_for_another_intent_is_rejected():
    ledger = TxLedger()
    ledger.open("a", 46630)
    ledger.mark_signed("a", "0x" + "c" * 64)
    ledger.open("b", 46630)
    with pytest.raises(DuplicateTx):
        ledger.mark_signed("b", "0x" + "C" * 64)  # same hash, different intent


def test_double_open_of_same_intent_is_rejected():
    ledger = TxLedger()
    ledger.open("i", 46630)
    with pytest.raises(DuplicateTx):
        ledger.open("i", 46630)


def test_reorg_flips_finalized_back_and_blocks_entry():
    ledger = TxLedger()
    ledger.open("i2", 46630)
    ledger.mark_signed("i2", "0x" + "d" * 64)
    ledger.mark_submitted("i2")
    for height in (100, 101, 102):
        rec = ledger.mark_receipt("i2", _receipt(block=100), block_height=height)
    assert rec.admits_entry()
    rec.mark_reorged()
    assert rec.state is TxState.REORGED
    assert rec.admits_entry() is False
    # recovery: receipt re-appears deeper and re-finalizes
    for height in (200, 201, 202):
        rec = ledger.mark_receipt("i2", _receipt(block=200), block_height=height)
    assert rec.admits_entry() is True


def test_skip_transition_is_rejected():
    ledger = TxLedger()
    rec = ledger.open("s1", 46630)
    with pytest.raises(InvalidTransition):
        rec.mark_submitted()  # unsigned -> submitted is not allowed


def test_unknown_intent_is_rejected():
    ledger = TxLedger()
    with pytest.raises(TxError):
        ledger.mark_submitted("nope")


def test_finality_depth_is_three():
    assert FINALITY_DEPTH == 3
