"""Word Forge v1 — English ASCII racks and a frozen server dictionary."""
import re
from collections import Counter
from center.games.sealed_rounds import SealedRoundsEngine

class WordForgeEngine(SealedRoundsEngine):
    template_id='word-forge';action_kind='word';action_fields={'text'};hint_kind='rack-sort'
    def build_deck(self,rng):return rng.shuffled([r for r in self.pack['racks'] if len(r['letters'])==self.rules.rack_size])[:self.rules.rounds]
    def public_challenge(self,record):return {'id':record['id'],'prompt':'Forge one English word from this rack.','rack':record['letters'],'rackSize':self.rules.rack_size}
    def validate_submission(self,who,action,record):
        text=action.get('text')
        if not isinstance(text,str) or len(text)>80 or not re.fullmatch('[A-Za-z ]*',text):return None,'BAD_WORD'
        text=text.strip(' ').lower()
        if not re.fullmatch(r'[a-z]{3,'+str(self.rules.rack_size)+'}',text) or Counter(text)-Counter(record['letters']):return None,'BAD_WORD'
        # Membership stays sealed. Unknown words lock, then score zero at close.
        return text,None
    def resolve_challenge(self,record,deadline):
        dictionary=set(self.pack['dictionary']);rows={}
        for p in self.participants:
            word=self.value(p);valid=word is not None and word in dictionary
            score=100*len(word)**2+25*sum(c in 'qzjx' for c in word) if valid else 0
            if valid:self.qualified.add(p)
            self.totals[p]+=score;rows[p]={'text':word,'valid':valid,'score':score}
        return {'rack':record['letters'],'results':rows}
    def hint_payload(self,who,record):return {'sortedRack':''.join(sorted(record['letters'])),'counts':dict(sorted(Counter(record['letters']).items()))}
