from fastapi.testclient import TestClient
import pytest
from center.api import API_PREFIX
from center.tests.test_flow import make_app
from center.tests.test_arena_games import arena,ALICE


@pytest.mark.parametrize('template',['number-hunt','token-catch','boss-raid','combat-duel','reaction-duel'])
def test_practice_needs_no_wallet_or_room_and_creates_no_financial_records(tmp_path,template):
    app=make_app(tmp_path)
    with TestClient(app) as client:
        result=client.post(API_PREFIX+'/practice',json={'templateId':template})
        assert result.status_code==200,result.text
        data=result.json()
        assert data['practice'] and data['rewards']=='none' and data['state']
        path=API_PREFIX+'/practice/'+data['practiceId']
        headers={'X-Practice-Token':data['accessToken']}
        assert client.get(path,headers=headers).status_code==200
        assert client.get(path,headers={'X-Practice-Token':'forged'}).status_code==404
        with app.state.store.tx() as cx:
            for table in ('rooms','rounds','entitlements','ledger'):
                assert cx.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==0
        assert client.delete(path,headers=headers).status_code==200
        assert client.get(path,headers=headers).status_code==404


def test_practice_authority_rejects_unsequenced_position_and_releases_guard(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        data=client.post(API_PREFIX+'/practice',json={'templateId':'token-catch'}).json()
        path=API_PREFIX+'/practice/'+data['practiceId']+'/actions'
        def action(body):return client.post(path,json={'token':data['accessToken'],'action':body}).json()
        rejected=action({'kind':'move','x':999,'z':999,'dx':0,'dz':0})
        assert not rejected['ok'] and rejected['error']=='INVALID_INPUT_SEQUENCE'
        assert action({'kind':'block','active':True})['ok']
        assert action({'kind':'block','active':False})['ok']
        assert not action({'kind':'block','active':False})['ok']


def test_practice_creation_is_bounded(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        for _ in range(10):assert client.post(API_PREFIX+'/practice',json={'templateId':'number-hunt'}).status_code==200
        assert client.post(API_PREFIX+'/practice',json={'templateId':'number-hunt'}).status_code==429


def test_redundant_character_and_guard_actions_cannot_force_checkpoint_spam():
    engine=arena()
    engine.last_tick=100
    assert engine.act(ALICE,{'kind':'equip','character':'fox'},100).error=='NO_CHANGE'
    assert engine.act(ALICE,{'kind':'equip','character':'robot'},100).ok
    assert engine.act(ALICE,{'kind':'equip','character':'cat'},100.01).error=='CONTROL_RATE_LIMIT'
    assert engine.act(ALICE,{'kind':'block','active':True},100).ok
    assert engine.act(ALICE,{'kind':'block','active':True},100.01).error=='NO_CHANGE'
    assert engine.act(ALICE,{'kind':'block','active':False},100.02).ok
    assert engine.act(ALICE,{'kind':'block','active':True},100.03).error=='CONTROL_RATE_LIMIT'
