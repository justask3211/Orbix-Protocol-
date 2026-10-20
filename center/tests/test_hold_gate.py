import time
from copy import deepcopy
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from eth_account import Account
from pydantic import ValidationError
from center.hold_gate import HoldGate, HoldReadError, OrbixPolicy, ORBIX, SETTING
from center.api import create_app
from center.schema import RoomConfig, normalise_keys
from center.store import Store
from center.tests.test_flow import HUNT, sign_in

WALLET='0x'+'11'*20
TOKEN='0x'+'22'*20


class RPC:
    def __init__(self,balance=10*10**18):self.balance=balance;self.calls=[];self.fail=False
    def call(self,method,params):
        self.calls.append((method,params))
        if self.fail:raise OSError('RPC unavailable')
        if method=='eth_chainId':return hex(46630)
        if method=='eth_blockNumber':return '0x123'
        data=params[0]['data']
        if data=='0x313ce567':return '0x'+f'{18:064x}'
        if data.startswith('0x70a08231'):return '0x'+f'{self.balance:064x}'
        raise AssertionError('Hold checks must never query transfer locks or make payments')


def gate(tmp_path,balance=10*10**18):
    store=Store(str(tmp_path/'hold.db'));rpc=RPC(balance)
    return HoldGate(store,rpc),rpc


def config(kind='hold',threshold=10):
    raw=deepcopy(HUNT)
    raw['entry']={'kind':kind,'token':TOKEN,'amount':0 if kind=='hold' else 2,'hold_threshold':threshold}
    raw['access'].update(creator_absorbs_joiner_fee=True,payout_mode='hold' if kind=='hold' else 'creator')
    return RoomConfig(**normalise_keys(raw))


@pytest.mark.parametrize('balance,passed',[(0,False),(10*10**18-1,False),(10*10**18,True),(10*10**18+1,True)])
def test_exact_holding_boundary_and_locked_tokens_count(tmp_path,balance,passed):
    g,rpc=gate(tmp_path,balance)
    result=g.check(WALLET,'join',config())
    assert result['passed']==passed
    assert result['checks'][0]['required_base_units']==str(10*10**18)
    assert any(m=='eth_call' and p[0]['data'].startswith('0x70a08231') for m,p in rpc.calls)
    assert all(p[1]=='0x123' for m,p in rpc.calls if m=='eth_call')
    # Mock transfer()/complete() are deliberately absent: balance reads still succeed.


def test_precedence_global_and_room_cannot_bypass(tmp_path):
    g,rpc=gate(tmp_path)
    g.store.set_setting(SETTING,{'orbix_hold_create_threshold':20,'orbix_hold_join_threshold':11,'orbix_hold_tournament_threshold':5})
    assert not g.check(WALLET,'create')['passed']
    t=g.check(WALLET,'tournament',config())
    assert len(t['checks'])==2 and not t['passed']
    cfg=config();cfg.entry.token=ORBIX
    assert g.check(WALLET,'join',cfg)['checks'][0]['required']=='11'
    cfg.entry.hold_threshold=30
    assert g.check(WALLET,'join',cfg)['checks'][0]['required']=='30'
    assert all(g.public_policy()['forcible'].values())


def test_fresh_each_join_unless_admin_ttl(tmp_path):
    g,rpc=gate(tmp_path)
    assert g.check(WALLET,'join',config())['passed']
    rpc.balance=0
    assert not g.check(WALLET,'join',config())['passed']
    g.store.set_setting(SETTING,{'hold_cache_ttl_seconds':15})
    now=[100];g.clock=lambda:now[0]
    rpc.balance=10*10**18
    assert g.check(WALLET,'join',config())['passed']
    rpc.balance=0
    assert g.check(WALLET,'join',config())['passed']
    now[0]+=15
    assert not g.check(WALLET,'join',config())['passed']
    rpc.fail=True
    g.store.set_setting(SETTING,{})
    with pytest.raises(HoldReadError):g.check(WALLET,'join',config())
    with pytest.raises(HTTPException) as exc:g.require(WALLET,'join',config())
    assert exc.value.status_code==503


def test_validation_and_combined_fee_hold(tmp_path):
    g,rpc=gate(tmp_path)
    assert g.check(WALLET,'join',config('erc20'))['passed']
    raw=config().model_dump();raw['access']['creator_absorbs_joiner_fee']=False
    with pytest.raises(ValidationError):RoomConfig(**raw)
    raw=config().model_dump();raw['entry']['amount']=1
    with pytest.raises(ValidationError):RoomConfig(**raw)
    with pytest.raises(ValidationError):OrbixPolicy(hold_cache_ttl_seconds=301)
    with pytest.raises(ValidationError):OrbixPolicy(promo_link='javascript:alert(1)')
    with pytest.raises(ValidationError):OrbixPolicy(orbix_hold_join_threshold=True)


