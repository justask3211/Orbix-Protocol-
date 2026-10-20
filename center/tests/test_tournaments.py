import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError
from center.api import create_app
from center.room import RoomRuntime
from center.schema import RoomConfig, TEMPLATE_META
from center.tournaments import TournamentConfig, TournamentError, TournamentService, bracket_type, seeded_pairs
from center.tests.test_flow import sign_in
from eth_account import Account
from fastapi.testclient import TestClient


def wallet(i):
    return '0x' + f'{i:040x}'


def cfg(n=8, **kw):
    raw = dict(room=RoomConfig(template_id='reaction-duel', name='Tournament test', rules={'templateId':'reaction-duel'}, admission={'player_cap':2,'min_ready_to_start':2}), bracket_type='elimination', max_players=n, registration_close=2000)
    raw.update(kw)
    return TournamentConfig(**raw)


@pytest.fixture
def service(tmp_path):
    app=create_app(db_path=str(tmp_path/'t.db'))
    svc=app.state.tournaments
    svc.clock=lambda:1000
    return svc


@pytest.mark.parametrize('n', range(2,131))
def test_seeded_brackets_all_populations(n):
    players=list(range(n))
    groups=seeded_pairs(players)
    assert sorted(p for g in groups for p in g)==players
    byes=[g[0] for g in groups if len(g)==1]
    assert sorted(byes)==list(range((1<<(n-1).bit_length())-n))
    matches=0
    while len(players)>1:
        groups=seeded_pairs(players)
        matches+=sum(len(g)==2 for g in groups)
        players=[g[0] for g in groups]
    assert matches==n-1
    assert players==[0]


@pytest.mark.parametrize('n', range(2,131))
def test_heat_shrink_and_partition(n):
    players=list(range(n))
    while len(players)>10:
        groups=TournamentService.groups(players,10)
        assert max(map(len,groups))<=10
        assert max(map(len,groups))-min(map(len,groups))<=1
        assert sorted(p for g in groups for p in g)==sorted(players)
        nxt=[p for g in groups for p in g[:3]]
        assert len(nxt)<len(players)
        players=nxt
    assert 1<=len(players)<=10


def join_all(service,n=8,fee=7,**kw):
    owner=wallet(900)
    t=service.create(owner,cfg(n,entry_fee=fee,**kw),'test-nonce')
    for i in range(1,n+1):
        service.vault.deposit(wallet(i),100)
        t=service.join(t['id'],wallet(i))
    return t


def test_pool_refund_idempotency_permissions_and_restart(service):
    t=join_all(service)
    assert t['pool']==56
    service.join(t['id'],wallet(1))
    assert service.vault.balance_of(wallet(1))==93
    with pytest.raises(TournamentError,match='FORBIDDEN'):
        service.cancel(t['id'],wallet(999))
    again=TournamentService(service.store,service.vault,service.hub,service.admin,clock=lambda:1000)
    t=again.cancel(t['id'],t['owner'])
    again.cancel(t['id'],t['owner'])
    assert t['state']=='cancelled'
    assert all(service.vault.balance_of(wallet(i))==100 for i in range(1,9))
    with pytest.raises(TournamentError):
        again.start(t['id'],t['owner'])


def test_atomic_join_insufficient_and_concurrent_retry(service):
    t=service.create(wallet(900),cfg(entry_fee=10),'same-nonce')
    with pytest.raises(Exception):
        service.join(t['id'],wallet(1))
    assert service.get(t['id'])['participants']==[]
    service.vault.deposit(wallet(1),100)
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(lambda _:service.join(t['id'],wallet(1)),range(16)))
    assert service.vault.balance_of(wallet(1))==90
    assert service.get(t['id'])['pool']==10
    assert service.create(wallet(900),cfg(entry_fee=10),'same-nonce')['id']==t['id']


def test_caps_windows_types_and_frozen_terms(service):
    assert all(bracket_type(t) in {'elimination','heats'} for t in TEMPLATE_META)
    assert bracket_type('prism-lines')=='elimination'
    assert bracket_type('token-catch')=='heats'
    with pytest.raises(ValidationError):cfg(bracket_type='heats')
    with pytest.raises(ValidationError):cfg(fee_unit='erc20')
    with pytest.raises(ValidationError):cfg(distribution=[99])
    with pytest.raises(TournamentError):service.create(wallet(2),cfg(max_players=300),'caps-nonce')
    t=join_all(service,2)
    with pytest.raises(TournamentError,match='ENTRY_TERMS_FROZEN'):
        service.edit(t['id'],t['owner'],{'entry_fee':8})
    with pytest.raises(TournamentError,match='ADMIN_BANNER_ONLY'):
        service.edit(t['id'],t['owner'],{'banner':{'text':'hello'}})
    service.edit(t['id'],service.admin,{'banner':{'text':'Championship','placement':'front','size':'large'}})
    assert service.store.verify_audit_chain()['ok']


