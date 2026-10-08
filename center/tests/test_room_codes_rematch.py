"""Durable room aliases and independent, financially bounded rematches."""
import asyncio
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest
from eth_account import Account
from fastapi.testclient import TestClient

from center.api import API_PREFIX
from center.community import CommunityError
from center.entry_gate import EntryGateError
from center.room import Hub, RoomRuntime
from center.schema import RoomConfig, normalise_keys
from center.store import ConflictError, Store
from center.vault import VaultService
from center import settlement as st
from center.tests.test_flow import HUNT, fund_and_publish, make_app, sign_in

ALICE, BOB, OFFLINE = ['0x' + x * 20 for x in ('11', '22', '33')]


def config(**changes):
    raw = deepcopy(HUNT)
    raw['access'] = {'vault_mode': 'simulated', 'required_amount': 0}
    raw.update(changes)
    return RoomConfig(**normalise_keys(raw))


def room(store, *, cfg=None, hub=None):
    return RoomRuntime.create(store, VaultService(store), hub or Hub(), owner=ALICE, config=cfg or config())


def sample_row(identifier):
    cfg = config().model_dump(mode='json')
    return {'id': identifier, 'owner': ALICE, 'template_id': 'number-hunt', 'visibility': 'public',
            'mode': 'preview', 'status': 'registration', 'config': cfg, 'config_hash': '0x' + 'ab' * 32}


def test_collision_retry_and_durable_alias_not_hash_suffix(tmp_path, monkeypatch):
    monkeypatch.setattr('center.store.secrets.randbelow', lambda size: 0)
    path = str(tmp_path / 'codes.db')
    store = Store(path)
    for identifier in ('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc'):
        store.create_room(sample_row(identifier))
    before = {r['id']: r['join_code'] for r in store.list_rooms()}
    assert set(before.values()) == {'100000', '100001', '100002'}
    store.close()
    reopened = Store(path)
    assert {r['id']: r['join_code'] for r in reopened.list_rooms()} == before
    for identifier, code in before.items():
        assert reopened.resolve_room_code(code)['id'] == identifier
    assert reopened.resolve_room_code('000') is None
    reopened.close()


def test_existing_three_digit_codes_are_preserved_while_new_codes_start_at_six(monkeypatch):
    monkeypatch.setattr('center.store.secrets.randbelow', lambda size: 0)
    store = Store(':memory:')
    template = sample_row('unused')
    with store.tx() as cx:
        for code in range(100, 1000):
            identifier = f'{code:016x}'
            cx.execute('INSERT INTO rooms(id,owner,template_id,visibility,mode,status,config_json,config_hash,created_at,updated_at) '
                       'VALUES (?,?,?,?,?,?,?,?,0,0)',
                       (identifier, ALICE, 'number-hunt', 'public', 'preview', 'registration',
                        json.dumps(template['config']), template['config_hash']))
            cx.execute('INSERT INTO room_codes(room_id,join_code) VALUES (?,?)', (identifier, str(code)))
    store.create_room(sample_row('ffffffffffffffff'))
    assert store.get_room('ffffffffffffffff')['join_code'] == '100000'
    assert store.resolve_room_code('100')['id'] == f'{100:016x}'
    assert len(store.list_rooms(limit=1000)) == 901
    store.close()


def test_six_digit_upper_boundary(monkeypatch):
    monkeypatch.setattr('center.store.secrets.randbelow', lambda size: size - 1)
    store = Store(':memory:')
    store.create_room(sample_row('upper-boundary'))
    assert store.get_room('upper-boundary')['join_code'] == '999999'
    store.close()


