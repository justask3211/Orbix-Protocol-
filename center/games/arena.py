"""Small authoritative movement arenas. Rendering and contracts live elsewhere.

30Hz bounded simulation, timed input leases, server pickup/combat checks, seeded
drops, no client positions/scores. Old lane/raid rooms retain their own engines.
"""
from __future__ import annotations

from copy import deepcopy
import math

from center.games.base import ActionResult, Engine

STEP = 1 / 30
CHARACTERS = ('fox', 'robot', 'frog', 'cat')
WEAPONS = {'hands': (1.8, 8), 'sword': (2.6, 16), 'spear': (3.8, 12), 'gun': (12, 12)}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class ArenaEngine(Engine):
    version = 2
    arena = True
    width, depth, speed = 20, 16, 4.5

    def __init__(self, config, round_id, seed, participants):
        super().__init__(config, round_id, seed, participants)
        self.rules = config.rules
        self.started_at = self.last_tick = 0.0
        self.bodies, self.inputs, self.teams = {}, {}, {}
        self.drops, self.crates, self.projectiles, self.events = [], [], [], []
        self.damage = {p: 0 for p in participants}
        self.boss = None
        self.next_drop = 0
        self.next_boss_attack = 4000
        self.event_id = self.object_id = self.tick_id = 0
        self.winner = self.winning_team = None
        self.suspended = set()

    def start(self, now=0.0):
        if len(self.participants) > 50 or (self.template_id == 'combat-duel' and len(self.participants) != 2):
            raise ValueError('INVALID_ARENA_PLAYER_COUNT')
        self.started_at = self.last_tick = now
        health = getattr(self.rules, 'starting_health', 100)
        for i, who in enumerate(self.participants):
            angle = i * math.tau / max(1, len(self.participants))
            self.bodies[who] = dict(x=round(math.sin(angle)*6, 4), z=round(math.cos(angle)*5, 4),
                yaw=angle+math.pi, hp=health, maxHp=health, score=0, character=CHARACTERS[i%4],
                weapon='hands', weaponUses=0, shieldUntil=0, stunnedUntil=0, respawnAt=0,
                blocking=False, pushCharges=0, pushReadyAt=0, attackReadyAt=0, inputSeq=0,
                controlReadyAt=0, equipReadyAt=0,
                speed=self.speed, team=self.teams.get(who), moving=False)
        if self.template_id == 'boss-raid':
            self.boss = dict(x=0, z=0, hp=self.rules.boss_health, maxHp=self.rules.boss_health,
                phase='idle', attackAt=0, attackX=0, attackZ=0)
        self.crates = [dict(id=f'crate-{i}', x=x, z=z, hp=30) for i,(x,z) in enumerate(
            [(-6,-4),(6,-4),(-6,4),(6,4),(-2,5),(2,-5)])]
        # Weapons visible at spawn let players start moving/fighting immediately.
        if self.template_id != 'token-catch':
            for kind,x,z in [('sword',-3,0),('spear',3,0),('gun',0,-5),('shield',0,5)]:
                self._drop(kind,x,z,0,0)

    def _event(self, kind, who=None, target=None, x=0, z=0):
        self.event_id += 1
        self.events.append(dict(id=self.event_id, kind=kind, who=who, target=target,
            x=round(x,3), z=round(z,3), at=self.elapsed))
        self.events = self.events[-40:]

    @property
    def elapsed(self):
        return max(0, int((self.last_tick-self.started_at)*1000))

    def _drop(self, kind, x, z, at, fall=1000, value=1):
        self.object_id += 1
        self.drops.append(dict(id=f'drop-{self.object_id}', kind=kind, x=round(x,3),z=round(z,3),
            spawnAt=at, landAt=at+fall, expiresAt=at+fall+15000, value=value))
        # Bound abandoned items independently of match length and player count.
        self.drops = self.drops[-150:]

    def _scatter(self, who):
        body = self.bodies[who]
        loss = body['score']//2
        body['score'] -= loss
        if not loss:
            return
        count = min(16, loss)
        for i in range(count):
            angle = i*math.tau/count
            self._drop('coin', self._clamp(body['x']+math.sin(angle)*1.6, self.width),
                self._clamp(body['z']+math.cos(angle)*1.6,self.depth), self.elapsed, 500,
                loss//count+(1 if i < loss%count else 0))
        self._event('scatter', who, x=body['x'],z=body['z'])

    @staticmethod
    def _clamp(value, dimension):
        return max(-dimension/2+.55, min(dimension/2-.55,value))

    @staticmethod
    def _distance(a,b):
        return math.hypot(a['x']-b['x'], a['z']-b['z'])

    def _alive(self, who, now_ms):
        body = self.bodies[who]
        return who not in self.suspended and body['hp'] > 0 and body['respawnAt'] <= now_ms

    def _hurt(self, target, damage, attacker=None, *, scatter=True, falling=False):
        body = self.bodies[target]
        if falling:
            damage=body['hp']
        elif body['shieldUntil'] > self.last_tick*1000:
            damage = max(1,damage//4)
        elif body['blocking']:
            damage = max(1,damage*2//5)
        dealt = min(body['hp'], damage)
        body['hp'] -= dealt
        if attacker:
            self.damage[attacker] += dealt
        self._event('hit',attacker,target,body['x'],body['z'])
        if body['hp'] <= 0:
            self._event('knockout',attacker,target,body['x'],body['z'])
            if self.template_id == 'combat-duel':
                self.finished = True
                self.winner = attacker if attacker and attacker != target else None
            else:
                if self.template_id == 'token-catch' and scatter:
                    self._scatter(target)
                body['respawnAt'] = int(self.last_tick*1000)+2200
                body['weapon'], body['weaponUses'], body['blocking'] = 'hands',0,False
                self.inputs.pop(target,None)

    def _can_walk(self, x,z):
        return not any(c['hp']>0 and abs(x-c['x'])<.85 and abs(z-c['z'])<.85 for c in self.crates) and not (
            self.boss and self.boss['hp']>0 and math.hypot(x,z)<1.6)

    def _step(self):
        now_ms = self.last_tick*1000
        elapsed = self.elapsed
        self.tick_id += 1
        for who, body in self.bodies.items():
            if who in self.suspended:
                body['moving'] = False
                continue
            if body['respawnAt'] and now_ms >= body['respawnAt']:
                body['hp'],body['respawnAt'] = body['maxHp'],0
                body['x'],body['z'] = 0,6
                body['stunnedUntil'] = int(now_ms)+500
                self._event('respawn',who,x=body['x'],z=body['z'])
            inp = self.inputs.get(who,{})
            active = self._alive(who,now_ms) and body['stunnedUntil'] <= now_ms and inp.get('until',0)>now_ms
            dx,dz = (inp.get('dx',0),inp.get('dz',0)) if active else (0,0)
            body['moving'] = bool(dx or dz)
            scale = self.speed*STEP*(.5 if body['blocking'] else 1)
            x,z = self._clamp(body['x']+dx*scale,self.width),self._clamp(body['z']+dz*scale,self.depth)
            if self._can_walk(x,body['z']): body['x'] = x
            if self._can_walk(body['x'],z): body['z'] = z
            if not self._alive(who,now_ms): continue
            for drop in list(self.drops):
                if drop['landAt']>elapsed or drop['expiresAt']<=elapsed or self._distance(body,drop)>.8:
                    continue
                self.drops.remove(drop)
                kind = drop['kind']
                if kind=='coin': body['score']+=drop['value']
                elif kind=='bomb':
                    if self.template_id=='token-catch': self._scatter(who)
                    body['stunnedUntil']=int(now_ms)+1000
                    self._hurt(who,12,scatter=False)
                elif kind=='push': body['pushCharges']=min(3,body['pushCharges']+1)
                elif kind=='shield': body['shieldUntil']=int(now_ms)+6000
                elif kind=='heal': body['hp']=min(body['maxHp'],body['hp']+30)
                elif kind in WEAPONS:
                    body['weapon'],body['weaponUses']=kind,15
                self._event('pickup-'+kind,who,x=drop['x'],z=drop['z'])
        self.drops=[d for d in self.drops if d['expiresAt']>elapsed]
        if elapsed>=self.next_drop and len(self.drops)<120:
            rate=getattr(self.rules,'spawn_per_second',2)
            self.next_drop=elapsed+int(1000/rate)
            chance=self.rng.below(100)
            if self.template_id=='token-catch':
                hazard=getattr(self.rules,'hazard_chance_pct',10)
                kind='bomb' if chance<hazard else 'push' if chance< hazard+10 else 'shield' if chance< hazard+15 else 'coin'
            else: kind=self.rng.choice(['heal','shield','sword','spear','gun'])
            self._drop(kind,self.rng.between(-85,85)/10,self.rng.between(-65,65)/10,elapsed)
        self._advance_projectiles()
        if self.boss and self.boss['hp']>0:
            if self.boss['phase']=='windup' and elapsed>=self.boss['attackAt']:
                spot={'x':self.boss['attackX'],'z':self.boss['attackZ']}
                for who,body in self.bodies.items():
                    if self._alive(who,now_ms) and self._distance(body,spot)<2:
                        self._hurt(who,25)
                        body['stunnedUntil']=int(now_ms)+450
                self._event('boss-slam',x=spot['x'],z=spot['z'])
                self.boss['phase']='idle'
            if elapsed>=self.next_boss_attack:
                active=[p for p in self.participants if self._alive(p,now_ms)]
                if active:
                    target=self.bodies[self.rng.choice(active)]
                    self.boss.update(phase='windup',attackAt=elapsed+1200,attackX=target['x'],attackZ=target['z'])
                self.next_boss_attack=elapsed+4500
        if elapsed>=self.rules.duration_seconds*1000 or (self.boss and self.boss['hp']<=0):
            self._finish()

    def _advance_projectiles(self):
        keep=[]
        for bullet in self.projectiles:
            if bullet['who'] in self.suspended:continue
            bullet['x']+=math.sin(bullet['yaw'])*12*STEP
            bullet['z']+=math.cos(bullet['yaw'])*12*STEP
            if self.elapsed>=bullet['expiresAt'] or abs(bullet['x'])>10 or abs(bullet['z'])>8: continue
            crate=next((c for c in self.crates if c['hp']>0 and self._distance(c,bullet)<.7),None)
            if crate:
                crate['hp']=max(0,crate['hp']-bullet['damage'])
                if not crate['hp']:
                    self._drop(self.rng.choice(['gun','sword','spear','shield','heal','push']),crate['x'],crate['z'],self.elapsed,0)
                    self._event('crate-break',bullet['who'],x=crate['x'],z=crate['z'])
                continue
            if self.boss and self._distance(self.boss,bullet)<1.5:
                self._boss_damage(bullet['who'],bullet['damage']);continue
            hit=False
            if self.template_id=='combat-duel':
                for target,body in self.bodies.items():
                    if target!=bullet['who'] and self._alive(target,self.last_tick*1000) and self._distance(body,bullet)<.65:
                        self._hurt(target,bullet['damage'],bullet['who']);hit=True;break
            if not hit: keep.append(bullet)
        self.projectiles=keep[-100:]

    def _boss_damage(self,who,amount):
        allowance=max(0,self.rules.contribution_cap-self.damage[who])
        actual=min(amount,self.boss['hp'],allowance)
        self.damage[who]+=actual
        self.boss['hp']-=actual
        self._event('boss-hit',who,x=0,z=0)
        if self.boss['hp']<=0:self._finish()

    def _finish(self):
        self.finished=True
        if self.template_id=='boss-raid':
            damage=self.team_damage()
            best=max(damage.values(),default=0)
            leaders=[team for team,total in damage.items() if total==best]
            self.winning_team=leaders[0] if best>0 and len(leaders)==1 else None
        elif self.template_id=='combat-duel' and not self.winner:
            health={p:b['hp'] for p,b in self.bodies.items() if p not in self.suspended}
            highest=max(health.values(),default=0)
            leaders=[p for p,hp in health.items() if hp==highest]
            self.winner=leaders[0] if len(leaders)==1 and self.damage[leaders[0]]>0 else None

    def advance(self, now):
        if self.finished:return
        if not finite(now) or now<self.last_tick:return
        # Recovery pauses movement input; wall-clock deadlines still expire the game.
        if now-self.last_tick>2:
            self.inputs.clear()
            self.last_tick=now-min(.25,now-self.last_tick)
        steps=min(60,int((now-self.last_tick+1e-8)/STEP))
        for _ in range(steps):
            self.last_tick+=STEP
            self._step()
            if self.finished:break

    def tick(self,now):
        self.advance(now)
        return ActionResult(True,finished=self.finished)

    def act(self,who,action,now):
        if not isinstance(action,dict) or who not in self.bodies:return ActionResult(False,'NOT_ADMITTED')
        if self.finished:return ActionResult(False,'ROUND_NOT_OPEN')
        self.advance(now)
        if self.finished:return ActionResult(False,'ROUND_NOT_OPEN',finished=True)
        body=self.bodies[who]
        if who in self.suspended:return ActionResult(False,'PLAYER_SUSPENDED')
        kind=action.get('kind')
        if kind=='equip':
            character=action.get('character')
            if character not in CHARACTERS:return ActionResult(False,'UNKNOWN_CHARACTER')
            if character==body['character']:return ActionResult(False,'NO_CHANGE')
            if body.get('equipReadyAt',0)>now*1000:return ActionResult(False,'CONTROL_RATE_LIMIT')
            body['equipReadyAt']=int(now*1000)+250
            body['character']=character
            return ActionResult(True)
        if not self._alive(who,now*1000):return ActionResult(False,'RESPAWNING')
        if kind=='move':
            dx,dz,seq=action.get('dx'),action.get('dz'),action.get('seq')
            if not finite(dx) or not finite(dz) or abs(dx)>1 or abs(dz)>1:return ActionResult(False,'INVALID_DIRECTION')
            if not isinstance(seq,int) or isinstance(seq,bool) or not 0<seq<2**53:return ActionResult(False,'INVALID_INPUT_SEQUENCE')
            if seq<=body['inputSeq']:return ActionResult(False,'STALE_INPUT')
            yaw=action.get('yaw')
            if yaw is not None and (not finite(yaw) or abs(yaw)>math.tau*2):return ActionResult(False,'INVALID_FACING')
            prior=self.inputs.get(who,{})
            stopping=dx==0 and dz==0 and (prior.get('dx',0)!=0 or prior.get('dz',0)!=0)
            if not stopping and now*1000-prior.get('at',-1000)<35:return ActionResult(False,'INPUT_RATE_LIMIT')
            norm=max(1,math.hypot(dx,dz))
            self.inputs[who]=dict(dx=dx/norm,dz=dz/norm,at=now*1000,until=now*1000+250)
            body['inputSeq']=seq
            if yaw is not None:body['yaw']=yaw
            elif dx or dz:body['yaw']=math.atan2(dx,dz)
            return ActionResult(True)
        if kind=='block':
            if not isinstance(action.get('active'),bool):return ActionResult(False,'INVALID_BLOCK')
            if action['active']==body['blocking']:return ActionResult(False,'NO_CHANGE')
            if action['active'] and body.get('controlReadyAt',0)>now*1000:return ActionResult(False,'CONTROL_RATE_LIMIT')
            if action['active']:body['controlReadyAt']=int(now*1000)+100
            body['blocking']=action['active'];return ActionResult(True)
        if body['stunnedUntil']>now*1000:return ActionResult(False,'STUNNED')
        if kind=='push':
            if body['pushCharges']<=0:return ActionResult(False,'NO_PUSH_POWER')
            if body['pushReadyAt']>now*1000:return ActionResult(False,'COOLDOWN')
            body['pushCharges']-=1;body['pushReadyAt']=int(now*1000)+1200
            for target,other in self.bodies.items():
                if target==who or not self._alive(target,now*1000) or self._distance(body,other)>2.5:continue
                dx,dz=other['x']-body['x'],other['z']-body['z'];dist=math.hypot(dx,dz)
                if dist<.01:dx,dz,dist=math.sin(body['yaw']),math.cos(body['yaw']),1
                x,z=other['x']+dx/dist*3,other['z']+dz/dist*3
                other['stunnedUntil']=int(now*1000)+900
                self.inputs.pop(target,None)
                if abs(x)>10 or abs(z)>8:
                    self._hurt(target,other['hp'],who if self.template_id=='combat-duel' else None,falling=True)
                else:
                    other['x'],other['z']=x,z
                self._event('push',who,target,other['x'],other['z'])
            return ActionResult(True,finished=self.finished)
        if kind not in {'attack','interact'}:return ActionResult(False,'UNKNOWN_ACTION')
        if body['attackReadyAt']>now*1000:return ActionResult(False,'COOLDOWN')
        body['attackReadyAt']=int(now*1000)+getattr(self.rules,'attack_cooldown_ms',getattr(self.rules,'action_cooldown_ms',500))
        weapon=body['weapon'];reach,damage=WEAPONS[weapon]
        self._event('attack',who,x=body['x'],z=body['z'])
        for crate in self.crates:
            if crate['hp']>0 and self._distance(body,crate)<2.5 and (not action.get('crateId') or action['crateId']==crate['id']):
                crate['hp']=max(0,crate['hp']-15)
                if not crate['hp']:
                    self._drop(self.rng.choice(['gun','sword','spear','shield','heal','push']),crate['x'],crate['z'],self.elapsed,0)
                    self._event('crate-break',who,x=crate['x'],z=crate['z'])
                return ActionResult(True)
        if kind=='interact':return ActionResult(False,'NO_CRATE_IN_REACH')
        if weapon=='gun':
            self.object_id+=1
            self.projectiles.append(dict(id=f'bullet-{self.object_id}',who=who,x=body['x'],z=body['z'],yaw=body['yaw'],damage=damage,expiresAt=self.elapsed+1000))
        else:
            if self.boss and self._distance(body,self.boss)<=reach+1 and self._facing(body,self.boss):self._boss_damage(who,damage)
            elif self.template_id=='combat-duel':
                for target,other in self.bodies.items():
                    if target!=who and self._alive(target,now*1000) and self._distance(body,other)<=reach and self._facing(body,other):
                        self._hurt(target,damage,who);break
        if weapon!='hands':
            body['weaponUses']-=1
            if body['weaponUses']<=0:body['weapon']='hands'
        return ActionResult(True,finished=self.finished)

    @staticmethod
    def _facing(body,target):
        dx,dz=target['x']-body['x'],target['z']-body['z'];dist=math.hypot(dx,dz)
        return dist<.01 or (math.sin(body['yaw'])*dx+math.cos(body['yaw'])*dz)/dist>=.35

    def team_damage(self):
        teams=set(self.teams.values())
        return {team:sum(self.damage[p] for p in self.participants if self.teams.get(p)==team) for team in sorted(teams)}

    def scores(self):
        return {p:self.bodies[p]['score'] if self.template_id=='token-catch' else self.damage[p] for p in self.participants}

    def ranking(self):
        scores=self.scores()
        return sorted(self.participants,key=lambda p:(-scores[p],p))

    def eligible(self):
        if not self.finished:return set()
        if self.template_id=='combat-duel':return {self.winner} if self.winner and self.winner not in self.suspended else set()
        if self.template_id=='boss-raid':
            return {p for p in self.participants if p not in self.suspended and self.teams.get(p)==self.winning_team and self.damage[p]>=self.rules.min_contribution} if self.winning_team else set()
        allowed=[p for p in self.ranking() if p not in self.suspended and self.bodies[p]['score']>=self.rules.win_threshold]
        return set(allowed[:self.rules.top_n])

    def public_state(self):
        # Copies prevent queued snapshots being mutated by the next tick.
        return deepcopy(dict(template=self.template_id,arena=True,arenaKind=self.template_id,bounds=dict(width=self.width,depth=self.depth),
            nowMs=self.elapsed,serverTimeMs=int(self.last_tick*1000),startedAt=self.started_at,
            duration=self.rules.duration_seconds,tick=self.tick_id,players=self.participants,bodies=self.bodies,
            drops=self.drops,crates=self.crates,projectiles=self.projectiles,events=self.events,
            teams=self.teams,teamDamage=self.team_damage(),boss=self.boss,finished=self.finished,
            scores=self.scores(),winner=self.winner,winningTeam=self.winning_team,
            weaponCooldownMs=getattr(self.rules,'attack_cooldown_ms',getattr(self.rules,'action_cooldown_ms',500)),
            minContribution=getattr(self.rules,'min_contribution',0),winThreshold=getattr(self.rules,'win_threshold',0)))

    def snapshot(self):
        return deepcopy(dict(participants=self.participants,started_at=self.started_at,last_tick=self.last_tick,
            bodies=self.bodies,inputs=self.inputs,teams=self.teams,drops=self.drops,crates=self.crates,
            projectiles=self.projectiles,events=self.events,damage=self.damage,boss=self.boss,
            next_drop=self.next_drop,next_boss_attack=self.next_boss_attack,event_id=self.event_id,
            object_id=self.object_id,tick_id=self.tick_id,winner=self.winner,winning_team=self.winning_team,
            suspended=sorted(self.suspended),finished=self.finished,
            rng_counter=self.rng._counter,rng_buf=self.rng._buf.hex()))

    def _load(self,snapshot):
        data=deepcopy(snapshot)
        self.rng._counter=data.pop('rng_counter')
        self.rng._buf=bytes.fromhex(data.pop('rng_buf'))
        self.suspended=set(data.pop('suspended',[]))
        for key,value in data.items():setattr(self,key,value)


class CatchArenaEngine(ArenaEngine):
    template_id='token-catch'


class BossArenaEngine(ArenaEngine):
    template_id='boss-raid'


class CombatDuelEngine(ArenaEngine):
    template_id='combat-duel'
