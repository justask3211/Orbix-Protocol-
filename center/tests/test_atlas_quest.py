from center.tests.portfolio_cases import EngineContract,make,action,restored
class TestAtlasQuest(EngineContract):
 tid='atlas-quest'

import pytest

@pytest.mark.parametrize('answer,pin,distance,score',[(dict(col=0,row=0),dict(col=35,row=0),1,960),(dict(col=35,row=17),dict(col=0,row=17),1,960),(dict(col=0,row=0),dict(col=18,row=17),35,0),(dict(col=0,row=0),dict(col=0,row=5),5,800),(dict(col=0,row=0),dict(col=0,row=6),6,760)])
def test_wrap_poles_distance_and_threshold(answer,pin,distance,score):
 e=make('atlas-quest');e.deck[0].update(answer_col=answer['col'],answer_row=answer['row'])
 assert e.act('a',{**action(e),**pin},101).ok
 e.tick(125)
 assert e.history[0]['results']['a']['distance']==distance and e.scores()['a']==score
 assert ('a' in e.eligible())==(distance<=5)

@pytest.mark.parametrize('pin',[dict(col=True,row=0),dict(col=0,row=False),dict(col=36,row=0),dict(col=0,row=18),dict(col=-1,row=0)])
def test_pin_bounds(pin):
 e=make('atlas-quest');assert not e.act('a',{**action(e),**pin},101).ok
