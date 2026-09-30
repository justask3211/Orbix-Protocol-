"""G15 — Level Runner, G16 — Contract Detective, G18 — MEV Rush, G19 — Idle Rig, G20 — Airdrop Quest.

G15: a deterministic lane-obstacle stream from the seed; movement is replayed
server-side, so a client can never report its own score and there is no farming loop.

G16: a curated educational bank of mock contract snippets (vulnerable/patched) with
explanations shown only after the question closes. Explicitly learning content, not
a security-audit certification.

G18: a *simulated* pending-transaction queue. Opportunities are server-issued from
the committed seed; there is no real-chain frontrunning here, by design.

G19: progression runs on the server clock only, with an inventory cap that can never
be exceeded — no perpetual off-line payout.

G20: achievements verified from accepted actions in other Center templates, one
wallet-bound entitlement per quest, bounded budget, hard stop date.
"""

from __future__ import annotations

from center.games.base import ActionResult, Engine
from center.rules_late import AirdropQuestRules, ContractDetectiveRules, IdleRigRules, LevelRunnerRules, MevRushRules
from center.schema import RoomConfig


class LevelRunnerEngine(Engine):
    template_id = "level-runner"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: LevelRunnerRules = config.rules  # type: ignore[assignment]
        self.obstacles: list[int] = []      # the seeded stream, secret until reveal
        self.lane: dict[str, int] = {}
        self.progress: dict[str, int] = {}  # server-computed distance, not client-reported
        self.crashed: set[str] = set()
        self.finished: bool = False

    def start(self, now: float = 0.0) -> None:
        # obstacles[i] = lane of the obstacle at distance i, 255 marks a gap
        self.obstacles = [self.rng.below(3) if self.rng.below(4) else 255 for _ in range(1000)]
        self.lane = {p: 1 for p in self.participants}
        self.progress = {p: 0 for p in self.participants}
        self.crashed = set()
        self.finished = False

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if who in self.crashed:
            return ActionResult(False, "ALREADY_CRASHED")
        kind = action.get("kind")
        if kind == "step":  # one tick of forward motion from the client's frame clock
            move = action.get("lane")
            if move not in (0, 1, 2) or not isinstance(move, int):
                return ActionResult(False, "BAD_ACTION")
            self.lane[who] = move
            i = self.progress[who]
            obstacle = self.obstacles[i]
            if obstacle != 255 and obstacle == move:
                self.crashed.add(who)
                return ActionResult(True, patch={"crashed": True}, scores=self.scores())
            self.progress[who] = i + 1
            if i + 1 >= self.rules.score_cap:
                self.finished = True
            return ActionResult(True, finished=self.finished, scores=self.scores())
        return ActionResult(False, "BAD_ACTION")

    def scores(self) -> dict[str, float]:
        return {p: float(self.progress.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.progress.get(p, 0), p))

    def eligible(self) -> set[str]:
        """Positive distance only: an instant crash earns nothing."""
        return {p for p in self.participants if self.progress.get(p, 0) > 0}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "laneTemplate": self.rules.lane_template,
            "scoreCap": self.rules.score_cap,
            "lane": dict(self.lane),
            "progress": dict(self.progress),
            "crashed": sorted(self.crashed),
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "obstacles": self.obstacles,
            "lane": self.lane,
            "progress": self.progress,
            "crashed": sorted(self.crashed),
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.obstacles = list(snapshot.get("obstacles", []))
        self.lane = dict(snapshot.get("lane", {}))
        self.progress = {k: int(v) for k, v in snapshot.get("progress", {}).items()}
        self.crashed = set(snapshot.get("crashed", []))
        self.finished = bool(snapshot.get("finished", False))


