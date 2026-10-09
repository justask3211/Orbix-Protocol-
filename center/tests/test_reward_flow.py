import copy
import json
import time

import pytest
from eth_abi import encode
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak
from fastapi.testclient import TestClient

from center.api import API_PREFIX, Auth, create_app
from center.reward_flow import ENGINE, ZERO, call_data, room_key
from center.vault import ChainError
from center.tests.test_flow import HUNT, sign_in


class RewardRpc:
    def __init__(self, creator, signer):
        self.creator, self.signer = creator, signer
        self.room_id = None
        self.deadline = int(time.time()) + 86400
        self.mode = 1
        self.amount = 100
        self.state = 0
        self.status = '0x1'
        self.logs = []
        self.claimed = False
        self.chain = '0xb626'
        self.calls = []
        self.root = b'\0' * 32
        self.token = '0x' + 'ab' * 20
        self.kind = 0
        self.token_id = 0

    def call(self, method, params):
        self.calls.append((method, params))
        if method == 'eth_chainId':
            return self.chain
        if method == 'eth_getTransactionReceipt':
            return {'status': self.status, 'from': self.creator, 'to': ENGINE, 'blockNumber': '0x100', 'logs': [{'address': ENGINE, 'topics': ['0x' + keccak(text='AssetDeposited(uint256,uint8,address,uint256,uint256)').hex(), '0x' + (7).to_bytes(32, 'big').hex()]}]}
        if method == 'eth_getLogs':
            return self.logs
        if method == 'eth_call':
            data = params[0]['data']
            if data.startswith(call_data('poolInfo(uint256)')[:10]):
                return '0x' + encode(['address','bytes32','uint8','uint64','uint8','uint256','bytes32','string'], [self.creator, room_key(self.room_id), self.mode, self.deadline, self.state, len(self.logs), self.root, '']).hex()
            if data.startswith(call_data('poolAssets(uint256)')[:10]):
                return '0x' + encode(['uint8[]','address[]','uint256[]','uint256[]'], [[self.kind],[self.token],[self.token_id],[self.amount]]).hex()
            if data.startswith(call_data('isClaimed(uint256,address)')[:10]):
                return '0x' + encode(['bool'], [self.claimed]).hex()
            if data == call_data('authority()'):
                return '0x' + encode(['address'], [self.signer]).hex()
            if params[0].get('from'):
                return '0x'
        raise ChainError('Unexpected mocked read')

    def allocate(self, winner):
        self.logs = [{'blockNumber': '0x101', 'logIndex': '0x0', 'topics': ['0x'+keccak(text='AllocationSet(uint256,address,uint256,uint256)').hex(), '0x'+(7).to_bytes(32,'big').hex(), '0x'+winner[2:].lower().rjust(64,'0')], 'data': '0x'+encode(['uint256','uint256'],[0,100]).hex()}]


@pytest.fixture
def flow(tmp_path, monkeypatch):
    db = str(tmp_path / 'center.db')
    monkeypatch.setenv('CENTER_DB', db)
    monkeypatch.setenv('CENTER_TESTNET_REWARDS', 'true')
    monkeypatch.setenv('CENTER_ESCROW', ENGINE)
    signer = Account.create()
    monkeypatch.setenv('CENTER_REWARD_SIGNER_KEY', signer.key.hex())
    host, winner, stranger = Account.create(), Account.create(), Account.create()
    app = create_app(db_path=db, authenticator=Auth('test'))
    rpc = RewardRpc(host.address.lower(), signer.address)
    app.state.rewards.rpc = rpc
    cfg = copy.deepcopy(HUNT)
    cfg['mode'] = 'testnet'
    cfg['access']['required_amount'] = 0
    cfg['rewards'] = {'kind':'funded-assets', 'claim_mode':'auto', 'claim_deadline':rpc.deadline, 'slots':[{'rank':1,'asset_kind':'erc20','asset_contract':rpc.token,'amount':'100'}]}
    with TestClient(app) as client:
        headers = sign_in(client, host)
        prepared = client.post(API_PREFIX+'/rooms/prepare-rewards', headers=headers, json={'config':cfg,'intentNonce':'fund-1'})
        assert prepared.status_code == 200, prepared.text
        rpc.room_id = prepared.json()['roomId']
        yield app, client, rpc, cfg, headers, host, winner, stranger


def publish(flow):
    _, client, _, cfg, headers, *_ = flow
    return client.post(API_PREFIX+'/rooms',headers=headers,json={'config':cfg,'intentNonce':'fund-1','funding':{'poolId':'7','txHash':'0x'+'12'*32}})


