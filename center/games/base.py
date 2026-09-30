"""Engine protocol shared by every Center template.

Design rules enforced here (manual sections 3, 12, 15):
  * the server owns the secret state and every random draw
  * a round's randomness comes from one committed seed, expanded through a documented,
    reproducible stream, so a published transcript can be replayed and recomputed
  * engines return *entitlements*; they never touch money
  * an engine never trusts a client-supplied score
"""

from __future__ import annotations

import hashlib
import hmac
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from center.schema import RoomConfig

DOMAIN_COMMIT = b"orbix-center/round-commit/v1"


class StreamRNG:
    """Deterministic, reproducible byte stream derived from a seed.

    `draw(n)` returns n bytes of SHA-256(seed || domain || counter) output. Engines use
    `below(limit)` which applies unbiased rejection sampling so a range is never skewed
    by a modulo bias (manual section 12.4).
    """

    def __init__(self, seed: str, domain: bytes = b"orbix-center/stream/v1") -> None:
        self._seed = seed.encode()
        self._domain = domain
        self._counter = 0
        self._buf = b""

    def _refill(self) -> None:
        block = hashlib.sha256(self._seed + self._domain + self._counter.to_bytes(8, "big")).digest()
        self._counter += 1
        self._buf += block

    def draw(self, n: int) -> bytes:
        while len(self._buf) < n:
            self._refill()
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def below(self, limit: int) -> int:
        """Uniform integer in [0, limit) with rejection sampling (no modulo bias)."""
        if limit <= 0:
            raise ValueError("limit must be positive")
        if limit == 1:
            return 0
        nbytes = (limit.bit_length() + 7) // 8
        ceiling = (1 << (8 * nbytes)) - ((1 << (8 * nbytes)) % limit)
        while True:
            value = int.from_bytes(self.draw(nbytes), "big")
            if value < ceiling:
                return value % limit

    def between(self, lo: int, hi: int) -> int:
        """Inclusive uniform integer in [lo, hi]."""
        if hi < lo:
            raise ValueError("hi must be >= lo")
        return lo + self.below(hi - lo + 1)

    def choice(self, seq):
        return seq[self.below(len(seq))]

    def shuffled(self, seq: list) -> list:
        out = list(seq)
        for i in range(len(out) - 1, 0, -1):
            j = self.below(i + 1)
            out[i], out[j] = out[j], out[i]
        return out


def commit_hash(round_id: str, config_hash: str, seed: str) -> str:
    """Public commitment published before play, binding seed + round + config."""
    return hashlib.sha256(
        DOMAIN_COMMIT + round_id.encode() + b"|" + config_hash.encode() + b"|" + seed.encode()
    ).hexdigest()


def verify_commit(round_id: str, config_hash: str, seed: str, expected: str) -> bool:
    return hmac.compare_digest(commit_hash(round_id, config_hash, seed), expected)


@dataclass
class ActionResult:
    ok: bool
    error: str | None = None
    patch: dict[str, Any] = field(default_factory=dict)
    private: dict[str, Any] = field(default_factory=dict)
    finished: bool = False
    scores: dict[str, float] = field(default_factory=dict)


@dataclass
class Entitlement:
    """A reward slot allocation produced by settlement. Never carries money itself."""

    slot_id: int
    winner: str
    points: int = 0
    asset_kind: str | None = None
    asset_contract: str | None = None
    token_id: int = 0
    amount: int = 0


class Engine(ABC):
    """One authoritative game reducer."""

    template_id: str = "base"
    version: int = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        self.config = config
        self.round_id = round_id
        self.seed = seed
        self.rng = StreamRNG(seed)
        self.participants = list(participants)
        self.finished = False

    # ------------------------------------------------------------------ lifecycle

    @abstractmethod
    def start(self, now: float = 0.0) -> None:
        """Initialise secret state. Called once, after participants are known."""
    def tick(self, now: float) -> "ActionResult | None":
        """Optional clock hook (question deadlines, timed phases). Default: no-op."""
        return None

    @abstractmethod
    def public_state(self) -> dict:
        """The state every client is allowed to see (never leaks secrets)."""

    @abstractmethod
    def act(self, who: str, action: dict, now: float) -> ActionResult:
        """Apply one participant action. Must validate everything."""

    # ------------------------------------------------------------------ results

    def scores(self) -> dict[str, float]:
        return {}

    @abstractmethod
    def ranking(self) -> list[str]:
        """Participant ids best-first."""

    def eligible(self) -> set[str]:
        """Participants who actually achieved the round's objective.

        Rewards are never paid for a round the player did not take part in properly:
        an empty result set is the correct outcome for a round nobody won. Engines with
        an objective wider than "top of the ranking" override this.
        """
        return set(self.participants)

    def entitlements(self) -> list[Entitlement]:
        """Allocate the configured reward slots across the ranking of eligible players."""
        slots = self.config.rewards.slots
        allowed = self.eligible()
        order = [p for p in self.ranking() if p in allowed]
        out: list[Entitlement] = []
        if self.config.rewards.kind == "funded-assets":
            for slot in slots:
                idx = slot.rank - 1
                if idx < len(order):
                    out.append(
                        Entitlement(
                            slot_id=slot.rank,
                            winner=order[idx],
                            asset_kind=slot.asset_kind,
                            asset_contract=slot.asset_contract,
                            token_id=slot.token_id,
                            amount=slot.amount,
                        )
                    )
        else:
            for slot in slots:
                idx = slot.rank - 1
                if idx < len(order):
                    out.append(Entitlement(slot_id=slot.rank, winner=order[idx], points=slot.points))
        return out

    # ------------------------------------------------------------------ persistence

    @abstractmethod
    def snapshot(self) -> dict:
        """Serialisable state. Must round-trip exactly through `restore`."""

    @classmethod
    def restore(cls, config: RoomConfig, round_id: str, seed: str, snapshot: dict) -> "Engine":
        engine = cls(config, round_id, seed, snapshot.get("participants", []))
        engine._load(snapshot)
        return engine

    @abstractmethod
    def _load(self, snapshot: dict) -> None:
        """Rehydrate from `snapshot`."""

    # ------------------------------------------------------------------ helpers

    def _require_participant(self, who: str) -> None:
        if who not in self.participants:
            raise KeyError("not a participant of this round")

    def transcript_hash(self, actions: list[dict]) -> str:
        """Hash of the ordered accepted action log, for the fairness receipt."""
        h = hashlib.sha256(b"orbix-center/transcript/v1|" + self.round_id.encode())
        for a in actions:
            h.update(b"|" + repr(sorted(a.items())).encode())
        return h.hexdigest()
