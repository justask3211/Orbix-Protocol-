"""Bounded ephemeral practice matches: no room, ledger, entry or entitlement writes."""
from __future__ import annotations
from collections import deque
import math
import secrets
import time

from fastapi import HTTPException, Request, Header
from center.games import engine_for, StreamRNG
from center.schema import RoomConfig

PLAYER = '0x'+'11'*20
BOTS = ['0x'+f'{i:02x}'*20 for i in range(32,36)]
RULES = {
    'number-hunt':dict(digits=4,min=1111,max=9999,guess_budget=20,duration_seconds=300,hints='on',hint_visibility='private'),
    'token-catch':dict(duration_seconds=120,arena_mode=True,world_version=4,loot_budget=500,airdrop_count=10,loot_chunk=5,spawn_per_second=4,lanes=3,hazard_chance_pct=12,win_threshold=5),
    'boss-raid':dict(duration_seconds=180,arena_mode=True,world_version=4,team_mode='teams',team_size=2,max_players=50,min_players=2,boss_health=6000,contribution_cap=10000),
    'combat-duel':dict(duration_seconds=180,world_version=4,starting_health=150),
    'reaction-duel':dict(rounds=3),
    'closest-call': {}, 'word-forge': {}, 'prism-lines': {}, 'relic-auction': {}, 'atlas-quest': {},
}


