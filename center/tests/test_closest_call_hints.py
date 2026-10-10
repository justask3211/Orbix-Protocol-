from center.tests.portfolio_cases import HintContract,make
class TestClosestCallHints(HintContract):
 tid='closest-call'

def test_reference_is_answer_independent():
 e=make('closest-call');r=make('closest-call');r.deck[0]['answer']=r.deck[0]['lower']
 assert e.hint_payload('a',e.deck[0])==r.hint_payload('a',r.deck[0])
