"""Presentation privacy; never rewrite signed settlement receipts or contract payloads."""
from __future__ import annotations

import hashlib
import re


def visible_state(value, settings: dict, viewer: str | None = None, owner: str | None = None):
    if viewer and viewer == owner:
        return value
    if isinstance(value, dict):
        return {visible_state(k, settings, viewer, owner): visible_state(v, settings, viewer, owner)
                for k, v in value.items()
                if not (settings.get("hideGuesses") and k in {"guessLog", "lastGuess"})}
    if isinstance(value, list):
        return [visible_state(v, settings, viewer, owner) for v in value]
    if settings.get("hidePlayers") and isinstance(value, str) and re.fullmatch(r"0x[0-9a-fA-F]{40}", value) and value.lower() != viewer:
        return "player-" + hashlib.sha256(value.lower().encode()).hexdigest()[:8]
    return value