class ContractDetectiveEngine(Engine):
    template_id = "contract-detective"
    version = 1

    #: curated educational bank (vulnerable / patched pairs), with answer + explanation
    BANK: dict[str, list[dict]] = {
        "reentrancy": [
            {
                "snippet": "function withdraw() external { uint amt = balances[msg.sender]; (bool ok,) = msg.sender.call{value: amt}(\"\"); require(ok); balances[msg.sender] = 0; }",
                "question": "What makes this withdrawal unsafe?",
                "choices": ["State is updated after the external call", "msg.sender is untrusted", "require() can fail", "Nothing, it is safe"],
                "answer": 0,
                "explanation": "The balance is zeroed after the call, so a reentrant callee can withdraw again.",
            },
            {
                "snippet": "function withdraw() external { uint amt = balances[msg.sender]; balances[msg.sender] = 0; (bool ok,) = msg.sender.call{value: amt}(\"\"); require(ok); }",
                "question": "Why is this version safer?",
                "choices": ["It uses more gas", "State is zeroed before the external call", "It has no require", "It is not safer"],
                "answer": 1,
                "explanation": "Checks-effects-interactions: the effect lands before control leaves the contract.",
            },
        ],
        "overflow": [
            {
                "snippet": "function add(uint256 a, uint256 b) external pure returns (uint256) { unchecked { return a + b; } }",
                "question": "What is the risk here (Solidity <0.8 semantics)?",
                "choices": ["None", "Integer overflow wraps silently", "a and b are untrusted", "unchecked costs more gas"],
                "answer": 1,
                "explanation": "Inside unchecked, an overflow wraps instead of reverting.",
            },
        ],
        "access": [
            {
                "snippet": "function setOwner(address o) external { owner = o; }",
                "question": "What is missing?",
                "choices": ["An event", "An onlyOwner check", "A payable modifier", "Nothing"],
                "answer": 1,
                "explanation": "Anyone can call it: the function needs an access guard.",
            },
        ],
    }

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: ContractDetectiveRules = config.rules  # type: ignore[assignment]
        self.picks: list[dict] = []
        self.answers: dict[str, dict[int, int]] = {}
        self.correct: dict[str, int] = {}
        self.finished: bool = False

    def start(self, now: float = 0.0) -> None:
        pool: list[dict] = []
        cats = self.rules.categories or list(self.BANK)
        for c in cats:
            pool.extend(self.BANK.get(c, []))
        self.picks = self.rng.shuffled(pool)[:10]
        self.answers = {p: {} for p in self.participants}
        self.correct = {p: 0 for p in self.participants}
        self.finished = False

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "answer":
            return ActionResult(False, "BAD_ACTION")
        q, a = action.get("question"), action.get("choice")
        if not isinstance(q, int) or not (0 <= q < len(self.picks)) or not isinstance(a, int):
            return ActionResult(False, "BAD_ACTION")
        if q in self.answers[who]:
            return ActionResult(False, "ACTION_DUPLICATE")
        self.answers[who][q] = a
        if a == self.picks[q]["answer"]:
            self.correct[who] += 1
        if all(len(v) >= len(self.picks) for v in self.answers.values()):
            self.finished = True
        return ActionResult(True, finished=self.finished, scores=self.scores())

    def scores(self) -> dict[str, float]:
        return {p: float(self.correct.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.correct.get(p, 0), p))

    def eligible(self) -> set[str]:
        return {p for p in self.participants if self.correct.get(p, 0) > 0}

    def public_state(self) -> dict:
        """Never includes `answer`; the explanation is only revealed after the round."""
        return {
            "template": self.template_id,
            "questions": [
                {"snippet": q["snippet"], "question": q["question"], "choices": q["choices"]} for q in self.picks
            ],
            "answeredCount": {p: len(v) for p, v in self.answers.items()},
            "finished": self.finished,
        }

    def results_explained(self) -> list[dict]:
        """For the results screen only, after settlement."""
        return [{"snippet": q["snippet"], "explanation": q["explanation"], "answer": q["answer"]} for q in self.picks]

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "picks": self.picks,
            "answers": {k: {str(a): b for a, b in v.items()} for k, v in self.answers.items()},
            "correct": self.correct,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.picks = list(snapshot.get("picks", []))
        self.answers = {k: {int(a): b for a, b in v.items()} for k, v in snapshot.get("answers", {}).items()}
        self.correct = {k: int(v) for k, v in snapshot.get("correct", {}).items()}
        self.finished = bool(snapshot.get("finished", False))


