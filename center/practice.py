"""Bounded ephemeral practice matches: no room, ledger, entry or entitlement writes."""
from __future__ import annotations
from collections import deque
import math
import secrets
import time

from fastapi import HTTPException, Request, Header
from center.games import engine_for
from center.schema import RoomConfig

PLAYER = '0x'+'11'*20
BOTS = ['0x'+f'{i:02x}'*20 for i in range(32,36)]
RULES = {
    'number-hunt':dict(digits=4,min=1111,max=9999,guess_budget=20,duration_seconds=300,hints='on',hint_visibility='private'),
    'token-catch':dict(duration_seconds=180,arena_mode=True,spawn_per_second=4,lanes=3,hazard_chance_pct=12,win_threshold=5),
    'boss-raid':dict(duration_seconds=180,arena_mode=True,team_mode='teams',team_size=2,max_players=50,min_players=2,boss_health=1800,contribution_cap=10000),
    'combat-duel':dict(duration_seconds=180,starting_health=100),
    'reaction-duel':dict(rounds=3),
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
                    choice=secrets.choice(['rock','paper','scissors']);salt=secrets.token_hex(16)
                    record['botChoice']=(choice,salt)
                    engine.act(BOTS[0],{'kind':'commit','choice':choice,'salt':salt},now)
                    record['lastBot']=now
                if state['phase']=='reveal' and not state['revealed'].get(BOTS[0]) and record.get('botChoice'):
                    choice,salt=record['botChoice']
                    engine.act(BOTS[0],{'kind':'reveal','choice':choice,'salt':salt},now)
            return
        if now-record['lastBot']<.15:return
        record['lastBot']=now
        for bot in record['bots']:
            body=engine.bodies[bot]
            target=None
            if engine.template_id=='token-catch':
                coins=[d for d in engine.drops if d['kind'] in {'coin','push','shield'}]
                target=min(coins,key=lambda d:engine._distance(body,d),default=None)
            elif engine.template_id=='boss-raid':target=engine.boss
            else:target=engine.bodies[PLAYER]
            if not target:continue
            dx,dz=target['x']-body['x'],target['z']-body['z'];distance=math.hypot(dx,dz)
            moving=distance>(2.3 if engine.template_id=='boss-raid' else 1.25 if engine.template_id=='combat-duel' else .35)
            record['seqs'][bot]+=1
            engine.act(bot,{'kind':'move','seq':record['seqs'][bot],'dx':dx/max(1,distance) if moving else 0,
                'dz':dz/max(1,distance) if moving else 0,'yaw':math.atan2(dx,dz)},now)
            if engine.template_id!='token-catch' and body['attackReadyAt']<=now*1000:
                engine.act(bot,{'kind':'attack'},now)

    def frame(record):
        update(record)
        engine=record['engine']
        state=engine.public_state()
        if hasattr(engine,'private_state'):state.update(engine.private_state(PLAYER))
        return {'state':state,'me':PLAYER,'players':engine.participants,'deadline':record['startedAt']+RULES[engine.template_id].get('duration_seconds',45),
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
        rates[client].append(now)
        bots=BOTS[:3] if template=='boss-raid' else BOTS[:2] if template=='token-catch' else BOTS[:1] if template in {'combat-duel','reaction-duel'} else []
        players=[PLAYER,*bots]
        config=RoomConfig(name='Practice',template_id=template,rules={'templateId':template,**RULES[template]},
            admission={'player_cap':len(players),'min_ready_to_start':1},access={'required_amount':0})
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
