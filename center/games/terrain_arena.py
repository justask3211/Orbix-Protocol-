"""Field-v1 terrain arenas. Version 3 flat-world records remain replayable."""
from center.games.field_arena import FieldArenaEngine
from center.games.terrain import terrain_height
from center.games.base import ActionResult


class TerrainArenaEngine(FieldArenaEngine):
    version=4

    @property
    def terrain_theme(self):
        return {'token-catch':'island','boss-raid':'guardian','combat-duel':'courtyard'}[self.template_id]

    def _ground(self,x,z):
        return terrain_height(x,z,self.terrain_theme)

    def start(self,now=0.):
        super().start(now)
        for body in self.bodies.values():body['y']=self._ground(body['x'],body['z'])
        for obstacle in self.obstacles:obstacle['baseY']=self._ground(obstacle['x'],obstacle['z'])
        for crate in self.crates:crate['y']=self._ground(crate['x'],crate['z'])
        if self.boss:self.boss['y']=self._ground(self.boss['x'],self.boss['z'])

    def _drop(self,*args,**kwargs):
        item=super()._drop(*args,**kwargs)
        item['y']=self._ground(item['x'],item['z'])
        return item

    def _schedule_airdrops(self):
        super()._schedule_airdrops()
        for crate in self.airdrops:crate['y']=self._ground(crate['x'],crate['z'])

    def _boss_attacks(self):
        super()._boss_attacks()
        for attack in self.attacks:attack['y']=self._ground(attack['x'],attack['z'])
        if self.boss and self.attacks:self.boss['yaw']=self.attacks[-1].get('yaw',self.boss.get('yaw',0))

    def act(self,who,action,now):
        if not isinstance(action,dict):return super().act(who,action,now)
        self.advance(now)
        body=self.bodies.get(who)
        floor=self._ground(body['x'],body['z']) if body else 0
        grounded=body and abs(body['y']-floor)<.001 and body['vy']==0
        # A failed interaction must not consume a strike or trigger its animation.
        if body and action.get('kind')=='interact' and not self.finished and self._alive(who,now*1000) and body['stunnedUntil']<=now*1000:
            if not any(c['hp']>0 and self._distance(body,c)<2.5 and self._clear_line(body,c) for c in self.crates):
                return ActionResult(False,'NO_CRATE_IN_REACH')
        weapon=body.get('weapon','hands') if body else 'hands'
        result=super().act(who,action,now)
        if result.ok and grounded and action.get('kind')=='dodge':body['y']=self._ground(body['x'],body['z'])
        if result.ok and body:
            kind=action.get('kind')
            if kind in {'attack','punch','push','interact'}:
                body['lastAttackWeapon']='hands' if kind in {'punch','push','interact'} else weapon
                body['lastAttackKind']=kind
            if kind in {'loot','open_airdrop','interact'}:body['lastInteractAt']=int(now*1000)
        # A confirmed push follows the same grounded terrain constraint as walking.
        for other in self.bodies.values():
            if other['vy']==0 and other['y']<self._ground(other['x'],other['z']):other['y']=self._ground(other['x'],other['z'])
        return result

    def public_state(self):
        state=super().public_state()
        state.update(worldVersion=4,terrain={'kind':'field-v1','theme':self.terrain_theme})
        for who,body in state['bodies'].items():
            surface=self._ground(body['x'],body['z'])
            for cover in self.obstacles:
                if abs(body['x']-cover['x'])<cover['width']/2+.32 and abs(body['z']-cover['z'])<cover['depth']/2+.32:
                    surface=max(surface,cover.get('baseY',0)+cover['height'])
            accepted=self.inputs.get(who,{})
            body.update(inputDx=accepted.get('dx',0),inputDz=accepted.get('dz',0),inputAt=accepted.get('at',0),inputUntil=accepted.get('until',0))
            body['groundHeight']=surface
            body['onGround']=abs(body['y']-surface)<.05 and body['vy']==0
        return state


class TerrainCatchEngine(TerrainArenaEngine):template_id='token-catch'
class TerrainBossEngine(TerrainArenaEngine):template_id='boss-raid'
class TerrainCombatEngine(TerrainArenaEngine):template_id='combat-duel'
