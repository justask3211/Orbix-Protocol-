"""Trusted-server RPS sealing, immutable v2 contract (SHA-256, canonical JSON).

The authority sees preimages. This does not protect against a malicious authority.
"""
import hashlib
import json
import re
from center.games.base import Engine, ActionResult
from center.games.duel_moves import BEATS, CLASSIC, EXTENDED

class SealedDuelEngine(Engine):
    version = 2
    timed_sealed = True

    def __init__(self, config, round_id, seed, participants):
        super().__init__(config, round_id, seed, sorted(p.lower() for p in participants))
        self.rules = config.rules
        self.players = self.participants
        self.round_index = 0
        self.phase = 'commit'
        self.phase_started_at = 0
        self.server_time = 0
        self.sealed = {p: {} for p in self.players}
        self.wins = {p: 0 for p in self.players}
        self.accepted = {p: 0 for p in self.players}
        self.history = []
        self.transitions = []
        self.integrity_error = None

    @property
    def choices(self):
        return CLASSIC if self.rules.choice_set == 'classic' else EXTENDED

    def start(self, now=0):
        if len(self.players) != 2 or len(set(self.players)) != 2:
            raise ValueError('EXACTLY_TWO_PLAYERS_REQUIRED')
        self.phase_started_at = self.server_time = now

    def phase_deadline(self):
        return self.phase_started_at + (self.rules.choice_window_seconds if self.phase == 'commit' else self.rules.reveal_window_seconds)

    def digest(self, who, index, choice, salt):
        bound = ['orbix-center/sealed-duel/v2', self.template_id, self.round_id, index, who.lower(), choice, salt]
        return hashlib.sha256(json.dumps(bound, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()

    def _resolve(self, deadline):
        choices = []
        for p in self.players:
            record = self.sealed[p].get(str(self.round_index))
            if record and record['digest'] != self.digest(p, self.round_index, record['choice'], record['salt']):
                self.integrity_error = 'SEALED_PREIMAGE_MISMATCH'
                self.finished = True
                self.phase = 'done'
                return
            choices.append(record['choice'] if record else None)
        a, b = choices
        winner = None
        if a is None and b is None: reason = 'double-no-choice'
        elif a is None or b is None:
            winner = self.players[0 if a is not None else 1]
            reason = 'no-choice-forfeit'
        elif a == b: reason = 'draw'
        else:
            winner = self.players[0 if b in BEATS[a] else 1]
            reason = 'dominance'
        if winner: self.wins[winner] += 1
        self.history.append(dict(round=self.round_index, a=a, b=b, winner=winner, reason=reason,
                                 outcome=f'{winner or "tie"}:{a}:{b}', resolvedAt=deadline))
        self.phase = 'reveal'
        self.phase_started_at = deadline

    def tick(self, now):
        self.server_time = now
        changed = False
        for _ in range(2 * self.rules.rounds):
            if self.finished or now < self.phase_deadline(): break
            deadline = self.phase_deadline()
            index, phase = self.round_index, self.phase
            if phase == 'commit': self._resolve(deadline)
            else:
                if max(self.wins.values(), default=0) >= self.rules.rounds // 2 + 1 or self.round_index + 1 >= self.rules.rounds:
                    self.finished, self.phase = True, 'done'
                else:
                    self.round_index += 1
                    self.phase = 'commit'
                self.phase_started_at = deadline
            self.transitions.append(dict(roundId=self.round_id, index=index, phase=phase, at=deadline))
            changed = True
        return ActionResult(True, patch=self.public_state(), finished=self.finished, scores=self.scores()) if changed else None

    def _receipt(self, who):
        record = self.sealed.get(who, {}).get(str(self.round_index))
        return dict(choice=record['choice'], subroundIndex=self.round_index, locked=True, receiptId=record['digest']) if record else None

    def private_state(self, who):
        return {'ownSelection': self._receipt(who)} if who in self.players else {}

    def act(self, who, action, now):
        # Runtime checkpoints clock updates even when the input is rejected.
        self.tick(now)
        if who not in self.players: return ActionResult(False, 'NOT_ADMITTED')
        if action.get('kind') == 'reveal': return ActionResult(False, 'UNSUPPORTED_ACTION')
        if self.integrity_error: return ActionResult(False, self.integrity_error)
        if self.finished: return ActionResult(False, 'ROUND_FINISHED')
        if action.get('roundId') != self.round_id or type(action.get('subroundIndex')) is not int or action['subroundIndex'] != self.round_index:
            return ActionResult(False, 'STALE_PHASE')
        if self.phase != 'commit' or now < self.phase_started_at: return ActionResult(False, 'ROUND_NOT_OPEN')
        if action.get('kind') == 'hint':
            kind = 'round-progress' if self.template_id == 'reaction-duel' else 'commit-phase'
            if action.get('hintKind') != kind or set(action) - {'kind','hintKind','roundId','subroundIndex','actionId'}:
                return ActionResult(False, 'BAD_ACTION')
            return ActionResult(True, patch=self.public_state())
        if action.get('kind') != 'commit' or set(action) - {'kind','roundId','subroundIndex','choice','salt','actionId'}:
            return ActionResult(False, 'BAD_ACTION')
        choice, salt = action.get('choice'), action.get('salt')
        if not isinstance(choice, str) or choice not in self.choices or not isinstance(salt, str) or not re.fullmatch(r'[0-9a-fA-F]{32}(?:[0-9a-fA-F]{2}){0,16}', salt):
            return ActionResult(False, 'BAD_ACTION')
        existing = self.sealed[who].get(str(self.round_index))
        if existing:
            if existing['choice'] != choice or existing['salt'] != salt: return ActionResult(False, 'CHOICE_LOCKED')
        else:
            self.sealed[who][str(self.round_index)] = dict(choice=choice, salt=salt, digest=self.digest(who, self.round_index, choice, salt))
            self.accepted[who] += 1
        return ActionResult(True, patch=self.public_state(), private=self.private_state(who))

    def scores(self): return dict(self.wins)
    def ranking(self): return sorted(self.players, key=lambda p: (-self.wins[p], p))
    def eligible(self):
        high = max(self.wins.values(), default=0)
        leaders = [p for p in self.players if self.wins[p] == high and self.accepted[p] > 0]
        return set(leaders) if not self.integrity_error and high > 0 and len(leaders) == 1 else set()
    def public_state(self):
        committed = {p: str(self.round_index) in self.sealed[p] for p in self.players}
        revealed = {p: self.phase != 'commit' and committed[p] for p in self.players}
        return dict(template=self.template_id, version=2, roundId=self.round_id, rounds=self.rules.rounds,
                    roundIndex=self.round_index, phase=self.phase, phaseStartedAt=self.phase_started_at,
                    phaseDeadline=self.phase_deadline(), serverTime=self.server_time, committed=committed,
                    revealed=revealed, commitsIn=committed, revealsIn=revealed, choiceSet=self.rules.choice_set,
                    moves=self.choices, players=self.players, wins=dict(self.wins), history=list(self.history), finished=self.finished,
                    recoveryReason=self.integrity_error)
    def snapshot(self):
        return dict(version=2, participants=self.players, roundIndex=self.round_index, phase=self.phase,
                    phaseStartedAt=self.phase_started_at, serverTime=self.server_time, sealed=self.sealed,
                    wins=self.wins, accepted=self.accepted, history=self.history, transitions=self.transitions,
                    finished=self.finished, integrityError=self.integrity_error)
    def _load(self, s):
        if s.get('version') != 2 or 'sealed' not in s: raise ValueError('INCOMPATIBLE_DUEL_SNAPSHOT')
        self.round_index, self.phase = s['roundIndex'], s['phase']
        self.phase_started_at, self.server_time = s['phaseStartedAt'], s['serverTime']
        self.sealed, self.wins, self.accepted = s['sealed'], s['wins'], s['accepted']
        self.history, self.transitions = s['history'], s['transitions']
        self.finished, self.integrity_error = s['finished'], s.get('integrityError')
