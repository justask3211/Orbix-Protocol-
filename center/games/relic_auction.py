"""Relic Auction v1 — first-price sealed bids, virtual game credits only."""
from collections import Counter
from center.games.sealed_rounds import SealedRoundsEngine

class RelicAuctionEngine(SealedRoundsEngine):
    template_id='relic-auction';index_key='auctionIndex';action_kind='bid';action_fields={'amount'};hint_kind='budget-ledger'
    def __init__(self,*args,**kw):
        super().__init__(*args,**kw)
        self.balances={p:self.rules.starting_credits for p in self.participants};self.inventory={p:[] for p in self.participants};self.seat_order=[]
    def build_deck(self,rng):
        self.seat_order=self.stream('auction-seat').shuffled(self.participants)
        props=self.stream('props')
        return [{'id':f'relic-{i}','value':rng.between(12,40),'colour':rng.choice(['amber','jade','violet']),'prop':props.choice(['vase','compass','idol'])} for i in range(self.rules.rounds)]
    def public_challenge(self,record):return dict(record)
    def validate_submission(self,who,action,record):
        amount=action.get('amount')
        return (amount,None) if type(amount) is int and 0<=amount<=self.balances[who] else (None,'BAD_BID')
    def _profit(self,p):
        counts=Counter(r['colour'] for r in self.inventory[p]);sets=min(counts[c] for c in ['amber','jade','violet'])
        return sum(r['value'] for r in self.inventory[p])+self.rules.set_bonus*sets+self.balances[p]-self.rules.starting_credits
    def scores(self):return {p:self._profit(p) for p in self.participants}
    def eligible(self):return {p for p in self.participants if self.inventory[p] and self._profit(p)>0}
    def resolve_challenge(self,record,deadline):
        bids={p:self.value(p) or 0 for p in self.participants};high=max(bids.values(),default=0)
        offset=self.index%len(self.seat_order);priority=self.seat_order[offset:]+self.seat_order[:offset]
        winner=next((p for p in priority if bids[p]==high),None) if high>0 else None
        if winner:
            self.balances[winner]-=high;self.inventory[winner].append(dict(record))
        return {'relic':dict(record),'bids':bids,'winner':winner,'paid':high if winner else 0,'priority':priority,'profits':self.scores()}
    def hint_payload(self,who,record):return {'gameCredits':self.balances[who],'spent':self.rules.starting_credits-self.balances[who],'colours':{c:sum(r['colour']==c for r in self.inventory[who]) for c in ['amber','jade','violet']},'setBonus':self.rules.set_bonus,'formula':'One amber + one jade + one violet forms a set.'}
    def public_extra(self):return {'balances':dict(self.balances),'inventories':{p:list(r) for p,r in self.inventory.items()},'seatOrder':list(self.seat_order),'setBonus':self.rules.set_bonus,'startingCredits':self.rules.starting_credits,'creditsLabel':'Game credits'}
    def snapshot_extra(self):return {'balances':self.balances,'inventory':self.inventory,'seatOrder':self.seat_order}
    def load_extra(self,extra):self.balances=extra['balances'];self.inventory=extra['inventory'];self.seat_order=extra['seatOrder']
