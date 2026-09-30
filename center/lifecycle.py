"""Room lifecycle state machine (manual section 7).

One module owns the legal transitions so no handler can invent a state, and a terminal
state can never be overwritten because a timer fired later.
"""

from __future__ import annotations

DRAFT = "draft"
PREVIEW_PUBLISHED = "preview-published"
CONFIG_FROZEN = "config-frozen"
FUNDING = "funding"
FUNDED = "funded"
REGISTRATION = "registration"
READY = "ready"
RUNNING = "running"
RESULT_PENDING = "result-pending"
SETTLEMENT_PENDING = "settlement-pending"
CLAIMABLE = "claimable"
CANCELLED = "cancelled"
REFUNDABLE = "refundable"
RECOVERY_REQUIRED = "recovery-required"
CLOSED = "closed"

ALL_STATES = {
    DRAFT, PREVIEW_PUBLISHED, CONFIG_FROZEN, FUNDING, FUNDED, REGISTRATION, READY, RUNNING,
    RESULT_PENDING, SETTLEMENT_PENDING, CLAIMABLE, CANCELLED, REFUNDABLE, RECOVERY_REQUIRED, CLOSED,
}

#: Terminal states can never be left.
TERMINAL = {CLOSED}

TRANSITIONS: dict[str, set[str]] = {
    DRAFT: {PREVIEW_PUBLISHED, CONFIG_FROZEN, CANCELLED},
    PREVIEW_PUBLISHED: {CONFIG_FROZEN, CANCELLED},
    CONFIG_FROZEN: {FUNDING, REGISTRATION, CANCELLED},
    FUNDING: {FUNDED, CANCELLED, FUNDING},
    FUNDED: {REGISTRATION, CANCELLED},
    REGISTRATION: {READY, RUNNING, CANCELLED},
    READY: {RUNNING, CANCELLED, RECOVERY_REQUIRED},
    RUNNING: {RESULT_PENDING, CANCELLED, RECOVERY_REQUIRED, SETTLEMENT_PENDING},
    RECOVERY_REQUIRED: {RUNNING, REFUNDABLE, RESULT_PENDING},
    RESULT_PENDING: {SETTLEMENT_PENDING, RUNNING, REFUNDABLE},
    SETTLEMENT_PENDING: {CLAIMABLE, REFUNDABLE},
    CLAIMABLE: {CLOSED},
    CANCELLED: {REFUNDABLE},
    REFUNDABLE: {CLOSED},
}

#: States in which new players may be admitted.
JOINABLE = {REGISTRATION, READY, PREVIEW_PUBLISHED}
#: States in which gameplay actions are accepted.
PLAYABLE = {RUNNING, READY}


class LifecycleError(Exception):
    pass


def can_transition(current: str, target: str) -> bool:
    if current not in ALL_STATES or target not in ALL_STATES:
        raise LifecycleError(f"unknown state: {current if current not in ALL_STATES else target}")
    if current in TERMINAL:
        return False
    return target in TRANSITIONS.get(current, set())


def transition(current: str, target: str) -> str:
    """Return the new state or raise. Never mutates a terminal state."""
    if current == target:
        return current
    if not can_transition(current, target):
        raise LifecycleError(f"illegal transition {current} -> {target}")
    return target


def is_joinable(state: str) -> bool:
    return state in JOINABLE


def is_playable(state: str) -> bool:
    return state in PLAYABLE


def is_terminal(state: str) -> bool:
    return state in TERMINAL
