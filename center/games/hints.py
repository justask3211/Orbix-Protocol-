"""Typed, versioned per-template hint policy (plan items D3/D4-D22).

A HintPolicy declares what a template MAY reveal, to whom, at what budget/cost.
It is data, never behavior: the engine still computes every hint server-side from
committed secret state. Clients can request a hint; they can never author one.

Rules enforced by construction:
  * kind OFF means the engine must reject hint requests outright.
  * PUBLIC audience items ride the room patch/feed; PRIVATE items ride the
    per-player `private` payload only.
  * budget is a hard per-player cap the engine decrements; exhausted = rejected.
  * a policy never encodes an answer: every reveal kind here is provably
    non-leaking for its game (documented per template).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class HintKind:
    """One reveal operation a template supports."""

    id: str                 # e.g. "higher-lower"
    audience: str           # "public" | "private"
    description: str        # shown in the wizard; must state exactly what is revealed
    budget: int | None = None   # None = unlimited (still rate-limited by the engine)
    cost: int = 0               # optional point cost per use


@dataclass(frozen=True)
class HintPolicy:
    """Versioned hint policy for one template. `version` bumps on any semantic change
    so a published room's config hash freezes the exact policy it was authored with."""

    template_id: str
    version: int
    kinds: tuple[HintKind, ...] = field(default_factory=tuple)
    implemented: bool = True    # False = UI must show "no hint feed yet" (honest state)

    def kind(self, kind_id: str) -> HintKind | None:
        for k in self.kind_list():
            if k.id == kind_id:
                return k
        return None

    def kind_list(self) -> list[HintKind]:
        return list(self.kinds)


# --------------------------------------------------------------------------
# Release-one templates with implemented, non-leaking hints.
# --------------------------------------------------------------------------

NUMBER_HUNT = HintPolicy(
    template_id="number-hunt",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="higher-lower",
            audience="public",   # or private: the creator chooses visibility
            description=(
                "After a miss, the server says whether the nearest remaining target is "
                "higher or lower than the guess. Never reveals the target or its distance."
            ),
        ),
    ),
)

HASH_HUNT = HintPolicy(
    template_id="hash-hunt",
    version=1,
    implemented=True,
    kinds=(
        HintKind(
            id="difficulty-throughput",
            audience="public",
            description=(
                "Shows the public difficulty (leading zero bits) and each miner's own "
                "verified attempt rate. Never shows a solution nonce or another "
                "player's partial preimage."
            ),
        ),
    ),
)

LOGO_BINGO_LIVE = HintPolicy(
    template_id="logo-bingo",
    version=1,
    implemented=True,
    kinds=(
        HintKind(
            id="call-history",
            audience="public",
            description=(
                "The full shared call history is public state; the hint feed replays it "
                "with board accessibility labels. No future calls are ever exposed."
            ),
        ),
    ),
)

BOSS_RAID = HintPolicy(
    template_id="boss-raid",
    version=1,
    implemented=True,
    kinds=(
        HintKind(
            id="phase-weakness",
            audience="public",
            description=(
                "Broadcasts the boss phase and its current vulnerability window plus "
                "aggregate contribution. Hidden per-player state is never shown."
            ),
        ),
    ),
)

BINGO = HintPolicy(
    template_id="grid-bingo",
    version=1,
    implemented=True,
    kinds=(
        HintKind(
            id="call-history",
            audience="public",
            description=(
                "The full shared call history is public state; the hint feed replays it "
                "with board accessibility labels. No future calls are ever exposed."
            ),
        ),
    ),
)

RPS_DUEL = HintPolicy(
    template_id="rps-duel",
    version=1,
    implemented=True,
    kinds=(
        HintKind(
            id="commit-phase",
            audience="public",
            description=(
                "Only commit/reveal phase progress is shared. An opponent's move stays "
                "hashed until the reveal phase the engine opens."
            ),
        ),
    ),
)

REACTION_DUEL = HintPolicy(
    template_id="reaction-duel",
    version=1,
    implemented=True,
    kinds=(
        HintKind(
            id="round-progress",
            audience="public",
            description=(
                "Shared round counter, phase (commit/reveal), and per-player commit/reveal "
                "status. An opponent's choice stays committed (hashed) until the engine "
                "opens the reveal phase, so progress is all the feed ever shows."
            ),
        ),
    ),
)

