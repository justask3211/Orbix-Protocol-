from center.tests.portfolio_cases import EngineContract,make,action,restored
class TestPrismLines(EngineContract):
 tid='prism-lines'

import pytest

@pytest.mark.parametrize('cells',[[(4,0),(4,1),(4,2),(4,3)],[(1,0),(2,0),(3,0),(4,0)],[(1,0),(2,1),(3,2),(4,3)],[(1,4),(2,3),(3,2),(4,1)]])
def test_four_line_directions_and_edge(cells):
 e=make('prism-lines')
 for r,c in cells:e.board[r][c]='a'
 assert e._line('a',*cells[-1])==[list(cell) for cell in sorted(cells)]

def test_full_column_rejected_and_streak_resets():
 e=make('prism-lines');p=e.current_player
 for r in range(e.rules.rows):e.board[r][0]='a' if r%2 else 'b'
 assert e.act(p,action(e,0),101).error=='COLUMN_FULL' and e.turn_index==0
 e.streak[p]=1
 assert e.act(p,action(e,1),101).ok and e.streak[p]==0
 assert e.board[-1][1]==p and e.phase_started==101

def test_line_win_result_budget_and_json_restore():
 import json
 e=make('prism-lines');winner=e.current_player
 for i,c in enumerate([0,1,0,1,0,1,0]):
  assert e.act(e.current_player,action(e,c,aid=f'd-{i}'),101+i).ok
 assert e.winner==winner and e.phase=='result' and not e.finished
 r=type(e).restore(e.config,e.round_id,e.seed,json.loads(json.dumps(e.snapshot())))
 assert r.public_state()==e.public_state()
 e.tick(110);r.tick(110)
 assert e.finished and e.entitlements()[0].winner==winner and e.snapshot()==r.snapshot()

def test_one_idle_forfeit_and_pass_count_draw():
 e=make('prism-lines');idle=e.current_player;e.tick(115)
 assert e.act(e.current_player,action(e,1),116).ok
 e.tick(131);assert e.reason=='forfeit' and e.winner!=idle
 e=make('prism-lines');e.turn_index=24;e.tick(115)
 assert e.reason=='draw' and not e.eligible()
