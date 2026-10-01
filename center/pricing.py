"""Admin pricing authority and the immutable per-room fee snapshot.

Design (delivery ledger gates B04, B09, B10, B11):

  * One exact wallet is the pricing authority: ``ADMIN_ADDRESS``. Ownership is an exact
    full-address comparison, never a suffix or prefix match.
  * The schedule is a *server-side default* (creator charge, joiner charge) bounded by
    hard caps. It can only be changed by an authenticated admin presenting a fresh,
    single-use signed proof.
  * Publishing snapshots the effective schedule onto the room. A later admin change can
    therefore never reprice a room that already exists.

Nothing here enables a funded path or moves money: the schedule is a governance value
that preview rooms record for readback and that funded room creation will consult once
the custody gates pass.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: The single exact admin wallet. Full-address equality only.
ADMIN_ADDRESS = "0x253db2d543b10c94918de97eb8499ee59ab9087e"

#: Hard caps on the two charges, in integer base units. A schedule value above its cap
#: is rejected outright, so a compromised or mistaken admin session cannot set an
#: unbounded charge.
CREATOR_FEE_CAP = 1_000_000
JOINER_FEE_CAP = 100_000

#: The schedule used until an admin sets one. Both charges default to zero (preview).
DEFAULT_PRICING: dict[str, int] = {"creatorFee": 0, "joinerFee": 0}

SETTING_KEY = "pricing"


class FeeSchedule(BaseModel):
    """Creator + joiner charge, both integer base units, both capped."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    creator_fee: int = Field(default=0, ge=0, alias="creatorFee")
    joiner_fee: int = Field(default=0, ge=0, alias="joinerFee")

    @model_validator(mode="after")
    def _within_caps(self) -> "FeeSchedule":
        if self.creator_fee > CREATOR_FEE_CAP:
            raise ValueError(f"creatorFee exceeds cap {CREATOR_FEE_CAP}")
        if self.joiner_fee > JOINER_FEE_CAP:
            raise ValueError(f"joinerFee exceeds cap {JOINER_FEE_CAP}")
        return self

    def as_dict(self) -> dict[str, int]:
        return {"creatorFee": self.creator_fee, "joinerFee": self.joiner_fee}

    @classmethod
    def from_dict(cls, raw: dict | None) -> "FeeSchedule":
        data = raw or {}
        return cls(creator_fee=int(data.get("creatorFee", 0)), joiner_fee=int(data.get("joinerFee", 0)))


def caps() -> dict[str, int]:
    return {"creatorFee": CREATOR_FEE_CAP, "joinerFee": JOINER_FEE_CAP}
