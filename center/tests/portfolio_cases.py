import copy,json
from collections import Counter
import pytest
from center.schema import RoomConfig,TEMPLATE_RULES
from center.games import engine_for
from center.content_packs import validate_config_pack

def make(tid,**rules):
 c=RoomConfig(template_id=tid,name='Portfolio game',rules={'templateId':tid,**rules},admission={'player_cap':2,'min_ready_to_start':2},rewards={'slots':[{'rank':1,'points':100}]})
 e=engine_for(c)(c,'match','fixed-seed',['a','b']);e.start(100);return e

def action(e,value=None,aid='input',**extra):
 tid=e.template_id;key='turnIndex' if tid=='prism-lines' else 'auctionIndex' if tid=='relic-auction' else 'challengeIndex'
 if tid=='closest-call':payload={'kind':'estimate','value':e.deck[e.index]['answer'] if value is None else value}
 elif tid=='word-forge':payload={'kind':'word','text':value or next(w for w in e.pack['dictionary'] if not(Counter(w)-Counter(e.deck[e.index]['letters'])))}
 elif tid=='atlas-quest':payload={'kind':'pin','col':e.deck[e.index]['answer_col'] if value is None else value,'row':e.deck[e.index]['answer_row']}
 elif tid=='relic-auction':payload={'kind':'bid','amount':1 if value is None else value}
 else:payload={'kind':'drop','column':0 if value is None else value}
 return {**payload,'roundId':e.round_id,key:e.turn_index if tid=='prism-lines' else e.index,'actionId':aid,**extra}

def player(e):return e.current_player if e.template_id=='prism-lines' else 'a'
def restored(e):return type(e).restore(e.config,e.round_id,e.seed,json.loads(json.dumps(e.snapshot())))
class EngineContract:
 tid=''
 @pytest.mark.parametrize('bad',[True,1.5,'3',None])
 def test_strict_rules(self,bad):
  key='turn_seconds' if self.tid=='prism-lines' else 'rounds'
  with pytest.raises(ValueError):make(self.tid,**{key:bad})
 def test_rule_bounds_and_unknown(self):
  for rules in [{'duration_seconds':0},{'hint_budget':0},{'client_score':1},{'max_players':0}]:
   with pytest.raises(ValueError):make(self.tid,**rules)
  if self.tid!='prism-lines':
   with pytest.raises(ValueError):make(self.tid,rounds=11)
  if hasattr(make(self.tid).rules,'pack_id'):
   e=make(self.tid); e.config.rules.pack_sha256='0'*64
   with pytest.raises(ValueError):validate_config_pack(e.config)
 def test_authenticated_shapes_and_ids(self):
  e=make(self.tid);p=player(e);a=action(e)
  for who,payload in [('outsider',a),(p,{**a,'roundId':'old'}),(p,{**a,'actionId':''}),(p,{**a,'score':999}),(p,{**a,'timestamp':101})]:assert not e.act(who,payload,101).ok
  index='turnIndex' if self.tid=='prism-lines' else 'auctionIndex' if self.tid=='relic-auction' else 'challengeIndex'
  assert not e.act(p,{**a,index:True},101).ok
  assert not e.act(p,{**a,index:9},101).ok
 def test_receipts_conflicts_and_restore(self):
  e=make(self.tid);p=player(e);a=action(e);ack=e.act(p,a,101);assert ack.ok
  r=restored(e);assert r.act(p,a,101).private==ack.private
  assert r.act(p,{**a,'kind':'wrong'},101).error=='ACTION_ID_CONFLICT'
  assert not r.private_state('outsider')
  assert 'ownSubmission' not in r.public_state()
  if self.tid!='prism-lines':
   b=action(e,aid='changed');field={'closest-call':'value','word-forge':'text','relic-auction':'amount','atlas-quest':'col'}[self.tid]
   b[field]=0 if field!='text' else e.deck[0]['letters'][:3]
   if b[field]!=a[field]:assert not r.act(p,b,102).ok
   assert r.phase=='selection' and not r.history
 def test_deadline_and_idle_no_allocations(self):
  e=make(self.tid);a=action(e);p=player(e);deadline=e.phase_deadline()
  assert not e.act(p,a,deadline).ok
  e.tick(10000);assert e.finished and not e.eligible() and not e.entitlements()
  before=copy.deepcopy(e.snapshot());e.tick(10000);assert e.snapshot()==before
 def test_every_phase_snapshot_and_deterministic_final(self):
  e=make(self.tid);r=restored(e)
  for n in range(80):
   assert e.public_state()==r.public_state()
   if e.finished:break
   if e.phase=='selection':
    a=action(e,aid=f'act-{n}');p=player(e)
    assert e.act(p,a,e.phase_started+1).ok
    assert r.act(p,a,r.phase_started+1).ok
   t=e.phase_deadline();e.tick(t);r.tick(t);r=restored(r)
  assert e.finished and r.finished
  assert (e.scores(),e.ranking(),e.eligible(),e.entitlements(),e.snapshot())==(r.scores(),r.ranking(),r.eligible(),r.entitlements(),r.snapshot())
 def test_hidden_content_not_in_public_config(self):
  e=make(self.tid);public=json.dumps(e.public_state());config=json.dumps(e.config.public_dict())
  for key in ['dictionary','answer_col','answer_row','latitude_arcseconds','longitude_arcseconds','packRaw','deck','submissions']:assert f'"{key}"' not in public+config
  if self.tid=='closest-call':assert '"answer"' not in public+config
  if self.tid!='prism-lines':
   p=player(e);a=action(e);e.act(p,a,101)
   assert not e.history and not e.private_state('b')['ownSubmission']