def test_existing_three_digit_code_resolves_after_database_reopen(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        _, published = fund_and_publish(client, Account.create())
        with app.state.store.tx() as cx:
            cx.execute('UPDATE room_codes SET join_code=? WHERE room_id=?', ('123', published['roomId']))
        assert client.get(f'{API_PREFIX}/rooms/resolve/123').json()['roomId'] == published['roomId']
    with TestClient(make_app(tmp_path)) as client:
        assert client.get(f'{API_PREFIX}/rooms/resolve/123').json()['roomId'] == published['roomId']


def test_legacy_rooms_and_round_metadata_migrate_without_loss(tmp_path):
    path = str(tmp_path / 'legacy.db')
    cx = sqlite3.connect(path)
    cx.executescript('''
    CREATE TABLE rooms(id TEXT PRIMARY KEY,owner TEXT,template_id TEXT,visibility TEXT,mode TEXT,status TEXT,
      config_json TEXT,config_hash TEXT,round_id TEXT,seed TEXT,commit_hash TEXT,revision INTEGER DEFAULT 1,
      created_at REAL,updated_at REAL);
    CREATE TABLE rounds(round_id TEXT PRIMARY KEY,room_id TEXT,seed TEXT,commit_hash TEXT,started_at REAL,
      ended_at REAL,merkle_root TEXT,allocations_hash TEXT,transcript_hash TEXT,settlement_deadline INTEGER,
      settled_at REAL,state TEXT,snapshot_json TEXT);
    ''')
    raw = config().model_dump(mode='json')
    cx.execute('INSERT INTO rooms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
               ('old-room', ALICE, 'number-hunt', 'public', 'preview', 'claimable', json.dumps(raw),
                'frozen-config', 'prior-round', 'prior-seed', 'prior-commit', 7, 10, 20))
    cx.execute('INSERT INTO rounds VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
               ('prior-round', 'old-room', 'prior-seed', 'prior-commit', 10, 20, 'root', 'allocations',
                'transcript', 30, 20, 'claimable', None))
    cx.commit(); cx.close()
    store = Store(path)
    row, rnd = store.get_room('old-room'), store.get_round('prior-round')
    code = row['join_code']
    assert len(code) == 6 and code.isascii() and code.isdigit()
    assert row['revision'] == 7 and rnd['merkle_root'] == 'root'
    assert rnd['config'] == raw and rnd['config_hash'] == 'frozen-config'
    assert rnd['action_start_seq'] == 0
    store.close()
    store = Store(path)
    assert store.get_room('old-room')['join_code'] == code
    store.close()


def test_parallel_store_writers_allocate_unique_codes(tmp_path):
    path = str(tmp_path / 'concurrent.db')
    Store(path).close()
    def publish(index):
        store = Store(path)
        try:
            identifier = f'{index:016x}'
            store.create_room(sample_row(identifier))
            return store.get_room(identifier)['join_code']
        finally:
            store.close()
    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = list(pool.map(publish, range(24)))
    assert len(set(codes)) == 24
    assert all(100000 <= int(code) <= 999999 for code in codes)


def test_public_alias_resolves_but_private_code_does_not_replace_invite(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        host, guest = Account.create(), Account.create()
        headers, public = fund_and_publish(client, host)
        code = public['joinCode']
        assert public['roomNumber'] == code
        assert public['shareUrl'].endswith('/' + code)
        assert client.get(f'{API_PREFIX}/rooms/resolve/{code}').json()['roomId'] == public['roomId']
        replay = client.post(f'{API_PREFIX}/rooms', json={'config': HUNT, 'intentNonce': 'intent-1'}, headers=headers).json()
        assert replay['replayed'] and replay['joinCode'] == code
        cfg = deepcopy(HUNT); cfg['visibility'] = 'private'
        private = client.post(f'{API_PREFIX}/rooms', json={'config': cfg}, headers=headers).json()
        path = f"{API_PREFIX}/rooms/resolve/{private['joinCode']}"
        guest_headers = sign_in(client, guest)
        missing = client.get(f'{API_PREFIX}/rooms/resolve/000').json()
        assert client.get(path).status_code == 404
        assert client.get(path, headers=guest_headers).json() == missing
        invite = client.post(f"{API_PREFIX}/rooms/{private['roomId']}/invites", headers=headers).json()
        assert f"/{private['joinCode']}?invite=" in invite['shareUrl']
        assert client.get(path, params={'invite': invite['invite']}).status_code == 404
        assert client.get(path, params={'invite': invite['invite']}, headers=guest_headers).json()['roomId'] == private['roomId']
        assert client.post(f"{API_PREFIX}/rooms/{private['roomId']}/join", json={}, headers=guest_headers).status_code == 403
        assert client.post(f"{API_PREFIX}/rooms/{private['roomId']}/join", json={'invite': invite['invite']}, headers=guest_headers).status_code == 200


def test_numeric_resolution_cannot_bypass_paid_admission(tmp_path):
    app = make_app(tmp_path)
    class Gate:
        calls = 0
        def require(self, *args, **kwargs):
            self.calls += 1
            raise EntryGateError('ENTRY_PAYMENT_REQUIRED', 'Verified payment required')
    app.state.entry_gate = gate = Gate()
    with TestClient(app) as client:
        host, guest = Account.create(), Account.create()
        cfg = deepcopy(HUNT); cfg['entry'] = {'kind': 'erc20', 'token': '0x' + '44' * 20, 'amount': 2}
        headers, published = fund_and_publish(client, host, cfg=cfg)
        resolved = client.get(f"{API_PREFIX}/rooms/resolve/{published['joinCode']}").json()
        assert resolved['roomId'] == published['roomId'] and gate.calls == 0
        assert app.state.store.participants(resolved['roomId']) == []
        guest_headers = sign_in(client, guest)
        refused = client.post(f"{API_PREFIX}/rooms/{resolved['roomId']}/join", headers=guest_headers, json={})
        assert refused.status_code == 403 and gate.calls == 1
        assert app.state.store.participants(resolved['roomId']) == []


async def finished_preview(store, hub=None):
    rt = room(store, hub=hub)
    for player in (ALICE, BOB, OFFLINE):
        rt.join(player); rt.set_ready(player)
    await rt.start(100)
    await rt.act(ALICE, {'kind': 'guess', 'number': rt.engine.targets[0]}, 101)
    assert rt.status == 'claimable'
    return rt


def test_rematch_preserves_claims_config_history_and_pending_restart(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / 'rematch.db'))
        rt = await finished_preview(store)
        previous = rt.round_id
        before = store.get_round(previous)
        entitlement = store.entitlements_for_round(previous)[0]
        with store.tx() as cx:
            cx.execute('UPDATE entitlements SET claimed_tx=? WHERE claim_id=?', ('confirmed-old-claim', entitlement['claim_id']))
        edited = config(rules={**HUNT['rules'], 'duration_seconds': 180})
        prepared = await rt.prepare_rematch(edited, now=102)
        assert prepared['roomId'] == rt.room_id and prepared['joinCode'] == rt.join_code
        assert prepared['roundId'] != previous and prepared['previousRoundId'] == previous
        assert rt.seed != before['seed'] and rt.commit != before['commit_hash']
        assert all(not p['ready'] for p in store.participants(rt.room_id))
        assert store.get_round(previous) == before
        assert store.entitlements_for_round(previous)[0]['claimed_tx'] == 'confirmed-old-claim'
        recovered = RoomRuntime.load(store, VaultService(store), Hub(), rt.room_id)
        assert recovered.engine is None and recovered.finished_at is None and recovered.deadline() is None
        assert recovered.round_id == prepared['roundId'] and recovered.config.rules.duration_seconds == 180
        assert recovered.settlement_frame() is None and recovered.fairness()['seed'] is None
        assert recovered.fairness()['configHash'] != before['config_hash']
        with pytest.raises(ValueError, match='MATCH_NOT_FINISHED'):
            await recovered.prepare_rematch()
        store.close()
    asyncio.run(scenario())


def test_rematch_starts_only_connected_ready_eligible_players_and_keeps_old_claims(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / 'active.db')); hub = Hub()
        rt = await finished_preview(store, hub)
        assert rt.engine.participants == [ALICE, BOB, OFFLINE]  # first-round behavior preserved
        previous = rt.round_id
        old_claim = store.entitlements_for_round(previous)[0]['claim_id']
        await rt.prepare_rematch(now=102)
        await hub.register('alice', rt.room_id, ALICE, None)
        rt.set_ready(ALICE); rt.set_ready(OFFLINE)
        with pytest.raises(ValueError, match='NOT_READY'):
            await rt.start(103)
        await hub.register('bob', rt.room_id, BOB, None)
        rt.set_ready(BOB)
        await rt.start(104)
        assert rt.engine.participants == [ALICE, BOB]
        assert rt.engine.scores().get(OFFLINE) is None
        await rt.act(BOB, {'kind': 'guess', 'number': rt.engine.targets[0]}, 105)
        assert store.entitlements_for_round(rt.round_id)[0]['claim_id'] != old_claim
        assert store.entitlements_for_round(previous)[0]['claim_id'] == old_claim
        assert len(store.rounds_for_room(rt.room_id)) == 2
        restored = RoomRuntime.load(store, VaultService(store), Hub(), rt.room_id)
        assert restored.engine.scores() == rt.engine.scores()
        store.close()
    asyncio.run(scenario())


