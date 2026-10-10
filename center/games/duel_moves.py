"""Frozen classic/extended dominance matrix."""
CLASSIC = ["rock", "paper", "scissors"]
EXTENDED = ["rock", "paper", "scissors", "lizard", "spock"]

BEATS = {
    "rock": {"scissors", "lizard"},
    "paper": {"rock", "spock"},
    "scissors": {"paper", "lizard"},
    "lizard": {"spock", "paper"},
    "spock": {"scissors", "rock"},
}
