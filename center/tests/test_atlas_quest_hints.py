from center.tests.portfolio_cases import HintContract,make
class TestAtlasQuestHints(HintContract):
 tid='atlas-quest'

def test_hemisphere_payload_constant_for_every_cell_and_penalty_once():
 for north in [True,False]:
  e=make('atlas-quest');record=e.deck[0];record['hemisphere']='north' if north else 'south'
  payload=e.hint_payload('a',record)
  for row in range(0 if north else 9,9 if north else 18):
   for col in range(36):
    record.update(answer_col=col,answer_row=row)
    assert e.hint_payload('a',record)==payload
 e=make('atlas-quest');h=TestAtlasQuestHints().hint(e)
 assert e.act('a',h,101).ok and e.act('a',h,102).ok
 assert e.act('a',__import__('center.tests.portfolio_cases',fromlist=['action']).action(e),103).ok
 e.tick(125);assert e.scores()['a']==900 and e.eligible()=={'a'}
