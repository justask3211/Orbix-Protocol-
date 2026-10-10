"""Atlas Quest v1 — integer grid distance, wrapping longitude; never fake km."""
from center.games.sealed_rounds import SealedRoundsEngine

class AtlasQuestEngine(SealedRoundsEngine):
    template_id='atlas-quest';action_kind='pin';action_fields={'col','row'};hint_kind='hemisphere'
    def build_deck(self,rng):return rng.shuffled(self.pack['records'])[:self.rules.rounds]
    def public_challenge(self,record):return {'id':record['id'],'prompt':record['prompt'],'columns':36,'rows':18,'projection':'10-degree grid distance; longitude wraps, latitude does not.'}
    def validate_submission(self,who,action,record):
        col,row=action.get('col'),action.get('row')
        return ({'col':col,'row':row},None) if type(col) is int and type(row) is int and 0<=col<36 and 0<=row<18 else (None,'BAD_PIN')
    def resolve_challenge(self,record,deadline):
        rows={}
        for p in self.participants:
            pin=self.value(p);distance=None
            if pin is not None:
                dx=abs(pin['col']-record['answer_col']);distance=min(dx,36-dx)+abs(pin['row']-record['answer_row'])
                if distance<=5:self.qualified.add(p)
            score=max(0,1000-40*distance-100*int(self.hinted(p))) if distance is not None else 0
            self.totals[p]+=score;rows[p]={'pin':pin,'distance':distance,'hinted':self.hinted(p),'score':score}
        return {'answer':{'col':record['answer_col'],'row':record['answer_row']},'explanation':record['explanation'],'source':record['source'],'results':rows}
    def hint_payload(self,who,record):return {'hemisphere':record['hemisphere'],'message':'Northern map half (rows 0–8).' if record['hemisphere']=='north' else 'Southern map half (rows 9–17).','scorePenalty':100}
