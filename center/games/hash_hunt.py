"""G07 — Hash Hunt.

Bot- and agent-friendly proof-of-work race. The preimage is exactly the tuple documented
in the build manual, ABI-encoded and hashed with keccak256:

    (bytes32 domain, uint256 chainId, address escrow, bytes32 roundId,
     bytes32 publicSeed, address player, uint256 nonce)

A proof is bound to the player, the round and the escrow address, so a valid nonce found
by one wallet can never be replayed as another wallet's submission. The server verifies;
it never mines.
"""

from __future__ import annotations

from eth_abi import encode as abi_encode
from eth_utils import keccak

from center.games.base import ActionResult, Engine
from center.schema import HashHuntRules, RoomConfig

#: Domain separation constant. Published so agents can mine the same target.
DOMAIN = keccak(text="orbix-center/hash-hunt/v1")

#: Null escrow address used before a real escrow is bound to a round.
ZERO_ADDR = "0x" + "00" * 20


def proof_target(difficulty_bits: int) -> int:
    return (1 << 256) >> difficulty_bits


def proof_hash(chain_id: int, escrow: str, round_id_hex: str, public_seed_hex: str, player: str, nonce: int) -> int:
    encoded = abi_encode(
        ["bytes32", "uint256", "address", "bytes32", "bytes32", "address", "uint256"],
        [
            DOMAIN,
            chain_id,
            escrow,
            bytes.fromhex(round_id_hex.removeprefix("0x")),
            bytes.fromhex(public_seed_hex.removeprefix("0x")),
            player,
            nonce,
        ],
    )
    return int.from_bytes(keccak(encoded), "big")


class HashHuntEngine(Engine):
    template_id = "hash-hunt"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: HashHuntRules = config.rules  # type: ignore[assignment]
        self.public_seed: str = ""
        self.chain_id: int = 46630
        self.escrow: str = ZERO_ADDR
        self.accepted: dict[str, list[dict]] = {}
        self.best: dict[str, int] = {}
        self.attempts: dict[str, int] = {}   # D10: verified server-side submit volume
        self.started_at: float = 0.0
        self.finished: bool = False
        self.first_winner: str | None = None

    # ------------------------------------------------------------------ lifecycle

    def start(self, now: float = 0.0) -> None:
        self.public_seed = "0x" + self.rng.draw(32).hex()
        for p in self.participants:
            self.accepted[p] = []
            self.best[p] = 1 << 256
            self.attempts[p] = 0
        self.started_at = now

    @property
    def target(self) -> int:
        return proof_target(self.rules.difficulty_bits)

    def tick(self, now: float) -> ActionResult | None:
        if self.finished:
            return None
        if now - self.started_at >= self.rules.duration_seconds:
            self.finished = True
            return ActionResult(True, patch={"finished": True, "scores": self.scores()}, finished=True)
        return None

    # ------------------------------------------------------------------ actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "submit":
            return ActionResult(False, "BAD_ACTION")

        nonce = action.get("nonce")
        if not isinstance(nonce, int) or isinstance(nonce, bool) or nonce < 0 or nonce >= (1 << 256):
            return ActionResult(False, "BAD_ACTION")
        if any(p["nonce"] == nonce for p in self.accepted[who]):
            return ActionResult(False, "ACTION_DUPLICATE")

        value = proof_hash(self.chain_id, self.escrow, self.round_id, self.public_seed, who, nonce)
        self.attempts[who] += 1  # counted only on server-verified hash evaluations
        if value >= self.target:
            # Not a valid proof: rejected, and it does not consume a slot.
            return ActionResult(False, "BAD_PROOF")

        self.best[who] = min(self.best[who], value)
        self.accepted[who].append({"nonce": nonce, "hash": f"0x{value:064x}"})
        patch: dict = {"accepted": {p: len(self.accepted[p]) for p in self.participants}}
        if self.first_winner is None and self.rules.win_mode == "first-valid":
            self.first_winner = who
            self.finished = True
            patch["firstValid"] = who
            patch["finished"] = True
        return ActionResult(True, patch=patch, private={"hash": f"0x{value:064x}"}, finished=self.finished, scores=self.scores())

    def eligible(self) -> set[str]:
        """A slot requires at least one proof the server accepted."""
        return {p for p in self.participants if self.accepted.get(p)}

    # ------------------------------------------------------------------ results

    def score_of(self, who: str) -> float:
        return float(len(self.accepted.get(who, [])))

    def scores(self) -> dict[str, float]:
        return {p: self.score_of(p) for p in self.participants}

    def ranking(self) -> list[str]:
        def key(p: str):
            first = 1 if self.first_winner == p else 0
            return (-first, -len(self.accepted.get(p, [])), self.best.get(p, 1 << 256), p)

        return sorted(self.participants, key=key)

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "roundId": self.round_id,
            "domain": "0x" + DOMAIN.hex(),
            "chainId": self.chain_id,
            "escrow": self.escrow,
            "publicSeed": self.public_seed,
            "target": f"0x{self.target:064x}",
            "difficultyBits": self.rules.difficulty_bits,
            # D10 feed: public difficulty + each miner's own VERIFIED attempt rate.
            # Never a solution nonce, partial preimage, or another player's secrets.
            "attemptRates": {
                p: {
                    "attempts": self.attempts.get(p, 0),
                    "valid": len(self.accepted.get(p, [])),
                }
                for p in self.participants
            },
            "winMode": self.rules.win_mode,
            # valid proofs are public: agents are meant to see the competition
            "leaderboard": [
                {"who": p, "valid": len(self.accepted.get(p, [])), "firstNonce": (self.accepted.get(p) or [{}])[0].get("nonce")}
                for p in self.ranking()[: self.rules.leaderboard_size]
                if self.accepted.get(p)
            ],
            "finished": self.finished,
            "firstValid": self.first_winner,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "publicSeed": self.public_seed,
            "chainId": self.chain_id,
            "escrow": self.escrow,
            "accepted": self.accepted,
            "best": self.best,
            "attempts": self.attempts,
            "startedAt": self.started_at,
            "finished": self.finished,
            "firstWinner": self.first_winner,
        }

    def _load(self, snapshot: dict) -> None:
        self.public_seed = str(snapshot.get("publicSeed", ""))
        self.chain_id = int(snapshot.get("chainId", 46630))
        self.escrow = str(snapshot.get("escrow", ZERO_ADDR))
        self.accepted = {k: list(v) for k, v in snapshot.get("accepted", {}).items()}
        self.best = {k: int(v) for k, v in snapshot.get("best", {}).items()}
        self.attempts = {k: int(v) for k, v in snapshot.get("attempts", {}).items()}
        for p in self.participants:
            self.attempts.setdefault(p, 0)
        self.started_at = float(snapshot.get("startedAt", 0.0))
        self.finished = bool(snapshot.get("finished", False))
        self.first_winner = snapshot.get("firstWinner")
