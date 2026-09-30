# VIBE ARCADE — Room Server (MVP: Number Jackpot)
# FastAPI + WebSockets. Rooms live in memory (Redis later). Sneak-peek: entries tracked off-chain.
# Run: uvicorn main:app --host 0.0.0.0 --port 8080
import asyncio, json, os, secrets, time
from typing import Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Vibe Arcade Room Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/")
async def index():
    return FileResponse("static/index.html")

MAX_ROOMS = int(os.environ.get("MAX_ROOMS", "50"))
MAX_PLAYERS_PER_ROOM = int(os.environ.get("MAX_PLAYERS", "100"))
RATE_LIMIT_MS = int(os.environ.get("RATE_LIMIT_MS", "400"))  # min ms between guesses

rooms: Dict[str, dict] = {}


def new_room(cfg: dict) -> dict:
    lo = max(111111, int(cfg.get("min", 111111)))
    hi = min(999999, int(cfg.get("max", 999999)))
    if lo >= hi:
        lo, hi = 111111, 999999
    guesses = min(50, max(1, int(cfg.get("guesses", 20))))
    seconds = min(3600, max(15, int(cfg.get("seconds", 60))))
    return {
        "id": secrets.token_hex(4),
        "secret": secrets.randbelow(hi - lo + 1) + lo,
        "lo": lo, "hi": hi, "guesses": guesses, "seconds": seconds,
        "reward_token": str(cfg.get("rewardToken", "TEST"))[:16],
        "pot": float(cfg.get("pot", 1000)),
        "entry_fee": float(cfg.get("entryFee", 0)),
        "name": str(cfg.get("name", "Number Jackpot"))[:40],
        "created": time.time(),
        "ends": time.time() + seconds,
        "state": "open",  # open | won | expired
        "players": {},    # ws -> {addr, guesses_left, spent, joined}
        "feed": [],       # last 30 guess events
        "winners": [],
        "rate": {},       # addr -> last guess ts
    }


@app.get("/health")
async def health():
    return {"ok": True, "service": "vibe-arcade", "rooms": len(rooms)}


@app.get("/rooms")
async def list_rooms():
    out = []
    for r in rooms.values():
        out.append({
            "id": r["id"], "name": r["name"], "state": r["state"],
            "lo": r["lo"], "hi": r["hi"], "guesses": r["guesses"],
            "seconds": r["seconds"], "rewardToken": r["reward_token"],
            "pot": r["pot"], "entryFee": r["entry_fee"],
            "players": len(r["players"]),
            "timeLeft": max(0, int(r["ends"] - time.time())) if r["state"] == "open" else 0,
        })
    return out


@app.post("/rooms")
async def create_room(cfg: dict):
    """Create a room. (Burn-to-create gate comes later; MVP open.)"""
    if len(rooms) >= MAX_ROOMS:
        return JSONResponse({"error": "room limit reached"}, status_code=429)
    r = new_room(cfg)
    rooms[r["id"]] = r
    return {"ok": True, "roomId": r["id"], "config": {
        "lo": r["lo"], "hi": r["hi"], "guesses": r["guesses"],
        "seconds": r["seconds"], "rewardToken": r["reward_token"],
        "pot": r["pot"], "entryFee": r["entry_fee"]}}


@app.get("/room/{room_id}")
async def room_meta(room_id: str):
    r = rooms.get(room_id)
    if not r:
        return JSONResponse({"error": "not found"}, status_code=404)
    return {"id": r["id"], "name": r["name"], "state": r["state"],
            "lo": r["lo"], "hi": r["hi"], "guesses": r["guesses"],
            "seconds": r["seconds"], "rewardToken": r["reward_token"],
            "pot": r["pot"], "entryFee": r["entry_fee"],
            "players": len(r["players"]), "feed": r["feed"][-30:],
            "timeLeft": max(0, int(r["ends"] - time.time())) if r["state"] == "open" else 0}