async def finish_match(service,match,draw=False):
    rt=RoomRuntime.load(service.store,service.vault,service.hub,match['room_id'])
    for p in match['players']:rt.set_ready(p)
    await rt.start(now=1000)
    # A genuine server choice/clock path: one player commits, the other forfeits.
    for elapsed in range(1, 47):
        if rt.finished_at:break
        now=1000+elapsed
        await rt.tick(now)
        if rt.finished_at:break
        if not draw and rt.engine.phase=='commit':
            result=await rt.act(match['players'][0],{'kind':'commit','choice':'rock','salt':'ab'*16,'roundId':rt.round_id,'subroundIndex':rt.engine.round_index},now=now)
            assert result['ok'],result
        await rt.tick(now)
    assert rt.finished_at is not None
    return rt


@pytest.mark.asyncio
async def test_full_bracket_settlement_by_hook(service):
    t=join_all(service,7,fee=11,seeding='creator',seeds=[wallet(i) for i in range(1,8)],distribution=[60,25,15],min_players=3)
    service.start(t['id'],t['owner'])
    for _ in range(10):
        if service.get(t['id'])['state']=='settled':break
        t=service.get(t['id'])
        for m in t['rounds'][-1]['matches']:
            if m['state']=='pending':
                await finish_match(service,m)
                service.report(t['id'],m['id'])
    t=service.get(t['id'])
    assert t['state']=='settled',t
    assert sum(a['points'] for a in t['allocations'])==77
    assert t['podium'][0]['wallet']==wallet(1)
    assert len(service.store.entitlements_for(wallet(1)))>=1
    assert t['history']==['registering','running','round-1','round-2','final','settled']
    service.report(t['id'],t['rounds'][-1]['matches'][0]['id'])
    assert len(service.get(t['id'])['allocations'])==3
    service.close(t['id'],t['owner'])
    with pytest.raises(TournamentError):service.cancel(t['id'],t['owner'])


@pytest.mark.asyncio
async def test_draw_replay_and_admission(service):
    t=join_all(service,2)
    service.start(t['id'],t['owner'])
    m=service.get(t['id'])['rounds'][0]['matches'][0]
    with pytest.raises(TournamentError):service.assert_member(m['room_id'],wallet(999))
    await finish_match(service,m,True)
    t=service.report(t['id'],m['id'])
    retry=t['rounds'][0]['matches'][0]
    assert retry['attempt']==2 and retry['room_id']!=m['room_id']
    service.assert_member(retry['room_id'],wallet(1))
    with pytest.raises(TournamentError):service.assert_member(m['room_id'],wallet(1))


def test_api_cannot_submit_winner_or_cancel_other_creator(tmp_path):
    app=create_app(db_path=str(tmp_path/'api.db'))
    with TestClient(app) as c:
        creator,other=Account.create(),Account.create()
        h=sign_in(c,creator);bad=sign_in(c,other)
        config=cfg(registration_close=__import__('time').time().__int__()+1000).model_dump(mode='json')
        t=c.post('/api/center/v1/tournaments',json={'config':config,'intentNonce':'api-nonce'},headers=h).json()
        assert 'id' in t,t
        tid=t['id']
        assert c.post(f'/api/center/v1/tournaments/{tid}/cancel',headers=bad).status_code==403
        assert c.post(f'/api/center/v1/tournaments/{tid}/report-match-result',json={'matchId':'1-1','winner':other.address},headers=bad).status_code==403
        assert c.get('/api/center/v1/tournaments/mine',headers=h).json()['tournaments'][0]['id']==tid


@pytest.mark.asyncio
async def test_cancel_stops_running_match_and_refunds_once(service):
    t=join_all(service,2)
    service.start(t['id'],t['owner'])
    m=service.get(t['id'])['rounds'][0]['matches'][0]
    rt=RoomRuntime.load(service.store,service.vault,service.hub,m['room_id'])
    service.runtimes[rt.room_id]=rt
    for p in m['players']:rt.set_ready(p)
    await rt.start(now=1000)
    cancelled=service.cancel(t['id'],service.admin)
    assert cancelled['pool']==0 and cancelled['refunded']==14
    assert rt.status=='closed'
    assert not (await rt.act(wallet(1),{'kind':'commit'},now=1001))['ok']
    service.cancel(t['id'],service.admin)
    assert service.vault.balance_of(wallet(1))==100


def test_auto_full_waits_for_creator_seeds_without_rolling_back_last_entry(service):
    t=join_all(service,2,seeding='creator',start_condition='auto-when-full')
    assert t['state']=='registering' and len(t['participants'])==2
    t=service.edit(t['id'],t['owner'],{'seeds':[wallet(2),wallet(1)]})
    assert t['state']=='final'


def test_random_auto_full_starts_and_closed_registration_refunds(service):
    t=join_all(service,2,start_condition='auto-when-full')
    assert t['state']=='final'
    t2=service.create(wallet(900),cfg(8,min_players=3,entry_fee=4),'expired-nonce')
    service.join(t2['id'],wallet(1))
    service.clock=lambda:2001
    asyncio.run(service.tick({}))
    assert service.get(t2['id'])['state']=='cancelled'
