"""Character physics, contested loot conservation, combat and integer pool settlement."""
import math
import pytest
from pydantic import ValidationError
from center.games import engine_for
from center.games.field_arena import FieldCatchEngine
from center.schema import RoomConfig

A,B,C,D=['0x'+f'{n:040x}' for n in range(1,5)]


def make(template='token-catch',players=None,**changes):
    players=players or [A,B]
    rules={'token-catch':dict(arena_mode=True,spawn_per_second=2,lanes=3,loot_budget=500,airdrop_count=10,loot_chunk=5),
           'boss-raid':dict(arena_mode=True,team_mode='teams',team_size=2,max_players=50,min_players=2,boss_health=6000,contribution_cap=100000),
           'combat-duel':dict(starting_health=150)}[template]
    cfg=RoomConfig(name='Field test',template_id=template,rules={'templateId':template,'world_version':3,'duration_seconds':60,**rules,**changes},
                   admission={'player_cap':len(players),'min_ready_to_start':2},
                   rewards={'kind':'preview-points','slots':[{'rank':1,'points':500}]})
    game=engine_for(cfg)(cfg,'cd'*16,'ab'*32,players)
    game.teams={p:f'team-{i//2+1}' for i,p in enumerate(players)}
    game.start(100.)
    return game


def clear(game):
    game.obstacles=[];game.crates=[];game.drops=[];game.next_drop=10**9
    for i,body in enumerate(game.bodies.values()):body.update(x=i*3,z=0,y=0.,vy=0.,yaw=math.pi/2)


def test_legacy_versions_remain_original_reducers():
    game=make();assert isinstance(game,FieldCatchEngine)
    game.config.rules.world_version=2
    assert engine_for(game.config) is not FieldCatchEngine


def test_shot_uses_current_camera_without_waiting_for_movement_packet():
    game=make();clear(game)
    game.bodies[A].update(weapon='gun',weaponUses=3,yaw=0.)
    assert game.act(A,{'kind':'attack','yaw':math.pi/2,'aimPitch':.3},100).ok
    assert game.projectiles[0]['yaw']==math.pi/2
    assert game.projectiles[0]['pitch']==.3
    assert game.bodies[A]['x']==0
    for bad in [float('nan'),float('inf'),True,20]:
        assert game.act(B,{'kind':'punch','yaw':bad},100).error=='INVALID_FACING'
    assert game.act(B,{'kind':'punch','aimPitch':2},100).error=='INVALID_AIM'


def test_catch_defense_and_push_inventory_are_enforced_by_server():
    game=make();clear(game)
    assert game.act(A,{'kind':'push'},100).error=='NO_PUSH_POWER'
    game.bodies[A]['pushCharges']=1
    assert game.act(A,{'kind':'push'},100).ok and game.bodies[A]['pushCharges']==0
    game.bodies[B]['shieldUntil']=101000
    game._hurt(B,50,A);assert game.bodies[B]['hp']==100
    game.bodies[B].update(shieldUntil=0,dodgeUntil=101000)
    game._hurt(B,50,A);assert game.bodies[B]['hp']==100


@pytest.mark.parametrize('bad',[float('nan'),float('inf'),True,99])
def test_bad_camera_pitch_or_sprint_cannot_corrupt_positions(bad):
    game=make();before=game.bodies[A].copy()
    result=game.act(A,{'kind':'move','seq':1,'dx':0,'dz':1,'aimPitch':bad},100)
    assert not result.ok and result.error=='INVALID_AIM'
    assert game.bodies[A]==before


def test_jump_gravity_landing_cooldown_and_stop_input_are_authoritative():
    game=make();clear(game)
    assert game.act(A,{'kind':'jump','y':999},100).ok
    assert game.act(A,{'kind':'jump'},100).error=='ALREADY_AIRBORNE'
    game.tick(100.2);assert 0<game.bodies[A]['y']<2
    assert game.act(A,{'kind':'move','seq':1,'dx':1,'dz':0,'sprint':True},100.2).ok
    assert game.act(A,{'kind':'move','seq':2,'dx':0,'dz':0},100.21).ok
    game.tick(101);assert game.bodies[A]['y']==0 and game.bodies[A]['vy']==0
    assert abs(game.bodies[A]['x'])<.1