def settle(flow):
    app, _, rpc, _, _, _, winner, _ = flow
    rid=rpc.room_id
    app.state.store.save_round({'round_id':'0x'+'34'*32,'room_id':rid,'seed':'seed','commit_hash':'hash','started_at':time.time()-60,'ended_at':time.time(),'state':'claimable','snapshot':{}})
    app.state.store.save_entitlement({'claim_id':'0x'+'56'*32,'round_id':'0x'+'34'*32,'room_id':rid,'winner':winner.address.lower(),'slot_id':1,'asset_kind':'erc20','asset_contract':rpc.token,'amount':100,'token_id':0,'proof':[]})


def test_requires_confirmed_funding_before_room_or_charge(flow):
    app, client, rpc, cfg, headers, *_ = flow
    response=client.post(API_PREFIX+'/rooms',headers=headers,json={'config':cfg,'intentNonce':'fund-1'})
    assert response.status_code==409
    assert app.state.store.get_room(rpc.room_id) is None
    assert app.state.rewards.binding(rpc.room_id) is None


@pytest.mark.parametrize('field,value', [('status','0x0'),('amount',99),('mode',0),('state',1),('creator',ZERO),('room_id','other'),('chain','0x1')])
def test_rejects_wrong_receipt_or_pool(flow,field,value):
    app,_,rpc,*_=flow
    setattr(rpc,field,value)
    response=publish(flow)
    assert response.status_code in (409,503), response.text
    assert app.state.rewards.binding(rpc.room_id) is None


def test_funding_binding_durable_and_no_double_publish(flow):
    app,_,rpc,*_=flow
    response=publish(flow)
    assert response.status_code==200,response.text
    assert response.json()['roomId']==rpc.room_id
    assert app.state.rewards.binding(rpc.room_id)['poolId']=='7'
    again=publish(flow)
    assert again.status_code==200,again.text
    assert again.json()['roomId']==rpc.room_id
    assert again.json()['replayed']
    from center.store import Store
    from center.reward_flow import RewardFlow
    reopened=Store(app.state.store.path)
    assert RewardFlow(reopened,rpc).binding(rpc.room_id)['poolId']=='7'
    reopened.close()


def test_wallet_index_code_bound_signature_and_lookup(flow):
    app,client,rpc,_,_,_,winner,stranger=flow
    assert publish(flow).status_code==200
    settle(flow)
    h=sign_in(client,winner)
    pending=client.get(API_PREFIX+'/wallet/rewards',headers=h)
    assert pending.status_code==200,pending.text
    assert not pending.json()['rewards'][0]['payable']
    rpc.allocate(winner.address)
    result=client.get(API_PREFIX+'/wallet/rewards',headers=h).json()['rewards'][0]
    assert result['payable'] and result['function']=='claimByCode'
    pid,index,nonce,sig=result['args']
    digest=keccak(b'ORBIX_REWARD_CLAIM_V1'+bytes.fromhex(ENGINE[2:])+(46630).to_bytes(32,'big')+int(pid).to_bytes(32,'big')+index.to_bytes(32,'big')+bytes.fromhex(winner.address[2:])+nonce.to_bytes(32,'big'))
    assert Account.recover_message(encode_defunct(primitive=digest),signature=sig).lower()==rpc.signer.lower()
    code=result['code']
    assert client.post(API_PREFIX+'/rewards/lookup',headers=h,json={'code':code}).json()['claim']['args']==result['args']
    sh=sign_in(client,stranger)
    assert client.get(API_PREFIX+'/wallet/rewards',headers=sh).json()['rewards']==[]
    assert client.post(API_PREFIX+'/rewards/lookup',headers=sh,json={'code':code}).status_code==403
    assert client.post(API_PREFIX+'/rewards/lookup',headers=h,json={'code':code+'bad'}).status_code==404
    rpc.claimed=True
    assert not client.get(API_PREFIX+'/wallet/rewards',headers=h).json()['rewards'][0]['payable']


def test_chain_failure_is_not_claimable(flow):
    _,client,rpc,_,_,_,winner,_=flow
    assert publish(flow).status_code==200
    settle(flow)
    h=sign_in(client,winner)
    rpc.chain='0x1'
    assert client.get(API_PREFIX+'/wallet/rewards',headers=h).status_code==503


@pytest.mark.parametrize('kind,asset_id,token', [('eth',3,ZERO),('erc721',1,'0x'+'cd'*20),('erc1155',2,'0x'+'ef'*20)])
def test_typed_inventory(flow,kind,asset_id,token):
    _,client,rpc,cfg,headers,*_=flow
    rpc.kind,rpc.token=asset_id,token
    rpc.amount=1 if kind=='erc721' else 100
    cfg['rewards']['slots'][0].update(asset_kind=kind,asset_contract=token,amount=rpc.amount)
    prepared=client.post(API_PREFIX+'/rooms/prepare-rewards',headers=headers,json={'config':cfg,'intentNonce':'fund-1'})
    rpc.room_id=prepared.json()['roomId']
    assert publish(flow).status_code==200