TOKEN_CATCH = HintPolicy(
    template_id="token-catch",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="lane-tempo",
            audience="public",
            description=(
                "Live window of ALREADY-FALLEN spawns only (last 300ms), so players "
                "can verify what they just saw. Future spawn lanes, timings and "
                "hazards are never exposed — a bot cannot pre-position."
            ),
        ),
    ),
)

MEMORY_MATCH = HintPolicy(
    template_id="memory-match",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="bounded-reveal",
            audience="private",
            budget=2,
            description=(
                "Reveals ONE hidden matching pair face-up, to the asking player only. "
                "Never maps the whole board, so the hint cannot replace play. Creator "
                "sets the per-player budget (1-5 uses)."
            ),
            cost=0,
        ),
    ),
)

PUZZLE_SPRINT = HintPolicy(
    template_id="puzzle-sprint",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="legal-move",
            audience="private",
            budget=3,
            description=(
                "Suggests ONE legal next move (the tile adjacent to the blank right "
                "now), never the full solution path. Each use costs a small move "
                "penalty toward the score, and the creator caps uses per player."
            ),
        ),
    ),
)

# --------------------------------------------------------------------------
# Later-catalog templates: policy declared, feed NOT implemented yet.
# The wizard shows the intended style and clearly says the feed is inactive.
# --------------------------------------------------------------------------

_LATER = (
    ("live-quiz", "Category and elimination cues only; answers stay server-side."),
    ("quiz", "Category and elimination cues only; answers stay server-side."),
    ("reward-grid", "Capped proximity clue, budget-limited per player."),
    ("pattern-recall", "Bounded replay of an already-shown segment only."),
    ("typing-sprint", "Personal pace/accuracy cue; never other players' text."),
    ("maze-race", "Directional clue budget; never the full route."),
    ("level-runner", "Checkpoint telemetry only; no future hazard data."),
    ("contract-detective", "One curated evidence hint per question, not an audit verdict."),
    ("mev-rush", "Simulated queue position only; no live mempool claim."),
    ("idle-rig", "Server-clock efficiency readout; no hidden earning implication."),
    ("airdrop-quest", "Wallet-bound remaining requirements only."),
)

LATER_POLICIES: dict[str, HintPolicy] = {
    tid: HintPolicy(template_id=tid, version=1, implemented=False,
                    kinds=(HintKind(id="planned", audience="private", description=desc),))
    for tid, desc in _LATER
}
LATER_POLICIES.pop("live-quiz", None)
LATER_POLICIES.pop("token-catch", None)
LATER_POLICIES.pop("reward-grid", None)
LATER_POLICIES.pop("pattern-recall", None)
LATER_POLICIES.pop("maze-race", None)
LATER_POLICIES.pop("quiz", None)
LATER_POLICIES.pop("catch", None)
LATER_POLICIES.pop("airdrop-quest", None)
LATER_POLICIES.pop("idle-rig", None)
LATER_POLICIES.pop("mev-rush", None)
LATER_POLICIES.pop("contract-detective", None)
LATER_POLICIES.pop("level-runner", None)
LATER_POLICIES.pop("typing-sprint", None)
LATER_POLICIES.pop("logo-bingo", None)
LATER_POLICIES.pop("grid-bingo", None)
LIVE_QUIZ = HintPolicy(
    template_id="live-quiz",
    version=1,
    implemented=True,
    kinds=(
        HintKind(
            id="elimination",
            audience="private",
            budget=None,  # per-question budget comes from hintEliminations in rules
            description=(
                "Strikes out one wrong answer choice for the current question, kept "
                "private to the asking player. The server verifies every eliminated "
                "choice is wrong, so the cue narrows the set without ever pointing at "
                "the answer. Budget per question is the creator's hint_eliminations cap."
            ),
        ),
    ),
)


#: All policies, by template id. Room publish hashes MUST include the policy
#: object for the chosen template (config-hash domain covers it via rules + this
#: registry lookup at publish time).
PATTERN_RECALL = HintPolicy(
    template_id="pattern-recall",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="bounded-replay",
            audience="private",
            budget=2,
            description=(
                "Replays the sequence segment ALREADY shown this step, to the asking "
                "player only. Never touches the future part of the sequence; two "
                "replays per round so the hint cannot replace memory."
            ),
        ),
    ),
)

