#!/usr/bin/env python3
"""Orbix 666 hunt server — Railway container build (pure-python, no pycryptodome/foundry needed).
Serves hunt page + /status + /check. Sneak-peek mode: winner detection works, claim signing disabled."""
import json, os, secrets, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8400"))
SIGNER_ADDR = os.environ.get("SIGNER_ADDR", "0x253db2d543b10c94918de97eb8499ee59ab9087e")
N666 = os.environ.get("N666", "0x2D11AD9d0388CbCA0A9E137F099C3fff97d1B29d")
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hunt_state.json")

def load_state():
    if os.path.exists(STATE):
        try: return json.load(open(STATE))
        except Exception: pass
    return {"winners": [], "salt": secrets.token_hex(16), "claimed": []}

def save_state(s):
    json.dump(s, open(STATE, "w"))

def gen_winners():
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

class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            b = open(os.path.join(os.path.dirname(__file__), "hunt.html"), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
        elif self.path in ("/status", "/api/status"):
            s = load_state()
            self._json({"signer": SIGNER_ADDR, "n666": N666,
                        "winners_remaining": 222 - len(s.get("claimed", [])),
                        "salt_locked": bool(s.get("winners")), "mode": "sneak-peek"})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/check":
            return self._json({"error": "not found"}, 404)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0))
        address = (body.get("address") or "").lower()
        try: number = int(body.get("number") or 0)
        except Exception: number = 0
        s = load_state()
        if not s.get("winners"):
            gen_winners()
        win = number in s["winners"]
        if win and address and address not in s["claimed"] and len(s["claimed"]) < 222:
            s["claimed"].append(address)
            save_state(s)
            return self._json({"winner": True, "luckyNumber": number, "contract": N666,
                               "signer": SIGNER_ADDR, "signature": None,
                               "note": "sneak-peek: claim signing disabled"})
        return self._json({"winner": False, "number": number})

if __name__ == "__main__":
    gen_winners()
    print(f"[hunt] server on :{PORT}, signer {SIGNER_ADDR} (sneak-peek mode)")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.protocol_version = "HTTP/1.1"
    srv.serve_forever()
