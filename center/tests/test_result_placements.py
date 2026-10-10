"""A display score is not proof of an objective win or of a duel winner."""
from types import SimpleNamespace

from center import lifecycle as lc
from center.games.duel import DuelEngine
from center.games.number_hunt import NumberHuntEngine
from center.room import RoomRuntime
from center.schema import RoomConfig


def hunt(*, budget=10, targets=1, split=False):
    cfg = RoomConfig(template_id='number-hunt', name='Placement hunt', rules={
        'templateId': 'number-hunt', 'digits': 4, 'min': 1111, 'max': 1113,
        'guess_budget': budget, 'duration_seconds': 60, 'target_count': targets,
        'guess_cooldown_ms': 300, 'win_mode': 'split-at-end' if split else 'first-hit',
    })
    engine = NumberHuntEngine(cfg, 'round', '12' * 32, ['alice', 'bob'])
    engine.start(0)
    return engine


def runtime(engine):
    rt = RoomRuntime.__new__(RoomRuntime)
    rt.engine = engine
    rt.config = engine.config
    rt.round_id = 'round'
    rt.status = lc.CLAIMABLE
    rt.store = SimpleNamespace(
        get_round=lambda _: {'merkle_root': '0x' + '00' * 32},
        entitlements_for_round=lambda _: [],
    )
    return rt


def test_untouched_positive_guess_budgets_are_not_winners():
    engine = hunt()
    engine.finished = True
    rows = runtime(engine)._result_rows()
    assert [row['score'] for row in rows] == [10, 10]
    assert [row['eligible'] for row in rows] == [False, False]
    assert [row['rank'] for row in rows] == [1, 2]


def test_a_target_found_on_the_final_guess_is_still_a_winner():
    engine = hunt(budget=1)
    result = engine.act('alice', {'kind': 'guess', 'number': engine.targets[0]}, 1)
    assert result.ok and result.finished
    rows = runtime(engine)._result_rows()
    assert rows[0] == {'who': 'alice', 'score': 0.0, 'rank': 1, 'eligible': True}
    assert rows[1]['score'] == 1 and rows[1]['eligible'] is False


def test_number_hunt_rank_follows_hit_order_not_remaining_budget():
    engine = hunt(targets=2, split=True)
    miss = next(number for number in range(1111, 1114) if number not in engine.targets)
    assert engine.act('alice', {'kind': 'guess', 'number': miss}, 1).ok
    assert engine.act('alice', {'kind': 'guess', 'number': engine.targets[0]}, 2).ok
    assert engine.act('bob', {'kind': 'guess', 'number': engine.targets[1]}, 3).ok
    rows = runtime(engine)._result_rows()
    assert [(row['who'], row['score'], row['rank'], row['eligible']) for row in rows] == [
        ('alice', 8, 1, True), ('bob', 9, 2, True),
    ]


def test_live_result_metadata_does_not_expose_early_eligibility():
    engine = hunt(targets=2, split=True)
    assert engine.act('alice', {'kind': 'guess', 'number': engine.targets[0]}, 1).ok
    assert not engine.finished
    assert all(row['eligible'] is False for row in runtime(engine)._result_rows())


def test_positive_round_wins_in_a_drawn_reaction_duel_pay_nobody():
    cfg = RoomConfig(template_id='reaction-duel', template_version=1, name='Drawn duel', rules={'templateId': 'reaction-duel', 'rounds': 3}, admission={'player_cap': 2, 'min_ready_to_start': 2})
    engine = DuelEngine(cfg, 'round', '12' * 32, ['alice', 'bob'])
    engine.start(0)
    for index, (left, right) in enumerate([('rock', 'scissors'), ('scissors', 'rock'), ('rock', 'rock')]):
        now = index * 2 + .1
        for who, choice in [('alice', left), ('bob', right)]:
            assert engine.act(who, {'kind': 'commit', 'choice': choice, 'salt': who + str(index)}, now).ok
        for who, choice in [('alice', left), ('bob', right)]:
            assert engine.act(who, {'kind': 'reveal', 'choice': choice, 'salt': who + str(index)}, now + .1).ok
    assert engine.finished and engine.scores() == {'alice': 1.0, 'bob': 1.0}
    assert all(row['eligible'] is False for row in runtime(engine)._result_rows())


def test_http_and_rebuilt_settlement_preserve_identical_placements():
    engine = hunt(budget=1)
    engine.act('alice', {'kind': 'guess', 'number': engine.targets[0]}, 1)
    rt = runtime(engine)
    assert rt.results()['results'] == rt._result_rows()
    assert rt.settlement_frame()['payload']['results'] == rt._result_rows()
