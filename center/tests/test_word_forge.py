from center.tests.portfolio_cases import EngineContract,make,action,restored
class TestWordForge(EngineContract):
 tid='word-forge'

import pytest
from collections import Counter

@pytest.mark.parametrize('text',['aaa','c a t','cát','cаt','cat\n','🦊'])
def test_malformed_and_repeated_tiles_reject(text):
 e=make('word-forge');e.deck[0]['letters']='catxxxxx'
 assert not e.act('a',action(e,text),101).ok
 assert not e.submissions['a']

def test_normalization_sealed_membership_and_rare_letters():
 e=make('word-forge');e.deck[0]['letters']='jazzxxxx'
 e.pack['dictionary']=['jazz']
 assert e.act('a',action(e,' JAZZ '),101).ok
 assert e.private_state('a')['ownSubmission']['submission']=='jazz'
 assert e.act('b',action(e,'zaj',aid='other'),101).ok
 assert 'valid' not in repr(e.private_state('b')) and not e.history
 e.tick(140)
 assert e.scores()=={'a':1675,'b':0} and e.eligible()=={'a'}
 assert e.history[0]['results']['b']=={'text':'zaj','valid':False,'score':0}

def test_each_rack_size_is_solvable_and_distinct():
 for size in [7,8,9]:
  e=make('word-forge',rack_size=size,rounds=6)
  assert len({r['id'] for r in e.deck})==6
  assert all(len(r['letters'])==size and any(not(Counter(w)-Counter(r['letters'])) for w in e.pack['dictionary']) for r in e.deck)
