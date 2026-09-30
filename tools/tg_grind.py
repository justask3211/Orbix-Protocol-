#!/usr/bin/env python3
"""Deep-mine spark_coded + vibevibefun history: competitions, rewards, games/tools, grinding alpha."""
import asyncio, os, re, json
from telethon import TelegramClient

API_ID = int(os.environ['TELEGRAM_API_ID'])
API_HASH = os.environ['TELEGRAM_API_HASH']
SESSION = os.path.expanduser('~/.hermes/cache/scratch/vibevibe_session')

COMPETE = re.compile(r'(compete|competition|bounty|quest|grind|points|leaderboard|weekly|raid|reward|prize|winners|builder|build.*tool|game|mini.?app|bot|trade.*comp|volume)', re.I)

async def dump(client, target, label, limit=1500):
    try:
        entity = await client.get_entity(target)
    except Exception as e:
        print(f'!! cannot resolve {target}: {e}')
        return []
    print(f'\n########## {label} ({target}) ##########')
    out = []
    async for m in client.iter_messages(entity, limit=limit):
        if not m.message: continue
        try:
            sender = getattr(m.sender, 'username', '') or getattr(m.sender, 'first_name', '') or ''
        except Exception: sender = ''
        if not COMPETE.search(m.message): continue
        date = m.date.strftime('%Y-%m-%d') if m.date else ''
        out.append({'date': date, 'sender': sender, 'text': m.message})
    # print most interesting, newest last
    for m in out[:80]:
        print(f"--- [{m['date']}] {m['sender']}")
        print(m['text'][:600])
    print(f'({len(out)} keyword hits in {label})')
    return out

async def main():
    async with TelegramClient(SESSION, API_ID, API_HASH) as client:
        a = await dump(client, 'spark_coded', 'SPARK COMMUNITY')
        b = await dump(client, 'vibevibefun', 'VIBEVIBE FUN')
        json.dump(a + b, open(os.path.expanduser('~/.hermes/cache/scratch/grind_intel.json'), 'w'), ensure_ascii=False)
        print(f'\nSaved {len(a)+len(b)} hits.')

asyncio.run(main())
