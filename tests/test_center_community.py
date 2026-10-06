"""Community boundaries: admission, creator authority, privacy and durable bans."""
import json

import pytest

from center.community import CommunityError, CommunityService
from center.store import Store

HOST = '0x' + '11' * 20
ALICE = '0x' + '22' * 20
BOB = '0x' + '33' * 20
OUTSIDER = '0x' + '44' * 20
ROOM = '1234567890abcdef'


@pytest.fixture
def community(tmp_path):
    store = Store(str(tmp_path / 'community.db'))
    store.create_room({'id': ROOM, 'owner': HOST, 'template_id': 'number-hunt',
                       'visibility': 'public', 'mode': 'preview', 'status': 'registration',
                       'config': {}, 'config_hash': 'hash'})
    store.join(ROOM, ALICE)
    store.join(ROOM, BOB)
    store.set_profile(ALICE, 'Alice', '', 0, False)
    clock = [1000.0]
    service = CommunityService(store, clock=lambda: clock[0])
    return service, store, clock


def error_code(action, code, status=None):
    with pytest.raises(CommunityError) as caught:
        action()
    assert caught.value.code == code
    if status is not None:
        assert caught.value.status == status


def test_only_admitted_players_or_creator_can_read_or_post(community):
    service, _, _ = community
    error_code(lambda: service.snapshot(ROOM, None), 'UNAUTHENTICATED', 401)
    error_code(lambda: service.snapshot(ROOM, OUTSIDER), 'NOT_ADMITTED', 403)
    error_code(lambda: service.post_message(ROOM, OUTSIDER, 'Hello'), 'NOT_ADMITTED')
    assert service.post_message(ROOM, HOST, 'Welcome')['kind'] == 'chat'
    assert service.snapshot(ROOM, ALICE)['messages'][0]['isHost'] is True


def test_owner_only_roster_contains_verified_wallets_and_names(community):
    service, _, _ = community
    error_code(lambda: service.roster(ROOM, None), 'UNAUTHENTICATED')
    error_code(lambda: service.roster(ROOM, ALICE), 'FORBIDDEN')
    roster = service.roster(ROOM, HOST)
    assert next(player for player in roster['players'] if player['wallet'] == ALICE)['name'] == 'Alice'
    # Public/message UI does not silently leak the owner's wallet list.
    public = json.dumps(service.snapshot(ROOM, BOB))
    assert ALICE not in public and BOB not in public and HOST not in public
    assert 'wallet' not in public


def test_settings_preserve_defaults_and_enforce_authority(community):
    service, _, _ = community
    assert service.public_settings(ROOM) == {'muteChat': False, 'hidePlayers': False, 'hideGuesses': False}
    error_code(lambda: service.update_settings(ROOM, ALICE, {'muteChat': True}), 'FORBIDDEN')
    for patch in ({'muteChat': 1}, {'hidePlayers': 'false'}, {'unknown': True}, {}):
        error_code(lambda: service.update_settings(ROOM, HOST, patch), 'INVALID_SETTINGS')
    service.update_settings(ROOM, HOST, {'muteChat': True, 'hidePlayers': True})
    error_code(lambda: service.post_message(ROOM, ALICE, 'Still talking'), 'CHAT_MUTED', 409)
    service.post_message(ROOM, HOST, 'Creator announcement')
    snapshot = service.snapshot(ROOM, ALICE)
    assert snapshot['players'] == []
    assert all(message['name'].startswith('Player ') for message in snapshot['messages'])
    assert service.roster(ROOM, HOST)['players']


def test_host_hints_are_durable_and_players_cannot_impersonate(community):
    service, store, _ = community
    error_code(lambda: service.post_message(ROOM, ALICE, 'Fake hint', 'hint'), 'FORBIDDEN')
    service.post_message(ROOM, HOST, 'Look above the midpoint.', 'hint')
    reopened = CommunityService(Store(store.path))
    messages = reopened.snapshot(ROOM, BOB)['messages']
    assert messages[0]['kind'] == 'hint'
    assert messages[0]['text'] == 'Look above the midpoint.'


def test_messages_are_bounded_plain_text(community):
    service, _, _ = community
    for text in ('', '   ', 'a' * 501, 'bad\x00text'):
        error_code(lambda: service.post_message(ROOM, ALICE, text), 'INVALID_MESSAGE')
    error_code(lambda: service.post_message(ROOM, ALICE, 'x', 'admin'), 'INVALID_MESSAGE')
    service.post_message(ROOM, ALICE, '<script>still plain text</script>')
    assert service.snapshot(ROOM, ALICE)['messages'][0]['text'] == '<script>still plain text</script>'


