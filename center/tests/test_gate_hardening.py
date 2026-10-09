"""Owner anchoring, signature compatibility, fail-closed signer and room cutover."""
from copy import deepcopy

import pytest
from eth_abi import decode, encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak
from fastapi.testclient import TestClient

from center.api import API_PREFIX, Auth, create_app
from center.entry_gate import EntryGateVerifier, EntryGateError, DEPLOYED_GATE, room_id_bytes32
from center.tests.test_flow import HUNT, fund_and_publish, sign_in

NEW_GATE = '0x' + '77' * 20
ROOM = '0123456789abcdef'


class AuthorizationRpc:
    def __init__(self, signer):
        self.signer = signer
        self.version = 3
        self.chain = '0xb626'
        self.calls = []

    def call(self, method, params):
        self.calls.append((method, params))
        if method == 'eth_chainId':
            return self.chain
        if method == 'eth_call':
            selector = params[0]['data'][:10]
            if selector == '0x' + keccak(text='safetyVersion()')[:4].hex():
                return '0x' + encode(['uint256'], [self.version]).hex()
            if selector == '0x' + keccak(text='bindingAuthority()')[:4].hex():
                return '0x' + encode(['address'], [self.signer]).hex()
        raise OSError('RPC unavailable')


def test_namespace_proof_matches_solidity_packed_protocol_and_never_sends_money():
    signer, creator = Account.create(), Account.create()
    rpc = AuthorizationRpc(signer.address)
    proof = EntryGateVerifier(rpc, NEW_GATE).binding_authorization(ROOM, creator.address, signer.key.hex(), 2000)
    digest = keccak(b'ORBIX_ROOM_BIND_V1' + bytes.fromhex(NEW_GATE[2:]) + (46630).to_bytes(32,'big')
                    + room_id_bytes32(ROOM) + bytes.fromhex(creator.address[2:]) + (2000).to_bytes(32,'big'))
    assert Account.recover_message(encode_defunct(primitive=digest), signature=proof['signature']) == signer.address
    assert proof['creator'] == creator.address.lower() and proof['roomKey'] == '0x' + room_id_bytes32(ROOM).hex()
    assert all(method in {'eth_chainId','eth_call'} for method, _ in rpc.calls)


@pytest.mark.parametrize('failure', ['legacy', 'wrong-chain', 'wrong-signer', 'missing-read'])
def test_namespace_authorization_fails_closed(failure):
    signer = Account.create()
    rpc = AuthorizationRpc(signer.address)
    if failure == 'legacy': rpc.version = 2
    if failure == 'wrong-chain': rpc.chain = '0x1'
    if failure == 'wrong-signer': rpc.signer = Account.create().address
    if failure == 'missing-read': rpc.call = lambda *_: (_ for _ in ()).throw(OSError('private-provider-credential'))
    with pytest.raises(EntryGateError, match='hardened gate') as error:
        EntryGateVerifier(rpc, NEW_GATE).binding_authorization(ROOM, signer.address, signer.key.hex(), 2000)
    assert 'private-provider-credential' not in str(error.value)


def test_api_only_signs_persisted_creator_and_retains_gate_after_cutover(tmp_path, monkeypatch):
    signer, creator, stranger = Account.create(), Account.create(), Account.create()
    monkeypatch.setenv('CENTER_ROOM_BIND_SIGNER_KEY', signer.key.hex())
    app = create_app(db_path=str(tmp_path/'center.db'), authenticator=Auth('test'))
    rpc = AuthorizationRpc(signer.address)
    app.state.entry_gate = EntryGateVerifier(rpc, NEW_GATE)
    cfg = deepcopy(HUNT)
    cfg['entry'] = {'kind':'erc20','token':'0x'+'33'*20,'amount':7}
    with TestClient(app) as client:
        headers, room = fund_and_publish(client, creator, cfg=cfg)
        rid = room['roomId']; path = f'{API_PREFIX}/rooms/{rid}/gate-authorization'
        assert client.post(path).status_code == 401
        assert client.post(path, headers=sign_in(client,stranger)).status_code == 403
        proof = client.post(path, headers=headers)
        assert proof.status_code == 200 and proof.json()['creator'] == creator.address.lower()
        assert proof.json()['gate'] == NEW_GATE
        # Switching the global address must not move an existing room's admission history.
        app.state.entry_gate = EntryGateVerifier(rpc, '0x'+'88'*20)
        assert client.post(path, headers=headers).json()['gate'] == NEW_GATE
        assert client.get(f'{API_PREFIX}/rooms/{rid}').json()['entryGate'] == NEW_GATE
        app.state.store.set_setting(f'entry-gate:{rid}', {'address':DEPLOYED_GATE})
        assert client.get(f'{API_PREFIX}/rooms/{rid}').json()['entryGate'] == DEPLOYED_GATE
        assert client.post(path, headers=headers).json()['gate'] == DEPLOYED_GATE


def test_non_token_room_cannot_receive_binding_authorization(tmp_path, monkeypatch):
    signer, host = Account.create(), Account.create()
    monkeypatch.setenv('CENTER_ROOM_BIND_SIGNER_KEY', signer.key.hex())
    app=create_app(db_path=str(tmp_path/'center.db'),authenticator=Auth('test'))
    with TestClient(app) as client:
        headers, room=fund_and_publish(client,host)
        response=client.post(f"{API_PREFIX}/rooms/{room['roomId']}/gate-authorization",headers=headers)
        assert response.status_code == 409
