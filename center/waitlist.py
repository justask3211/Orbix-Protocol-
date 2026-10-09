"""Private, explicit form collection; eligibility comes from authoritative results."""
from __future__ import annotations

import csv
import io
import json
import re
import time

from center.community import CommunityError
from center.store import Store


class WaitlistService:
    def __init__(self, store: Store, chain_id: int, clock=time.time):
        self.store, self.chain_id, self.clock = store, chain_id, clock
        with store.tx() as cx:
            cx.execute('''CREATE TABLE IF NOT EXISTS room_waitlist (
                room_id TEXT NOT NULL, player TEXT NOT NULL, wallet TEXT NOT NULL,
                created_at REAL NOT NULL, PRIMARY KEY(room_id, player))''')
            if 'fields_json' not in {r[1] for r in cx.execute('PRAGMA table_info(room_waitlist)')}:
                cx.execute("ALTER TABLE room_waitlist ADD COLUMN fields_json TEXT NOT NULL DEFAULT '[]'")
            cx.execute('''CREATE TABLE IF NOT EXISTS room_qa (
                room_id TEXT NOT NULL, player TEXT NOT NULL, answers_json TEXT NOT NULL,
                created_at REAL NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY(room_id, player))''')
            cx.execute('''CREATE TABLE IF NOT EXISTS waitlist_requests (
                actor TEXT NOT NULL, created_at REAL NOT NULL)''')
            cx.execute('CREATE INDEX IF NOT EXISTS idx_waitlist_rate ON waitlist_requests(actor,created_at)')

    @staticmethod
    def _room(cx, room_id):
        row = cx.execute('SELECT owner, config_json, status FROM rooms WHERE id=?', (room_id,)).fetchone()
        if not row:
            raise CommunityError('NOT_FOUND', 'No such room.', 404)
        return row

    def _rate(self, cx, who):
        now = self.clock()
        cx.execute('DELETE FROM waitlist_requests WHERE created_at<?', (now - 60,))
        if cx.execute('SELECT COUNT(*) FROM waitlist_requests WHERE actor=?', (who,)).fetchone()[0] >= 30:
            raise CommunityError('RATE_LIMIT', 'Up to 30 waitlist requests per minute. Try again shortly.', 429)
        cx.execute('INSERT INTO waitlist_requests VALUES (?,?)', (who, now))

    def submit(self, room_id: str, who: str, wallet: str, *, finished: bool, players: list[str], results: list[dict] | None = None, fields: list[str] | None = None) -> dict:
        who = who.lower()
        if not re.fullmatch(r'0x[0-9a-fA-F]{40}', wallet):
            raise CommunityError('INVALID_WALLET', 'Enter an EVM address: 0x followed by 40 hexadecimal characters.', 422)
        with self.store.tx() as cx:
            room = self._room(cx, room_id)
            config = json.loads(room['config_json'])
            form = next((f for f in config.get('rewards', {}).get('forms', []) if f['kind'] == 'waitlist-form'), None)
            if not form and not config.get('waitlist', {}).get('enabled', False):
                raise CommunityError('WAITLIST_DISABLED', 'This room does not collect a waitlist.', 409)
            if not finished:
                raise CommunityError('ROUND_NOT_FINISHED', 'Complete the match before submitting.', 409)
            if who not in {p.lower() for p in players}:
                raise CommunityError('NOT_ADMITTED', 'Only players in this finished match may submit.', 403)
            if form:
                self._require_eligible(form, who, results or [])
                self._require_open(room, config)
            values = self._values(fields or [], len(form.get('fields', [])) if form else 0, required=False)
            self._rate(cx, who)
            entry = cx.execute('SELECT wallet, created_at, fields_json FROM room_waitlist WHERE room_id=? AND player=?', (room_id, who)).fetchone()
            replayed = entry is not None
            if not entry:
                now = self.clock()
                cx.execute('INSERT INTO room_waitlist (room_id,player,wallet,created_at,fields_json) VALUES (?,?,?,?,?)', (room_id, who, wallet.lower(), now, json.dumps(values)))
                entry = {'wallet': wallet.lower(), 'created_at': now, 'fields_json': json.dumps(values)}
            self.store._append_audit(cx, who, 'waitlist.submit', None,
                {'roomId': room_id, 'wallet': entry['wallet'], 'replayed': replayed}, self.chain_id)
            return {'wallet': entry['wallet'], 'createdAt': entry['created_at'], 'replayed': replayed, 'fields': json.loads(entry['fields_json'])}

    def listing(self, room_id: str, who: str, *, export=False) -> dict | str:
        who = who.lower()
        with self.store.tx() as cx:
            room = self._room(cx, room_id)
            if room['owner'].lower() != who:
                raise CommunityError('FORBIDDEN', 'Only the room creator may read the waitlist.', 403)
            self._rate(cx, who)
            entries = [dict(row) for row in cx.execute(
                'SELECT wallet, player, fields_json, created_at AS createdAt FROM room_waitlist WHERE room_id=? ORDER BY created_at, player', (room_id,))]
            form = next((f for f in json.loads(room['config_json']).get('rewards', {}).get('forms', []) if f['kind'] == 'waitlist-form'), {})
            for entry in entries:
                entry['fields'] = json.loads(entry.pop('fields_json'))
            self.store._append_audit(cx, who, 'waitlist.export' if export else 'waitlist.read', None,
                {'roomId': room_id, 'count': len(entries)}, self.chain_id)
        if export:
            output = io.StringIO(newline='')
            writer = csv.writer(output)
            writer.writerow(['wallet', 'player', 'timestamp', *[self._csv(label) for label in form.get('fields', [])]])
            writer.writerows((e['wallet'], e['player'], e['createdAt'], *[self._csv(v) for v in e['fields']]) for e in entries)
            return output.getvalue()
        return {'entries': entries, 'count': len(entries), 'uniqueWallets': len({e['wallet'] for e in entries})}

    @staticmethod
    def _csv(value):
        # Spreadsheet apps interpret these prefixes even when CSV-quoted.
        return "'" + value if value.lstrip().startswith(('=', '+', '-', '@')) else value

    @staticmethod
    def _values(values, count, *, required):
        if len(values) != count or any(not isinstance(v, str) or len(v) > 500 or
                (required and not v.strip()) or any(ord(c) < 32 and c not in "\n\t" for c in v) for v in values):
            raise CommunityError('INVALID_FORM', 'Submit one short text value per configured field (up to 500 characters).', 422)
        return [v.strip() for v in values]

    @staticmethod
    def _eligible(form, who, results):
        rows = [r for r in results if r['who'].lower() == who]
        if not rows:
            return False
        row = rows[0]
        rule = form['eligibility']
        return rule == 'anyone' or (rule == 'winners-only' and row['eligible']) or (
            rule == 'top3' and row['rank'] <= 3) or (rule == 'custom' and row['rank'] <= form['custom_count'])

    def _require_eligible(self, form, who, results):
        if not self._eligible(form, who, results):
            raise CommunityError('FORM_INELIGIBLE', 'This form is reserved for the creator’s selected placements.', 403)

    def _require_open(self, room, config):
        close_at = config.get('timing', {}).get('close_at', 0)
        if room['status'] in {'closed', 'cancelled', 'refundable'} or close_at and self.clock() >= close_at:
            raise CommunityError('ROOM_CLOSED', 'Responses close when the room closes.', 409)

    def status(self, room_id, who, *, finished, results):
        who = who.lower()
        with self.store.tx() as cx:
            room = self._room(cx, room_id)
            config = json.loads(room['config_json'])
            forms = config.get('rewards', {}).get('forms', [])
            closed = room['status'] in {'closed', 'cancelled', 'refundable'} or bool(
                config.get('timing', {}).get('close_at', 0) and self.clock() >= config['timing']['close_at'])
            return {'forms': [{**form, 'eligible': finished and self._eligible(form, who, results),
                'submitted': bool(cx.execute('SELECT 1 FROM ' + ('room_qa' if form['kind'] == 'qa-form' else 'room_waitlist') +
                    ' WHERE room_id=? AND player=?', (room_id, who)).fetchone()), 'editable': not closed}
                for form in forms]}

    def submit_qa(self, room_id, who, answers, *, finished, results):
        who = who.lower()
        with self.store.tx() as cx:
            room = self._room(cx, room_id)
            config = json.loads(room['config_json'])
            form = next((f for f in config.get('rewards', {}).get('forms', []) if f['kind'] == 'qa-form'), None)
            if not form:
                raise CommunityError('FORM_DISABLED', 'This room has no Q&A reward.', 409)
            if not finished:
                raise CommunityError('ROUND_NOT_FINISHED', 'Complete the match before submitting.', 409)
            self._require_eligible(form, who, results)
            self._require_open(room, config)
            values = self._values(answers, len(form['questions']), required=True)
            self._rate(cx, who)
            now = self.clock()
            previous = cx.execute('SELECT created_at FROM room_qa WHERE room_id=? AND player=?', (room_id, who)).fetchone()
            cx.execute('INSERT INTO room_qa VALUES (?,?,?,?,?) ON CONFLICT(room_id,player) DO UPDATE SET answers_json=excluded.answers_json, updated_at=excluded.updated_at',
                (room_id, who, json.dumps(values), previous['created_at'] if previous else now, now))
            # Never put private answers into audit logs, public state or broadcasts.
            self.store._append_audit(cx, who, 'qa.submit', None, {'roomId': room_id, 'edited': bool(previous)}, self.chain_id)
            return {'saved': True, 'edited': bool(previous), 'updatedAt': now}

    def qa_listing(self, room_id, who, *, export=False):
        who = who.lower()
        with self.store.tx() as cx:
            room = self._room(cx, room_id)
            if room['owner'].lower() != who:
                raise CommunityError('FORBIDDEN', 'Only the room creator may read Q&A responses.', 403)
            self._rate(cx, who)
            form = next((f for f in json.loads(room['config_json']).get('rewards', {}).get('forms', []) if f['kind'] == 'qa-form'), {})
            entries = [dict(r) for r in cx.execute('SELECT player, answers_json, created_at AS createdAt, updated_at AS updatedAt FROM room_qa WHERE room_id=? ORDER BY created_at,player', (room_id,))]
            for entry in entries:
                entry['answers'] = json.loads(entry.pop('answers_json'))
            self.store._append_audit(cx, who, 'qa.export' if export else 'qa.read', None, {'roomId': room_id, 'count': len(entries)}, self.chain_id)
        if export:
            output = io.StringIO(newline='')
            writer = csv.writer(output)
            writer.writerow(['player', 'timestamp', 'updated', *[self._csv(q) for q in form.get('questions', [])]])
            writer.writerows((e['player'], e['createdAt'], e['updatedAt'], *[self._csv(a) for a in e['answers']]) for e in entries)
            return output.getvalue()
        return {'entries': entries, 'count': len(entries), 'questions': form.get('questions', [])}

    def response_counts(self, room_id):
        with self.store.tx() as cx:
            return {'waitlist-form': cx.execute('SELECT COUNT(*) FROM room_waitlist WHERE room_id=?', (room_id,)).fetchone()[0],
                'qa-form': cx.execute('SELECT COUNT(*) FROM room_qa WHERE room_id=?', (room_id,)).fetchone()[0]}

    def reward_wallets(self, room_id, who):
        listing = self.listing(room_id, who)
        wallets = list(dict.fromkeys(e["wallet"].lower() for e in listing["entries"] if int(e["wallet"], 16)))
        if not wallets:
            raise CommunityError("EMPTY_WAITLIST", "This waitlist has no nonzero recipient wallets.", 409)
        if len(wallets) > 50:
            raise CommunityError("WAITLIST_TOO_LARGE", "This version supports up to 50 wallets per drop. No entries were omitted.", 409)
        return wallets

    def validate_reward_source(self, rewards, who):
        if not rewards.waitlist_source:
            return
        wallets = self.reward_wallets(rewards.waitlist_source, who)
        chosen = [a.lower() for a in rewards.merkle_winners]
        if not chosen or len(chosen) != len(set(chosen)) or not set(chosen).issubset(wallets):
            raise CommunityError("WAITLIST_MISMATCH", "Recipients must come from the creator's collected waitlist snapshot.", 409)

    def count(self, room_id):
        with self.store.tx() as cx:
            return cx.execute('SELECT COUNT(*) FROM room_waitlist WHERE room_id=?', (room_id,)).fetchone()[0]