def test_rate_limit_survives_deletion_and_restart(community):
    service, store, clock = community
    first = service.post_message(ROOM, ALICE, 'One')
    error_code(lambda: service.post_message(ROOM, ALICE, 'Too soon'), 'RATE_LIMIT', 429)
    service.delete_message(ROOM, HOST, first['messageId'])
    reopened = CommunityService(Store(store.path), clock=lambda: clock[0])
    error_code(lambda: reopened.post_message(ROOM, ALICE, 'Still too soon'), 'RATE_LIMIT')
    for number in range(9):
        clock[0] += 2
        reopened.post_message(ROOM, ALICE, str(number))
    clock[0] += 2
    error_code(lambda: reopened.post_message(ROOM, ALICE, 'Minute limit'), 'RATE_LIMIT')
    clock[0] += 61
    assert reopened.post_message(ROOM, ALICE, 'Allowed')['messageId']


def test_deletion_is_owner_only_and_returns_tombstone(community):
    service, _, _ = community
    message = service.post_message(ROOM, ALICE, 'A message')
    error_code(lambda: service.delete_message(ROOM, BOB, message['messageId']), 'FORBIDDEN')
    error_code(lambda: service.delete_message(ROOM, HOST, 999), 'NOT_FOUND')
    service.delete_message(ROOM, HOST, message['messageId'])
    snapshot = service.snapshot(ROOM, BOB)
    assert snapshot['messages'][0]['deleted'] is True
    assert snapshot['messages'][0]['text'] == ''


def test_lobby_kick_removes_admission_but_does_not_ban(community):
    service, store, _ = community
    error_code(lambda: service.kick(ROOM, BOB, ALICE), 'FORBIDDEN')
    error_code(lambda: service.kick(ROOM, HOST, HOST), 'INVALID_TARGET')
    service.kick(ROOM, HOST, ALICE)
    assert ALICE not in [player['who'] for player in store.participants(ROOM)]
    error_code(lambda: service.snapshot(ROOM, ALICE), 'NOT_ADMITTED')
    service.assert_can_join(ROOM, ALICE)


def test_ban_is_durable_and_unban_is_owner_only(community):
    service, store, _ = community
    service.ban(ROOM, HOST, ALICE)
    reopened = CommunityService(Store(store.path))
    error_code(lambda: reopened.assert_can_join(ROOM, ALICE), 'ROOM_BANNED')
    error_code(lambda: reopened.snapshot(ROOM, ALICE), 'ROOM_BANNED')
    assert reopened.roster(ROOM, HOST)['banned'][0]['wallet'] == ALICE
    error_code(lambda: reopened.unban(ROOM, BOB, ALICE), 'FORBIDDEN')
    reopened.unban(ROOM, HOST, ALICE)
    reopened.assert_can_join(ROOM, ALICE)
    assert reopened.roster(ROOM, HOST)['banned'] == []


@pytest.mark.parametrize('status', ['running', 'result-pending', 'settlement-pending', 'claimable', 'cancelled', 'closed'])
def test_started_or_finished_rosters_cannot_be_changed(community, status):
    service, store, _ = community
    with store.tx() as cx:
        cx.execute('UPDATE rooms SET status=? WHERE id=?', (status, ROOM))
    error_code(lambda: service.kick(ROOM, HOST, ALICE), 'LOBBY_ONLY', 409)
    error_code(lambda: service.ban(ROOM, HOST, ALICE), 'LOBBY_ONLY')
    assert ALICE in [player['who'] for player in store.participants(ROOM)]
    assert service.roster(ROOM, HOST)['banned'] == []
    # Hosts can still moderate chat and send custom hints during the match.
    assert service.update_settings(ROOM, HOST, {'hideGuesses': True})['hideGuesses'] is True


def test_no_cross_room_message_deletion_or_unknown_room_info(community):
    service, store, _ = community
    message = service.post_message(ROOM, ALICE, 'Private to this room')
    other = 'abcdef1234567890'
    store.create_room({'id': other, 'owner': HOST, 'template_id': 'number-hunt',
                       'visibility': 'private', 'mode': 'preview', 'status': 'registration',
                       'config': {}, 'config_hash': 'other'})
    error_code(lambda: service.delete_message(other, HOST, message['messageId']), 'NOT_FOUND')
    error_code(lambda: service.snapshot(other, ALICE), 'NOT_ADMITTED')
    error_code(lambda: service.public_settings('missing'), 'NOT_FOUND')
    error_code(lambda: service.snapshot(ROOM, ALICE, -1), 'INVALID_CURSOR')


def start_round(store, at=1000.0):
    with store.tx() as cx:
        cx.execute("UPDATE rooms SET status='running' WHERE id=?", (ROOM,))
    store.save_round({'round_id': 'round-1', 'room_id': ROOM, 'seed': 'seed',
                      'commit_hash': 'hash', 'started_at': at, 'state': 'running'})


