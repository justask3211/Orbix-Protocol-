"""A finished match permits explicit collection from winners and non-winners."""
import asyncio
import copy
import csv
import io

import pytest
from eth_account import Account
from fastapi.testclient import TestClient

from center.api import API_PREFIX
from center.schema import RoomConfig, normalise_keys
from center.tests.test_flow import HUNT, make_app, sign_in, fund_and_publish


@pytest.fixture
def game(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        host, winner, loser, outsider = [Account.create() for _ in range(4)]
        config = copy.deepcopy(HUNT)
        config['waitlist'] = {'enabled': True, 'message': 'Join our next event — participation is optional.'}
        owner, room = fund_and_publish(client, host, cfg=config)
        room_id = room['roomId']
        headers = [sign_in(client, p) for p in (winner, loser, outsider)]
        for h in headers[:2]:
            assert client.post(f'{API_PREFIX}/rooms/{room_id}/join', headers=h, json={}).status_code == 200
            client.post(f'{API_PREFIX}/rooms/{room_id}/ready', headers=h, json={'ready': True})
        assert client.post(f'{API_PREFIX}/rooms/{room_id}/start', headers=owner).status_code == 200
        yield app, client, room_id, owner, headers, winner, loser


def finish(app, room_id):
    rt = app.state.runtimes[room_id]
    # Authoritative engine records an actual winner; the other player has no entitlement.
    asyncio.run(rt.act(rt.engine.participants[0], {'kind':'guess','number':rt.engine.targets[0]}))
    assert rt.engine.finished


def test_explicit_submission_and_owner_export(game):
    app, client, rid, owner, headers, winner, loser = game
    path = f'{API_PREFIX}/rooms/{rid}/waitlist'
    arbitrary = '0x' + 'Ab' * 20
    assert client.get(path, headers=owner).json()['count'] == 0
    assert client.post(path, headers=headers[1], json={'wallet':arbitrary}).status_code == 409
    finish(app,rid)
    # Finish never auto-collects an address. Both placements can now choose any wallet.
    assert client.get(path, headers=owner).json()['count'] == 0
    detail=client.get(f'{API_PREFIX}/rooms/{rid}',headers=headers[1]).json()
    assert detail['config']['waitlist']['message'].startswith('Join our next event')
    for h in headers[:2]:
        response=client.post(path,headers=h,json={'wallet':arbitrary})
        assert response.status_code == 200, response.text
        assert response.json()['wallet'] == arbitrary.lower()
    replay=client.post(path,headers=headers[1],json={'wallet':winner.address}).json()
    assert replay['replayed'] and replay['wallet'] == arbitrary.lower()
    listing=client.get(path,headers=owner).json()
    assert listing['count']==2 and listing['uniqueWallets']==1
    assert {e['player'] for e in listing['entries']} == {winner.address.lower(),loser.address.lower()}
    assert all(e['createdAt']>0 for e in listing['entries'])
    for h in headers:
        assert client.get(path,headers=h).status_code==403
        assert client.get(path+'.csv',headers=h).status_code==403
    assert client.get(path).status_code==401
    assert client.post(path,headers=headers[2],json={'wallet':arbitrary}).status_code==403
    response=client.get(path+'.csv',headers=owner)
    assert response.headers['content-type'].startswith('text/csv')
    assert len(list(csv.reader(io.StringIO(response.text))))==3
    assert app.state.store.verify_audit_chain()['ok']
    assert {'waitlist.submit','waitlist.read','waitlist.export'} <= {e['action'] for e in app.state.store.list_audit()}
    # Durable after runtime restart, still deduped per player per room.
    app.state.runtimes.pop(rid)
    assert client.post(path,headers=headers[1],json={'wallet':arbitrary}).json()['replayed']


@pytest.mark.parametrize('wallet',['0x123','0x'+'gg'*20,'1x'+'ab'*20,'0x'+'ab'*21,' '+ '0x'+'ab'*20])
def test_invalid_addresses(game,wallet):
    app,client,rid,owner,headers,*_=game
    finish(app,rid)
    assert client.post(f'{API_PREFIX}/rooms/{rid}/waitlist',headers=headers[0],json={'wallet':wallet}).status_code==422
    assert client.get(f'{API_PREFIX}/rooms/{rid}/waitlist',headers=owner).json()['count']==0


def test_disabled_and_message_bounds(tmp_path):
    assert not RoomConfig(**normalise_keys(HUNT)).waitlist.enabled
    for message in ['a'*281,'bad\x00message']:
        with pytest.raises(ValueError):
            RoomConfig(**normalise_keys({**HUNT,'waitlist':{'enabled':True,'message':message}}))
    app=make_app(tmp_path)
    with TestClient(app) as client:
        h,room=fund_and_publish(client,Account.create())
        assert client.post(f"{API_PREFIX}/rooms/{room['roomId']}/waitlist",headers=h,json={'wallet':'0x'+'ab'*20}).status_code==409


def test_rate_limit_persists_and_reads_are_owner_only(game):
    app,client,rid,owner,headers,*_=game
    path=f'{API_PREFIX}/rooms/{rid}/waitlist'
    for _ in range(30):
        assert client.get(path,headers=owner).status_code==200
    assert client.get(path,headers=owner).status_code==429
    assert client.get(path+'.csv',headers=owner).status_code==429


def test_address_collection_does_not_change_gameplay_commitment():
    original = RoomConfig(**normalise_keys(HUNT))
    collecting = RoomConfig(**normalise_keys({**HUNT, 'waitlist': {'enabled': True, 'message': 'Optional list'}}))
    assert original.config_hash_input() == collecting.config_hash_input()
    with pytest.raises(ValueError):
        RoomConfig(**normalise_keys({**HUNT, 'waitlist': {'enabled': 'true'}}))
