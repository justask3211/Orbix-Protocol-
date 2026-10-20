"""Generate cross-runtime fixtures directly from the unchanged production reducers."""
import sys,json,random
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]))
from center.schema import RoomConfig
from center.games import engine_for
from center.games.arena import CHARACTERS
players=['0x'+'11'*20,'0x'+'22'*20]
cases=[]
for template in ['token-catch','combat-duel','boss-raid']:
 for run in range(3):
  rules={'templateId':template,'world_version':4,'arena_mode':True,'duration_seconds':60}
  if template=='combat-duel':rules.pop('arena_mode')
  if template=='token-catch':rules.update(spawn_per_second=2,lanes=3)
  if template=='boss-raid':rules.update(max_players=2,team_mode='teams',boss_health=500,team_reward_shares=[60,40],winning_teams=2)
  config=RoomConfig(template_id=template,name='Parity fixture',rules=rules,admission={'player_cap':2,'min_ready_to_start':2})
  seed=f'{run+1:064x}';engine=engine_for(config)(config,'a'*32,seed,players)
  if template=='boss-raid':engine.teams=dict(zip(players,['team-1','team-2']))
  engine.start(1000.)
  # Scenario variants exercise loot, melee, knockouts, jumping, all boss attack kinds.
  if run==1:
   for i,b in enumerate(engine.bodies.values()):b.update(x=0,z=i*1.2,y=0,yaw=0 if i==0 else 3.141592653589793)
   if template=='token-catch':engine._drop('coin',0,0,0,0,25);engine._drop('bomb',0,0,0,0)
  if run==2:
   for i,b in enumerate(engine.bodies.values()):b.update(x=0,z=3+i,y=0,yaw=3.141592653589793,weapon='gun',weaponUses=100,weaponLevel=3)
  initial=engine.snapshot();events=[];rng=random.Random(run)
  for tick in range(1,1802):
   at=1000+tick/30
   engine.tick(at);events.append({'at':at})
   if tick%3==0 and not engine.finished:
    who=players[tick%2]
    kind=rng.choice(['move','attack','punch','dodge','jump','block','loot','open_airdrop','interact','equip','push'])
    a={'kind':kind,'seq':tick,'dx':rng.choice([-1,0,1]),'dz':rng.choice([-1,0,1]),'sprint':bool(tick%4),'active':bool(tick%4),'yaw':0 if tick%2 else 3.141592653589793,'character':rng.choice(CHARACTERS),'style':rng.choice(['heavy','light','kick'])}
    if kind=='loot':
     near=sorted(engine.drops,key=lambda d:engine._distance(engine.bodies[who],d))
     a['dropId']=near[0]['id'] if near else 'missing'
    if kind=='open_airdrop':a['dropId']=engine.airdrops[0]['id'] if engine.airdrops else 'missing'
    res=engine.act(who,a,at);events.append({'at':at,'who':who,'action':a,'accepted':res.ok,'error':res.error})
   if engine.finished:break
  cases.append(dict(template=template,rules=config.rules.model_dump(),seed=seed,initial=initial,events=events,expected=engine.snapshot(),public=engine.public_state(),eligible=sorted(engine.eligible()),characters=CHARACTERS))
print(json.dumps(cases,separators=(',',':')))