def test_api_enforces_create_join_and_tournament_and_preflight(tmp_path):
    app=create_app(db_path=str(tmp_path/'api.db'));rpc=RPC(0);app.state.hold_gate.rpc=rpc
    app.state.store.set_setting(SETTING,{'orbix_hold_create_threshold':1,'orbix_hold_join_threshold':2,'orbix_hold_tournament_threshold':3})
    with TestClient(app) as c:
        account=Account.create();h=sign_in(c,account)
        c.post('/api/center/v1/wallet/vault/deposit',json={'amount':1000},headers=h)
        check=c.post('/api/center/v1/hold-check',json={'action':'create','config':HUNT},headers=h)
        assert check.status_code==200,check.text
        assert not check.json()['passed']
        response=c.post('/api/center/v1/rooms',json={'config':HUNT,'intentNonce':'hold-room'},headers=h)
        assert response.status_code==403,response.text
        rpc.balance=3*10**18
        r=c.post('/api/center/v1/rooms',json={'config':HUNT,'intentNonce':'hold-room'},headers=h).json()
        assert 'roomId' in r,r
        rpc.balance=0
        assert c.post(f"/api/center/v1/rooms/{r['roomId']}/join",json={},headers=h).status_code==403
        assert app.state.store.participants(r['roomId'])==[]
        assert c.patch('/api/center/v1/admin/orbix-policy',json={},headers=h).status_code==403
        from center.tests.test_tournaments import cfg
        tcfg=cfg(registration_close=int(time.time())+1000).model_dump(mode='json')
        assert c.post('/api/center/v1/tournaments',json={'config':tcfg,'intentNonce':'hold-tournament'},headers=h).status_code==403
        rpc.balance=3*10**18
        t=c.post('/api/center/v1/tournaments',json={'config':tcfg,'intentNonce':'hold-tournament'},headers=h).json()
        assert 'id' in t,t
        rpc.balance=2*10**18
        assert c.post(f"/api/center/v1/tournaments/{t['id']}/join",headers=h).status_code==403
        assert c.get('/api/center/v1/orbix-policy').headers['access-control-allow-origin']=='*'


def test_hold_only_join_never_uses_payment_gate(tmp_path):
    app=create_app(db_path=str(tmp_path/'join.db'));app.state.hold_gate.rpc=RPC()
    class NoPayment:
        def require(self,*a,**kw):raise AssertionError('No transfer gate for hold-only entry')
    app.state.entry_gate=NoPayment()
    with TestClient(app) as c:
        account=Account.create();h=sign_in(c,account)
        raw=config().model_dump(mode='json');raw['access']['required_amount']=0
        published=c.post('/api/center/v1/rooms',json={'config':raw,'intentNonce':'no-payment'},headers=h)
        assert published.status_code==200,published.text
        rid=published.json()['roomId']
        joined=c.post(f'/api/center/v1/rooms/{rid}/join',json={},headers=h)
        assert joined.status_code==200,joined.text


def test_fee_and_hold_are_both_required_at_real_admission(tmp_path):
    app=create_app(db_path=str(tmp_path/'combined.db'));rpc=RPC();app.state.hold_gate.rpc=rpc
    paid=[]
    class Payment:
        def require(self,*args,**kw):paid.append(args[1])
    app.state.entry_gate=Payment()
    with TestClient(app) as c:
        owner=Account.create();h=sign_in(c,owner)
        raw=config('erc20').model_dump(mode='json');raw['access']['required_amount']=0
        r=c.post('/api/center/v1/rooms',json={'config':raw,'intentNonce':'fee-plus-hold'},headers=h).json()
        assert 'roomId' in r,r
        rpc.balance=0
        assert c.post(f"/api/center/v1/rooms/{r['roomId']}/join",json={},headers=h).status_code==403
        assert paid==[]
        rpc.balance=10*10**18
        assert c.post(f"/api/center/v1/rooms/{r['roomId']}/join",json={},headers=h).status_code==200
        assert paid==[owner.address.lower()]


def test_policy_write_requires_fresh_admin_proof_and_audits(tmp_path):
    from eth_account.messages import encode_defunct
    admin=Account.create();app=create_app(db_path=str(tmp_path/'policy.db'),admin_address=admin.address)
    with TestClient(app) as c:
        h=sign_in(c,admin)
        policy=OrbixPolicy(orbix_hold_join_threshold=5).model_dump()
        assert c.patch('/api/center/v1/admin/orbix-policy',json=policy,headers=h).status_code==403
        nonce=c.post('/api/center/v1/auth/nonce',json={'address':admin.address,'purpose':'admin'}).json()
        signature=Account.sign_message(encode_defunct(text=nonce['message']),admin.key).signature.hex()
        signed={**h,'X-Admin-Proof':nonce['nonce']+':'+signature}
        assert c.patch('/api/center/v1/admin/orbix-policy',json=policy,headers=signed).status_code==200
        assert c.patch('/api/center/v1/admin/orbix-policy',json=policy,headers=signed).status_code==403
        assert app.state.store.verify_audit_chain()['ok']
        assert c.get('/api/center/v1/orbix-policy').json()['forcible']['orbix_hold_join_threshold']