def test_diagonal_speed_lease_and_cover_collision():
    game=make();clear(game)
    assert game.act(A,{'kind':'move','seq':1,'dx':1,'dz':1,'sprint':True,'x':999},100).ok
    game.tick(100.2);body=game.bodies[A]
    assert math.hypot(body['x'],body['z'])<=8*.21
    game.tick(101);position=(body['x'],body['z'])
    game.tick(101.5);assert (body['x'],body['z'])==position
    body.update(x=0,z=0,y=0)
    game.obstacles=[dict(id='wall',x=1,z=0,width=1,depth=8,height=3,kind='bunker')]
    for index in range(1,20):
        game.act(A,{'kind':'move','seq':index+1,'dx':1,'dz':0},101.5+index*.1)
    assert body['x']<.2


def test_airdrop_pool_has_exactly_500_units_and_no_future_locations():
    game=make();clear(game)
    assert game.public_state()['airdrops']==[]
    for second in range(1,61):game.tick(100+second)
    assert game.finished and len(game.airdrops)==10
    assert sum(d['coinValue'] for d in game.airdrops)==500
    assert game.dropped_value==500
    assert all(d['landAt']<=54000 for d in game.airdrops)


def test_loot_opens_into_ten_shared_piles_and_duplicate_race_loses():
    game=make();clear(game);game.tick(106)
    crate=game.airdrops[0]
    assert game.act(A,{'kind':'open_airdrop','dropId':crate['id']},106).error=='LOOT_OUT_OF_REACH'
    for body in game.bodies.values():body.update(x=crate['x'],z=crate['z'])
    assert game.act(A,{'kind':'open_airdrop','dropId':crate['id']},106).ok
    coins=[d for d in game.drops if d['kind']=='coin' and d['sourceId']==crate['id']]
    assert len(coins)==10 and sum(d['value'] for d in coins)==50
    assert game.act(B,{'kind':'open_airdrop','dropId':crate['id']},106).error=='AIRDROP_ALREADY_OPEN'
    first=coins[0]
    assert game.act(A,{'kind':'loot','dropId':first['id']},106).ok
    assert game.act(B,{'kind':'loot','dropId':first['id']},106).error=='LOOT_ALREADY_TAKEN'
    for i,item in enumerate(coins[1:]):assert game.act(B if i%2 else A,{'kind':'loot','dropId':item['id']},106.2+i*.2).ok
    assert game.bodies[A]['score']+game.bodies[B]['score']==50
    assert game.bodies[B]['score']>0


def test_no_automatic_pickup_and_loot_cannot_cross_cover():
    game=make();clear(game)
    item=game._drop('coin',0,0,0,value=5)
    game.tick(100.2);assert game.bodies[A]['score']==0 and item in game.drops
    game.bodies[A]['x']=-1;item['x']=1
    game.obstacles=[dict(id='wall',x=0,z=0,width=.5,depth=4,height=3,kind='bunker')]
    assert game.act(A,{'kind':'loot','dropId':item['id']},100.2).error=='LOOT_OUT_OF_REACH'


def test_bomb_half_scatter_conserves_pool_and_remains_collectible():
    game=make();clear(game);game.bodies[A]['score']=51
    bomb=game._drop('bomb',0,0,0)
    assert game.act(A,{'kind':'loot','dropId':bomb['id']},100).ok
    assert game.bodies[A]['score']==26
    assert sum(d['value'] for d in game.drops if d['kind']=='coin')==25
    game.bodies[B].update(x=0,z=0)
    game.tick(100.5)
    for i,item in enumerate(list(game.drops)):
        if item['kind']=='coin':assert game.act(B,{'kind':'loot','dropId':item['id']},100.5+i*.2).ok
    assert game.bodies[B]['score']==25