def mount_practice(app,prefix):
    matches={}
    rates={}
    app.state.practice_matches=matches

    def find(identifier,token):
        record=matches.get(identifier)
        if not record or record['expires']<time.time() or not isinstance(token,str) or not secrets.compare_digest(token,record['token']):
            raise HTTPException(404,detail={'code':'PRACTICE_EXPIRED','message':'Practice ended or expired. Start a fresh match.'})
        return record

    def update(record):
        engine=record['engine'];now=time.time()
        if engine.finished:return
        engine.tick(now)
        if not getattr(engine,'arena',False):
            if engine.template_id=='reaction-duel':
                state=engine.public_state()
                if state['phase']=='commit' and not state['committed'].get(BOTS[0]) and now-record['lastBot']>=.8:
                    rng=StreamRNG(engine.seed, ('practice-bot/reaction-duel/v2/'+str(engine.round_index)).encode())
                    choice=rng.choice(engine.choices);salt=rng.draw(16).hex()
                    engine.act(BOTS[0],{'kind':'commit','roundId':engine.round_id,'subroundIndex':engine.round_index,'choice':choice,'salt':salt},now)
                    record['lastBot']=now
            if engine.template_id in {'prism-lines', 'relic-auction'} and not engine.finished:
                state=engine.public_state()
                index=state['index']
                if state['phase']=='selection' and now-state['phaseStartedAt']>=1:
                    rng=StreamRNG(engine.seed, f'practice-bot/{engine.template_id}/v1/{index}'.encode())
                    bot=BOTS[0]
                    common={'roundId':engine.round_id,'actionId':f'bot-{index}'}
                    if engine.template_id=='prism-lines' and state['currentPlayer']==bot:
                        columns=[c for c in range(state['columns']) if state['board'][0][c] is None]
                        if columns:engine.act(bot,{**common,'kind':'drop','turnIndex':index,'column':rng.choice(columns)},now)
                    elif engine.template_id=='relic-auction' and not state['submitted'][bot]:
                        balance=state['balances'][bot];value=state['challenge']['value']
                        amount=min(balance,rng.between(1,max(1,value)))
                        engine.act(bot,{**common,'kind':'bid','auctionIndex':index,'amount':amount},now)
            return
        if now-record['startedAt']<8 or now-record['lastBot']<.15:return
        record['lastBot']=now
        for bot in record['bots']:
            body=engine.bodies[bot]
            if body['hp']<=0:continue
            target=None
            if engine.template_id=='token-catch':
                coins=[d for d in engine.drops if d['kind'] in {'coin','push','shield'}]
                crates=[d for d in getattr(engine,'airdrops',[]) if not d['opened'] and d['landAt']<=engine.elapsed]
                target=min([*coins,*crates],key=lambda d:engine._distance(body,d),default=None)
            elif engine.template_id=='boss-raid':
                upgrades=[d for d in engine.drops if d['kind']=='upgrade']
                target=min(upgrades,key=lambda d:engine._distance(body,d),default=None) or engine.boss
            else:target=engine.bodies[PLAYER]
            if not target:continue
            dx,dz=target['x']-body['x'],target['z']-body['z'];distance=math.hypot(dx,dz)
            desired=12 if engine.template_id=='boss-raid' and target is engine.boss else 1.25 if engine.template_id=='combat-duel' else 2
            moving=distance>desired
            record['seqs'][bot]+=1
            engine.act(bot,{'kind':'move','seq':record['seqs'][bot],'dx':dx/max(1,distance) if moving else 0,
                'dz':dz/max(1,distance) if moving else 0,'yaw':math.atan2(dx,dz)},now)
            if getattr(engine,'version',2)>=3 and target.get('id') and distance<=3:
                engine.act(bot,{'kind':'open_airdrop' if target.get('id','').startswith('airdrop-') else 'loot','dropId':target['id']},now)
            if getattr(engine,'version',2)>=3 and moving and not engine._can_walk_body(body['x']+dx/max(1,distance),body['z']+dz/max(1,distance),body):
                engine.act(bot,{'kind':'jump'},now)
            if engine.template_id!='token-catch' and body['attackReadyAt']<=now*1000:
                engine.act(bot,{'kind':'attack'},now)

    def frame(record):
        update(record)
        engine=record['engine']
        state=engine.public_state()
        if engine.finished:
            scores=engine.scores();eligible=engine.eligible()
            state['finalPlacements']=[{'who':who,'score':scores[who],'rank':rank} for rank,who in enumerate((p for p in engine.ranking() if p in eligible),1)]
        if hasattr(engine,'private_state'):state.update(engine.private_state(PLAYER))
        return {'state':state,'me':PLAYER,'players':engine.participants,'deadline':record['startedAt']+getattr(engine.rules,'duration_seconds', engine.rules.rounds*(engine.rules.choice_window_seconds+engine.rules.reveal_window_seconds) if engine.template_id in {'reaction-duel','rps-duel'} else 120),
            'serverTimeMs':int(time.time()*1000),'practice':True,'rewards':'none'}

    @app.post(prefix+'/practice')
    async def create(body:dict,request:Request):
        now=time.time()
        for key,record in list(matches.items()):
            if record['expires']<=now:matches.pop(key,None)
        for key,times in list(rates.items()):
            while times and times[0]<now-60:times.popleft()
            if not times:rates.pop(key,None)
        client=request.client.host if request.client else 'unknown'
        if len(rates)>500 or len(rates.setdefault(client,deque()))>=10 or len(matches)>=40:
            raise HTTPException(429,detail={'code':'PRACTICE_BUSY','message':'Practice is busy. Try again shortly.'})
        template=body.get('templateId')
        if template not in RULES:raise HTTPException(422,detail={'code':'UNKNOWN_PRACTICE_GAME'})
        from center.admin_games import game_availability
        if game_availability(app.state.store,template)['status']!='live':
            raise HTTPException(409,detail={'code':'GAME_UNAVAILABLE','message':'This game is currently paused.'})
        rates[client].append(now)
        bots=BOTS[:3] if template=='boss-raid' else BOTS[:2] if template=='token-catch' else BOTS[:1] if template in {'combat-duel','reaction-duel','prism-lines','relic-auction'} else []
        players=[PLAYER,*bots]
        config=RoomConfig(name='Practice',template_id=template,rules={'templateId':template,**RULES[template]},
            admission={'player_cap':len(players),'min_ready_to_start':2 if template in {'prism-lines','relic-auction'} else 1},access={'required_amount':0})
        identifier,token=secrets.token_urlsafe(16),secrets.token_urlsafe(32)
        engine=engine_for(config)(config,secrets.token_hex(16),secrets.token_hex(32),players)
        if template=='boss-raid':engine.teams={p:f'team-{i//2+1}' for i,p in enumerate(players)}
        engine.start(now)
        record={'token':token,'engine':engine,'bots':bots,'expires':now+900,'startedAt':now,'lastBot':now,'seqs':{p:0 for p in bots}}
        matches[identifier]=record
        return {'practiceId':identifier,'accessToken':token,**frame(record)}

    @app.get(prefix+'/practice/{identifier}')
    async def state(identifier:str,token:str=Header(alias='X-Practice-Token')):return frame(find(identifier,token))

    @app.post(prefix+'/practice/{identifier}/actions')
    async def action(identifier:str,body:dict):
        record=find(identifier,body.get('token'))
        update(record)
        result=record['engine'].act(PLAYER,body.get('action',{}),time.time())
        return {'ok':result.ok,'error':result.error,**frame(record)}

    @app.delete(prefix+'/practice/{identifier}')
    async def close(identifier:str,token:str=Header(alias='X-Practice-Token')):
        find(identifier,token)
        matches.pop(identifier,None)
        return {'closed':True}
