#!/usr/bin/env python3
"""Local full-flow proof: prefund -> publish -> enter -> play -> settle -> claim.

Runs against a throwaway Anvil chain. The point of this script is the cross-language
agreement check: the merkle root and the EIP-712 settlement signature are produced by
Python (center/settlement.py, the same code the API uses) and must be accepted by the
deployed Solidity contract. If any encoding detail drifted, this fails loudly.

Usage:
    center/.venv/bin/python center/onchain_flow.py <rpc-url> <deployments.json>
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from eth_account import Account  # noqa: E402
from eth_utils import keccak  # noqa: E402

from center import settlement as st  # noqa: E402

ANVIL_KEYS = {
    "creator": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "authority": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "playerA": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "playerB": "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
}

STEP = 0
RPC = "http://127.0.0.1:8546"
FAILURES: list[str] = []


def ok(label: str, detail: object = "") -> None:
    print(f"  PASS  {label}" + (f"  {detail}" if detail != "" else ""))


def bad(label: str, detail: object = "") -> None:
    FAILURES.append(label)
    print(f"  FAIL  {label}" + (f"  {detail}" if detail != "" else ""))


def check(label: str, condition: bool, detail: object = "") -> None:
    (ok if condition else bad)(label, detail)


ROUND_SIG = ("roundOf(bytes32)((bytes32,bytes32,address,address,uint256,uint32,uint32,uint64,"
             "uint64,uint64,uint64,uint64,uint64,uint32,uint16,bytes32,uint8,bytes32,bytes32,bytes32,uint256))")


def round_fields(castfn, escrow: str, round_id: str) -> list[str]:
    """Read the Round struct and split it into its 21 declared fields, in order."""
    raw = castfn("call", escrow, ROUND_SIG, round_id).strip()
    return [f.strip() for f in raw.strip("()").split(",")]


def to_int(value: str) -> int:
    value = value.strip().split()[0]
    return int(value, 16) if value.startswith("0x") else int(value)


def cast(*args: str, key: str | None = None) -> str:
    cmd = ["cast", *args, "--rpc-url", RPC]
    if key:
        cmd += ["--private-key", ANVIL_KEYS[key]]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = (proc.stdout or proc.stderr).strip()
    if proc.returncode != 0:
        raise RuntimeError(f"cast {' '.join(args[:2])} failed: {out[:400]}")
    return out


def try_cast(*args: str, key: str | None = None) -> tuple[bool, str]:
    try:
        return True, cast(*args, key=key)
    except RuntimeError as exc:
        return False, str(exc)


def send(*args: str, key: str) -> str:
    return cast("send", *args, key=key)


def wait_receipt(rpc: str, tx_hash: str) -> None:
    for _ in range(60):
        status = cast("receipt", tx_hash, "--json")
        if json.loads(status).get("status") == "0x1":
            return
        time.sleep(0.2)
    raise RuntimeError("transaction was not mined")


def main() -> int:
    global RPC
    rpc = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8546"
    RPC = rpc
    deployments = sys.argv[2] if len(sys.argv) > 2 else "center/deployments/local.json"
    with open(deployments) as fh:
        d = json.load(fh)

    run_salt = os.environ.get("CENTER_RUN_SALT") or str(int(time.time()))
    print(f"   run salt {run_salt}")
    token, vault, escrow = d["token"], d["vault"], d["escrow"]
    registry, verifier = d["registry"], d["verifier"]
    creator, player_a, player_b, authority = d["creator"], d["playerA"], d["playerB"], d["authority"]
    e18 = 10**18

    print(f"\n== Orbix Center on-chain flow ({rpc}) ==")
    print(f"   escrow {escrow}\n   vault  {vault}\n   token  {token}")

    # ---------------------------------------------------------------- 1. registry
    print("\n[1] registry wiring")
    check("escrow approved", cast("call", registry, "isEscrow(address)(bool)", escrow) == "true")
    check("token approved", cast("call", registry, "isAsset(address)(bool)", token) == "true")
    check("template approved", cast("call", registry, "isTemplate(bytes32)(bool)", keccak(text="number-hunt").hex()) == "true")
    check("authority set for epoch 1", cast("call", verifier, "authorizedSigner(uint32)(address)", "1").lower() == authority.lower())

    # ---------------------------------------------------------------- 2. vault float
    print("\n[2] unified vault: deposit then software deduction")
    bal_before = to_int(cast("call", vault, "balanceOf(address)(uint256)", creator))
    send(token, "approve(address,uint256)", vault, str(10_000 * e18), key="creator")
    send(vault, "deposit(uint256)", str(10_000 * e18), key="creator")
    bal = to_int(cast("call", vault, "balanceOf(address)(uint256)", creator))
    check("deposit credited", bal - bal_before == 10_000 * e18, f"balance={bal // e18}")

    intent = "0x" + keccak(text=f"orbix-center/publish/v1|local|cfg-{run_salt}").hex()
    room_bytes = "0x" + keccak(text=f"room-local-{run_salt}").hex()
    send(vault, "deduct(bytes32,uint256,bytes32)", intent, str(100 * e18), room_bytes, key="creator")
    bal2 = to_int(cast("call", vault, "balanceOf(address)(uint256)", creator))
    check("deduction applied", bal2 == bal - 100 * e18, f"balance={bal2 // e18}")
    ok_replay, _ = try_cast("send", vault, "deduct(bytes32,uint256,bytes32)", intent, str(100 * e18), room_bytes, key="creator")
    bal3 = to_int(cast("call", vault, "balanceOf(address)(uint256)", creator))
    check("replayed deduction refused (no double charge)", not ok_replay and bal3 == bal2, f"balance={bal3 // e18}")
    check("intent marked consumed", cast("call", vault, "intentConsumed(bytes32)(bool)", intent) == "true")

    # ---------------------------------------------------------------- 3. create round
    print("\n[3] create round, fund rewards and take entries")
    now = to_int(cast("block", "latest", "--field", "timestamp"))
    round_id = "0x" + keccak(text=f"orbx-round-local-{run_salt}").hex()
    config_hash = "0x" + keccak(text=f"cfg-{run_salt}").hex()
    template = "0x" + keccak(text="number-hunt").hex()
    spec = (
        f"({round_id},{config_hash},{template},{token},{20 * e18},8,"
        f"{now},{now + 600},{now + 1200},{now + 3600},{now + 7200},{now + 10800},1,0,"
        f"0x{'00' * 32})"
    )
    sig = "createRound((bytes32,bytes32,bytes32,address,uint256,uint32,uint64,uint64,uint64,uint64,uint64,uint64,uint32,uint16,bytes32))"
    send(escrow, sig, spec, key="creator")
    check("round registered", cast("call", escrow, "roundOf(bytes32)((bytes32,bytes32,address,address,uint256,uint32,uint32,uint64,uint64,uint64,uint64,uint64,uint64,uint32,uint16,bytes32,uint8,bytes32,bytes32,bytes32,uint256))", round_id).startswith("("))

    # Two funded reward slots: 60 to the winner, 30 to the runner-up (90 total reserved).
    for who in ("creator",):
        send(token, "approve(address,uint256)", escrow, str(90 * e18), key=who)
    send(escrow, "fundERC20(bytes32,address,uint256)", round_id, token, str(90 * e18), key="creator")

    for who in ("playerA", "playerB"):
        send(token, "approve(address,uint256)", escrow, str(20 * e18), key=who)
        send(escrow, "enter(bytes32)", round_id, key=who)
    entrants = round_fields(cast, escrow, round_id)[6]
    check("two entrants recorded", int(entrants) == 2, f"entrants={entrants}")

    # ---------------------------------------------------------------- 4. python settlement
    print("\n[4] python builds the allocation tree and signs it")
    deadline = now + 3600
    epoch = 1
    entries, leaves = [], []
    for slot, (winner, amount) in enumerate([(player_a, 60 * e18), (player_b, 30 * e18)], start=1):
        cid, leaf = st.entitlement_leaf(
            chain_id=d["chainId"], escrow=escrow, round_id=round_id, winner=winner,
            slot_id=slot, allocation_nonce=0, asset_kind="erc20",
            asset_contract=token, token_id=0, amount=amount,
        )
        entries.append({
            "claimId": "0x" + cid.hex(), "roundId": round_id, "winner": winner, "slotId": slot,
            "points": 100 if slot == 1 else 50, "assetKind": "erc20", "assetContract": token,
            "tokenId": 0, "amount": amount,
        })
        leaves.append(leaf)
    root = st.merkle_root(leaves)
    allocations = st.allocations_hash(entries)
    transcript = st.transcript_hash(round_id, [{"kind": "guess", "who": player_a, "number": 4242}])
    digest = st.settlement_digest(
        chain_id=d["chainId"], escrow=escrow, round_id=round_id, config_hash=config_hash,
        root=root, allocations=allocations, transcript=transcript, deadline=deadline, epoch=epoch,
    )
    signature = st.sign_settlement(
        ANVIL_KEYS["authority"], chain_id=d["chainId"], escrow=escrow, round_id=round_id,
        config_hash=config_hash, root=root, allocations=allocations, transcript=transcript,
        deadline=deadline, epoch=epoch,
    )
    onchain_digest = cast(
        "call", escrow, "settlementDigest(bytes32,bytes32,bytes32,bytes32,uint64)(bytes32)",
        round_id, "0x" + root.hex(), "0x" + allocations.hex(), "0x" + transcript.hex(), str(deadline),
    )
    check("EIP-712 digest matches the contract", onchain_digest.lower() == "0x" + digest.hex(), f"{onchain_digest[:18]}…")

    send(escrow, "publishSettlement(bytes32,bytes32,bytes32,bytes32,uint64,bytes)",
         round_id, "0x" + root.hex(), "0x" + allocations.hex(), "0x" + transcript.hex(), str(deadline), signature,
         key="creator")

    fields = round_fields(cast, escrow, round_id)
    check("round has 21 fields", len(fields) == 21, f"got {len(fields)}")
    check("contract stored the python root", fields[16 + 1].lower() == "0x" + root.hex(),
          f"stored {fields[16 + 1][:12]} vs python {'0x' + root.hex()[:12]}")
    check("contract stored the allocations hash", fields[18].lower() == "0x" + allocations.hex())
    check("contract stored the transcript hash", fields[19].lower() == "0x" + transcript.hex())
    check("round is settled", fields[16] == "3", f"state={fields[16]} (3 == State.Settled)")

    # ---------------------------------------------------------------- 5. claims
    print("\n[5] winners claim with a python-built merkle proof")
    before = to_int(cast("call", token, "balanceOf(address)(uint256)", player_a))
    proof_arg = "[" + ",".join("0x" + p.hex() for p in st.merkle_proof(leaves, 0)) + "]"
    e = entries[0]
    tuple_arg = f"({0},{token},{e['tokenId']},{e['amount']},{e['claimId']},{round_id},{player_a},{e['slotId']},0)"
    send(escrow, "claim((uint8,address,uint256,uint256,bytes32,bytes32,address,uint32,uint256),bytes32[])", tuple_arg, proof_arg, key="playerA")
    after = to_int(cast("call", token, "balanceOf(address)(uint256)", player_a))
    check("winner paid the full allocation", after - before == 60 * e18, f"+{(after - before) // e18} OBX-T")

    again_ok, _ = try_cast("send", escrow, "claim((uint8,address,uint256,uint256,bytes32,bytes32,address,uint32,uint256),bytes32[])", tuple_arg, proof_arg, key="playerA")
    check("double claim refused", not again_ok)

    bad_ok, _ = try_cast(
        "send", escrow, "claim((uint8,address,uint256,uint256,bytes32,bytes32,address,uint32,uint256),bytes32[])",
        f"(0,{token},0,{90 * e18},{'0x' + '11' * 32},{round_id},{player_b},9,0)", proof_arg, key="playerB",
    )
    check("forged claim refused", not bad_ok)

    proof_arg_b = "[" + ",".join("0x" + p.hex() for p in st.merkle_proof(leaves, 1)) + "]"
    before_b = to_int(cast("call", token, "balanceOf(address)(uint256)", player_b))
    eb = entries[1]
    tuple_b = f"({0},{token},{eb['tokenId']},{eb['amount']},{eb['claimId']},{round_id},{player_b},{eb['slotId']},0)"
    send(escrow, "claim((uint8,address,uint256,uint256,bytes32,bytes32,address,uint32,uint256),bytes32[])", tuple_b, proof_arg_b, key="playerB")
    after_b = to_int(cast("call", token, "balanceOf(address)(uint256)", player_b))
    check("runner-up paid", after_b - before_b == 30 * e18, f"+{(after_b - before_b) // e18} OBX-T")

    # ---------------------------------------------------------------- result
    print("\n== flow result ==")
    if FAILURES:
        print(f"  {len(FAILURES)} check(s) failed: {FAILURES}")
        return 1
    print("  all checks passed: python settlement is accepted by the deployed contract")
    print(json.dumps({"roundId": round_id, "merkleRoot": "0x" + root.hex(),
                      "allocationsHash": "0x" + allocations.hex(),
                      "transcriptHash": "0x" + transcript.hex(),
                      "signature": signature[:20] + "…", "claims": len(entries)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
