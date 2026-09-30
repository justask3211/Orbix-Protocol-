"""Shared strict model base.

Kept in its own module so both `center.schema` and the later-catalog rule modules can
use it without a circular import (`schema` re-exports it for compatibility).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class Strict(BaseModel):
    """Rejects unknown fields: a client cannot smuggle in a setting we never validated."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)
