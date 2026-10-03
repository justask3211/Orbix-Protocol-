"""Player profiles: display name, bio, avatar (color index), address privacy.

Profiles are stored in SQLite via the Store. Each wallet address gets one
profile. The privacy toggle controls whether the wallet address is shown
alongside the display name in game logs and player lists.
"""

from __future__ import annotations


class ProfileError(Exception):
    pass


def validate_name(name: str) -> str:
    name = name.strip()
    if not name or len(name) < 2 or len(name) > 24:
        raise ProfileError("name must be 2–24 characters")
    return name


def validate_bio(bio: str) -> str:
    bio = bio.strip()
    if len(bio) > 200:
        raise ProfileError("bio must be ≤200 characters")
    return bio