@pytest.mark.parametrize('kind', ['paid-entry', 'funded-rewards', 'onchain-access'])
def test_financial_rooms_cannot_reuse_paid_game_or_financial_state(tmp_path, kind):
    async def scenario():
        raw = deepcopy(HUNT)
        if kind == 'paid-entry':
            raw['entry'] = {'kind': 'erc20', 'token': '0x' + '44' * 20, 'amount': 3}
        elif kind == 'funded-rewards':
            raw['mode'] = 'testnet'
            raw['rewards'] = {'kind': 'funded-assets', 'slots': [{'rank': 1, 'asset_kind': 'erc20', 'asset_contract': '0x' + '44' * 20, 'amount': 500}]}
        else:
            raw['mode'] = 'testnet'; raw['access'] = {'vault_mode': 'onchain', 'token': '0x' + '44' * 20}
        store = Store(str(tmp_path / f'{kind}.db'))
        rt = room(store, cfg=RoomConfig(**normalise_keys(raw)))
        before = store.get_room(rt.room_id)
        assert rt.rematch_capability()['requiresFreshRoom']
        with pytest.raises(ValueError, match='FRESH_FUNDED_ROOM_REQUIRED'):
            await rt.prepare_rematch(config())
        assert store.get_room(rt.room_id) == before
        assert store.rounds_for_room(rt.room_id) == []
        store.close()
    asyncio.run(scenario())


