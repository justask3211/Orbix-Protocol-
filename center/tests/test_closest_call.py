from center.tests.portfolio_cases import EngineContract,make,action,restored
class TestClosestCall(EngineContract):
 tid='closest-call'

import pytest
from center.content_packs import load_pack

@pytest.mark.parametrize('guess,score,qualifies',[(50,1000,True),(70,800,True),(71,790,False),(100,500,False)])
def test_integer_error_and_eligibility(guess,score,qualifies):
 e=make('closest-call');e.deck[0].update(answer=50,lower=0,upper=100)
 assert e.act('a',action(e,guess),101).ok
 assert not e.history and not e.eligible()
 e.tick(120);assert e.scores()['a']==score and ('a' in e.eligible())==qualifies
 assert e.scores()['b']==0

def test_all_exhibits_have_matching_geometry_and_ties_ignore_arrival_order():
 e=make('closest-call');_,pack=load_pack(e.rules)
 assert all(len(record['display']['objects'])==record['answer'] for record in pack['records'])
 r=make('closest-call')
 for engine,order in [(e,['a','b']),(r,['b','a'])]:
  for p in order:assert engine.act(p,action(engine,aid=p),101).ok
  engine.tick(120)
 assert e.ranking()==r.ranking() and e.scores()==r.scores()
 assert e.ranking()==e.tie_order

def test_highest_eligible_score_gets_rank_one_even_when_unqualified_total_is_higher():
 e=make('closest-call',rounds=3)
 for i in range(3):
  e.deck[i].update(answer=50,lower=0,upper=100)
  assert e.act('a',action(e,71,aid=f'a-{i}'),e.phase_started+1).ok
  if i==0:assert e.act('b',action(e,70,aid='b'),e.phase_started+1).ok
  e.tick(e.phase_deadline());e.tick(e.phase_deadline())
 assert e.scores()=={'a':2370,'b':800} and e.ranking()[0]=='a'
 assert e.eligible()=={'b'} and e.entitlements()[0].winner=='b'
 from center.room import RoomRuntime
 from types import SimpleNamespace
 rows=RoomRuntime._result_rows(SimpleNamespace(engine=e,config=e.config))
 assert next(row for row in rows if row['who']=='b')['rank']==1
 assert next(row for row in rows if row['who']=='a')['rank'] is None
