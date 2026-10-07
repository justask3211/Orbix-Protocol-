"""Version-three character arenas: authoritative locomotion, loot and combat.

The older ArenaEngine remains the reducer for committed version-two rooms.
All positions, inventory, airdrop conservation and reward allocations are server-owned.
"""
from __future__ import annotations

from copy import deepcopy
import math

from center.games.arena import ArenaEngine, STEP, WEAPONS, finite
from center.games.base import ActionResult, Entitlement


class FieldArenaEngine(ArenaEngine):
    version = 3
    width, depth, speed = 40, 40, 5.0

    def __init__(self, *args):
        super().__init__(*args)
        self.obstacles, self.airdrops, self.attacks = [], [], []
        self.drop_index = self.dropped_value = 0
        self.next_upgrade = 0
        self.upgrade_phase = 0
        self.spawn_points = {}
        self.attack_index = 0

    @property
    def elapsed(self):
        # Fixed steps accumulate binary float error; exact deadlines remain exact.
        return max(0,int((self.last_tick-self.started_at)*1000+1e-5))

    def start(self, now=0.0):
        super().start(now)
        self.drops, self.crates = [], []
        self.obstacles = [dict(id=f'cover-{i}', x=x, z=z, width=w, depth=d,
                               height=h, kind=kind) for i,(x,z,w,d,h,kind) in enumerate([
            (-9,-7,4,2,1.2,'cover'), (9,7,4,2,1.2,'cover'),
            (-10,9,2,3,2.4,'rock'), (10,-9,2,3,2.4,'rock'),
            (-4,-12,4,2,2.8,'bunker'), (4,12,4,2,2.8,'bunker')])]
        self.crates = [dict(id=f'crate-{i}', x=x, z=z, hp=40) for i,(x,z) in enumerate([
            (-13,-3),(13,3),(-3,13),(3,-13),(-7,5),(7,-5)])]
        crew_ids = sorted(set(self.teams.values()))
        crew_counts = {}
        for i, (who,body) in enumerate(self.bodies.items()):
            if self.template_id == 'token-catch':
                x,z=(i%8-3.5)*.9, 15+(i//8)*.5
            elif self.template_id == 'boss-raid':
                team = self.teams.get(who)
                angle = crew_ids.index(team)*math.tau/max(1,len(crew_ids)) if team in crew_ids else i*math.tau/len(self.bodies)
                j=crew_counts.get(team,0);crew_counts[team]=j+1
                x,z=math.sin(angle)*14+(j%3-1)*.9, math.cos(angle)*14+(j//3)*.8
            else:
                x,z=0, (-5 if i else 5)
            body.update(x=x,z=z,y=0.,vy=0.,yaw=math.atan2(-x,-z),aimPitch=0.,
                        speed=self.speed,sprinting=False,downedUntil=0,jumpReadyAt=0,
                        dodgeReadyAt=0,dodgeUntil=0,weaponLevel=0,lastAttackAt=0,
                        lastAttackStyle='light',combo=0,comboUntil=0,lootReadyAt=0)
            self.spawn_points[who]={'x':x,'z':z}
            if self.template_id == 'boss-raid':
                body.update(weapon='gun',weaponUses=-1)
        if self.template_id == 'token-catch':
            self.next_drop=3000
        else:
            for kind,x,z in [('sword',-3,3),('spear',3,-3),('shield',-3,-3),('heal',3,3)]:
                self._drop(kind,x,z,0,0)
            if self.template_id=='combat-duel' and self.rules.allow_guns:self._drop('gun',0,-8,0,0)
        self.next_upgrade=getattr(self.rules,'upgrade_interval_seconds',30)*1000
        if self.boss:
            self.boss.update(attackKind='slam',radius=3)

    def _drop(self,kind,x,z,at,fall=0,value=1,source_id=None):
        self.object_id+=1
        item=dict(id=f'drop-{self.object_id}',kind=kind,x=round(x,3),z=round(z,3),
                  spawnAt=at,landAt=at+fall,expiresAt=self.rules.duration_seconds*1000+1000,
                  value=value,sourceId=source_id)
        self.drops.append(item)
        return item

    def _scatter(self,who):
        body=self.bodies[who];loss=body['score']//2;body['score']-=loss
        if not loss:return
        count=min(16,loss,max(1,450-len(self.drops)))
        if len(self.drops)>=450:
            nearest=min((d for d in self.drops if d['kind']=='coin'),key=lambda d:self._distance(body,d),default=None)
            if nearest:
                nearest['value']+=loss;self._event('scatter',who,x=body['x'],z=body['z']);return
        for i in range(count):
            angle=i*math.tau/count
            self._drop('coin',self._clamp(body['x']+math.sin(angle)*1.5,self.width),
                       self._clamp(body['z']+math.cos(angle)*1.5,self.depth),self.elapsed,400,
                       loss//count+(1 if i<loss%count else 0))
        self._event('scatter',who,x=body['x'],z=body['z'])

    def _can_walk_body(self,x,z,body):
        if any(c['hp']>0 and body.get('y',0)<1.1 and abs(x-c['x'])<.85 and abs(z-c['z'])<.85 for c in self.crates):return False
        if self.boss and self.boss['hp']>0 and math.hypot(x,z)<1.8:return False
        return not any(body.get('y',0)<o['height'] and abs(x-o['x'])<o['width']/2+.32
                       and abs(z-o['z'])<o['depth']/2+.32 for o in self.obstacles)

    @staticmethod
    def _segment_rect(a,b,obstacle,padding=0):
        """Slab intersection, also used for cover line-of-sight; no tunnelling."""
        enter,leave=0.,1.
        for axis,size in (('x','width'),('z','depth')):
            lo=obstacle[axis]-obstacle[size]/2-padding
            hi=obstacle[axis]+obstacle[size]/2+padding
            step=b[axis]-a[axis]
            if abs(step)<1e-9:
                if not lo<=a[axis]<=hi:return False
            else:
                near,far=sorted(((lo-a[axis])/step,(hi-a[axis])/step))
                enter=max(enter,near);leave=min(leave,far)
                if enter>leave:return False
        return True

    def _clear_line(self,a,b):
        # Loot and melee cannot reach through walls. Low cover can be jumped over.
        height=min(a.get('y',0),b.get('y',0))+.9
        return not any(o['height']>height and self._segment_rect(a,b,o) for o in self.obstacles)

    def _schedule_airdrops(self):
        budget,count=self.rules.loot_budget,self.rules.airdrop_count
        end=self.rules.duration_seconds*1000
        while self.drop_index<count:
            index=self.drop_index
            land=int((index+1)*(end-6000)/count)
            spawn=max(0,land-2500)
            if self.elapsed<spawn:break
            value=budget//count+(1 if index<budget%count else 0)
            self.object_id+=1
            # Locations are generated at spawn, so public state never leaks future sites.
            x,z=self.rng.between(-150,150)/10,self.rng.between(-150,150)/10
            for _ in range(20):
                # Leave room for the loot ring: an open crate must not create
                # permanently unreachable piles inside neighbouring cover.
                if self._can_walk_body(x,z,{'y':0}) and all(
                    self._can_walk_body(x+math.sin(i*math.tau/8)*1.3,z+math.cos(i*math.tau/8)*1.3,{'y':0})
                    for i in range(8)):break
                x,z=self.rng.between(-150,150)/10,self.rng.between(-150,150)/10
            else:x,z=0,0
            self.airdrops.append(dict(id=f'airdrop-{self.object_id}',x=x,z=z,spawnAt=spawn,
                                     landAt=land,opened=False,coinValue=value))
            self.dropped_value+=value;self.drop_index+=1
            self._event('airdrop-inbound',x=x,z=z)

    def _open_airdrop(self,who,identifier):
        body=self.bodies[who]
        crate=next((a for a in self.airdrops if a['id']==identifier),None)
        if not crate:return ActionResult(False,'NO_AIRDROP')
        if crate['landAt']>self.elapsed:return ActionResult(False,'AIRDROP_NOT_LANDED')
        if crate['opened']:return ActionResult(False,'AIRDROP_ALREADY_OPEN')
        if self._distance(body,crate)>3 or not self._clear_line(body,crate):return ActionResult(False,'LOOT_OUT_OF_REACH')
        crate['opened']=True
        remaining=crate['coinValue'];index=0
        while remaining:
            value=min(self.rules.loot_chunk,remaining);remaining-=value
            angle=index*2.39996;radius=.25+min(.95,math.sqrt(index)*.18)
            self._drop('coin',crate['x']+math.sin(angle)*radius,crate['z']+math.cos(angle)*radius,
                       self.elapsed,0,value,crate['id']);index+=1
        if self.rng.below(100)<self.rules.hazard_chance_pct:
            self._drop('bomb',crate['x']+.35,crate['z'],self.elapsed,0,source_id=crate['id'])
        if self.rng.below(100)<self.rules.gun_spawn_chance_pct:
            self._drop('gun',crate['x']-.35,crate['z'],self.elapsed,0,source_id=crate['id'])
        self._event('airdrop-open',who,x=crate['x'],z=crate['z'])
        return ActionResult(True)

    def _loot(self,who,identifier,now):
        body=self.bodies[who]
        item=next((d for d in self.drops if d['id']==identifier),None)
        if not item:return ActionResult(False,'LOOT_ALREADY_TAKEN')
        if item['landAt']>self.elapsed:return ActionResult(False,'LOOT_NOT_LANDED')
        if self._distance(body,item)>3 or abs(body['y'])>2 or not self._clear_line(body,item):return ActionResult(False,'LOOT_OUT_OF_REACH')
        if body['lootReadyAt']>now*1000:return ActionResult(False,'LOOT_COOLDOWN')
        body['lootReadyAt']=int(now*1000)+100
        self.drops.remove(item)
        kind=item['kind']
        if kind=='coin':body['score']+=item['value']
        elif kind=='bomb':
            self._scatter(who);body['stunnedUntil']=int(now*1000)+2000
        elif kind=='shield':body['shieldUntil']=int(now*1000)+7000
        elif kind=='heal':body['hp']=min(body['maxHp'],body['hp']+35)
        elif kind=='push':body['pushCharges']=min(3,body['pushCharges']+1)
        elif kind=='upgrade':
            body['weaponLevel']=min(4,body['weaponLevel']+1)
            if self.template_id=='boss-raid':body.update(weapon='gun',weaponUses=-1)
        elif kind in WEAPONS:
            body['weapon']=kind
            body['weaponUses']=-1 if self.template_id=='boss-raid' else getattr(self.rules,'gun_shots',5) if kind=='gun' else 30
        self._event('pickup-'+kind,who,x=item['x'],z=item['z'])
        return ActionResult(True)

    def _down(self,target,seconds,attacker=None):
        body=self.bodies[target];body['hp']=0
        body['respawnAt']=body['downedUntil']=int(self.last_tick*1000)+seconds*1000
        body['blocking']=False;body['moving']=False;body['y']=body['vy']=0
        self.inputs.pop(target,None)
        self._event('knockout',attacker,target,body['x'],body['z'])

    def _hurt(self,target,damage,attacker=None,**kwargs):
        if self.bodies[target].get('dodgeUntil',0)>self.last_tick*1000:return
        if self.template_id=='token-catch':
            if self.bodies[target]['shieldUntil']>self.last_tick*1000:return
            self._down(target,self.rules.gun_knockout_seconds,attacker)
            return
        super()._hurt(target,damage,attacker,**kwargs)
        if self.template_id=='boss-raid' and self.bodies[target]['hp']<=0:
            self._down(target,self.rules.knockout_seconds,attacker)

    def _step(self):
        now_ms=self.last_tick*1000;self.tick_id+=1
        for who,body in self.bodies.items():
            if who in self.suspended:body['moving']=False;continue
            if body['respawnAt'] and now_ms>=body['respawnAt']:
                body.update(hp=body['maxHp'],respawnAt=0,downedUntil=0,y=0.,vy=0.,blocking=False)
                spawn=self.spawn_points[who];body.update(x=spawn['x'],z=spawn['z'],stunnedUntil=int(now_ms)+400)
                self._event('respawn',who,x=body['x'],z=body['z'])
            active=self._alive(who,now_ms) and body['stunnedUntil']<=now_ms
            inp=self.inputs.get(who,{})
            leased=active and inp.get('until',0)>now_ms
            dx,dz=(inp.get('dx',0),inp.get('dz',0)) if leased else (0,0)
            body['moving']=bool(dx or dz)
            body['sprinting']=bool(leased and inp.get('sprint') and not body['blocking'])
            if active and (body['y']>0 or body['vy']>0):
                body['vy']-=18*STEP;body['y']=max(0,body['y']+body['vy']*STEP)
                if body['y']==0:body['vy']=0
            if active:
                scale=STEP*(8 if body['sprinting'] else self.speed)*(.5 if body['blocking'] else 1)
                x,z=self._clamp(body['x']+dx*scale,self.width),self._clamp(body['z']+dz*scale,self.depth)
                if self._can_walk_body(x,body['z'],body):body['x']=x
                if self._can_walk_body(body['x'],z,body):body['z']=z
                # A jump cannot finish inside a collider after clearing its top.
                if not self._can_walk_body(body['x'],body['z'],body):
                    for obstacle in self.obstacles:
                        if abs(body['x']-obstacle['x'])<obstacle['width']/2+.32 and abs(body['z']-obstacle['z'])<obstacle['depth']/2+.32:
                            body['y']=obstacle['height'];body['vy']=0
        if self.template_id=='token-catch':
            self._schedule_airdrops()
        if self.elapsed>=self.next_drop:
            self.next_drop=self.elapsed+7000
            kind=self.rng.choice(['gun','shield','heal']) if self.template_id=='token-catch' else self.rng.choice(['heal','shield','upgrade'] if self.boss else ['heal','shield','sword','spear'])
            if self.template_id=='combat-duel' and self.rules.allow_guns and self.rng.below(100)<30:kind='gun'
            if len(self.drops)<440 and (kind!='gun' or self.template_id!='token-catch' or self.rng.below(100)<self.rules.gun_spawn_chance_pct):
                x,z=self.rng.between(-160,160)/10,self.rng.between(-160,160)/10
                if self._can_walk_body(x,z,{'y':0}):self._drop(kind,x,z,self.elapsed,1500)
        self._advance_projectiles()
        if self.boss and self.boss['hp']>0:
            self._boss_attacks()
            phase=min(3,int((1-self.boss['hp']/self.boss['maxHp'])*4))
            if self.elapsed>=self.next_upgrade or phase>self.upgrade_phase:
                self.upgrade_phase=max(phase,self.upgrade_phase)
                self.next_upgrade=self.elapsed+self.rules.upgrade_interval_seconds*1000
                for index in range(min(max(3,min(12,len(self.bodies))),max(0,450-len(self.drops)))):
                    angle=index*math.tau/max(3,min(12,len(self.bodies)))
                    self._drop('upgrade',math.sin(angle)*7,math.cos(angle)*7,self.elapsed,1000)
                self._event('boss-upgrades',x=0,z=0)
        if self.elapsed>=self.rules.duration_seconds*1000 or self.boss and self.boss['hp']<=0:
            self._finish()

    def _boss_attacks(self):
        for attack in self.attacks:
            if attack.get('resolved') or self.elapsed<attack['hitAt']:continue
            attack['resolved']=True
            for who,body in self.bodies.items():
                if not self._alive(who,self.last_tick*1000):continue
                distance=self._distance(body,attack);kind=attack['kind']
                hit=distance<attack['radius']
                if kind=='wave':hit=distance<attack['radius'] and body['y']<.7
                elif kind=='beam':
                    dx,dz=body['x']-attack['x'],body['z']-attack['z']
                    along=dx*math.sin(attack['yaw'])+dz*math.cos(attack['yaw'])
                    side=abs(dx*math.cos(attack['yaw'])-dz*math.sin(attack['yaw']))
                    hit=0<=along<=attack['radius'] and side<attack['width']/2 and self._clear_line(attack,body)
                if hit:self._hurt(who,attack['damage'])
            self._event('boss-'+attack['kind'],x=attack['x'],z=attack['z'])
        self.attacks=[a for a in self.attacks if a['expiresAt']>self.elapsed]
        self.boss['phase']='windup' if any(not a.get('resolved') for a in self.attacks) else 'idle'
        if self.elapsed<self.next_boss_attack:return
        alive=[p for p in self.participants if self._alive(p,self.last_tick*1000)]
        if not alive:return
        target=self.bodies[self.rng.choice(alive)]
        kind=['slam','wave','beam','meteor'][self.attack_index%4];self.attack_index+=1
        x,z=(0,0) if kind in {'wave','beam'} else (target['x'],target['z'])
        self.object_id+=1
        attack=dict(id=f'boss-attack-{self.object_id}',kind=kind,x=x,z=z,yaw=math.atan2(target['x'],target['z']),
                    radius={'slam':3,'wave':11,'beam':25,'meteor':4}[kind],width=2.5,
                    warnAt=self.elapsed,hitAt=self.elapsed+1800,expiresAt=self.elapsed+2600,
                    damage={'slam':32,'wave':25,'beam':40,'meteor':45}[kind],resolved=False)
        self.attacks.append(attack)
        self.boss.update(phase='windup',attackKind=kind,attackAt=attack['hitAt'],attackX=x,attackZ=z,radius=attack['radius'])
        self.next_boss_attack=self.elapsed+max(3000,6000-self.upgrade_phase*750)

    @staticmethod
    def _segment_distance(a,b,point):
        dx,dz=b['x']-a['x'],b['z']-a['z'];den=dx*dx+dz*dz
        t=max(0,min(1,((point['x']-a['x'])*dx+(point['z']-a['z'])*dz)/den)) if den else 0
        return math.hypot(point['x']-a['x']-t*dx,point['z']-a['z']-t*dz),t

    def _advance_projectiles(self):
        keep=[]
        for bullet in self.projectiles:
            if bullet['who'] in self.suspended:continue
            previous=bullet.copy()
            bullet['x']+=math.sin(bullet['yaw'])*math.cos(bullet.get('pitch',0))*28*STEP
            bullet['z']+=math.cos(bullet['yaw'])*math.cos(bullet.get('pitch',0))*28*STEP
            bullet['y']+=math.sin(bullet.get('pitch',0))*28*STEP
            if self.elapsed>=bullet['expiresAt'] or abs(bullet['x'])>20 or abs(bullet['z'])>20 or bullet['y']<0:continue
            if any(o['height']>min(previous['y'],bullet['y']) and self._segment_rect(previous,bullet,o) for o in self.obstacles):continue
            crate=next((c for c in self.crates if c['hp']>0 and self._segment_distance(previous,bullet,c)[0]<.8 and bullet['y']<1.4),None)
            if crate:
                crate['hp']=max(0,crate['hp']-bullet['damage'])
                if not crate['hp']:
                    self._drop(self.rng.choice(['heal','shield','upgrade'] if self.boss else ['gun','heal','shield']),crate['x'],crate['z'],self.elapsed)
                continue
            if self.boss and self.boss['hp']>0 and self._segment_distance(previous,bullet,self.boss)[0]<1.8 and bullet['y']<4:
                self._boss_damage(bullet['who'],bullet['damage']);continue
            hit=False
            if not self.boss:
                for target,body in self.bodies.items():
                    distance,t=self._segment_distance(previous,bullet,body)
                    y=previous['y']+(bullet['y']-previous['y'])*t
                    if target!=bullet['who'] and self._alive(target,self.last_tick*1000) and distance<.5 and body['y']<=y<=body['y']+1.8:
                        self._hurt(target,bullet['damage'],bullet['who']);hit=True;break
            if not hit:keep.append(bullet)
        self.projectiles=keep[-150:]

    def act(self,who,action,now):
        if not isinstance(action,dict) or who not in self.bodies:return ActionResult(False,'NOT_ADMITTED')
        self.advance(now)
        if self.finished:return ActionResult(False,'ROUND_NOT_OPEN')
        body=self.bodies[who];kind=action.get('kind')
        # Releasing guard is always permitted, including stun and knockout.
        if kind=='block' and action.get('active') is False:
            if body['blocking'] is False:return ActionResult(False,'NO_CHANGE')
            body['blocking']=False;return ActionResult(True)
        if who in self.suspended:return ActionResult(False,'PLAYER_SUSPENDED')
        if kind in {'move','equip','block'}:
            if kind=='move':
                if 'sprint' in action and type(action['sprint']) is not bool:return ActionResult(False,'INVALID_SPRINT')
                pitch=action.get('aimPitch',body['aimPitch'])
                if not finite(pitch) or abs(pitch)>1.1:return ActionResult(False,'INVALID_AIM')
                result=super().act(who,action,now)
                if result.ok:
                    self.inputs[who]['sprint']=bool(action.get('sprint'))
                    body['aimPitch']=pitch
                return result
            return super().act(who,action,now)
        if not self._alive(who,now*1000):return ActionResult(False,'RESPAWNING')
        if body['stunnedUntil']>now*1000:return ActionResult(False,'STUNNED')
        # Aim belongs to the action itself: a coalesced movement packet may follow
        # a shot. Accept angles only, never a client position or hit result.
        if kind in {'attack','punch','push','dodge'}:
            yaw=action.get('yaw',body['yaw']);pitch=action.get('aimPitch',body['aimPitch'])
            if not finite(yaw) or abs(yaw)>math.tau*2:return ActionResult(False,'INVALID_FACING')
            if not finite(pitch) or abs(pitch)>1.1:return ActionResult(False,'INVALID_AIM')
            body.update(yaw=yaw,aimPitch=pitch)
        if kind=='jump':
            on_surface=body['y']==0 or any(abs(body['y']-o['height'])<.01 for o in self.obstacles)
            if not on_surface or body['vy']!=0:return ActionResult(False,'ALREADY_AIRBORNE')
            if body['jumpReadyAt']>now*1000:return ActionResult(False,'COOLDOWN')
            body['vy']=7.5;body['jumpReadyAt']=int(now*1000)+700
            self._event('jump',who,x=body['x'],z=body['z']);return ActionResult(True)
        if kind=='dodge':
            if body['dodgeReadyAt']>now*1000:return ActionResult(False,'COOLDOWN')
            body['dodgeReadyAt']=int(now*1000)+2200;body['dodgeUntil']=int(now*1000)+350
            x=self._clamp(body['x']+math.sin(body['yaw'])*2.2,self.width)
            z=self._clamp(body['z']+math.cos(body['yaw'])*2.2,self.depth)
            if self._can_walk_body(x,z,body) and self._clear_line(body,{'x':x,'z':z,'y':body['y']}):body.update(x=x,z=z)
            self._event('dodge',who,x=body['x'],z=body['z']);return ActionResult(True)
        if kind=='open_airdrop' and self.template_id=='token-catch':return self._open_airdrop(who,action.get('dropId'))
        if kind=='loot':return self._loot(who,action.get('dropId'),now)
        if kind not in {'attack','punch','push','interact'}:return ActionResult(False,'UNKNOWN_ACTION')
        if kind=='push' and body['pushCharges']<=0:return ActionResult(False,'NO_PUSH_POWER')
        if body['attackReadyAt']>now*1000:return ActionResult(False,'COOLDOWN')
        style=action.get('style','light')
        if style not in {'light','heavy','kick'}:return ActionResult(False,'INVALID_ATTACK_STYLE')
        weapon='hands' if kind in {'punch','push'} else body['weapon']
        cooldown=getattr(self.rules,'attack_cooldown_ms',getattr(self.rules,'action_cooldown_ms',500))
        if self.boss:cooldown=max(150,int(cooldown/(1+.15*body['weaponLevel'])))
        if style=='heavy':cooldown=int(cooldown*1.7)
        body['attackReadyAt']=int(now*1000)+cooldown
        body['combo']=min(3,body['combo']+1) if body['comboUntil']>now*1000 else 1
        body['comboUntil']=int(now*1000)+getattr(self.rules,'combo_window_ms',800)
        body['lastAttackAt']=int(now*1000);body['lastAttackStyle']=style if kind=='attack' else 'punch'
        if kind=='push':body['pushCharges']-=1
        reach,damage=WEAPONS[weapon]
        if self.boss and weapon=='gun':damage=int(self.rules.starting_gun_damage*(1+.25*body['weaponLevel']))
        elif not self.boss:damage=int(damage*(1+.15*(body['combo']-1))*(1.7 if style=='heavy' else 1.15 if style=='kick' else 1))
        if style=='kick':reach+=.5
        self._event('attack',who,x=body['x'],z=body['z'])
        if kind=='interact':
            crate=next((c for c in self.crates if c['hp']>0 and self._distance(body,c)<2.5 and self._clear_line(body,c)),None)
            if not crate:return ActionResult(False,'NO_CRATE_IN_REACH')
            crate['hp']=max(0,crate['hp']-20)
            if not crate['hp']:self._drop('upgrade' if self.boss else 'shield',crate['x'],crate['z'],self.elapsed)
            return ActionResult(True)
        if weapon=='gun':
            self.object_id+=1
            self.projectiles.append(dict(id=f'bullet-{self.object_id}',who=who,x=body['x'],z=body['z'],y=body['y']+1.3,
                yaw=body['yaw'],pitch=body['aimPitch'],damage=damage,expiresAt=self.elapsed+1600))
        elif self.boss:
            if self._distance(body,self.boss)<=reach+1 and self._facing(body,self.boss) and self._clear_line(body,self.boss):self._boss_damage(who,damage)
        else:
            for target,other in self.bodies.items():
                if target==who or not self._alive(target,now*1000) or abs(body['y']-other['y'])>1.5:continue
                if self._distance(body,other)<=reach and self._facing(body,other) and self._clear_line(body,other):
                    if self.template_id=='token-catch':
                        if other['shieldUntil']>now*1000 or other['dodgeUntil']>now*1000:continue
                        other['stunnedUntil']=int(now*1000)+self.rules.punch_stun_seconds*1000
                        self.inputs.pop(target,None)
                        x=self._clamp(other['x']+math.sin(body['yaw'])*1.5,self.width)
                        z=self._clamp(other['z']+math.cos(body['yaw'])*1.5,self.depth)
                        if self._can_walk_body(x,z,other):other.update(x=x,z=z)
                        self._event('punch',who,target,other['x'],other['z'])
                    else:self._hurt(target,damage,who)
                    break
        if weapon!='hands' and body['weaponUses']>0:
            body['weaponUses']-=1
            if body['weaponUses']==0:body['weapon']='hands'
        return ActionResult(True,finished=self.finished)

    def team_rankings(self):
        totals=self.team_damage();positive={t:d for t,d in totals.items() if d>0}
        shares=self.rules.team_reward_shares if self.boss else []
        out=[];position=0
        for damage in sorted(set(positive.values()),reverse=True):
            tied=sorted(t for t,d in positive.items() if d==damage)
            numerator=sum(shares[position:position+len(tied)])
            denominator=len(tied)
            share=numerator/denominator
            for team in tied:out.append(dict(team=team,rank=position+1,damage=damage,rewardShare=share,
                                            shareNumerator=numerator,shareDenominator=denominator,eligible=share>0))
            position+=len(tied)
        return out

    def eligible(self):
        if not self.finished:return set()
        if self.template_id=='token-catch':return {p for p,b in self.bodies.items() if p not in self.suspended and b['score']>0}
        if self.boss:
            teams={r['team'] for r in self.team_rankings() if r['eligible']}
            return {p for p in self.participants if p not in self.suspended and self.teams.get(p) in teams and self.damage[p]>=self.rules.min_contribution}
        return super().eligible()

    def entitlements(self):
        if not self.finished:return []
        if self.template_id=='combat-duel':return super().entitlements()
        funded=self.config.rewards.kind=='funded-assets'
        pool=sum(s.amount if funded else s.points for s in self.config.rewards.slots)
        eligible=self.eligible();amounts={}
        if self.template_id=='token-catch':
            for p in sorted(eligible):amounts[p]=pool*self.bodies[p]['score']//self.rules.loot_budget
        else:
            # Shares include tied positions, split without selecting a wallet by luck.
            for row in self.team_rankings():
                members=sorted(p for p in eligible if self.teams.get(p)==row['team'])
                if not members:continue
                team_pool=pool*row['shareNumerator']//(100*row['shareDenominator'])
                weights={p:self.damage[p] if self.rules.team_member_split=='damage' else 1 for p in members}
                total=sum(weights.values())
                assigned={p:team_pool*weights[p]//total for p in members}
                remainder=team_pool-sum(assigned.values())
                fractions=sorted(members,key=lambda p:(-(team_pool*weights[p]%total),p))
                for p in fractions[:remainder]:assigned[p]+=1
                amounts.update(assigned)
        first=self.config.rewards.slots[0] if self.config.rewards.slots else None
        return [Entitlement(slot_id=i+1,winner=p,amount=n if funded else 0,points=0 if funded else n,
                asset_kind=first.asset_kind if funded else None,asset_contract=first.asset_contract if funded else None)
                for i,(p,n) in enumerate(sorted(amounts.items())) if n>0]

    def public_state(self):
        state=super().public_state()
        state.update(worldVersion=3,obstacles=deepcopy(self.obstacles),airdrops=deepcopy(self.airdrops),
                     attacks=deepcopy(self.attacks),spawnPoints=deepcopy(self.spawn_points))
        if self.template_id=='token-catch':
            state.update(lootBudget=self.rules.loot_budget,droppedValue=self.dropped_value,
                         remainingScheduled=self.rules.loot_budget-self.dropped_value,
                         unclaimedValue=self.dropped_value-sum(b['score'] for b in self.bodies.values()),
                         lootChunk=self.rules.loot_chunk,lootRadius=3)
        if self.boss:state.update(teamRankings=self.team_rankings(),rankedRewardShares=self.rules.team_reward_shares)
        return state

    def snapshot(self):
        state=super().snapshot()
        state.update(obstacles=deepcopy(self.obstacles),airdrops=deepcopy(self.airdrops),attacks=deepcopy(self.attacks),
                     drop_index=self.drop_index,dropped_value=self.dropped_value,next_upgrade=self.next_upgrade,
                     upgrade_phase=self.upgrade_phase,spawn_points=deepcopy(self.spawn_points),attack_index=self.attack_index)
        return state


class FieldCatchEngine(FieldArenaEngine):
    template_id='token-catch'


class FieldBossEngine(FieldArenaEngine):
    template_id='boss-raid'


class FieldCombatEngine(FieldArenaEngine):
    template_id='combat-duel'