class MevRushEngine(Engine):
    template_id = "mev-rush"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: MevRushRules = config.rules  # type: ignore[assignment]
        self.opportunities: list[dict] = []
        self.captured: dict[str, set[int]] = {}
        self.score: dict[str, int] = {}
        self._cursor: int = 0
        self._next_at: float = 0.0
        self.finished: bool = False

    def start(self, now: float = 0.0) -> None:
        # a simulated pending queue: each opportunity is live for a short window
        n = self.rules.duration_seconds // self.rules.opportunity_cadence_seconds
        self.opportunities = [
            {"slot": i, "kind": self.rng.choice(["backrun", "arb", "liquidation"]), "expiresAt": 0.0}
            for i in range(n)
        ]
        self.captured = {p: set() for p in self.participants}
        self.score = {p: 0 for p in self.participants}
        self._cursor = 0
        self._next_at = now
        self.finished = False

    def tick(self, now: float) -> ActionResult | None:
        if self.finished:
            return None
        if now >= self._next_at:
            if self._cursor < len(self.opportunities):
                self.opportunities[self._cursor]["liveAt"] = now
                self.opportunities[self._cursor]["expiresAt"] = now + self.rules.opportunity_cadence_seconds
                self._cursor += 1
                self._next_at = now + self.rules.opportunity_cadence_seconds
                # patch key must not collide with public_state()["live"] (an array of slot
                # indexes): an int here overwrites the array client-side and crashes the stage.
                return ActionResult(True, patch={"liveCount": self._cursor})
            self.finished = True
            return ActionResult(True, finished=True, scores=self.scores())
        return None

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "capture":
            return ActionResult(False, "BAD_ACTION")
        slot = action.get("slot")
        if not isinstance(slot, int) or not (0 <= slot < len(self.opportunities)):
            return ActionResult(False, "BAD_ACTION")
        if slot in self.captured[who]:
            return ActionResult(False, "ACTION_DUPLICATE")   # double-inclusion refused
        opp = self.opportunities[slot]
        if "liveAt" not in opp or not (opp["liveAt"] <= now <= opp["expiresAt"]):
            return ActionResult(False, "STALE_OPPORTUNITY")
        self.captured[who].add(slot)
        self.score[who] += 1
        return ActionResult(True, scores=self.scores())

    def scores(self) -> dict[str, float]:
        return {p: float(self.score.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.score.get(p, 0), p))

    def eligible(self) -> set[str]:
        return {p for p in self.participants if self.score.get(p, 0) > 0}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "live": [i for i, o in enumerate(self.opportunities) if o.get("expiresAt")],
            "captured": {p: sorted(v) for p, v in self.captured.items()},
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "opportunities": self.opportunities,
            "captured": {k: sorted(v) for k, v in self.captured.items()},
            "score": self.score,
            "cursor": self._cursor,
            "nextAt": self._next_at,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.opportunities = list(snapshot.get("opportunities", []))
        self.captured = {k: set(v) for k, v in snapshot.get("captured", {}).items()}
        self.score = {k: int(v) for k, v in snapshot.get("score", {}).items()}
        self._cursor = int(snapshot.get("cursor", 0))
        self._next_at = float(snapshot.get("nextAt", 0.0))
        self.finished = bool(snapshot.get("finished", False))


