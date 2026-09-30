#!/usr/bin/env python3
"""Analyze raid frequency from viberaidalerts + check vibevibefun membership and recent raids."""
import asyncio, os, re, json
from telethon import TelegramClient
from telethon.tl.types import Channel, User
from datetime import datetime, timedelta

API_ID = int(os.environ['TELEGRAM_API_ID'])
API_HASH = os.environ['TELEGRAM_API_HASH']
SESSION = os.path.expanduser('~/.hermes/cache/scratch/vibevibe_session')

async def main():
    async with TelegramClient(SESSION, API_ID, API_HASH) as client:
        # ---- 1) membership + info of vibevibefun ----
        for uname in ['vibevibefun', 'viberaidalerts', 'spark_coded']:
            try:
                e = await client.get_entity(uname)
                kind = 'channel' if getattr(e, 'broadcast', False) else 'group'
                # participation check: iter_participants works if member or public
                joined = True
                try:
                    _ = await client.get_participants(e, limit=1)
                    can_see = True
                except Exception:
                    can_see = False
                print(f'{uname}: id={e.id} kind={kind} can_read={can_see}')
            except Exception as ex:
                print(f'{uname}: ERROR {ex}')

        # ---- 2) raid frequency from viberaidalerts ----
        print('\n===== VIBERAIDALERTS: raid timeline =====')
        try:
            alerts = await client.get_entity('viberaidalerts')
            raids = []
            async for m in client.iter_messages(alerts, limit=300):
                if not m.message: continue
                if 'raid' in m.message.lower():
                    raids.append(m.date)
            raids.sort()
            print(f'total raid-alert messages: {len(raids)}')
            if raids:
                print(f'first: {raids[0]}  last: {raids[-1]}')
                # gaps between consecutive raids (per day counts)
                from collections import Counter
                per_day = Counter(r.date().isoformat() for r in raids)
                for day in sorted(per_day):
                    print(f'  {day}: {per_day[day]} alert(s)')
                # hour-of-day distribution
                hrs = Counter(r.hour for r in raids)
                print('hour-of-day histogram (UTC):', dict(sorted(hrs.items())))
                gaps = [(raids[i+1]-raids[i]).total_seconds()/3600 for i in range(len(raids)-1)]
                gaps = [g for g in gaps if g > 0.1]
                if gaps:
                    avg = sum(gaps)/len(gaps)
                    import statistics
                    print(f'avg gap: {avg:.1f}h | median: {statistics.median(gaps):.1f}h | min: {min(gaps):.1f}h | max: {max(gaps):.1f}h')
        except Exception as ex:
            print('alerts ERROR:', ex)

        # ---- 3) recent raids in vibevibefun (raid start markers by raidbot) ----
        print('\n===== VIBEVIBEFUN: recent raid-bot starts (last 7d) =====')
        vf = await client.get_entity('vibevibefun')
        starts = []
        async for m in client.iter_messages(vf, limit=1000):
            if not m.message: continue
            if m.date and m.message and m.date < (datetime.now(m.date.tzinfo) - timedelta(days=8)): break
            if 'Raid' in m.message and ('smash' in m.message.lower() or 'likes' in m.message.lower() or '🎯' in m.message or 'GO' in m.message[:40]):
                starts.append((m.date, m.message[:150]))
        for d, t in starts[:25]:
            print(f'[{d:%m-%d %H:%M}] {t}'.replace('\n',' '))

asyncio.run(main())
