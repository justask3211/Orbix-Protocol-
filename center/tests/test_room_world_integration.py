"""Room-bound authority, admission, and restart integration regressions."""
import asyncio
import json
from copy import deepcopy

from eth_account import Account
from fastapi.testclient import TestClient

from center.api import API_PREFIX
from center.entry_gate import EntryGateError
from center.room import RoomRuntime, Hub
from center.schema import RoomConfig
from center.store import Store
from center.vault import VaultService
from center.tests.test_flow import HUNT, make_app, fund_and_publish, sign_in
from center.tests.test_game_world_mechanics import configuration, ALICE, BOB, ROUND, SEED
from center.games.number_hunt import NumberHuntEngine
from center import settlement as st


def test_paid_http_admission_is_checked_by_authority_before_membership(tmp_path):
    app = make_app(tmp_path)
    class Gate:
        code = 'ENTRY_PAYMENT_REQUIRED'
        calls = []
        def require(self, *args, **kwargs):
            self.calls.append(args)
            if self.code:
                raise EntryGateError(self.code, 'Entry must be verified.')
    gate = Gate()
    app.state.entry_gate = gate
    with TestClient(app) as client:
        host, player = Account.create(), Account.create()
        cfg = deepcopy(HUNT)
        cfg['entry'] = {'kind': 'erc20', 'token': '0x'+'33'*20, 'amount': 7}
        headers, published = fund_and_publish(client, host, cfg=cfg)
        room_id = published['roomId']
        player_headers = sign_in(client, player)
        path = f'{API_PREFIX}/rooms/{room_id}/join'
        refused = client.post(path, headers=player_headers, json={})
        assert refused.status_code == 403
        assert refused.json()['detail']['code'] == 'ENTRY_PAYMENT_REQUIRED'
        assert app.state.store.participants(room_id) == []
        gate.code = 'ENTRY_RPC_UNAVAILABLE'
        assert client.post(path, headers=player_headers, json={}).status_code == 503
        gate.code = None
        accepted = client.post(path, headers=player_headers, json={})
        assert accepted.status_code == 200 and accepted.json()['ticket']
        assert gate.calls[-1] == (room_id, player.address.lower(), host.address.lower(), '0x'+'33'*20, 7)
        assert client.post(path, headers=player_headers, json={}).status_code == 200
        assert len(app.state.store.participants(room_id)) == 1


def test_private_spectator_requires_invite_and_cannot_bypass_player_gate(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        host, guest = Account.create(), Account.create()
        cfg = deepcopy(HUNT)
        cfg['visibility'] = 'private'
        cfg['admission']['spectators'] = True
        headers, room = fund_and_publish(client, host, cfg=cfg)
        guest_headers = sign_in(client, guest)
        response = client.post(f"{API_PREFIX}/rooms/{room['roomId']}/join", headers=guest_headers, json={'role':'spectator'})
        assert response.status_code == 403
        assert response.json()['detail']['code'] == 'INVITE_REQUIRED'


def test_recovered_finished_world_keeps_scores_and_full_claim_codes(tmp_path):
    async def scenario():
        store = Store(str(tmp_path/'restore.db'))
        config = configuration('number-hunt', {'digits':4,'min':1111,'max':9999,'guess_budget':10,'duration_seconds':60}, cap=2)
        rt = RoomRuntime.create(store, VaultService(store), Hub(), owner=ALICE, config=config)
        for player in (ALICE, BOB):
            rt.join(player); rt.set_ready(player)
        await rt.start(100)
        await rt.act(ALICE, {'kind':'guess', 'number':rt.engine.targets[0]}, 101)
        before = rt.settlement_frame()
        assert before['payload']['allocations']
        recovered = RoomRuntime.load(store, VaultService(store), Hub(), rt.room_id)
        assert recovered.engine.finished
        assert recovered.engine.scores() == rt.engine.scores()
        restored = recovered.settlement_frame()
        assert restored['payload']['allocations'][0]['code'] == before['payload']['allocations'][0]['code']
        for allocation in restored['payload']['allocations']:
            assert allocation['code'] == st.payment_code(allocation['claimId'])
    asyncio.run(scenario())


def test_private_hunt_hint_restores_only_to_its_authenticated_player():
    cfg = configuration('number-hunt', {'digits':4,'min':1111,'max':9999,'guess_budget':10,'duration_seconds':60,'hints':'on','hint_visibility':'private'}, cap=2)
    engine = NumberHuntEngine(cfg, ROUND, SEED, [ALICE, BOB])
    engine.start(100)
    guess = 1111 if engine.targets[0] != 1111 else 9999
    result = engine.act(ALICE, {'kind':'guess','number':guess}, 101)
    restored = NumberHuntEngine.restore(cfg, ROUND, SEED, engine.snapshot())
    assert restored.private_state(ALICE)['privateHint'] == result.private['hint']
    assert restored.private_state(BOB) == {}
    assert 'privateHint' not in restored.public_state()


def test_duel_action_reaches_opponent_without_disclosing_pending_choice(tmp_path):
    async def scenario():
        store = Store(str(tmp_path/'duel-broadcast.db'))
        hub = Hub()
        cfg = configuration('reaction-duel', {'rounds':3}, cap=2)
        rt = RoomRuntime.create(store, VaultService(store), hub, owner=ALICE, config=cfg)
        for player in (ALICE, BOB):
            rt.join(player); rt.set_ready(player)
        await rt.start(100)
        await hub.register('alice', rt.room_id, ALICE, None)
        await hub.register('bob', rt.room_id, BOB, None)
        await rt.act(ALICE, {'kind':'commit', 'choice':'rock', 'salt':'secret-a'}, 101)
        first = hub._conns['bob']['queue'].get_nowait()
        assert first['type'] == 'game.patch'
        assert first['payload']['committed'] == {ALICE:True, BOB:False}
        assert 'secret-a' not in json.dumps(first) and '"rock"' not in json.dumps(first)
        await rt.act(BOB, {'kind':'commit', 'choice':'scissors', 'salt':'secret-b'}, 102)
        frames = []
        queue = hub._conns['alice']['queue']
        while not queue.empty():
            frames.append(queue.get_nowait())
        patch = [frame for frame in frames if frame['type'] == 'game.patch'][-1]
        assert patch['payload']['phase'] == 'reveal'
        assert all(patch['payload']['committed'].values())
        encoded = json.dumps(patch)
        assert 'secret-b' not in encoded and '"scissors"' not in encoded
    asyncio.run(scenario())