class IdleRigEngine(Engine):
    template_id = "idle-rig"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: IdleRigRules = config.rules  # type: ignore[assignment]
        self.level: dict[str, int] = {}
        self.earned: dict[str, int] = {}
        self._last_tick: float = 0.0
        self._inventory_left: int = 0
        self.finished: bool = False

    def start(self, now: float = 0.0) -> None:
        self.level = {p: 1 for p in self.participants}
        self.earned = {p: 0 for p in self.participants}
        self._last_tick = now
        self._inventory_left = self.rules.inventory_cap
        self.finished = False

    def _rate(self, level: int) -> int:
        return 2 ** (level - 1)  # ordered upgrade tiers, exponential but capped by session

    def tick(self, now: float) -> ActionResult | None:
        if self.finished:
            return None
        elapsed = min(now - self._last_tick, self.rules.session_seconds)
        if elapsed <= 0:
            return None
        self._last_tick = now
        total = 0
        for p in self.participants:
            gain = int(elapsed) * self._rate(self.level[p])
            total += gain
            self.earned[p] = self.earned.get(p, 0) + gain
        # the campaign inventory can never be exceeded — accrual is cut at the cap
        if total >= self._inventory_left:
            scale = self._inventory_left / total
            for p in self.earned:
                self.earned[p] = int(self.earned[p] * scale)
            self._inventory_left = 0
            self.finished = True
        else:
            self._inventory_left -= total
        if now >= self.rules.session_seconds:
            self.finished = True
        return ActionResult(True, finished=self.finished, scores=self.scores())

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "upgrade":
            return ActionResult(False, "BAD_ACTION")
        if self.level[who] >= self.rules.upgrade_tiers:
            return ActionResult(False, "MAX_TIER")
        cost = 10 * self._rate(self.level[who])
        if self.earned.get(who, 0) < cost:
            return ActionResult(False, "NOT_ENOUGH")
        self.earned[who] -= cost
        self.level[who] += 1
        return ActionResult(True, scores=self.scores())

    def scores(self) -> dict[str, float]:
        return {p: float(self.earned.get(p, 0)) for p in self.participants}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.earned.get(p, 0), p))

    def eligible(self) -> set[str]:
        return {p for p in self.participants if self.earned.get(p, 0) > 0}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "levels": dict(self.level),
            "earned": dict(self.earned),
            "inventoryLeft": self._inventory_left,
            "sessionSeconds": self.rules.session_seconds,
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "level": self.level,
            "earned": self.earned,
            "inventoryLeft": self._inventory_left,
            "lastTick": self._last_tick,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.level = {k: int(v) for k, v in snapshot.get("level", {}).items()}
        self.earned = {k: int(v) for k, v in snapshot.get("earned", {}).items()}
        self._inventory_left = int(snapshot.get("inventoryLeft", self.rules.inventory_cap))
        self._last_tick = float(snapshot.get("lastTick", 0.0))
        self.finished = bool(snapshot.get("finished", False))


class AirdropQuestEngine(Engine):
    """Achievements are verified from accepted actions in *this* room only; the
    campaign ledger (budget, stop date) is enforced by the room runtime before an
    entitlement is written."""

    template_id = "airdrop-quest"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: AirdropQuestRules = config.rules  # type: ignore[assignment]
        self.achieved: dict[str, set[str]] = {}
        self.finished: bool = False

    def start(self, now: float = 0.0) -> None:
        self.achieved = {p: set() for p in self.participants}
        self.finished = False

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if action.get("kind") != "complete":
            return ActionResult(False, "BAD_ACTION")
        achievement = str(action.get("achievement", ""))
        if achievement not in self.rules.achievements:
            return ActionResult(False, "UNKNOWN_ACHIEVEMENT")  # a fake completion is refused outright
        if achievement in self.achieved[who]:
            return ActionResult(False, "ACTION_DUPLICATE")     # one entitlement per quest, ever
        self.achieved[who].add(achievement)
        return ActionResult(True, scores=self.scores())

    def scores(self) -> dict[str, float]:
        return {p: float(len(v)) for p, v in self.achieved.items()}

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-len(self.achieved.get(p, set())), p))

    def eligible(self) -> set[str]:
        return {p for p in self.participants if self.achieved.get(p)}

    def public_state(self) -> dict:
        return {
            "template": self.template_id,
            "campaign": self.rules.campaign_name,
            "achievements": list(self.rules.achievements),
            "achieved": {p: sorted(v) for p, v in self.achieved.items()},
            "finished": self.finished,
        }

    def snapshot(self) -> dict:
        return {"participants": self.participants, "achieved": {k: sorted(v) for k, v in self.achieved.items()},
                "finished": self.finished}

    def _load(self, snapshot: dict) -> None:
        self.achieved = {k: set(v) for k, v in snapshot.get("achieved", {}).items()}
        self.finished = bool(snapshot.get("finished", False))
