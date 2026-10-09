"""Explicit address collection, independent of scores, eligibility and settlement."""
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
            cx.execute('''CREATE TABLE IF NOT EXISTS waitlist_requests (
                actor TEXT NOT NULL, created_at REAL NOT NULL)''')
            cx.execute('CREATE INDEX IF NOT EXISTS idx_waitlist_rate ON waitlist_requests(actor,created_at)')

    @staticmethod
    def _room(cx, room_id):
        row = cx.execute('SELECT owner, config_json FROM rooms WHERE id=?', (room_id,)).fetchone()
        if not row:
            raise CommunityError('NOT_FOUND', 'No such room.', 404)
        return row

    def _rate(self, cx, who):
        now = self.clock()
        cx.execute('DELETE FROM waitlist_requests WHERE created_at<?', (now - 60,))
        if cx.execute('SELECT COUNT(*) FROM waitlist_requests WHERE actor=?', (who,)).fetchone()[0] >= 30:
            raise CommunityError('RATE_LIMIT', 'Up to 30 waitlist requests per minute. Try again shortly.', 429)
        cx.execute('INSERT INTO waitlist_requests VALUES (?,?)', (who, now))

    def submit(self, room_id: str, who: str, wallet: str, *, finished: bool, players: list[str]) -> dict:
        who = who.lower()
        if not re.fullmatch(r'0x[0-9a-fA-F]{40}', wallet):
            raise CommunityError('INVALID_WALLET', 'Enter an EVM address: 0x followed by 40 hexadecimal characters.', 422)
        with self.store.tx() as cx:
            room = self._room(cx, room_id)
            if not json.loads(room['config_json']).get('waitlist', {}).get('enabled', False):
                raise CommunityError('WAITLIST_DISABLED', 'This room does not collect a waitlist.', 409)
            if not finished:
                raise CommunityError('ROUND_NOT_FINISHED', 'Complete the match before submitting.', 409)
            if who not in {p.lower() for p in players}:
                raise CommunityError('NOT_ADMITTED', 'Only players in this finished match may submit.', 403)
            self._rate(cx, who)
            entry = cx.execute('SELECT wallet, created_at FROM room_waitlist WHERE room_id=? AND player=?', (room_id, who)).fetchone()
            replayed = entry is not None
            if not entry:
                now = self.clock()
                cx.execute('INSERT INTO room_waitlist VALUES (?,?,?,?)', (room_id, who, wallet.lower(), now))
                entry = {'wallet': wallet.lower(), 'created_at': now}
            self.store._append_audit(cx, who, 'waitlist.submit', None,
                {'roomId': room_id, 'wallet': entry['wallet'], 'replayed': replayed}, self.chain_id)
            return {'wallet': entry['wallet'], 'createdAt': entry['created_at'], 'replayed': replayed}

    def listing(self, room_id: str, who: str, *, export=False) -> dict | str:
        who = who.lower()
        with self.store.tx() as cx:
            room = self._room(cx, room_id)
            if room['owner'].lower() != who:
                raise CommunityError('FORBIDDEN', 'Only the room creator may read the waitlist.', 403)
            self._rate(cx, who)
            entries = [dict(row) for row in cx.execute(
                'SELECT wallet, player, created_at AS createdAt FROM room_waitlist WHERE room_id=? ORDER BY created_at, player', (room_id,))]
            self.store._append_audit(cx, who, 'waitlist.export' if export else 'waitlist.read', None,
                {'roomId': room_id, 'count': len(entries)}, self.chain_id)
        if export:
            output = io.StringIO(newline='')
            writer = csv.writer(output)
            writer.writerow(['wallet', 'player', 'timestamp'])
            writer.writerows((e['wallet'], e['player'], e['createdAt']) for e in entries)
            return output.getvalue()
        return {'entries': entries, 'count': len(entries), 'uniqueWallets': len({e['wallet'] for e in entries})}

    def count(self, room_id):
        with self.store.tx() as cx:
            return cx.execute('SELECT COUNT(*) FROM room_waitlist WHERE room_id=?', (room_id,)).fetchone()[0]
