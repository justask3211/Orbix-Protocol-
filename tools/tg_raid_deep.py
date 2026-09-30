#!/usr/bin/env python3
"""Full history raid-frequency analysis: every raid alert + raid end marker across ALL time.
Output: per-day counts, per-weekday stats, gap distribution, blitz-day detection."""
import asyncio, os, re, json
from telethon import TelegramClient
from collections import Counter
from datetime import timedelta
import statistics

API_ID = int(os.environ['TELEGRAM_API_ID'])
API_HASH = os.environ['TELEGRAM_API_HASH']
SESSION = os.path.expanduser('~/.hermes/cache/scratch/vibevibe_session')

RAID_END = re.compile(r'Raid Ended', re.I)
RAID_GO = re.compile(r'(raid now|new raid|raid is live|raid started|🔥 GO|🚨)', re.I)

async def main():
    async with TelegramClient(SESSION, API_ID, API_HASH) as client:
        # ---- alerts channel: pull EVERYTHING ----
        alerts = await client.get_entity('viberaidalerts')
        events = []
        async for m in client.iter_messages(alerts, limit=None):
            if not m.message: continue
            kind = 'end' if RAID_END.search(m.message) else ('start' if RAID_GO.search(m.message) else 'alert')
            events.append({'ts': m.date, 'kind': kind, 'text': m.message[:200]})
        events.sort(key=lambda x: x['ts'])
        print(f'=== VIBERAIDALERTS: {len(events)} total messages (full history) ===')
        starts = [e for e in events if e['kind'] in ('alert', 'start')]
        ends = [e for e in events if e['kind'] == 'end']
        print(f'raid-start-ish: {len(starts)}, raid-end markers: {len(ends)}')

        per_day = Counter(e['ts'].date().isoformat() for e in starts)
        print('\n--- raids per day (all history) ---')
        for day in sorted(per_day):
            wd = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][__import__('datetime').date.fromisoformat(day).weekday()]
            bar = '█' * per_day[day]
            print(f'{day} {wd}: {per_day[day]:2d} {bar}')

        # weekday pattern
        wd_count = Counter()
        wd_days = set()
        for e in starts:
            wd_count[e['ts'].weekday()] += 1
            wd_days.add(e['ts'].date().isoformat())
        print('\n--- per-weekday totals ---')
        for wd in range(7):
            names = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
            print(f'{names[wd]}: {wd_count.get(wd,0)}')

        # gaps in hours
        ts = [e['ts'] for e in starts]
        gaps = [(ts[i+1]-ts[i]).total_seconds()/3600 for i in range(len(ts)-1)]
        if gaps:
            print(f'\n--- gap stats (n={len(gaps)}) ---')
            print(f'mean {statistics.mean(gaps):.1f}h | median {statistics.median(gaps):.1f}h | min {min(gaps):.2f}h | max {max(gaps):.1f}h | stdev {statistics.stdev(gaps):.1f}h')
            buckets = Counter()
            for g in gaps:
                if g < 1: buckets['<1h'] += 1
                elif g < 3: buckets['1-3h'] += 1
                elif g < 6: buckets['3-6h'] += 1
                elif g < 12: buckets['6-12h'] += 1
                elif g < 24: buckets['12-24h'] += 1
                else: buckets['>24h'] += 1
            print('gap buckets:', dict(sorted(buckets.items())))

        # blitz detection: days with >=4 raids
        blitz = [d for d, c in per_day.items() if c >= 4]
        quiet = [d for d, c in per_day.items() if c <= 1]
        print(f'\nblitz days (>=4 raids): {len(blitz)} -> {blitz}')
        print(f'quiet days (<=1 raid): {len(quiet)} -> {quiet}')

        # hour histogram
        hrs = Counter(e['ts'].hour for e in starts)
        print('\n--- hour-of-day (UTC) ---')
        for h in range(24):
            if hrs.get(h): print(f'{h:02d} UTC: {"█"*hrs[h]} ({hrs[h]})')

        # fill-rate analysis from raid-end messages (likes/replies targets)
        print('\n--- raid fill rates (from end markers) ---')
        fills = []
        for e in events:
            m = re.search(r'Likes (\d+) \| (\d+)', e['text'])
            r = re.search(r'Replies (\d+) \| (\d+)', e['text'])
            if m:
                got, tgt = int(m.group(1)), int(m.group(2))
                fills.append(got/tgt if tgt else 0)
        if fills:
            print(f'n={len(fills)} | mean fill {statistics.mean(fills)*100:.0f}% | median {statistics.median(fills)*100:.0f}% | min {min(fills)*100:.0f}%')
            fast = sum(1 for f in fills if f >= 1.0)
            print(f'fully-filled raids: {fast}/{len(fills)}')

        # ---- vibevibefun: raidbot XP / announcement markers across all history ----
        print('\n=== VIBEVIBEFUN: raid cadence cross-check (raidbot messages per day, all history) ===')
        vf = await client.get_entity('vibevibefun')
        bot_days = Counter()
        async for m in client.iter_messages(vf, limit=3000):
            if not m.message: continue
            if 'vibeviberaidbot' in (getattr(m.sender, 'username', '') or '') or RAID_END.search(m.message) or 'XP' in m.message and 'Leaderboard' in m.message:
                bot_days[m.date.date().isoformat()] += 1
        for day in sorted(bot_days):
            print(f'{day}: {bot_days[day]} raidbot msgs')

asyncio.run(main())
