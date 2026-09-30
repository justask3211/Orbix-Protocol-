"""G02 — Live Quiz.

The answer key lives only on the server. `public_state()` never contains `correct_index`,
and the question/choice display order comes from the committed seed so it is reproducible.
"""

from __future__ import annotations

from center.games.base import ActionResult, Engine
from center.schema import QuizRules, RoomConfig


class QuizEngine(Engine):
    template_id = "live-quiz"
    version = 1

    def __init__(self, config: RoomConfig, round_id: str, seed: str, participants: list[str]) -> None:
        super().__init__(config, round_id, seed, participants)
        self.rules: QuizRules = config.rules  # type: ignore[assignment]
        self.order: list[int] = []          # question indices in play order
        self.choice_order: list[list[int]] = []  # display order per question
        self.answers: dict[str, dict[int, int]] = {}  # who -> {qIndex: choiceIndex}
        self.arrival: dict[str, dict[int, float]] = {}  # who -> {qIndex: serverTimeMs}
        self.q_started_at: float = 0.0
        self.q_index: int = 0
        self.finished: bool = False

    # ------------------------------------------------------------------ lifecycle

    def start(self, now: float = 0.0) -> None:
        n = len(self.rules.questions)
        idx = list(range(n))
        self.order = self.rng.shuffled(idx) if self.rules.shuffle_questions else idx
        self.choice_order = []
        for q in self.rules.questions:
            opts = list(range(len(q.choices)))
            self.choice_order.append(self.rng.shuffled(opts) if self.rules.shuffle_choices else opts)
        for p in self.participants:
            self.answers[p] = {}
            self.arrival[p] = {}
        self.q_started_at = now
        self.q_index = 0

    def _question(self):
        return self.rules.questions[self.order[self.q_index]]

    def tick(self, now: float) -> ActionResult | None:
        """Close the current question once its window elapses; advance or finish."""
        if self.finished:
            return None
        if now - self.q_started_at < self.rules.question_seconds:
            return None
        if self.q_index + 1 >= len(self.order):
            self.finished = True
            return ActionResult(True, patch={"finished": True, "scores": self.scores()}, finished=True)
        self.q_index += 1
        self.q_started_at = now
        return ActionResult(True, patch={"questionIndex": self.q_index, "questionOpenedAt": now})

    # ------------------------------------------------------------------ actions

    def act(self, who: str, action: dict, now: float) -> ActionResult:
        self._require_participant(who)
        if self.finished:
            return ActionResult(False, "ROUND_FINISHED")
        if action.get("kind") != "answer":
            return ActionResult(False, "BAD_ACTION")
        q_index = action.get("questionIndex")
        choice = action.get("choice")
        if not isinstance(q_index, int) or isinstance(q_index, bool):
            return ActionResult(False, "BAD_ACTION")
        if q_index != self.q_index:
            return ActionResult(False, "ROUND_NOT_OPEN" if q_index is None else "STALE_REVISION")
        if not isinstance(choice, int) or isinstance(choice, bool):
            return ActionResult(False, "BAD_ACTION")
        q = self._question()
        if not (0 <= choice < len(q.choices)):
            return ActionResult(False, "BAD_ACTION")
        if q_index in self.answers.get(who, {}):
            return ActionResult(False, "ACTION_DUPLICATE")
        if now - self.q_started_at > self.rules.question_seconds:
            return ActionResult(False, "ROUND_NOT_OPEN")

        self.answers[who][q_index] = choice
        self.arrival[who][q_index] = now
        correct = choice == q.correct_index
        return ActionResult(
            True,
            patch={"answered": len(self.answers[who])},
            private={"accepted": True, "correct": correct},
            scores=self.scores(),
        )

    def eligible(self) -> set[str]:
        """A slot requires at least one correct answer before the deadline."""
        return {p for p in self.participants if self.correct_count(p) > 0}

    # ------------------------------------------------------------------ scoring

    def score_of(self, who: str) -> int:
        total = 0
        for qi, choice in self.answers.get(who, {}).items():
            q = self.rules.questions[self.order[qi]]
            if choice != q.correct_index:
                continue
            total += 100
            if self.rules.scoring == "accuracy+speed" and self.rules.speed_bonus_max:
                elapsed = self.arrival[who][qi] - (self.q_started_at if qi == self.q_index else 0.0)
                window = max(1.0, float(self.rules.question_seconds))
                frac = max(0.0, min(1.0, 1.0 - elapsed / window))
                total += int(round(self.rules.speed_bonus_max * frac))
        return total

    def scores(self) -> dict[str, float]:
        return {p: float(self.score_of(p)) for p in self.participants}

    def correct_count(self, who: str) -> int:
        return sum(
            1
            for qi, choice in self.answers.get(who, {}).items()
            if choice == self.rules.questions[self.order[qi]].correct_index
        )

    def ranking(self) -> list[str]:
        return sorted(self.participants, key=lambda p: (-self.score_of(p), self.correct_count(p) * -1, p))

    def passed(self, who: str) -> bool:
        total = len(self.rules.questions)
        if total == 0:
            return False
        return (self.correct_count(who) / total) * 100 >= self.rules.pass_percentage

    # ------------------------------------------------------------------ state

    def public_state(self) -> dict:
        state: dict = {
            "template": self.template_id,
            "questionCount": len(self.order),
            "questionIndex": self.q_index,
            "questionSeconds": self.rules.question_seconds,
            "scoring": self.rules.scoring,
            "leaderboard": [{"who": p, "score": self.score_of(p)} for p in self.ranking()],
            "finished": self.finished,
        }
        if not self.finished and self.order:
            q = self._question()
            order = self.choice_order[self.order[self.q_index]]
            state["question"] = {
                "prompt": q.prompt,
                "choices": [q.choices[i] for i in order],
                "openedAt": self.q_started_at,
            }
        if self.finished:
            # explanation reveal, after the round closes
            state["review"] = [
                {"prompt": q.prompt, "correctIndex": q.correct_index, "explanation": q.explanation}
                for q in self.rules.questions
            ]
        return state

    def snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "order": self.order,
            "choiceOrder": self.choice_order,
            "answers": {k: {str(a): b for a, b in v.items()} for k, v in self.answers.items()},
            "arrival": {k: {str(a): b for a, b in v.items()} for k, v in self.arrival.items()},
            "qStartedAt": self.q_started_at,
            "qIndex": self.q_index,
            "finished": self.finished,
        }

    def _load(self, snapshot: dict) -> None:
        self.order = list(snapshot.get("order", []))
        self.choice_order = [list(x) for x in snapshot.get("choiceOrder", [])]
        self.answers = {k: {int(a): b for a, b in v.items()} for k, v in snapshot.get("answers", {}).items()}
        self.arrival = {k: {int(a): b for a, b in v.items()} for k, v in snapshot.get("arrival", {}).items()}
        self.q_started_at = float(snapshot.get("qStartedAt", 0.0))
        self.q_index = int(snapshot.get("qIndex", 0))
        self.finished = bool(snapshot.get("finished", False))
