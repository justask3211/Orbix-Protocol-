"""The real HTTP settlement boundary, using signatures produced by the Worker module."""
import asyncio,copy,hashlib,json,subprocess,time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from center.api import create_app
from center.games import engine_for
from center.room import RoomRuntime
from center.schema import RoomConfig
from center.edge_host import compare_snapshot, preferred_host, room_host
ROOT=Path(__file__).resolve().parents[2]
SECRET='test-result-secret-'+('ab'*32)
HOST='0x'+'11'*20;PEER='0x'+'22'*20


def worker_headers(path,body):
    script="import {bridgeHeaders} from './src/bridge.ts';let raw='';for await(const c of process.stdin)raw+=c;const x=JSON.parse(raw);console.log(JSON.stringify(await bridgeHeaders(x.secret,x.path,x.body)))"
    result=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',script],input=json.dumps({'secret':SECRET,'path':path,'body':body}),text=True,capture_output=True,cwd=ROOT/'workers/multiplayer',check=True)
    return json.loads(result.stdout)


def setup_result(app):
    config=RoomConfig(template_id='token-catch',name='Edge replay settlement',rules={'templateId':'token-catch','world_version':4,'arena_mode':True,'spawn_per_second':2,'lanes':3,'duration_seconds':15},admission={'player_cap':2,'min_ready_to_start':2},rewards={'kind':'preview-points','slots':[{'rank':1,'points':500}]})
    rt=RoomRuntime.create(app.state.store,app.state.vault,app.state.hub,owner=HOST,config=config)
    for p in [HOST,PEER]:rt.join(p);rt.set_ready(p,True)
    asyncio.run(rt.start(time.time()-16))
    app.state.runtimes[rt.room_id]=rt
    app.state.store.set_setting(f'room-host:{rt.room_id}',{'host':'cloudflare'})
    initial=rt.engine.snapshot()
    # Fixture is a committed, reachable coin pile, not a client-supplied result.
    rt.engine._drop('coin',rt.engine.bodies[HOST]['x'],rt.engine.bodies[HOST]['z'],0,0,25)
    initial=rt.engine.snapshot()
    row=app.state.store.get_room(rt.room_id)
    app.state.store.set_setting(f'edge-bootstrap:{rt.round_id}',dict(snapshot=initial,configHash=row['config_hash']))
    engine=engine_for(config).restore(config,rt.round_id,rt.seed,initial)
    at=engine.started_at
    action={'kind':'loot','dropId':engine.drops[0]['id']}
    res=engine.act(HOST,action,at)
    assert res.ok
    journal=[dict(at=at,who=HOST,action=action,accepted=True,error=None)]
    for i in range(1,452):
        engine.tick(at+i/30);journal.append({'at':at+i/30})
        if engine.finished:break
    data=dict(roundId=rt.round_id,configHash=row['config_hash'],journal=journal,snapshot=engine.snapshot())
    return rt,data


