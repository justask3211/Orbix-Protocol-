"""Signed per-template presentation and admission gates are durable and atomic."""
import copy
import sqlite3
import pytest
from eth_account import Account
from fastapi.testclient import TestClient
from center.admin_games import GameConfig, game_config
from center.api import API_PREFIX as P
from center.store import Store
from center.tests.test_admin_pricing import make_app, sign_in, admin_proof
from center.tests.test_flow import fund_and_publish, HUNT


@pytest.fixture
def setup(tmp_path):
    admin, host, player = Account.create(), Account.create(), Account.create()
    app = make_app(tmp_path, admin_address=admin.address)
    with TestClient(app) as client:
        headers = sign_in(client, admin)
        def save(config, tid='number-hunt'):
            return client.patch(f'{P}/admin/games/{tid}/config', headers={**headers, 'X-Admin-Proof': admin_proof(client, admin)}, json=config)
        yield app, client, save, host, player, admin, headers
    app.state.store.close()


def template(client, tid='number-hunt'):
    return next(t for t in client.get(P+'/templates').json()['templates'] if t['templateId']==tid)


def test_placements_effective_modes_and_sort(setup):
    app, client, save, *_ = setup
    cfg = GameConfig().model_dump()
    for placement in ['more', 'upcoming', 'hidden', 'catalog']:
        cfg.update(placement=placement, sort_order=-50)
        assert save(cfg).status_code==200
        item=template(client)
        assert item['placement']==placement and item['sort_order']==-50
        assert item['available_modes']['create']==(placement in {'catalog','more'})
        assert item['available_modes']['preview']==(placement!='hidden')
        assert client.get(P+'/templates').json()['templates'][0]['templateId']=='number-hunt'
    assert app.state.store.verify_audit_chain()['ok']
    assert sum(e['action']=='game.customization' for e in app.state.store.list_audit())==4


def test_persistence_proof_and_nested_badges(setup, tmp_path):
    app, client, save, *_ = setup
    cfg=GameConfig().model_dump()
    cfg['overlay'].update(text='80% built', color='#0123ab', position='bottom-left')
    cfg['tag'].update(enabled=True, text='Testing with friends', style='outline')
    saved=save(cfg).json()
    assert saved['updated_at'] and saved['admin_proof']['signature_hash']
    assert template(client)['overlay']==cfg['overlay']
    assert template(client)['tag']==cfg['tag']
    assert 'admin_proof' not in template(client)
    reopened=Store(str(tmp_path/'center.db'))
    assert game_config(reopened,'number-hunt')==saved
    assert reopened.verify_audit_chain()['ok']
    reopened.close()


@pytest.mark.parametrize('bad', [
    {'placement':'featured'}, {'surprise':True}, {'updated_at':0}, {'sort_order':True}, {'sort_order':1.5},
    {'overlay':{'text':'x'*41}}, {'tag':{'text':'x'*41}}, {'overlay':{'enabled':1}},
    {'overlay':{'color':'url(evil)'}}, {'overlay':{'position':'center'}}, {'overlay':{'unknown':False}},
    {'tag':{'style':'invented'}}, {'modes':{'create':'false'}}, {'modes':{'join':0}}, {'modes':{'extra':True}},
])
def test_strict_validation(setup,bad):
    app, _, save, *_=setup
    assert save(bad).status_code==422
    assert not any(e['action']=='game.customization' for e in app.state.store.list_audit())


def test_publish_join_and_practice_gated_before_side_effects(setup):
    app, client, save, host, player, *_=setup
    host_headers, room=fund_and_publish(client,host)
    player_headers=sign_in(client,player)
    cfg=GameConfig().model_dump()
    cfg['modes'].update(create=False, join=False, practice=False)
    assert save(cfg).status_code==200
    before=app.state.store.ledger(host.address.lower())
    assert client.post(P+'/rooms',headers=host_headers,json={'config':HUNT,'intentNonce':'disabled'}).status_code==409
    assert client.post(P+'/rooms/'+room['roomId']+'/join',headers=player_headers,json={}).status_code==409
    assert client.post(P+'/practice',json={'templateId':'number-hunt'}).status_code==409
    assert not app.state.practice_matches
    assert app.state.store.ledger(host.address.lower())==before
    assert not app.state.store.participants(room['roomId'])
    assert not client.get(P+'/rooms').json()['rooms']
    cfg['modes'].update(create=True,join=True,practice=True)
    assert save(cfg).status_code==200
    assert client.post(P+'/rooms/'+room['roomId']+'/join',headers=player_headers,json={}).status_code==200
    assert client.post(P+'/practice',json={'templateId':'number-hunt'}).status_code==200


def test_upcoming_blocks_admission_even_with_saved_toggles_on(setup):
    app, client, save, host, player, *_=setup
    h, room=fund_and_publish(client,host)
    cfg=GameConfig(placement='upcoming').model_dump()
    assert save(cfg).status_code==200
    assert client.post(P+'/rooms',headers=h,json={'config':HUNT}).status_code==409
    assert client.post(P+'/rooms/'+room['roomId']+'/join',headers=sign_in(client,player),json={}).status_code==409
    assert template(client)['available_modes']=={'practice':False,'preview':True,'create':False,'join':False}


def test_single_use_proof_exact_admin_and_unknown_game(setup):
    _, client, save, _, outsider, admin, headers=setup
    route=P+'/admin/games/number-hunt/config'
    body=GameConfig().model_dump()
    assert client.patch(route,headers=headers,json=body).status_code==403
    signed={**headers,'X-Admin-Proof':admin_proof(client,admin)}
    assert client.patch(route,headers=signed,json=body).status_code==200
    assert client.patch(route,headers=signed,json=body).status_code==403
    assert client.patch(route,headers=sign_in(client,outsider),json=body).status_code==403
    assert save(body,'no-such-game').status_code==404


def test_failed_audit_rolls_back_configuration(setup):
    app, _, _, _, _, admin, _=setup
    before=game_config(app.state.store,'number-hunt')
    with app.state.store.tx() as cx:
        cx.execute("CREATE TRIGGER reject_config_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
    with pytest.raises(sqlite3.IntegrityError):
        app.state.admin_games.customize(admin.address,'number-hunt',GameConfig(placement='hidden'))
    assert game_config(app.state.store,'number-hunt')==before
