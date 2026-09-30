#!/usr/bin/env python3
"""Pull pinned messages + keyword-deep scan of spark_coded history for allocation/share structure."""
import asyncio, os, re, json
from telethon import TelegramClient

API_ID = int(os.environ['TELEGRAM_API_ID'])
API_HASH = os.environ['TELEGRAM_API_HASH']
SESSION = os.path.expanduser('~/.hermes/cache/scratch/vibevibe_session')
TARGET = 'spark_coded'

PCT = re.compile(r'(\d{1,2}(?:\.\d)?)\s*%', re.I)
SHARE = re.compile(r'(revenue|fee|profit|allocation|airdrop|distribut|pool|share|tokenomics|supply|ticker|tge|snapshot|nft|launch|mainnet|spark)', re.I)

async def main():
    async with TelegramClient(SESSION, API_ID, API_HASH) as client:
        entity = await client.get_entity(TARGET)
        print('===== PINNED =====')
        try:
            pm = await client.get_messages(entity, ids=None)  # fallback
        except Exception: pass
        # pinned via iter_messages with pinned filter is not direct; use client.get_messages(ids=...) of pinned msg ids
        try:
            from telethon.tl.functions.messages import GetPinnedMessagesRequest  # may not exist for megagroups; fallback below
        except Exception: pass
        # fallback: scan deeper history for announcement-style messages by admins
        admins = {'bactyn', 'seedifyadmin', 'KriptoAnonim', 'NoRegretz', 'meta_alchemist'}
        print('===== ADMIN/ANNOUNCE MESSAGES (deeper history, pct+share mentions) =====')
        n = 0
        async for m in client.iter_messages(entity, limit=800):
            if not m.message: continue
            try:
                sender = getattr(m.sender, 'username', '') or ''
            except Exception: sender = ''
            if sender not in admins: continue
            pcts = PCT.findall(m.message)
            if not (pcts or SHARE.search(m.message)): continue
            date = m.date.strftime('%Y-%m-%d') if m.date else ''
            print(f'--- [{date}] {sender} pcts={pcts}')
            print(m.message[:900])
            n += 1
            if n > 40: break

asyncio.run(main())