def test_wrong_existing_allocation_does_not_mark_plan_complete(flow):
    app, _, rpc, _, _, _, _, stranger=flow
    assert publish(flow).status_code==200
    settle(flow)
    rpc.allocate(stranger.address)
    plan=app.state.rewards.plan(rpc.room_id)
    assert plan['chainAllocationCount']==1
    assert plan['allocationCount']==0
    assert plan['allocations'][0]['allocated'] is False


def test_expiry_and_signer_mismatch_are_not_payable(flow, monkeypatch):
    _,client,rpc,_,_,_,winner,_=flow
    assert publish(flow).status_code==200
    settle(flow);rpc.allocate(winner.address)
    h=sign_in(client,winner)
    monkeypatch.setenv('CENTER_REWARD_SIGNER_KEY',Account.create().key.hex())
    assert client.get(API_PREFIX+'/wallet/rewards',headers=h).status_code==503


def test_merkle_matches_reward_engine_single_hash_leaf_and_proof(flow):
    app,client,rpc,cfg,headers,_,winner,_=flow
    cfg['rewards'].update(claim_mode='merkle',merkle_winners=[winner.address])
    rpc.mode=2
    rpc.root=keccak(bytes.fromhex(winner.address[2:])+(0).to_bytes(32,'big')+(100).to_bytes(32,'big'))
    prepared=client.post(API_PREFIX+'/rooms/prepare-rewards',headers=headers,json={'config':cfg,'intentNonce':'fund-1'})
    assert prepared.status_code==200,prepared.text
    assert prepared.json()['merkleRoot']=='0x'+rpc.root.hex()
    rpc.room_id=prepared.json()['roomId']
    assert publish(flow).status_code==200
    settle(flow)
    result=client.get(API_PREFIX+'/wallet/rewards',headers=sign_in(client,winner)).json()['rewards'][0]
    assert result['payable']
    assert result['function']=='claimByMerkle'
    assert result['args']==['7',[],winner.address.lower(),0,'100']


def test_open_is_available_to_first_wallet_not_only_match_winner(flow):
    app,client,rpc,cfg,headers,_,winner,stranger=flow
    cfg['rewards']['claim_mode']='open';rpc.mode=3
    original=rpc.call
    def open_read(method,params):
        if method=='eth_call' and params[0]['data'].startswith(call_data('pools(uint256)')[:10]):
            return '0x'+encode(['address','bytes32','uint8','uint64','uint32','uint32','uint8','bool','bytes32','uint256','string'],[rpc.creator,room_key(rpc.room_id),3,rpc.deadline,1,0,0,True,b'\0'*32,len(rpc.logs),'']).hex()
        return original(method,params)
    rpc.call=open_read
    prepared=client.post(API_PREFIX+'/rooms/prepare-rewards',headers=headers,json={'config':cfg,'intentNonce':'fund-1'})
    rpc.room_id=prepared.json()['roomId']
    assert publish(flow).status_code==200
    settle(flow);rpc.allocate(ZERO)
    result=client.get(API_PREFIX+'/wallet/rewards',params={'roomId':rpc.room_id},headers=sign_in(client,stranger))
    assert result.status_code==200,result.text
    claim=result.json()['rewards'][0]
    assert claim['payable'] and claim['function']=='claimOpen'
    assert claim['winner'].lower()==stranger.address.lower()


def test_uint256_nft_id_persists_without_sqlite_integer_overflow(flow):
    app,client,rpc,cfg,headers,_,winner,_=flow
    nft_id=2**255+17
    rpc.kind,rpc.amount,rpc.token_id=1,1,nft_id
    cfg['rewards']['slots'][0].update(asset_kind='erc721',token_id=str(nft_id),amount='1')
    prepared=client.post(API_PREFIX+'/rooms/prepare-rewards',headers=headers,json={'config':cfg,'intentNonce':'fund-1'})
    rpc.room_id=prepared.json()['roomId']
    assert publish(flow).status_code==200
    settle(flow)
    entry=app.state.rewards.entries(rpc.room_id)[0]
    entry.update(asset_kind='erc721',amount=1,token_id=nft_id)
    app.state.store.save_entitlement(entry)
    plan=app.state.rewards.plan(rpc.room_id)
    assert plan['allocations'][0]['tokenId']==str(nft_id)


def test_legacy_escrow_lookup_cannot_report_reward_engine_claim_payable(flow):
    app,client,rpc,_,_,_,winner,_=flow
    assert publish(flow).status_code==200
    settle(flow)
    from center.settlement import payment_code
    code=payment_code('0x'+'56'*32)
    response=client.post(API_PREFIX+'/claims/lookup',headers=sign_in(client,winner),json={'code':code})
    assert response.status_code==200
    assert not response.json()['payable']
    assert 'My rewards' in response.json()['reason']
