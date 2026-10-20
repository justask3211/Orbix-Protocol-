import time
import pytest
from fastapi.testclient import TestClient
from eth_account import Account
from center.api import create_app
from center.admin_games import GameConfig
from center.edge_host import room_host
from center.tests.test_flow import sign_in


def test_default_host_legacy_parallel_and_no_funded_cf_publish(tmp_path):
    admin=Account.create();app=create_app(db_path=str(tmp_path/'edge.db'),admin_address=admin.address)
    with TestClient(app) as c:
        h=sign_in(c,admin)
        config={'template_id':'combat-duel','name':'Parallel hosts','visibility':'public','rules':{'templateId':'combat-duel','world_version':4},'admission':{'player_cap':2,'min_ready_to_start':2}}
        # combat-duel is in later test catalogs on some baselines; use explicit rules.
        r=c.post('/api/center/v1/rooms',json={'config':config,'intentNonce':'railway-before'},headers=h)
        assert r.status_code==200,r.text
        rid=r.json()['roomId']
        assert room_host(app.state.store,rid)=='railway'
        body=GameConfig(host='cloudflare')
        app.state.admin_games.customize(admin.address,'combat-duel',body)
        assert c.get('/api/center/v1/rooms').json()['rooms'][0]['hostType']=='railway'
        assert c.get(f'/api/center/v1/rooms/{rid}',headers=h).json()['hostType']=='railway'
        assert c.post(f'/api/center/v1/rooms/{rid}/join',json={},headers=h).status_code==200
        blocked=c.post('/api/center/v1/rooms',json={'config':config,'intentNonce':'cf-after'},headers=h)
        assert blocked.status_code==409,blocked.text
        assert blocked.json()['detail']['code']=='CLOUDFLARE_RUNTIME_NOT_READY'
        assert len(app.state.store.list_rooms())==1
        assert not c.get('/api/center/v1/multiplayer/capabilities').json()['cloudflareReady']
        with pytest.raises(Exception):app.state.admin_games.customize(admin.address,'number-hunt',body)


def test_tournament_cannot_bypass_host_guard(tmp_path):
    app=create_app(db_path=str(tmp_path/'edge-tournament.db'))
    app.state.store.set_setting('game-config:combat-duel',{'host':'cloudflare'})
    from center.tests.test_tournaments import cfg
    from center.schema import RoomConfig
    room=RoomConfig(template_id='combat-duel',name='CF Tournament',rules={'templateId':'combat-duel','world_version':4},admission={'player_cap':2,'min_ready_to_start':2})
    with pytest.raises(Exception,match='409'):
        app.state.tournaments.create('0x'+'11'*20,cfg(room=room,registration_close=int(time.time())+1000),'edge-tourney')