class HintContract:
 tid=''
 def hint(self,e,aid='hint'):
  a=action(e,aid=aid);return {k:v for k,v in a.items() if k in ['roundId','actionId','turnIndex','auctionIndex','challengeIndex']}|{'kind':'hint','hintKind':e.hint_kind if hasattr(e,'hint_kind') else 'legal-columns'}
 def test_off_and_private_retry(self):
  e=make(self.tid,hints='off');assert e.act(player(e),self.hint(e),101).error=='HINTS_OFF'
  e=make(self.tid);p=player(e);ack=e.act(p,self.hint(e),101);assert ack.ok
  budget=e.private_state(p)['hintsRemaining'];r=restored(e)
  assert r.act(p,self.hint(r),101).private==ack.private
  assert r.act(p,self.hint(r,'retry'),101).private==ack.private
  assert r.private_state(p)['hintsRemaining']==budget
  assert 'hintReceipt' not in r.public_state() and not r.private_state(next(x for x in e.participants if x!=p)).get('hintReceipt')
 def test_budget_across_match_and_invalid_packets(self):
  e=make(self.tid);p=player(e)
  assert not e.act(p,{**self.hint(e),'score':999},101).ok
  assert not e.act('outsider',self.hint(e),101).ok
  if self.tid=='prism-lines':
   # Interleave legal moves; same player returns each second turn.
   for i in range(3):
    assert e.act(p,self.hint(e,f'h-{i}'),e.phase_started+1).error == (None if i<2 else 'HINT_BUDGET_EXHAUSTED')
    if i<2:
     e.act(p,action(e,aid=f'p-{i}'),e.phase_started+1)
     e.act(e.current_player,action(e,value=1,aid=f'o-{i}'),e.phase_started+1)
  else:
   for i in range(e.rules.hint_budget+1):
    assert e.act(p,self.hint(e,f'h-{i}'),e.phase_started+1).error==(None if i<e.rules.hint_budget else 'HINT_BUDGET_EXHAUSTED')
    e.tick(e.phase_deadline());e.tick(e.phase_deadline());e=restored(e)
 def test_hint_exact_close_and_no_solver(self):
  e=make(self.tid);p=player(e);assert not e.act(p,self.hint(e),e.phase_deadline()).ok
  e=make(self.tid);payload=e.act(player(e),self.hint(e),101).private['hintReceipt']['payload']
  for key in ['answer','bestWord','dictionary','future','bids','answer_col','answer_row']:assert key not in payload
