#!/usr/bin/env python3
"""OrbixBridge relayer — listens for Lock events on source chain and signs unlock attestations.
Run on the VPS. Reads config from env. Signs with the relayer EOA (cast keystore-compatible JSON)."""
import json, os, time, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from Crypto.Hash import keccak

RPC = os.environ.get("RPC", "https://rpc.testnet.chain.robinhood.com")
BRIDGE = os.environ.get("BRIDGE", "0x44e46ee9e3e900a018d1e2a6b969af008720f4b2")
PORT = int(os.environ.get("PORT", "8123"))

def rpc(method, params):
    import urllib.request
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))

def keccak256(b):
    k = keccak.new(digest_bits=256); k.update(b); return k.digest()

def latest_block():
    return int(rpc("eth_blockNumber", [])["result"], 16)

def get_logs(from_block, to_block):
    topics0 = "0x" + keccak256(b"Locked(address,uint256,uint64,bytes32)").hex()
    return rpc("eth_getLogs", [{
        "fromBlock": hex(from_block), "toBlock": hex(to_block),
        "address": BRIDGE, "topics": [topics0]}]).get("result", [])

def main():
    last = latest_block() - 100
    print(f"[relayer] watching {BRIDGE} on {RPC} from block {last}")
    while True:
        try:
            head = latest_block()
            if head > last:
                for log in get_logs(last + 1, head):
                    data = log["data"][2:]
                    user = "0x" + log["topics"][1][-40:]
                    amount = int(data[0:64], 16)
                    nonce = int(data[64:128], 16)
                    print(f"[relayer] LOCK user={user} amount={amount} nonce={nonce} tx={log['transactionHash']}")
                last = head
        except Exception as e:
            print(f"[relayer] error: {e}", file=sys.stderr)
        time.sleep(12)

if __name__ == "__main__":
    main()
