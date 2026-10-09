"""Forms are the reward: private collection without financial entitlements."""
import copy
import csv
import io
import json

import pytest
from pydantic import ValidationError
from center.schema import Rewards, FormReward, RoomConfig, normalise_keys
from center.tests.test_waitlist import game, finish
from center.api import API_PREFIX


def configure(app, rid, kind, eligibility='winners-only', **options):
    rt = app.state.runtimes[rid]
    form = FormReward(kind=kind, eligibility=eligibility, **options)
    rt.config.rewards = Rewards(kind=kind, forms=[form])
    with app.state.store.tx() as cx:
        cx.execute('UPDATE rooms SET config_json=? WHERE id=?', (rt.config.model_dump_json(), rid))
    return rt


@pytest.mark.parametrize('payload', [
    {'kind':'qa-form'}, {'kind':'qa-form','questions':[' ']},
    {'kind':'qa-form','questions':['q']*6}, {'kind':'qa-form','questions':['a'*161]},
    {'kind':'waitlist-form','fields':['a','b','c','d']},
    {'kind':'waitlist-form','fields':['a\x00']},
    {'kind':'waitlist-form','eligibility':'custom','custom_count':0},
    {'kind':'waitlist-form','questions':['q']},
])
def test_schema_bounds(payload):
    with pytest.raises(ValidationError):
        FormReward(**payload)


def test_combined_funded_and_form_schema():
    rewards = Rewards(kind='funded-assets', slots=[{'rank':1,'asset_kind':'eth','asset_contract':'0x'+'00'*20,'amount':1}],
        forms=[{'kind':'qa-form','questions':['Why?']}])
    assert rewards.forms[0].questions == ['Why?']
    with pytest.raises(ValidationError):
        Rewards(kind='qa-form', forms=[{'kind':'qa-form','questions':['Q']}], slots=[{'rank':1,'points':5}])


@pytest.mark.parametrize('kind', ['waitlist-form','qa-form'])
@pytest.mark.parametrize('eligibility,loser_allowed', [('winners-only',False),('top3',True),('anyone',True),('custom',False)])
def test_eligibility_dedupe_and_privacy(game, kind, eligibility, loser_allowed):
    app, client, rid, owner, headers, winner, loser = game
    rt = configure(app,rid,kind,eligibility, **({'questions':['Your feedback?']} if kind=='qa-form' else {'fields':['Name']}))
    path = f'{API_PREFIX}/rooms/{rid}/' + ('qa-form' if kind=='qa-form' else 'waitlist')
    body = {'answers':['PRIVATE_SENTINEL']} if kind=='qa-form' else {'wallet':winner.address,'fields':['PRIVATE_SENTINEL']}
    assert client.post(path,headers=headers[0],json=body).status_code == 409
    finish(app,rid)
    assert rt.store.entitlements_for_round(rt.round_id) == [], 'Form-only rewards never issue monetary/point claims'
    assert client.post(path,headers=headers[0],json=body).status_code == 200
    assert client.post(path,headers=headers[1],json=body).status_code == (200 if loser_allowed else 403)
    assert client.post(path,headers=headers[2],json=body).status_code == 403
    result = client.post(path,headers=headers[0],json=body)
    assert result.status_code == 200
    data = client.get(path,headers=owner).json()
    assert data['count'] == (2 if loser_allowed else 1)
    for h in headers:
        assert client.get(path,headers=h).status_code == 403
        assert client.get(path+'.csv',headers=h).status_code == 403
    for h in [None,*headers]:
        assert 'PRIVATE_SENTINEL' not in client.get(f'{API_PREFIX}/rooms/{rid}',headers=h).text
        assert 'PRIVATE_SENTINEL' not in client.get(f'{API_PREFIX}/rooms/{rid}/results',headers=h).text
    assert 'PRIVATE_SENTINEL' not in json.dumps(app.state.store.list_audit())
    status = client.get(f'{API_PREFIX}/rooms/{rid}/forms/status',headers=headers[0]).json()['forms'][0]
    assert status['eligible'] and status['submitted'] and 'PRIVATE_SENTINEL' not in json.dumps(status)
    exported = client.get(path+'.csv',headers=owner)
    assert exported.status_code == 200 and 'no-store' in exported.headers['cache-control']
    assert len(list(csv.reader(io.StringIO(exported.text)))) == data['count']+1
    app.state.runtimes.pop(rid)
    assert client.get(path,headers=owner).json()['count'] == data['count']


def test_qa_edit_close_and_csv_injection(game):
    app, client, rid, owner, headers, *_ = game
    rt = configure(app,rid,'qa-form',questions=['Feedback?'])
    finish(app,rid)
    path = f'{API_PREFIX}/rooms/{rid}/qa-form'
    assert client.post(path,headers=headers[0],json={'answers':['first']}).json()['edited'] is False
    assert client.post(path,headers=headers[0],json={'answers':['=1+1']}).json()['edited'] is True
    assert client.get(path,headers=owner).json()['entries'][0]['answers'] == ['=1+1']
    assert "'=1+1" in client.get(path+'.csv',headers=owner).text
    rt.close('test')
    assert client.post(path,headers=headers[0],json={'answers':['late']}).status_code == 409
    assert client.get(path,headers=owner).json()['count'] == 1


def test_rules_use_true_winner_and_rank():
    from center.waitlist import WaitlistService
    rows=[{'who':f'p{i}','rank':i,'eligible':i==4} for i in range(1,6)]
    for policy, allowed in [('winners-only',{4}),('top3',{1,2,3}),('anyone',{1,2,3,4,5}),('custom',{1,2})]:
        form={'eligibility':policy,'custom_count':2}
        assert {i for i in range(1,6) if WaitlistService._eligible(form,f'p{i}',rows)} == allowed
