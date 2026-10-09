"""RewardEngine binding and wallet claims. No server-sent funding transactions.

Auto prompt uses Code on chain: the deployed Auto mode cannot redeem a code.
Code/Open allocation writes are creator-only, so plans are returned for the host
wallet to confirm. Readiness never follows from a server settlement alone.
"""
from __future__ import annotations

import base64
import json
import os
import time
from collections import defaultdict

from eth_abi import decode, encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak

from center import settlement as st
from center.vault import ChainError

ENGINE = "0x5b8d41421b9a6701cb7948e724234cb9b1eb8e1b"
ZERO = "0x" + "00" * 20
KINDS = {"erc20": 0, "erc721": 1, "erc1155": 2, "eth": 3}
MODES = {"auto": 1, "code": 1, "merkle": 2, "open": 3}


def room_key(room_id):
    return keccak(text=room_id)


def call_data(signature, types=(), values=()):
    return "0x" + (keccak(text=signature)[:4] + encode(types, values)).hex()


class RewardFlow:
    def __init__(self, store, rpc, chain_id=46630):
        self.store, self.rpc, self.chain_id = store, rpc, chain_id
        self.engine = ENGINE
        with store.tx() as c:
            c.execute("CREATE INDEX IF NOT EXISTS reward_winners ON entitlements(lower(winner),room_id)")
            c.execute("CREATE TABLE IF NOT EXISTS reward_bindings (room_id TEXT PRIMARY KEY, pool_id TEXT UNIQUE NOT NULL, binding_json TEXT NOT NULL)")

    def read(self, sig, inputs, args, outputs, block="latest"):
        raw = self.rpc.call("eth_call", [{"to": self.engine, "data": call_data(sig, inputs, args)}, block])
        try:
            return decode(outputs, bytes.fromhex(str(raw).removeprefix("0x")))
        except Exception as e:
            raise ChainError("Reward pool read is unavailable. Retry verification.") from e

    def chain(self):
        if int(str(self.rpc.call("eth_chainId", [])), 16) != self.chain_id:
            raise ChainError("Reward reader is on the wrong chain.")

    def info(self, pool_id, block="latest"):
        return self.read("poolInfo(uint256)", ["uint256"], [int(pool_id)],
                         ["address", "bytes32", "uint8", "uint64", "uint8", "uint256", "bytes32", "string"], block)

    def binding(self, room_id):
        with self.store.tx() as c:
            row = c.execute("SELECT binding_json FROM reward_bindings WHERE room_id=?", (room_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def verify_funding(self, room_id, creator, rewards, funding):
        self.chain()
        pool_id = int(funding["poolId"])
        receipt = self.rpc.call("eth_getTransactionReceipt", [funding["txHash"]])
        if not receipt or receipt.get("status") != "0x1" or receipt.get("to", "").lower() != self.engine or receipt.get("from", "").lower() != creator.lower():
            raise ValueError("Funding requires a confirmed creator deposit receipt on RewardEngine.")
        info = self.info(pool_id)
        if rewards.claim_mode == "open":
            pool = self.read("pools(uint256)", ["uint256"], [pool_id], ["address", "bytes32", "uint8", "uint64", "uint32", "uint32", "uint8", "bool", "bytes32", "uint256", "string"])
            if pool[4] != len(rewards.slots) or pool[5] != 0 or not pool[7]:
                raise ValueError("Open pool capacity does not match the configured prize slots.")
        if info[0].lower() != creator.lower() or info[1] != room_key(room_id):
            raise ValueError("Reward pool creator or room binding does not match.")
        if info[2] != MODES[rewards.claim_mode] or info[3] != rewards.claim_deadline or info[4] != 0 or info[3] <= time.time() + 3600:
            raise ValueError("Reward pool mode, active state or deadline does not match.")
        kinds, contracts, ids, amounts = self.read("poolAssets(uint256)", ["uint256"], [pool_id], ["uint8[]", "address[]", "uint256[]", "uint256[]"])
        expected, actual = defaultdict(int), defaultdict(int)
        for slot in rewards.slots:
            expected[(KINDS[slot.asset_kind], slot.asset_contract.lower(), slot.token_id)] += slot.amount
        for k, a, i, n in zip(kinds, contracts, ids, amounts):
            actual[(k, a.lower(), i)] += n
        if dict(expected) != dict(actual):
            raise ValueError("Pool asset inventory does not match the promised rewards.")
        # Tie the submitted receipt to this pool, rather than accepting any old deposit.
        topic = "0x" + keccak(text="AssetDeposited(uint256,uint8,address,uint256,uint256)").hex()
        if not any(log.get("address", "").lower() == self.engine and log.get("topics", [])[:2] == [topic, "0x" + pool_id.to_bytes(32, "big").hex()] for log in receipt.get("logs", [])):
            raise ValueError("The funding receipt contains no deposit for this pool.")
        root, _ = self.merkle(rewards)
        if info[6] != root:
            raise ValueError("Committed Merkle distribution does not match.")
        with self.store.tx() as c:
            hit = c.execute("SELECT room_id FROM reward_bindings WHERE pool_id=?", (str(pool_id),)).fetchone()
        if hit and hit[0] != room_id:
            raise ValueError("This pool is already bound to another room.")
        return {"roomId": room_id, "poolId": str(pool_id), "txHash": funding["txHash"], "blockNumber": receipt["blockNumber"], "engine": self.engine,
                "mode": rewards.claim_mode, "deadline": info[3], "assets": [{"kind": k, "contract": a, "tokenId": str(i), "amount": str(n)} for k, a, i, n in zip(kinds, contracts, ids, amounts)]}

    def bind(self, binding):
        with self.store.tx() as c:
            c.execute("INSERT INTO reward_bindings VALUES (?,?,?)", (binding["roomId"], binding["poolId"], json.dumps(binding)))

    @staticmethod
    def merkle(rewards):
        if rewards.claim_mode != "merkle":
            return b"\0" * 32, []
        if len(rewards.merkle_winners) != len(rewards.slots):
            raise ValueError("Merkle mode requires a fixed recipient for every reward slot before funding.")
        if len(set(a.lower() for a in rewards.merkle_winners)) != len(rewards.merkle_winners):
            raise ValueError("Merkle mode permits one claim per wallet.")
        # Funding aggregates identical assets; support a single asset for this fixed distribution.
        if len({(s.asset_kind, s.asset_contract.lower(), s.token_id) for s in rewards.slots}) != 1:
            raise ValueError("Merkle distribution requires one shared asset.")
        if any(len(a) != 42 or not a.startswith("0x") or int(a[2:], 16) == 0 for a in rewards.merkle_winners):
            raise ValueError("Merkle recipients must be valid nonzero wallet addresses.")
        leaves = [keccak(bytes.fromhex(a[2:]) + (0).to_bytes(32, "big") + s.amount.to_bytes(32, "big")) for a, s in zip(rewards.merkle_winners, rewards.slots)]
        return st.merkle_root(leaves), leaves

    def entries(self, room_id):
        with self.store.tx() as c:
            return [dict(e) for e in c.execute("SELECT * FROM entitlements WHERE room_id=? ORDER BY slot_id,winner", (room_id,)).fetchall()]

    def plan(self, room_id):
        binding = self.binding(room_id)
        if not binding:
            return None
        info = self.info(binding["poolId"])
        rows = self.entries(room_id)
        if binding["mode"] == "open":
            from center.schema import RoomConfig
            rewards = RoomConfig(**self.store.get_room(room_id)["config"]).rewards
            rows = [{"claim_id": "0x" + keccak(text=f"ORBIX_OPEN:{room_id}:{i}").hex(), "winner": ZERO,
                     "asset_kind": s.asset_kind, "asset_contract": s.asset_contract, "token_id": s.token_id, "amount": s.amount}
                    for i, s in enumerate(rewards.slots)]
        allocations = []
        for e in rows:
            token_id = str(int(e["token_id"], 16)) if isinstance(e["token_id"], str) and e["token_id"].startswith("0x") else str(e["token_id"])
            ai = next((i for i, a in enumerate(binding["assets"]) if a["kind"] == KINDS.get(e["asset_kind"]) and a["contract"].lower() == (e["asset_contract"] or ZERO).lower() and a["tokenId"] == token_id), None)
            if ai is None:
                raise ValueError("Settlement reward does not match funded inventory.")
            allocations.append({"claimId": e["claim_id"], "winner": e["winner"], "assetIndex": ai, "amount": str(e["amount"]), "assetKind": e["asset_kind"], "assetContract": e["asset_contract"], "tokenId": token_id})
        used = set()
        logs = self.allocation_logs(binding) if binding["mode"] != "merkle" else []
        for allocation in allocations:
            allocation["allocated"] = False
            for i, log in enumerate(logs):
                winner = "0x" + log["topics"][2][-40:]
                ai, amount = decode(["uint256", "uint256"], bytes.fromhex(log["data"][2:]))
                expected_winner = ZERO if binding["mode"] == "open" else allocation["winner"].lower()
                if i not in used and winner.lower() == expected_winner and ai == allocation["assetIndex"] and str(amount) == allocation["amount"]:
                    allocation["allocated"] = True
                    used.add(i)
                    break
        return {**binding, "allocations": allocations, "allocationCount": sum(a["allocated"] for a in allocations), "chainAllocationCount": info[5], "settled": bool(self.store.room_round(room_id) and self.store.room_round(room_id).get("ended_at"))}

    def allocation_logs(self, binding):
        topic = "0x" + keccak(text="AllocationSet(uint256,address,uint256,uint256)").hex()
        logs = self.rpc.call("eth_getLogs", [{"address": self.engine, "fromBlock": binding["blockNumber"], "toBlock": "latest", "topics": [topic, "0x" + int(binding["poolId"]).to_bytes(32, "big").hex()]}]) or []
        return sorted(logs, key=lambda x: (int(x["blockNumber"], 16), int(x["logIndex"], 16)))

    def claims(self, who, room_id=None):
        self.chain()
        with self.store.tx() as c:
            rooms = [r[0] for r in c.execute("SELECT DISTINCT room_id FROM entitlements WHERE lower(winner)=?", (who.lower(),)).fetchall()]
        if room_id and room_id not in rooms:
            binding = self.binding(room_id)
            if binding and binding["mode"] == "open":
                rooms.append(room_id)
        output = []
        for rid in rooms:
            if room_id and rid != room_id:
                continue
            plan = self.plan(rid)
            if not plan or not plan["settled"]:
                continue
            from center.schema import RoomConfig
            rewards = RoomConfig(**self.store.get_room(rid)["config"]).rewards
            logs = self.allocation_logs(plan) if plan["mode"] != "merkle" else []
            root, leaves = self.merkle(rewards)
            for e in plan["allocations"]:
                if plan["mode"] != "open" and e["winner"].lower() != who.lower():
                    continue
                claimed = self.read("isClaimed(uint256,address)", ["uint256", "address"], [int(plan["poolId"]), who], ["bool"])[0]
                item = {**e, "winner": who if plan["mode"] == "open" else e["winner"], "roomId": rid, "poolId": plan["poolId"], "engine": self.engine, "chainId": self.chain_id, "deadline": plan["deadline"], "mode": plan["mode"], "claimed": claimed, "payable": False}
                if claimed:
                    item["reason"] = "Already claimed on chain."
                elif plan["deadline"] < time.time():
                    item["reason"] = "Claim deadline has passed."
                elif plan["mode"] == "merkle":
                    idx = next((i for i, a in enumerate(rewards.merkle_winners) if a.lower() == who.lower() and str(rewards.slots[i].amount) == e["amount"]), None)
                    if idx is not None:
                        item.update(payable=True, function="claimByMerkle", args=[plan["poolId"], ["0x" + p.hex() for p in st.merkle_proof(leaves, idx)], who, e["assetIndex"], e["amount"]])
                    else:
                        item["reason"] = "Winner does not match the immutable Merkle distribution."
                else:
                    match = None
                    for i, log in enumerate(logs):
                        winner = "0x" + log["topics"][2][-40:]
                        ai, amount = decode(["uint256", "uint256"], bytes.fromhex(log["data"][2:]))
                        if winner.lower() == (ZERO if plan["mode"] == "open" else who.lower()) and ai == e["assetIndex"] and str(amount) == e["amount"]:
                            match = i
                            break
                    if match is None:
                        item["reason"] = "Waiting for the creator to confirm the winner allocation."
                    elif plan["mode"] == "open":
                        item.update(payable=True, function="claimOpen", args=[plan["poolId"], match])
                    else:
                        key = os.environ.get("CENTER_REWARD_SIGNER_KEY") or os.environ.get("CENTER_SIGNER_KEY")
                        if not key:
                            item["reason"] = "Claim authority signing is not configured."
                        else:
                            authority = self.read("authority()", [], [], ["address"])[0]
                            if Account.from_key(key).address.lower() != authority.lower():
                                raise ChainError("Claim signer does not match the deployed authority.")
                            nonce = match + 1
                            digest = keccak(b"ORBIX_REWARD_CLAIM_V1" + bytes.fromhex(self.engine[2:]) + self.chain_id.to_bytes(32, "big") + int(plan["poolId"]).to_bytes(32, "big") + match.to_bytes(32, "big") + bytes.fromhex(who[2:]) + nonce.to_bytes(32, "big"))
                            signature = "0x" + Account.sign_message(encode_defunct(primitive=digest), key).signature.hex()
                            payload = {"claimId": e["claimId"], "poolId": plan["poolId"], "allocIndex": match, "nonce": nonce, "winner": who.lower(), "signature": signature}
                            code = "OR3-" + base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
                            item.update(payable=True, function="claimByCode", args=[plan["poolId"], match, nonce, signature], code=code)
                if item["payable"]:
                    sig, types = {
                        "claimByCode": ("claimByCode(uint256,uint256,uint256,bytes)", ["uint256", "uint256", "uint256", "bytes"]),
                        "claimOpen": ("claimOpen(uint256,uint256)", ["uint256", "uint256"]),
                        "claimByMerkle": ("claimByMerkle(uint256,bytes32[],address,uint256,uint256)", ["uint256", "bytes32[]", "address", "uint256", "uint256"]),
                    }[item["function"]]
                    values = list(item["args"])
                    values[0] = int(values[0])
                    if item["function"] == "claimByCode":
                        values[3] = bytes.fromhex(values[3][2:])
                    elif item["function"] == "claimByMerkle":
                        values[1] = [bytes.fromhex(v[2:]) for v in values[1]]
                        values[4] = int(values[4])
                    try:
                        self.rpc.call("eth_call", [{"from": who, "to": self.engine, "data": call_data(sig, types, values)}, "latest"])
                    except ChainError:
                        item.update(payable=False, reason="The contract cannot currently execute this claim. Refresh after checking pool inventory, allocation and deadline.")
                output.append(item)
        return output

    def lookup(self, code, who):
        try:
            if not isinstance(code, str) or len(code) > 2048 or not code.startswith("OR3-"):
                raise ValueError()
            payload = json.loads(base64.urlsafe_b64decode(code[4:] + "=" * (-len(code[4:]) % 4)))
            if payload["winner"].lower() != who.lower():
                raise PermissionError("This code belongs to another wallet.")
            claim = next((c for c in self.claims(who) if c["claimId"] == payload["claimId"]), None)
            if not claim or claim.get("code") != code:
                raise ValueError()
            return claim
        except PermissionError:
            raise
        except (ValueError, KeyError, TypeError) as e:
            raise ValueError("No claim matches this code. Check the complete code.") from e
