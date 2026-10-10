"""Vertical contracts: publish, practice, private reconnect, durable settlement and catalog."""
import asyncio
import copy
import json
import pytest
from fastapi.testclient import TestClient
from eth_account import Account
from center import lifecycle as lc
from center import settlement as st
from center.api import API_PREFIX
from center.games import ENGINES
from center.games.hints import policy_for
from center.schema import RoomConfig, PORTFOLIO_TEMPLATES
from center.room import RoomRuntime, Hub
from center.store import Store
from center.vault import VaultService
from center.tests.portfolio_cases import make, action
from center.tests.test_flow import make_app, sign_in

@pytest.mark.parametrize('tid', sorted(PORTFOLIO_TEMPLATES))
def test_registered_policy_and_frozen_duration(tid):
 e=make(tid);policy=policy_for(tid,1)
 assert policy.implemented and policy.version==1 and ENGINES[tid] is type(e)
 kind=policy.kinds[0]
 assert kind.audience=='private' and kind.budget==e.rules.hint_budget
 assert kind.cost==(100 if tid=='atlas-quest' else 0)
 data=e.config.model_dump(mode='json',by_alias=True)
 assert RoomConfig(**__import__('center.schema',fromlist=['normalise_keys']).normalise_keys(data)).config_hash_input()==e.config.config_hash_input()
 for field in ['hint_budget','max_players','duration_seconds']:
  with pytest.raises(ValueError):RoomConfig(**{**data,'rules':{**data['rules'],field:True}})
 with pytest.raises(ValueError):RoomConfig(**{**data,'community_settings':{'timed_hints':[{'delay_seconds':1,'text':'Unbounded clue'}]}})
 with pytest.raises(ValueError):RoomConfig(**{**data,'rewards':{'slots':[{'rank':3,'points':10}]}})

@pytest.mark.parametrize('tid',sorted(PORTFOLIO_TEMPLATES))
def test_publish_packs_and_outward_routes_are_secret_free(tmp_path,tid):
 app=make_app(tmp_path);host=Account.from_key('0x'+'a3'*32)
 with TestClient(app) as client:
  headers=sign_in(client,host)
  client.post(API_PREFIX+'/wallet/vault/deposit',headers=headers,json={'amount':1000})
  config=make(tid).config.model_dump(mode='json')
  if 'pack_sha256' in config['rules']:
   bad=copy.deepcopy(config);bad['rules']['pack_sha256']='0'*64
   res=client.post(API_PREFIX+'/rooms',headers=headers,json={'config':bad,'intentNonce':'bad'})
   assert res.status_code==422 and res.json()['detail']['code']=='INVALID_CONTENT_PACK'
  published=client.post(API_PREFIX+'/rooms',headers=headers,json={'config':config,'intentNonce':tid})
  assert published.status_code==200,published.text
  room_id=published.json()['roomId']
  public=client.get(API_PREFIX+'/rooms/'+room_id).json()
  rules=public['config']['rules']
  if 'pack_sha256' in rules:assert len(rules['pack_sha256'])==64
  encoded=json.dumps(public)
  for key in ['answer_col','answer_row','dictionary','deck','packRaw','submissions']:assert f'"{key}"' not in encoded
  template=next(t for t in client.get(API_PREFIX+'/templates').json()['templates'] if t['templateId']==tid)
  assert template['placement']=='catalog' and template['latencySensitivity']=='tolerant' and template['practiceAvailable']
  assert client.get(API_PREFIX+f'/templates/{tid}/rules').status_code==200
  # Community's direct service also rejects clues independently of route shape.
  from center.community import CommunityService,CommunityError
  with pytest.raises(CommunityError,match='bounded'):
   CommunityService(app.state.store).post_message(room_id,host.address,'Unbounded clue','hint')

@pytest.mark.parametrize('tid',sorted(PORTFOLIO_TEMPLATES))
def test_zero_clients_private_reconnect_restart_settlement_and_rematch(tmp_path,tid):
 async def run(restart):
  path=tmp_path/('restart.db' if restart else 'continuous.db')
  store=Store(str(path));vault=VaultService(store);hub=Hub();config=make(tid).config
  rt=RoomRuntime.create(store,vault,hub,owner='0x'+'11'*20,config=config)
  players=['0x'+'11'*20,'0x'+'22'*20]
  for p in players:rt.join(p);rt.set_ready(p)
  # Hold seed/match constant across both runs to compare durable transcript hashes.
  rt.round_id='ab'*16;rt.seed='fixed-runtime-seed'
  await rt.start(100)
  first=True
  for now in range(101,701):
   e=rt.engine
   if e.phase=='selection':
    who=e.current_player if tid=='prism-lines' else players[0]
    if tid=='prism-lines' or str(e.index) not in e.submissions[who]:
     a=action(e,aid=f'input-{e.turn_index if tid=="prism-lines" else e.index}')
     if tid=='prism-lines':a['column']=0 if e.turn_index%2==0 else 1
     if tid=='word-forge':
      from collections import Counter
      a['text']=next(w for w in e.pack['dictionary'] if not(Counter(w)-Counter(e.deck[e.index]['letters'])))
     ack=await rt.act(who,a,now)
     assert ack['ok'],ack
     if first and restart:
      private=e.private_state(who)
      rt=RoomRuntime.load(store,vault,hub,rt.room_id)
      assert rt.engine.private_state(who)==private
      assert (await rt.act(who,a,now))['ok']
     first=False
   await rt.tick(now)
   if rt.finished_at:break
  assert rt.finished_at and rt.status==lc.CLAIMABLE
  match=rt.round_id;log=store.actions_since(rt.room_id,0)
  accepted=[{'who':a['who'],'action':json.loads(a['payload']),'at':a['at']} for a in log if a['accepted']]
  assert any(a['who']=='clock' for a in accepted)
  record=store.get_round(match)
  assert record['transcript_hash']=='0x'+st.transcript_hash(match,accepted).hex()
  assert store.entitlements_for_round(match)
  scores=rt.engine.scores();ranking=rt.engine.ranking();snapshot=rt.engine.snapshot()
  old=store.get_round(match)
  await rt.prepare_rematch(now=rt.finished_at+1)
  assert store.get_round(match)==old and rt.engine is None
  assert rt.round_id!=match and rt.config.config_hash_input()==config.config_hash_input()
  return scores,ranking,snapshot,record['transcript_hash']
 before=asyncio.run(run(False));after=asyncio.run(run(True))
 assert before==after

def test_offline_hides_worlds_preserves_rooms_and_pauses_practice(tmp_path):
 app=make_app(tmp_path)
 from center.admin_games import AdminGameService
 from center.community import CommunityService
 admin='0x'+'99'*20
 service=AdminGameService(app.state.store,CommunityService(app.state.store),admin)
 with TestClient(app) as client:
  for tid in ['token-catch','combat-duel','boss-raid',*sorted(PORTFOLIO_TEMPLATES)]:
   assert service.availability(admin,tid,'offline')['status']=='offline'
   template=next(t for t in client.get(API_PREFIX+'/templates').json()['templates'] if t['templateId']==tid)
   assert template['placement']=='hidden' and not template['practiceAvailable']
   assert client.post(API_PREFIX+'/practice',json={'templateId':tid}).status_code==409
  for tid in ['token-catch','combat-duel','boss-raid']:
   service.availability(admin,tid,'live')
   template=next(t for t in client.get(API_PREFIX+'/templates').json()['templates'] if t['templateId']==tid)
   assert template['placement']=='more' and template['latencySensitivity']=='sensitive'
