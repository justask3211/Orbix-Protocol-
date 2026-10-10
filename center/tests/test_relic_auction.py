from center.tests.portfolio_cases import EngineContract,make,action,restored
class TestRelicAuction(EngineContract):
 tid='relic-auction'

import pytest

@pytest.mark.parametrize('bid',[False,True,-1,101,1.5,'5'])
def test_bid_bounds(bid):
 e=make('relic-auction');assert not e.act('a',action(e,bid),101).ok

def test_first_price_tie_rotation_and_loser_balance():
 e=make('relic-auction')
 for i in range(3):
  before=dict(e.balances)
  for p in ['b','a']:assert e.act(p,action(e,5,aid=f'{p}-{i}'),e.phase_started+1).ok
  assert e.balances==before and not e.history[i:]
  e.tick(e.phase_deadline());winner=e.seat_order[i%2]
  assert e.history[i]['winner']==winner
  assert e.balances[winner]==before[winner]-5
  assert e.balances[next(p for p in ['a','b'] if p!=winner)]==before[next(p for p in ['a','b'] if p!=winner)]
  e.tick(e.phase_deadline())
 assert sum(e.balances.values())==200-15

def test_sets_repeated_sets_signed_profit_and_pass_only_no_rewards():
 e=make('relic-auction')
 for counts,bonus in [(('amber','jade'),0),(('amber','jade','violet'),30),(('amber','jade','violet')*2,60)]:
  e.inventory['a']=[{'value':12,'colour':c} for c in counts];e.balances['a']=100-10*len(counts)
  assert e.scores()['a']==2*len(counts)+bonus and e.eligible()=={'a'}
 e.inventory['a']=[{'value':12,'colour':'amber'}];e.balances['a']=0
 assert e.scores()['a']==-88 and not e.eligible()
 e=make('relic-auction');assert e.act('a',action(e,0),101).ok
 e.tick(1000);assert all(h['winner'] is None for h in e.history) and not e.entitlements()
