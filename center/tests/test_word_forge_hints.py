from center.tests.portfolio_cases import HintContract,make
class TestWordForgeHints(HintContract):
 tid='word-forge'

def test_rack_sort_counts_and_no_dictionary_oracle():
 e=make('word-forge');e.deck[0]['letters']='bananaqq'
 original=e.hint_payload('a',e.deck[0]);e.pack['dictionary']=[]
 assert e.hint_payload('a',e.deck[0])==original=={'sortedRack':'aaabnnqq','counts':{'a':3,'b':1,'n':2,'q':2}}