def test_punch_stuns_two_seconds_and_gun_knocks_out_ten_without_deleting_coins():
    game=make();clear(game);game.bodies[B].update(x=1,z=0,score=20)
    assert game.act(A,{'kind':'punch'},100).ok
    assert game.bodies[B]['stunnedUntil']==102000
    assert game.bodies[B]['hp']==100 and game.bodies[B]['score']==20
    game.bodies[A].update(weapon='gun',weaponUses=5,attackReadyAt=0)
    game.bodies[B].update(x=4,z=0,stunnedUntil=0)
    assert game.act(A,{'kind':'attack'},100).ok
    game.tick(100.2)
    assert game.bodies[B]['hp']==0
    assert 110000<game.bodies[B]['respawnAt']<110200
    assert game.bodies[B]['score']==20
    for second in range(1,12):game.tick(100.2+second)
    assert game.bodies[B]['hp']==100 and game.bodies[B]['respawnAt']==0


def test_projectiles_cannot_tunnel_cover_or_hit_suspended_players():
    game=make('combat-duel',allow_guns=True);clear(game)
    game.bodies[A].update(weapon='gun',weaponUses=5)
    game.bodies[B].update(x=4,z=0)
    game.obstacles=[dict(id='wall',x=2,z=0,width=1,depth=4,height=3,kind='bunker')]
    game.act(A,{'kind':'attack'},100);game.tick(100.3)
    assert game.bodies[B]['hp']==150 and not game.projectiles


def test_equal_raid_guns_upgrades_and_multiple_telegraphed_attacks():
    game=make('boss-raid',players=[A,B,C,D])
    assert {(b['weapon'],b['weaponLevel'],b['weaponUses']) for b in game.bodies.values()}=={('gun',0,-1)}
    game._boss_damage(A,2000);game.tick(100.1)
    assert any(d['kind']=='upgrade' for d in game.drops)
    kinds=set()
    for second in range(1,31):
        game.tick(100+second);kinds.update(a['kind'] for a in game.attacks)
    assert {'slam','wave','beam','meteor'}<=kinds


def test_boss_wave_can_be_jumped_and_knockout_respawns_ten_seconds():
    game=make('boss-raid');clear(game)
    game.bodies[A].update(y=1,vy=0)
    game.attacks=[dict(id='wave',kind='wave',x=0,z=0,radius=11,width=2,yaw=0,hitAt=0,expiresAt=1000,damage=100,resolved=False)]
    game._boss_attacks()
    assert game.bodies[A]['hp']==100
    assert game.bodies[B]['hp']==0 and game.bodies[B]['respawnAt']==110000


def test_combo_and_dodge_cannot_bypass_cooldowns_or_cover():
    game=make('combat-duel');clear(game);game.bodies[B].update(x=1,z=0)
    assert game.act(A,{'kind':'attack','style':'heavy'},100).ok
    assert game.act(A,{'kind':'attack','style':'kick'},100.1).error=='COOLDOWN'
    assert game.act(B,{'kind':'dodge'},100.1).ok
    assert game.act(B,{'kind':'dodge'},100.2).error=='COOLDOWN'
    hp=game.bodies[B]['hp'];game._hurt(B,50,A);assert game.bodies[B]['hp']==hp


def test_raid_podium_pool_and_member_share_are_exact_large_integers():
    players=[A,B,C,D,'0x'+f'{5:040x}','0x'+f'{6:040x}']
    game=make('boss-raid',players=players)
    game.damage=dict(zip(players,[100,100,60,40,20,20]));game._finish()
    rewards=game.entitlements()
    assert sum(r.points for r in rewards)==500
    assert sorted(r.points for r in rewards)==[37,38,62,63,150,150]
    huge=10**25+3
    game.config.mode='testnet';game.config.rewards.kind='funded-assets'
    slot=game.config.rewards.slots[0];slot.amount=huge;slot.asset_kind='erc20';slot.asset_contract='0x'+'ab'*20
    ent=game.entitlements();assert sum(r.amount for r in ent)<=huge
    assert all(type(r.amount) is int for r in ent)


