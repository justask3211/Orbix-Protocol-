#!/usr/bin/env python3
"""Deep-read t.me/spark_coded: announcements + chat history, keyword scan for revenue/fee share."""
import asyncio, os, re, json
from telethon import TelegramClient

API_ID = int(os.environ['TELEGRAM_API_ID'])
API_HASH = os.environ['TELEGRAM_API_HASH']
SESSION = os.path.expanduser('~/.hermes/cache/scratch/vibevibe_session')
TARGET = 'spark_coded'

KEYWORDS = re.compile(r'(revenue\s*share|fee\s*share|profit|5\s*%|five\s*percent|allocation|airdrop|buyback|dividend|partner|treasury|reward|launch|launchpad|bridge|swap|chain|mainnet|testnet|ecosystem|builder|grant)', re.I)

async def main():
    async with TelegramClient(SESSION, API_ID, API_HASH) as client:
        entity = await client.get_entity(TARGET)
        print(f'ENTITY: {getattr(entity,"title",None)} | id={entity.id} | type={"channel" if entity.broadcast else "group"}')
        # channel info
        full = await client.get_entity(TARGET)
        try:
            print('ABOUT:', (await client.get_entity(TARGET)).about if hasattr(full, 'about') else '')
        except Exception as e:
            print('about n/a')
        print('\n===== LAST 100 MESSAGES =====')
        msgs = []
        async for m in client.iter_messages(entity, limit=100):
            if not m.message: continue
            sender = ''
            try:
                if m.sender:
                    sender = getattr(m.sender, 'username', None) or getattr(m.sender, 'first_name', '') or ''
            except Exception: pass
            date = m.date.strftime('%Y-%m-%d %H:%M') if m.date else ''
            flag = ' <<<KW' if KEYWORDS.search(m.message) else ''
            msgs.append({'date': date, 'sender': sender, 'text': m.message, 'kw': bool(KEYWORDS.search(m.message))})
            print(f'[{date}] {sender}: {m.message[:500]}{flag}')
        json.dump(msgs, open(os.path.expanduser('~/.hermes/cache/scratch/spark_msgs.json'), 'w'), ensure_ascii=False)
        print(f'\nSaved {len(msgs)} messages.')

asyncio.run(main())
