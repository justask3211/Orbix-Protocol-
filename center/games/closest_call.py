"""Closest Call v1 — integer range-normalized estimation, no arrival bonus."""
from center.games.sealed_rounds import SealedRoundsEngine

class ClosestCallEngine(SealedRoundsEngine):
    template_id='closest-call';action_kind='estimate';action_fields={'value'};hint_kind='scale-reference'
    def build_deck(self,rng):return rng.shuffled(self.pack['records'])[:self.rules.rounds]
    def public_challenge(self,record):return {k:record[k] for k in ['id','prompt','unit','lower','upper','scene_kind','display']}
    def validate_submission(self,who,action,record):
        value=action.get('value')
        return (value,None) if type(value) is int and record['lower']<=value<=record['upper'] else (None,'BAD_ESTIMATE')
    def resolve_challenge(self,record,deadline):
        rows={};span=record['upper']-record['lower']
        for p in self.participants:
            value=self.value(p);error=abs(value-record['answer']) if value is not None else None
            score=max(0,1000-1000*error//span) if error is not None else 0
            if error is not None and 5*error<=span:self.qualified.add(p)
            self.totals[p]+=score;rows[p]={'value':value,'error':error,'score':score}
        return {'answer':record['answer'],'unit':record['unit'],'span':span,'results':rows}
    def hint_payload(self,who,record):return {'lower':record['lower'],'upper':record['upper'],'unit':record['unit'],'referenceUnits':10,'message':'Compare against the fixed ten-unit reference. It does not indicate the target.'}