def test_preview_cannot_change_into_paid_rematch_or_stale_writer_overwrite(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / 'bounded.db'))
        rt = await finished_preview(store)
        stale = RoomRuntime.load(store, VaultService(store), Hub(), rt.room_id)
        paid = config(entry={'kind': 'erc20', 'token': '0x' + '44' * 20, 'amount': 1})
        before = store.get_room(rt.room_id)
        with pytest.raises(ValueError, match='FRESH_FUNDED_ROOM_REQUIRED'):
            await rt.prepare_rematch(paid)
        assert store.get_room(rt.room_id) == before
        await rt.prepare_rematch(now=102)
        with pytest.raises(ConflictError):
            await stale.prepare_rematch(now=102)
        assert len(store.rounds_for_room(rt.room_id)) == 2
        store.close()
    asyncio.run(scenario())


def receive_until(socket, frame_type):
    for _ in range(30):
        frame = socket.receive_json()
        if frame['type'] == frame_type:
            return frame
    raise AssertionError(f'Missing {frame_type} frame')


def test_spectator_readiness_is_rejected_without_disconnect(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        host, spectator = Account.create(), Account.create()
        spectator_config = deepcopy(HUNT)
        spectator_config['admission']['spectators'] = True
        _, published = fund_and_publish(client, host, cfg=spectator_config)
        headers = sign_in(client, spectator)
        room_id = published['roomId']; path = f'{API_PREFIX}/rooms/{room_id}'
        ticket = client.post(path + '/join', headers=headers, json={'role': 'spectator'}).json()['ticket']
        with client.websocket_connect(f'{API_PREFIX}/ws/rooms/{room_id}') as socket:
            socket.send_json({'type': 'session.hello', 'ticket': ticket})
            receive_until(socket, 'session.ready')
            socket.send_json({'type': 'participant.ready', 'ready': True})
            assert receive_until(socket, 'error')['payload']['code'] == 'NOT_ADMITTED'
            socket.send_json({'type': 'connection.ping'})
            receive_until(socket, 'connection.pong')
            member = next(p for p in client.get(path, headers=headers).json()['participants']
                          if p['who'] == spectator.address.lower())
            assert member['role'] == 'spectator' and not member['ready'] and not member['connected']


def test_authenticated_websocket_rematch_history_and_refresh_settlement(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        host, guest, offline = Account.create(), Account.create(), Account.create()
        headers, published = fund_and_publish(client, host)
        guest_headers, offline_headers = sign_in(client, guest), sign_in(client, offline)
        room_id = published['roomId']; path = f'{API_PREFIX}/rooms/{room_id}'
        tickets = []
        for auth in (headers, guest_headers, offline_headers):
            tickets.append(client.post(path + '/join', headers=auth, json={}).json()['ticket'])
            assert client.post(path + '/ready', headers=auth, json={}).status_code == 200
        with client.websocket_connect(f'{API_PREFIX}/ws/rooms/{room_id}') as host_socket, \
             client.websocket_connect(f'{API_PREFIX}/ws/rooms/{room_id}') as guest_socket:
            host_socket.send_json({'type': 'session.hello', 'ticket': tickets[0]})
            guest_socket.send_json({'type': 'session.hello', 'ticket': tickets[1]})
            assert receive_until(host_socket, 'session.ready')['joinCode'] == published['joinCode']
            receive_until(guest_socket, 'session.ready')
            started = client.post(path + '/start', headers=headers).json()
            rt = app.state.runtimes[room_id]
            assert len(rt.engine.participants) == 3  # pre-rematch admission semantics
            host_socket.send_json({'type': 'action', 'payload': {'kind': 'guess', 'number': rt.engine.targets[0]}})
            first = receive_until(host_socket, 'settlement.finalized')
            old_id = first['roundId']
            assert client.get(path, headers=headers).json()['settlement']['allocations']
            assert client.get(path).json()['settlement'] is None
            assert client.get(path, headers=guest_headers).json()['settlement']['allocations'] == []
            assert client.post(path + '/rematch', headers=guest_headers, json={}).status_code == 403
            prepared = client.post(path + '/rematch', headers=headers, json={})
            assert prepared.status_code == 200, prepared.json()
            prepared = prepared.json()
            assert prepared['roundId'] != old_id and prepared['previousRoundId'] == old_id
            assert receive_until(host_socket, 'room.rematch')['roundId'] == prepared['roundId']
            assert receive_until(guest_socket, 'room.rematch')['payload']['readinessReset']
            lobby = client.get(path, headers=headers).json()
            assert lobby['settlement'] is None and not any(p['ready'] for p in lobby['participants'])
            for auth in (headers, offline_headers):
                client.post(path + '/ready', headers=auth, json={})
            assert client.post(path + '/start', headers=headers).json()['detail']['code'] == 'NOT_READY'
            client.post(path + '/ready', headers=guest_headers, json={})
            assert client.post(path + '/start', headers=headers).json()['roundId'] == prepared['roundId']
            assert set(rt.engine.participants) == {host.address.lower(), guest.address.lower()}
            guest_socket.send_json({'type': 'action', 'payload': {'kind': 'guess', 'number': rt.engine.targets[0]}})
            second = receive_until(guest_socket, 'settlement.finalized')
            assert second['roundId'] != first['roundId']
            assert second['payload']['allocations'][0]['claimId'] != first['payload']['allocations'][0]['claimId']
            history = client.get(path + '/history', headers=headers).json()
            assert {r['roundId'] for r in history['rounds']} == {old_id, prepared['roundId']}
            assert all(r['entitlements'] for r in history['rounds'])
            assert all(not r['entitlements'] for r in client.get(path + '/history').json()['rounds'])
            assert client.get(f'{API_PREFIX}/rounds/{old_id}/fairness').json()['seed']
            # F5/recovery obtains the current settlement without socket rejoining.
            app.state.runtimes.pop(room_id)
            refreshed = client.get(path, headers=guest_headers).json()
            assert refreshed['roundId'] == second['roundId']
            assert refreshed['settlement']['allocations'][0]['claimId'] == second['payload']['allocations'][0]['claimId']


def test_edited_rematch_preserves_old_hints_and_rotates_new_presets(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / 'hints.db')); hub = Hub()
        cfg = config(community_settings={'timed_hints': [{'delay_seconds': 0, 'text': 'Old clue'}]})
        rt = room(store, cfg=cfg, hub=hub)
        rt.community.initialize(rt.room_id, ALICE, cfg.community_settings)
        for player in (ALICE, BOB):
            rt.join(player); rt.set_ready(player)
        await rt.start(100)
        rt.community.deliver_hints(rt.room_id, 100, 100)
        old_id = rt.round_id
        await rt.act(ALICE, {'kind': 'guess', 'number': rt.engine.targets[0]}, 101)
        edited = config(community_settings={'mute_chat': True, 'timed_hints': [{'delay_seconds': 0, 'text': 'New clue'}]})
        await rt.prepare_rematch(edited, now=102)
        for player in (ALICE, BOB):
            await hub.register(player, rt.room_id, player, None)
            rt.set_ready(player)
        await rt.start(103)
        rt.community.deliver_hints(rt.room_id, 103, 103)
        with store.tx() as cx:
            messages = [r[0] for r in cx.execute("SELECT text FROM room_community_messages WHERE kind='hint' ORDER BY id")]
            deliveries = [r[0] for r in cx.execute('SELECT round_id FROM room_community_hint_deliveries')]
        assert messages == ['Old clue', 'New clue']
        assert set(deliveries) == {old_id, rt.round_id}
        assert rt.community.public_settings(rt.room_id)['muteChat']
        assert store.get_round(old_id)['config']['community_settings']['timed_hints'][0]['text'] == 'Old clue'
        store.close()
    asyncio.run(scenario())


def test_rematch_suspension_and_spectator_cannot_count_as_ready_player(tmp_path):
    async def scenario():
        store = Store(str(tmp_path / 'eligible.db')); hub = Hub()
        rt = await finished_preview(store, hub)
        await rt.prepare_rematch(now=102)
        for player in (ALICE, BOB, OFFLINE):
            rt.set_ready(player)
            await hub.register(player, rt.room_id, player, None, role='spectator' if player == OFFLINE else 'player')
        def guard(who):
            if who == BOB:
                raise CommunityError('PLAYER_SUSPENDED', 'Suspended for this match', 403)
        rt.action_guard = guard
        with pytest.raises(ValueError, match='NOT_READY'):
            await rt.start(103)
        rt.action_guard = None
        await rt.start(104)
        assert rt.engine.participants == [ALICE, BOB]
        store.close()
    asyncio.run(scenario())


def test_arena_rematch_transcript_does_not_include_previous_match_inputs(tmp_path):
    async def scenario():
        raw = config().model_dump(mode='json')
        raw['template_id'] = 'combat-duel'
        raw['rules'] = {'templateId': 'combat-duel', 'world_version': 3, 'duration_seconds': 60}
        raw['admission'] = {'player_cap': 2, 'min_ready_to_start': 2}
        store = Store(str(tmp_path / 'arena-transcript.db')); hub = Hub()
        rt = room(store, cfg=RoomConfig(**raw), hub=hub)
        for player in (ALICE, BOB):
            rt.join(player); rt.set_ready(player)
        await rt.start(100)
        assert (await rt.act(ALICE, {'kind': 'move', 'seq': 1, 'dx': 1, 'dz': 0}, 100.1))['ok']
        await rt.finish(101)
        first = store.get_round(rt.round_id)
        assert store.actions_since(rt.room_id, 0)
        await rt.prepare_rematch(now=102)
        boundary = store.get_round(rt.round_id)['action_start_seq']
        assert boundary > 0
        for player in (ALICE, BOB):
            await hub.register(player, rt.room_id, player, None)
            rt.set_ready(player)
        await rt.start(103)
        assert (await rt.act(BOB, {'kind': 'move', 'seq': 1, 'dx': -1, 'dz': 0}, 103.1))['ok']
        await rt.finish(104)
        current = store.get_round(rt.round_id)
        inputs = [{'who': a['who'], 'action': json.loads(a['payload']), 'at': a['at']}
                  for a in store.actions_since(rt.room_id, boundary) if a['accepted']]
        assert len(inputs) == 1 and inputs[0]['who'] == BOB
        assert current['transcript_hash'] == '0x' + st.transcript_hash(rt.round_id, inputs).hex()
        assert store.get_round(first['round_id']) == first
        store.close()
    asyncio.run(scenario())