TYPING_SPRINT = HintPolicy(
    template_id="typing-sprint",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="pace-cue",
            audience="private",
            budget=5,
            description=(
                "Reports the asker's own recent typing rhythm (median inter-key time "
                "and a pace flag) from server-verified keystrokes. Never another "
                "player's text, timing, or progress."
            ),
        ),
    ),
)

LEVEL_RUNNER = HintPolicy(
    template_id="level-runner",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="checkpoint-telemetry",
            audience="private",
            budget=3,
            description=(
                "Reports the asker's own distance, lane, and crash state from the "
                "server-authoritative run. The upcoming obstacle stream stays "
                "secret until each reveal; never another player's run."
            ),
        ),
    ),
)

CONTRACT_DETECTIVE = HintPolicy(
    template_id="contract-detective",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="evidence-clue",
            audience="private",
            budget=1,
            description=(
                "One curated evidence cue per round (which line of the snippet to "
                "focus on) taken from static per-question metadata. It cannot "
                "encode which choice is correct and is not a security-audit verdict."
            ),
        ),
    ),
)

MEV_RUSH = HintPolicy(
    template_id="mev-rush",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="queue-position",
            audience="private",
            budget=3,
            description=(
                "Simulated queue position and the asker's own capture count only, "
                "explicitly labeled simulated. No live mempool claim, no future "
                "opportunity kinds, no other players' captures."
            ),
        ),
    ),
)

IDLE_RIG = HintPolicy(
    template_id="idle-rig",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="efficiency-readout",
            audience="private",
            budget=None,
            description=(
                "Server-clock-verified accrual rate, next-upgrade cost, and the "
                "asker's own earned total. Never implies off-chain earning; never "
                "another player's rig."
            ),
        ),
    ),
)

AIRDROP_QUEST = HintPolicy(
    template_id="airdrop-quest",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="remaining-requirements",
            audience="private",
            budget=None,
            description=(
                "Lists which quests THIS wallet has not completed and the completed "
                "set. Never issues an entitlement and never shows other players' "
                "progress."
            ),
        ),
    ),
)

MAZE_RACE = HintPolicy(
    template_id="maze-race",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="directional-clue",
            audience="private",
            budget=3,
            description=(
                "One coarse direction (from the asker's own cell) that reduces "
                "distance to the exit, or 'no-improving-move'. The maze layout is "
                "public; the hint only saves pathfinding effort, three uses max, "
                "and never prints the full route."
            ),
        ),
    ),
)

REWARD_GRID = HintPolicy(
    template_id="reward-grid",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="proximity",
            audience="private",
            budget=2,
            description=(
                "Answers only a coarse distance band (near / mid / far) to the nearest "
                "hidden reward tile. Never names a tile, a direction, or a row/column, "
                "so a hint cannot identify a reward slot. Two uses per player, logged "
                "in the fairness transcript."
            ),
        ),
    ),
)

LOGO_BINGO = HintPolicy(
    template_id="logo-bingo",
    version=2,
    implemented=True,
    kinds=(
        HintKind(
            id="call-history",
            audience="public",
            description=(
                "The full shared call history is public state and only grows; future "
                "calls stay server-side until drawn. Board claims are verified against "
                "the calls actually issued."
            ),
        ),
    ),
)

HINT_POLICIES: dict[str, HintPolicy] = {
    p.template_id: p
    for p in (
        NUMBER_HUNT, HASH_HUNT, BOSS_RAID, BINGO, LOGO_BINGO_LIVE, RPS_DUEL,
        REACTION_DUEL, MEMORY_MATCH, PUZZLE_SPRINT, LIVE_QUIZ, TOKEN_CATCH, REWARD_GRID, LOGO_BINGO, PATTERN_RECALL, TYPING_SPRINT, MAZE_RACE, LEVEL_RUNNER, CONTRACT_DETECTIVE, MEV_RUSH, IDLE_RIG, AIRDROP_QUEST, *LATER_POLICIES.values(),
    )
}


def policy_for(template_id: str) -> HintPolicy:
    """Fallback: an unimplemented, empty policy. Never raise for unknown ids so the
    catalog can grow before its policy lands."""
    return HINT_POLICIES.get(
        template_id,
        HintPolicy(template_id=template_id, version=1, implemented=False),
    )
