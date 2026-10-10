from center.tests.portfolio_cases import HintContract,make
class TestRelicAuctionHints(HintContract):
 tid='relic-auction'

def test_ledger_ignores_opponents_sealed_bid():
 from center.tests.portfolio_cases import action
 e=make('relic-auction');before=e.hint_payload('a',e.deck[0])
 assert e.act('b',action(e,99),101).ok
 assert e.hint_payload('a',e.deck[0])==before and e.balances['b']==100