async def broadcast(r: dict, msg: dict):
    dead = []
    for ws in list(r["players"].keys()):
        try:
            await ws.send_text(json.dumps(msg))
        except Exception:
            dead.append(ws)
    for ws in dead:
        r["players"].pop(ws, None)


@app.websocket("/ws/{room_id}")
async def ws_room(ws: WebSocket, room_id: str):
    r = rooms.get(room_id)
    if not r or len(r["players"]) >= MAX_PLAYERS_PER_ROOM:
        await ws.close(code=4004)
        return
    await ws.accept()
    addr = None
    try:
        # first message must be join
        join = json.loads(await ws.receive_text())
        if join.get("t") != "join":
            await ws.close(code=4000)
            return
        addr = str(join.get("addr", ""))[:42] or f"anon-{secrets.token_hex(3)}"
        r["players"][ws] = {"addr": addr, "guesses_left": r["guesses"], "joined": time.time()}
        await ws.send_text(json.dumps({"t": "welcome", "room": {
            "id": r["id"], "name": r["name"], "lo": r["lo"], "hi": r["hi"],
            "guesses": r["guesses"], "seconds": r["seconds"],
            "timeLeft": max(0, int(r["ends"] - time.time())), "state": r["state"],
            "rewardToken": r["reward_token"], "pot": r["pot"]},
            "you": {"guessesLeft": r["guesses"]}}))
        await broadcast(r, {"t": "playerJoined", "addr": addr[:6] + "…" + addr[-4:],
                            "players": len(r["players"])})
        while True:
            raw = await ws.receive_text()
            try:
                m = json.loads(raw)
            except Exception:
                continue
            p = r["players"].get(ws)
            if not p:
                break
            now = time.time()
            if r["state"] != "open" or now >= r["ends"]:
                r["state"] = "expired" if now >= r["ends"] else r["state"]
                await ws.send_text(json.dumps({"t": "roundOver", "state": r["state"]}))
                continue
            if m.get("t") == "guess":
                # rate limit
                last = r["rate"].get(addr, 0)
                if (now - last) * 1000 < RATE_LIMIT_MS:
                    await ws.send_text(json.dumps({"t": "slowDown"}))
                    continue
                r["rate"][addr] = now
                if p["guesses_left"] <= 0:
                    await ws.send_text(json.dumps({"t": "noGuesses"}))
                    continue
                try:
                    g = int(m.get("n"))
                except Exception:
                    continue
                p["guesses_left"] -= 1
                event = {"t": "guess", "who": addr[:6] + "…" + addr[-4:], "n": g,
                         "left": p["guesses_left"]}
                r["feed"].append(event)
                r["feed"] = r["feed"][-30:]
                if g == r["secret"]:
                    r["state"] = "won"
                    r["winners"].append(addr)
                    share = round(r["pot"] / (len(r["winners"])), 2) if r["winners"] else 0
                    await broadcast(r, {"t": "winner", "who": addr[:6] + "…" + addr[-4:],
                                        "n": g, "rewardToken": r["reward_token"],
                                        "share": share, "players": len(r["players"])})
                    await ws.send_text(json.dumps({"t": "youWon", "share": share,
                                                   "rewardToken": r["reward_token"]}))
                else:
                    hint = "higher" if g < r["secret"] else "lower"
                    await ws.send_text(json.dumps({"t": "result", "n": g, "hint": hint,
                                                   "left": p["guesses_left"]}))
                    await broadcast(r, {"t": "guessFeed", "who": addr[:6] + "…" + addr[-4:],
                                        "left": p["guesses_left"]})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if ws in r["players"]:
            left = r["players"].pop(ws)
            try:
                await broadcast(r, {"t": "playerLeft", "players": len(r["players"])})
            except Exception:
                pass


@app.on_event("startup")
async def seed_demo_room():
    r = new_room({"name": "Demo Jackpot", "guesses": 20, "seconds": 3600,
                              "pot": 5000, "rewardToken": "TEST", "entryFee": 0})
    rooms[r["id"]] = r
