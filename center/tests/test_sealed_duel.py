"""V2 automatic reveal vectors; legacy manual fixtures explicitly retain version 1."""
import copy
import itertools
import pytest
from center.games import engine_for
from center.games.duel_moves import BEATS
from center.schema import RoomConfig


def make(tid='reaction-duel', extended=False):
    c = RoomConfig(template_id=tid, name='Automatic duel', rules={'templateId':tid, 'choice_set':'extended' if extended else 'classic'}, admission={'player_cap':2,'min_ready_to_start':2}, rewards={'slots':[{'rank':1,'points':100}]})
    e = engine_for(c)(c, 'match', 'seed', ['a','b']);e.start(100)
    return e

def choose(e,p,c,t=101,**overrides):
    return e.act(p,dict(kind='commit',roundId='match',subroundIndex=e.round_index,choice=c,salt='ab'*16,**overrides),t)

@pytest.mark.parametrize('tid',['reaction-duel','rps-duel'])
@pytest.mark.parametrize('a,b',list(itertools.product(['rock','paper','scissors','lizard','spock'],repeat=2)))
def test_matrix_and_fixed_close(tid,a,b):
    e=make(tid,True)
    assert choose(e,'a',a).ok and choose(e,'b',b).ok
    assert e.phase=='commit' and not e.history
    e.tick(109.999);assert not e.history
    e.tick(110)
    expected=None if a==b else 'a' if b in BEATS[a] else 'b'
    assert e.history[0]['winner']==expected
    before=copy.deepcopy(e.snapshot());e.tick(110);assert e.snapshot()==before
    assert e.phase=='reveal' and e.phase_deadline()==115

@pytest.mark.parametrize('tid',['reaction-duel','rps-duel'])
def test_retries_private_restore_and_boundary(tid):
    e=make(tid)
    ack=choose(e,'a','rock');saved=copy.deepcopy(e.snapshot())
    assert choose(e,'a','rock').private==ack.private
    assert e.snapshot()==saved
    assert choose(e,'a','paper').error=='CHOICE_LOCKED'
    assert not e.private_state('spectator')
    assert 'salt' not in repr(ack.private) and not e.public_state()['history']
    restored=type(e).restore(e.config,e.round_id,e.seed,saved)
    assert restored.private_state('a')==ack.private
    assert choose(restored,'b','paper',110).error=='ROUND_NOT_OPEN'
    assert restored.history[0]['reason']=='no-choice-forfeit'
    restored.tick(115)
    assert restored.round_index==1
    assert restored.act('a',{'kind':'commit','roundId':'match','subroundIndex':0,'choice':'paper','salt':'ab'*16},116).error=='STALE_PHASE'
    assert restored.act('a',{'kind':'reveal'},116).error=='UNSUPPORTED_ACTION'

@pytest.mark.parametrize('bad',[None,False,{},'a','ab'*33])
def test_malformed_salt(bad):
    e=make();assert not e.act('a',{'kind':'commit','roundId':'match','subroundIndex':0,'choice':'rock','salt':bad},101).ok

def test_idle_catchup_and_integrity():
    e=make();e.tick(145);assert e.finished and len(e.history)==3 and not e.eligible() and not e.entitlements()
    e=make();choose(e,'a','rock');e.sealed['a']['0']['choice']='paper';e.tick(110)
    assert e.integrity_error and not e.entitlements()

def test_majority_result_duration_and_unique_winner():
    e=make()
    choose(e,'a','rock');choose(e,'b','scissors');e.tick(115)
    choose(e,'a','rock',116);choose(e,'b','scissors',116);e.tick(125)
    assert not e.finished
    e.tick(130);assert e.finished and e.eligible()=={'a'} and e.entitlements()[0].winner=='a'

def test_versions_and_ambiguous_restore():
    e=make();assert e.config.template_version==2
    with pytest.raises(ValueError):type(e).restore(e.config,e.round_id,e.seed,{'participants':['a','b'],'commits':{}})

def test_zero_clients_restart_transcript_and_outage(tmp_path):
    import asyncio
    from center.room import RoomRuntime, Hub
    from center.store import Store
    from center.vault import VaultService
    from center import lifecycle as lc
    async def run(restart, path):
        store=Store(str(path));c=make().config
        rt=RoomRuntime.create(store,VaultService(store),Hub(),owner='0x'+'11'*20,config=c)
        for p in ['0x'+'11'*20,'0x'+'22'*20]:rt.join(p);rt.set_ready(p)
        await rt.start(100)
        match=rt.round_id
        for p,choice in [('0x'+'11'*20,'rock'),('0x'+'22'*20,'scissors')]:
            assert (await rt.act(p,dict(kind='commit',roundId=match,subroundIndex=0,choice=choice,salt='ab'*16),101))['ok']
        if restart:rt=RoomRuntime.load(store,VaultService(store),Hub(),rt.room_id)
        for t in range(102,131):
            await rt.tick(t)
            if t==115:
                for p,choice in [('0x'+'11'*20,'rock'),('0x'+'22'*20,'scissors')]:
                    await rt.act(p,dict(kind='commit',roundId=match,subroundIndex=1,choice=choice,salt='ab'*16),116)
        assert rt.engine.eligible()=={'0x'+'11'*20} and rt.finished_at==130
        log=store.actions_since(rt.room_id,0)
        transitions=[__import__('json').loads(a['payload']) for a in log if a['who']=='clock']
        assert len(transitions)==4
        assert [a['at'] for a in transitions]==[110,115,125,130]
        assert len(store.entitlements_for_round(match))==1
        return rt.engine.scores(),rt.engine.ranking(),transitions
    before=asyncio.run(run(False,tmp_path/'one.db'));after=asyncio.run(run(True,tmp_path/'two.db'))
    assert before[:2]==after[:2]
    assert [{k:v for k,v in t.items() if k!='roundId'} for t in before[2]]==[{k:v for k,v in t.items() if k!='roundId'} for t in after[2]]
    async def outage():
        store=Store(str(tmp_path/'outage.db'));rt=RoomRuntime.create(store,VaultService(store),Hub(),owner='0x'+'11'*20,config=make().config)
        for p in ['0x'+'11'*20,'0x'+'22'*20]:rt.join(p);rt.set_ready(p)
        await rt.start(100);await rt.tick(111)
        assert rt.status==lc.RECOVERY_REQUIRED and not store.entitlements_for_round(rt.round_id)
    asyncio.run(outage())