def test_tied_crews_share_podium_instead_of_arbitrary_wallet_winner():
    game=make('boss-raid',players=[A,B,C,D]);game.damage={A:100,B:100,C:100,D:100};game._finish()
    assert [r['rewardShare'] for r in game.team_rankings()]==[42.5,42.5]
    assert sum(e.points for e in game.entitlements())==424


def test_collected_loot_entitlements_never_include_unclaimed_or_suspended_score():
    game=make();game.bodies[A]['score']=125;game.bodies[B]['score']=50;game._finish()
    assert {e.winner:e.points for e in game.entitlements()}=={A:125,B:50}
    game.suspended.add(B)
    assert {e.winner:e.points for e in game.entitlements()}=={A:125}


def test_snapshot_restores_camera_physics_loot_stream_and_pool_exactly():
    game=make();game.act(A,{'kind':'jump'},100)
    for second in range(1,8):game.tick(100+second)
    snapshot=game.snapshot();restored=type(game).restore(game.config,game.round_id,game.seed,snapshot)
    assert restored.snapshot()==snapshot and restored.public_state()==game.public_state()
    game.tick(108);restored.tick(108)
    assert restored.snapshot()==game.snapshot()


def test_field_round_over_authenticated_socket_settles_collected_pool(tmp_path,monkeypatch):
    import json
    from eth_account import Account
    from fastapi.testclient import TestClient
    from center.tests.test_flow import make_app,sign_in,fund_and_publish,WsReader
    from center.api import API_PREFIX
    monkeypatch.setenv('CENTER_DB',str(tmp_path/'center.db'))
    app=make_app(tmp_path)
    cfg=make().config.model_dump(by_alias=True)
    cfg['access'].update(vault_mode='simulated',required_amount=100,joiner_fee=0)
    with TestClient(app) as client:
        host,guest=Account.create(),Account.create()
        h,room=fund_and_publish(client,host,cfg=cfg)
        rid=room['roomId'];g=sign_in(client,guest)
        ticket=client.post(f'{API_PREFIX}/rooms/{rid}/join',json={},headers=h).json()['ticket']
        assert client.post(f'{API_PREFIX}/rooms/{rid}/join',json={},headers=g).status_code==200
        for headers in [h,g]:
            assert client.post(f'{API_PREFIX}/rooms/{rid}/ready',json={'ready':True},headers=headers).status_code==200
        assert client.post(f'{API_PREFIX}/rooms/{rid}/start',headers=h).status_code==200
        with client.websocket_connect(f'{API_PREFIX}/ws/rooms/{rid}') as ws:
            reader=WsReader(ws)
            ws.send_text(json.dumps({'type':'session.hello','ticket':ticket}))
            reader.want('session.ready')
            ws.send_text(json.dumps({'type':'action','payload':{'kind':'jump'}}))
            for _ in range(20):
                patch=reader.want('game.patch')['payload']
                if patch['bodies'][host.address.lower()]['y']>0:break
            else:pytest.fail('Accepted jump missing from authoritative snapshots')
            rt=app.state.runtimes[rid]
            assert rt.engine.public_state()['worldVersion']==3
            # Trusted fixture puts one contestable pile at the host's spawn.
            body=rt.engine.bodies[host.address.lower()]
            item=rt.engine._drop('coin',body['x'],body['z'],rt.engine.elapsed,value=5)
            ws.send_text(json.dumps({'type':'action','payload':{'kind':'loot','dropId':item['id']}}))
            for _ in range(20):
                patch=reader.want('game.patch')['payload']
                if patch['bodies'][host.address.lower()]['score']==5:break
            else:pytest.fail('Contested loot not confirmed by authority')
            client.portal.call(rt.finish)
            allocations=reader.want('settlement.finalized')['payload']['allocations']
            assert len(allocations)==1 and allocations[0]['points']==5
            assert allocations[0]['winner']==host.address.lower()


@pytest.mark.parametrize('changes',[{'loot_budget':10000,'loot_chunk':1},{'loot_budget':1,'airdrop_count':10}])
def test_excessive_loot_and_empty_airdrops_are_rejected(changes):
    with pytest.raises(ValidationError):make(**changes)