def test_creation_timed_hints_are_private_and_delivered_once_after_restart(community):
    from center.schema import CommunityOptions
    service, store, _ = community
    options = CommunityOptions(mute_chat=True, timed_hints=[{'delay_seconds': 10, 'text': 'Secret future clue'}])
    service.initialize(ROOM, HOST, options)
    service.initialize(ROOM, HOST, options)
    assert 'Secret future clue' not in json.dumps(service.snapshot(ROOM, ALICE))
    assert service.public_settings(ROOM)['muteChat'] is True
    start_round(store)
    assert service.deliver_hints(ROOM, 1000, 1009) == []
    reopened = CommunityService(Store(store.path))
    assert len(reopened.deliver_hints(ROOM, 2000, 1010)) == 1
    assert reopened.deliver_hints(ROOM, 1000, 1011) == []
    hints = reopened.snapshot(ROOM, ALICE)['messages']
    assert len(hints) == 1 and hints[0]['text'] == 'Secret future clue'


def test_live_timed_hint_uses_schedule_time_and_owner_authority(community):
    service, store, clock = community
    start_round(store, 950)
    error_code(lambda: service.post_message(ROOM, ALICE, 'Fake delayed hint', 'hint', 10), 'FORBIDDEN')
    out = service.post_message(ROOM, HOST, 'Live clue later', 'hint', 10)
    assert out['scheduled'] is True
    assert service.snapshot(ROOM, ALICE)['messages'] == []
    assert service.deliver_hints(ROOM, 950, 1009) == []
    assert len(service.deliver_hints(ROOM, 950, 1010)) == 1
    assert service.snapshot(ROOM, BOB)['messages'][0]['text'] == 'Live clue later'


def test_schedule_is_bounded_and_does_not_reset_existing_creator_settings(community):
    from center.schema import CommunityOptions
    service, _, clock = community
    service.initialize(ROOM, HOST, CommunityOptions(timed_hints=[{'delay_seconds': n + 1, 'text': f'Clue {n}'} for n in range(20)]))
    error_code(lambda: service.post_message(ROOM, HOST, 'Too many', 'hint', 5), 'HINT_LIMIT')
    service.update_settings(ROOM, HOST, {'hideGuesses': True})
    service.initialize(ROOM, HOST, CommunityOptions())
    assert service.public_settings(ROOM)['hideGuesses'] is True
    for delay in (-1, 3601, True, 2.5, '10'):
        error_code(lambda: service.post_message(ROOM, HOST, 'x', 'hint', delay), 'INVALID_HINT_DELAY')
    error_code(lambda: service.post_message(ROOM, HOST, 'chat', 'chat', 1), 'INVALID_HINT_DELAY')


def test_future_hint_text_never_leaks_through_public_config_or_changes_commitment():
    from center.schema import CommunityOptions, RoomConfig
    from pydantic import ValidationError
    base = {'template_id': 'number-hunt', 'name': 'Hint island', 'visibility': 'public',
            'rules': {'templateId': 'number-hunt', 'digits': 4, 'min': 1111, 'max': 9999,
                      'guess_budget': 10, 'duration_seconds': 60}}
    plain = RoomConfig(**base)
    timed = RoomConfig(**base, community_settings={'timed_hints': [{'delay_seconds': 5, 'text': 'Future clue'}]})
    assert 'Future clue' not in json.dumps(timed.public_dict())
    assert timed.config_hash_input() == plain.config_hash_input()
    for options in ({'mute_chat': 1}, {'timed_hints': [{'delay_seconds': True, 'text': 'x'}]},
                    {'timed_hints': [{'delay_seconds': 5, 'text': '   '}]},
                    {'timed_hints': [{'delay_seconds': 5, 'text': 'x'}] * 21}):
        with pytest.raises(ValidationError):
            CommunityOptions(**options)


def test_timed_hint_rate_limit_cannot_be_bypassed_by_scheduling(community):
    service, _, clock = community
    service.post_message(ROOM, HOST, 'Hint 1', 'hint', 30)
    error_code(lambda: service.post_message(ROOM, HOST, 'Hint 2', 'hint', 30), 'RATE_LIMIT')
    error_code(lambda: service.post_message(ROOM, HOST, 'Immediate chat bypass'), 'RATE_LIMIT')
    for n in range(9):
        clock[0] += 2
        service.post_message(ROOM, HOST, f'Hint {n + 2}', 'hint', 30)
    clock[0] += 2
    error_code(lambda: service.post_message(ROOM, HOST, 'One more', 'hint', 30), 'RATE_LIMIT')
    error_code(lambda: service.post_message(ROOM, HOST, 'One more chat'), 'RATE_LIMIT')