def test_worker_signed_results_replay_settle_idempotently_and_restore(tmp_path,monkeypatch):
    monkeypatch.setenv('CENTER_CF_RESULT_SECRET',SECRET)
    app=create_app(db_path=str(tmp_path/'results.db'))
    with TestClient(app) as c:
        rt,data=setup_result(app)
        path=f'/api/center/v1/internal/multiplayer/rooms/{rt.room_id}/results'
        body=json.dumps(data,separators=(',',':'));headers=worker_headers(path,body)
        assert c.post(path,content=body).status_code==401
        assert c.post(path,content=body+' ',headers=headers).status_code==401
        assert c.post(path,content=body,headers={**headers,'X-Orbix-Time':'1'}).status_code==401
        forged=copy.deepcopy(data);forged['snapshot']['bodies'][HOST]['score']=999
        bad=json.dumps(forged);rejected=c.post(path,content=bad,headers=worker_headers(path,bad))
        assert rejected.status_code==409,rejected.text
        assert not app.state.store.entitlements_for_round(rt.round_id)
        save=app.state.store.save_entitlement
        def unavailable(*args,**kwargs):raise OSError('fixture disk unavailable')
        monkeypatch.setattr(app.state.store,'save_entitlement',unavailable)
        assert c.post(path,content=body,headers=headers).status_code==503
        assert rt.finished_at is None and rt.status=='running'
        assert not app.state.store.entitlements_for_round(rt.round_id)
        monkeypatch.setattr(app.state.store,'save_entitlement',save)
        result=c.post(path,content=body,headers=headers)
        assert result.status_code==200,result.text
        assert result.json()['type']=='settlement.finalized'
        assert result.json()['payload']['allocations'][0]['points']==25
        assert c.post(path,content=body,headers=worker_headers(path,body)).json()==result.json()
        assert c.post(path,content=bad,headers=worker_headers(path,bad)).status_code==409
        app.state.runtimes.pop(rt.room_id)
        restored=RoomRuntime.load(app.state.store,app.state.vault,app.state.hub,rt.room_id)
        assert restored.settlement_frame()['payload']['allocations']==result.json()['payload']['allocations']
        app.state.runtimes[rt.room_id]=restored
        old_round=rt.round_id
        asyncio.run(restored.prepare_rematch())
        assert restored.round_id!=old_round and restored.engine is None
        # A lost callback response may retry after the host has begun a rematch.
        assert c.post(path,content=body,headers=worker_headers(path,body)).json()==result.json()
        assert restored.status=='registration' and restored.engine is None
        assert len(app.state.store.entitlements_for_round(old_round))==1
        other=RoomRuntime.create(app.state.store,app.state.vault,app.state.hub,owner=PEER,config=restored.config)
        app.state.store.set_setting(f'room-host:{other.room_id}',{'host':'cloudflare'})
        wrong_path=f'/api/center/v1/internal/multiplayer/rooms/{other.room_id}/results'
        assert c.post(wrong_path,content=body,headers=worker_headers(wrong_path,body)).status_code==409


def test_canary_requires_complete_environment_and_preserves_pinned_host(tmp_path,monkeypatch):
    app=create_app(db_path=str(tmp_path/'canary.db'));store=app.state.store
    for key in ['CENTER_CF_ENABLED','CENTER_EDGE_TICKET_SECRET','CENTER_CF_PROVISION_SECRET','CENTER_CF_RESULT_SECRET']:monkeypatch.delenv(key,raising=False)
    assert preferred_host(store,'token-catch')=='railway'
    monkeypatch.setenv('CENTER_CF_ENABLED','true')
    assert preferred_host(store,'token-catch')=='railway'
    for key in ['CENTER_EDGE_TICKET_SECRET','CENTER_CF_PROVISION_SECRET','CENTER_CF_RESULT_SECRET']:monkeypatch.setenv(key,SECRET)
    assert preferred_host(store,'token-catch')=='cloudflare'
    assert preferred_host(store,'combat-duel')==preferred_host(store,'boss-raid')=='railway'
    assert room_host(store,'legacy')=='railway'
    store.set_setting('game-config:token-catch',{'host':'railway'})
    assert preferred_host(store,'token-catch')=='railway'


def test_edge_tickets_preserve_admitted_spectator_role_and_reject_strangers(tmp_path,monkeypatch):
    import base64
    from eth_account import Account
    from center.tests.test_flow import sign_in
    monkeypatch.setenv('CENTER_EDGE_TICKET_SECRET',SECRET)
    app=create_app(db_path=str(tmp_path/'spectators.db'))
    with TestClient(app) as c:
        viewer=Account.create();headers=sign_in(c,viewer)
        stranger=sign_in(c,Account.create())
        rt,_=setup_result(app)
        app.state.store.join(rt.room_id,viewer.address.lower(),'spectator')
        app.state.store.set_setting(f'edge-active:{rt.round_id}',{'active':True})
        path=f'/api/center/v1/rooms/{rt.room_id}/multiplayer-ticket'
        issued=c.post(path,headers=headers,json={})
        assert issued.status_code==200,issued.text
        payload=issued.json()['transport']['ticket'].split('.')[0]
        claims=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        assert claims['role']=='spectator' and claims['sub']==viewer.address.lower()
        assert c.post(path,headers=stranger,json={}).status_code==403
