"""Elevation remains authoritative and versioned through jump, loot and restart."""
import math
import pytest
from center.schema import RoomConfig
from center.games import engine_for
from center.games.terrain import terrain_height
from center.tests.test_field_arena import make,A,B,C,D


def world(template='token-catch'):
    previous=make(template,players=[A,B,C,D] if template=='boss-raid' else [A,B])
    data=previous.config.model_dump();data['rules']['world_version']=4
    config=RoomConfig(**data)
    game=engine_for(config)(config,previous.round_id,previous.seed,previous.participants)
    game.teams=previous.teams.copy();game.start(100)
    return game


@pytest.mark.parametrize('template',['token-catch','boss-raid','combat-duel'])
def test_spawn_ground_and_published_cover_match_the_versioned_heightfield(template):
    game=world(template);state=game.public_state()
    assert game.version==state['worldVersion']==4
    for body in state['bodies'].values():
        assert body['y']==pytest.approx(terrain_height(body['x'],body['z'],game.terrain_theme))
        assert body['onGround']
    for cover in state['obstacles']:
        assert cover['baseY']==pytest.approx(game._ground(cover['x'],cover['z']))


def test_running_up_a_slope_keeps_feet_on_ground_and_jump_lands_on_slope():
    game=world();body=game.bodies[A]
    body.update(x=-13,z=13,y=game._ground(-13,13),vy=0)
    game.obstacles=[];game.crates=[]
    for step in range(1,31):
        now=100+step/30
        if step%3==1:assert game.act(A,{'kind':'move','seq':step,'dx':0,'dz':-1,'sprint':True},now).ok
        game.tick(now)
        assert body['y']==pytest.approx(game._ground(body['x'],body['z']))
    game.act(A,{'kind':'move','seq':32,'dx':0,'dz':0},101.01)
    assert game.act(A,{'kind':'jump'},101.1).ok
    game.tick(101.3);assert body['y']>game._ground(body['x'],body['z'])+.5
    game.tick(102.2);assert body['y']==pytest.approx(game._ground(body['x'],body['z']))
    assert game.public_state()['bodies'][A]['onGround']


def test_loot_respawn_and_dodge_use_elevated_surface_instead_of_flat_zero():
    game=world();body=game.bodies[A]
    game.obstacles=[];game.crates=[]
    body.update(x=-12,z=10,y=game._ground(-12,10),vy=0)
    coin=game._drop('coin',-12,10,0,value=5)
    assert coin['y']>1 and game.act(A,{'kind':'loot','dropId':coin['id']},100).ok
    assert game.act(A,{'kind':'dodge','yaw':math.pi/2},100.2).ok
    assert body['y']==pytest.approx(game._ground(body['x'],body['z']))
    game._down(A,10,B);game.tick(110.5)
    assert body['hp']==100 and body['y']==pytest.approx(game._ground(body['x'],body['z']))


def test_downward_shots_stop_at_authoritative_terrain():
    game=world('combat-duel');body=game.bodies[A]
    game.crates=[];game.obstacles=[]
    body.update(x=-12,z=10,y=game._ground(-12,10),weapon='gun',weaponUses=5)
    assert game.act(A,{'kind':'attack','aimPitch':-1},100).ok
    game.tick(100.4);assert not game.projectiles


def test_restart_preserves_terrain_collisions_rng_and_vertical_motion():
    game=world('boss-raid');game.act(A,{'kind':'jump'},100);game.tick(100.2)
    snapshot=game.snapshot()
    restored=type(game).restore(game.config,game.round_id,game.seed,snapshot)
    assert game.public_state()==restored.public_state()
    game.tick(100.4);restored.tick(100.4)
    assert game.snapshot()==restored.snapshot()


def test_flat_version_three_is_still_selected_without_terrain():
    game=make();assert game.version==3 and 'terrain' not in game.public_state()
    assert all(b['y']==0 for b in game.bodies.values())


def test_failed_crate_interaction_does_not_spend_cooldown_or_create_attack_event():
    game=world();body=game.bodies[A]
    game.crates=[]
    before=(body['attackReadyAt'],body['lastAttackAt'],body['combo'],len(game.events))
    assert game.act(A,{'kind':'interact'},100).error=='NO_CRATE_IN_REACH'
    assert before==(body['attackReadyAt'],body['lastAttackAt'],body['combo'],len(game.events))


def test_last_ammo_shot_keeps_confirmed_animation_weapon_after_inventory_changes():
    game=world('combat-duel');body=game.bodies[A]
    body.update(weapon='gun',weaponUses=1)
    assert game.act(A,{'kind':'attack'},100).ok
    published=game.public_state()['bodies'][A]
    assert published['weapon']=='hands' and published['lastAttackWeapon']=='gun'
    assert published['lastAttackKind']=='attack'


def test_prediction_metadata_is_accepted_input_only_and_preserves_authority():
    game=world(); body=game.bodies[A]
    assert game.act(A,{'kind':'move','seq':1,'dx':1,'dz':0,'sprint':True,'x':9999},100.1).ok
    public=game.public_state()['bodies'][A]
    assert public['inputSeq']==1 and public['inputDx']==1 and public['inputDz']==0
    assert public['inputAt']==pytest.approx(100100) and public['inputUntil']==pytest.approx(100350)
    assert public['x']<20 and body['x']<20
    assert not game.act(A,{'kind':'move','seq':1,'dx':-1,'dz':0},100.2).ok
    assert game.public_state()['bodies'][A]['inputDx']==1
    snapshot=game.snapshot()
    clone=type(game)(game.config,game.round_id,game.seed,game.participants)
    clone._load(snapshot)
    assert clone.public_state()==game.public_state()
