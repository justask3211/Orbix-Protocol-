#!/usr/bin/env python3
"""Scan vibevibe.fun community on Telegram: read announcements + chat, summarize what they're building,
and surface anything about revenue share / fee share / 5% allocations."""
import asyncio, os, re, sys, json
from telethon import TelegramClient
from telethon.tl.types import User, Channel

API_ID = int(os.environ['TELEGRAM_API_ID'])
API_HASH = os.environ['TELEGRAM_API_HASH']
SESSION = os.path.expanduser('~/.hermes/cache/scratch/vibevibe_session')

KEYWORDS = re.compile(r'(revenue\s*share|fee\s*share|profit\s*share|5\s*%|five\s*percent|allocation|distribution|airdrop|reward|partner|revenue|treasury|buyback|dividend|stake.*reward|LP.*fee)', re.I)

async def main():
    async with TelegramClient(SESSION, API_ID, API_HASH) as client:
        me = await client.get_me()
        print(f'Logged in as: {me.first_name} (@{me.username}) id={me.id}')
        # 1) find vibevibe groups/channels in dialogs
        hits = []
        async for d in client.iter_dialogs(limit=200):
            name = (d.name or '').lower()
            if any(k in name for k in ['vibe', 'orbix', 'robinhood']):
                kind = 'channel' if isinstance(d.entity, Channel) and d.entity.broadcast else ('group' if isinstance(d.entity, Channel) else 'user')
                hits.append((d.id, d.name, kind, d.entity.username))
        print('MATCHED DIALOGS:')
        for h in hits: print(' ', h)
        json.dump(hits, open(os.path.expanduser('~/.hermes/cache/scratch/vibe_dialogs.json'), 'w'))

        # 2) for each channel/group, pull recent messages
        for did, name, kind, uname in hits[:6]:
            print(f'\n===== {name} ({kind}, {uname}) =====')
            n = 0
            async for m in client.iter_messages(did, limit=60):
                if not m.message: continue
                n += 1
                flag = ' <<< KEYWORD' if KEYWORDS.search(m.message) else ''
                sender = ''
                try:
                    if m.sender:
                        sender = getattr(m.sender, 'username', None) or getattr(m.sender, 'first_name', '')
                except Exception: pass
                date = m.date.strftime('%m-%d %H:%M') if m.date else ''
                text = m.message.replace('\n', ' ')[:400]
                print(f'[{date}] {sender}: {text}{flag}')
                if n >= 60: break

asyncio.run(main())
