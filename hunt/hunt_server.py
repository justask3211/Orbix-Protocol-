#!/usr/bin/env python3
"""Orbix 666 — human-tier click-hunt server.
Serves the hunt page, tracks winning numbers, signs winner claims for on-chain mintHuman().
Run on VPS: PORT=8400 python3 hunt_server.py"""
import json, os, secrets, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from Crypto.Hash import keccak

PORT = int(os.environ.get("PORT", "8400"))
# Relayer/signer keystore via cast: SIGNER_ADDR + path to keystore json + password env
SIGNER_ADDR = os.environ.get("SIGNER_ADDR", "0x253db2d543b10c94918de97eb8499ee59ab9087e")
KS = os.environ.get("KS_PATH", os.path.expanduser("~/.foundry/keystores/vibes-test.json"))
PW = os.environ.get("KS_PASS", "vibetest123")
N666 = os.environ.get("N666", "0x2D11AD9d0388CbCA0A9E137F099C3fff97d1B29d")

STATE = os.path.join(os.path.dirname(__file__), "hunt_state.json")

def load_state():
    if os.path.exists(STATE):
        return json.load(open(STATE))
    return {"winners": [], "salt": secrets.token_hex(16), "claimed": []}

def save_state(s):
    json.dump(s, open(STATE, "w"))

def gen_winners():
    """Generate 222 unique 6-digit winning numbers (111111-999999) with a deterministic salt."""
    s = load_state()
    if s["winners"]:
        return s
    rng = secrets.SystemRandom()
    nums = set()
    while len(nums) < 222:
        nums.add(rng.randint(111111, 999999))
    s["winners"] = sorted(nums)
    save_state(s)
    return s

def sign_winner(address, lucky_number, ts, seed_hex):
    """Sign exactly like the contract expects: keccak256(abi.encodePacked(address,uint256,uint256,bytes32)) prefixed."""
    import subprocess, binascii
    # use cast wallet sign --no-hash? cast signs keccak of message; we need raw ECDSA of digest
    # Compute digest
    data = bytes.fromhex(address[2:].lower())  # abi.encodePacked(address) = 20 raw bytes, NOT padded
    data += int(lucky_number).to_bytes(32, "big")
    data += int(ts).to_bytes(32, "big")
    data += bytes.fromhex(seed_hex)
    k = keccak.new(digest_bits=256); k.update(data)
    digest = k.hexdigest()
    # eth_sign style: keccak("\x19Ethereum Signed Message:\n32" + digest)
    k2 = keccak.new(digest_bits=256)
    k2.update(b"\x19Ethereum Signed Message:\n32" + bytes.fromhex(digest))
    signed_digest = "0x" + k2.hexdigest()
    out = subprocess.run(
        ["/home/agentuser/.foundry/bin/cast", "wallet", "sign", "--no-hash", signed_digest, "--account", "vibes-test", "--password", PW],
        capture_output=True, text=True).stdout.strip()
    return out, digest

class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(open(os.path.join(os.path.dirname(__file__), "hunt.html"), "rb").read())
        elif self.path == "/status":
            s = load_state()
            self._json({"signer": SIGNER_ADDR, "n666": N666,
                        "winners_remaining": 222 - len(s.get("claimed", [])), "salt_locked": bool(s.get("winners"))})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/check":
            return self._json({"error": "not found"}, 404)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        address = (body.get("address") or "").lower()
        number = int(body.get("number") or 0)
        s = load_state()
        if not s.get("winners"):
            gen_winners()
        win = number in s["winners"]
        # anti-spam: rate limit per IP could be added; keep simple
        if win and address and address not in s["claimed"] and len(s["claimed"]) < 222:
            s["claimed"].append(address)
            save_state(s)
            ts = int(time.time())
            seed = "0x" + s["salt"] + secrets.token_hex(16)
            sig, digest = sign_winner(address, number, ts, seed[2:])
            return self._json({"winner": True, "signature": sig, "timestamp": ts, "seed": seed,
                               "luckyNumber": number, "contract": N666, "signer": SIGNER_ADDR})
        return self._json({"winner": False, "number": number})

if __name__ == "__main__":
    gen_winners()
    print(f"[hunt] server on :{PORT}, signer {SIGNER_ADDR}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
