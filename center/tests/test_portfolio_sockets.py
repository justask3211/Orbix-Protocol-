"""Every new stage's wire contract: private acks/reconnect and public-only broadcasts."""
import json
import pytest
from eth_account import Account
from fastapi.testclient import TestClient
from center.api import API_PREFIX
from center.schema import PORTFOLIO_TEMPLATES
from center.tests.portfolio_cases import make,action
from center.tests.test_flow import make_app,sign_in,WsReader

@pytest.mark.parametrize('tid',sorted(PORTFOLIO_TEMPLATES))
def test_private_socket_ack_and_reconnect_never_broadcast_receipts(tmp_path,tid):
 app=make_app(tmp_path)
 with TestClient(app) as client:
  host,guest=Account.create(),Account.create()
  headers={host.address.lower():sign_in(client,host),guest.address.lower():sign_in(client,guest)}
  h=headers[host.address.lower()]
  client.post(API_PREFIX+'/wallet/vault/deposit',json={'amount':1000},headers=h)
  published=client.post(API_PREFIX+'/rooms',json={'config':make(tid).config.model_dump(mode='json'),'intentNonce':tid},headers=h).json()
  rid=published['roomId'];path=API_PREFIX+'/rooms/'+rid
  tickets={p:client.post(path+'/join',json={},headers=header).json()['ticket'] for p,header in headers.items()}
  for header in headers.values():assert client.post(path+'/ready',json={'ready':True},headers=header).status_code==200
  assert client.post(path+'/start',headers=h).status_code==200
  engine=app.state.runtimes[rid].engine
  who=engine.current_player if tid=='prism-lines' else host.address.lower()
  opponent=next(p for p in headers if p!=who)
  with client.websocket_connect(API_PREFIX+'/ws/rooms/'+rid) as own,client.websocket_connect(API_PREFIX+'/ws/rooms/'+rid) as other:
   reader=WsReader(own);rival=WsReader(other)
   own.send_text(json.dumps({'type':'session.hello','ticket':tickets[who]}));reader.want('session.ready');reader.want('game.patch')
   other.send_text(json.dumps({'type':'session.hello','ticket':tickets[opponent]}));rival.want('session.ready');rival.want('game.patch')
   hint={k:v for k,v in action(engine,aid='hint').items() if k in {'roundId','challengeIndex','auctionIndex','turnIndex','actionId'}}|{'kind':'hint','hintKind':engine.public_state()['hintKind']}
   own.send_text(json.dumps({'type':'action','payload':hint}))
   ack=reader.want('action.ack')['payload'];assert ack['hintReceipt'] and ack['hintsRemaining']==engine.rules.hint_budget-1
   broadcast=rival.want('game.patch')['payload']
   assert 'hintReceipt' not in broadcast and 'ownSubmission' not in broadcast
   own.send_text(json.dumps({'type':'action','payload':action(engine,aid='submission')}))
   ack=reader.want('action.ack')['payload'];assert ack['ownSubmission']
   broadcast=rival.want('game.patch')['payload']
   assert 'ownSubmission' not in broadcast and 'hintReceipt' not in broadcast
   fair=client.get(API_PREFIX+'/rounds/'+engine.round_id+'/fairness').json()
   assert fair['seed'] is None
   assert not any(key in json.dumps(fair) for key in ['packRaw','dictionary','answer_col','answer_row'])
  new_ticket=client.post(path+'/join',json={},headers=headers[who]).json()['ticket']
  with client.websocket_connect(API_PREFIX+'/ws/rooms/'+rid) as socket:
   reader=WsReader(socket);socket.send_text(json.dumps({'type':'session.hello','ticket':new_ticket}))
   ready=reader.want('session.ready')['state']
   assert ready['ownSubmission']==ack['ownSubmission']
   assert ready['hintsRemaining']==engine.rules.hint_budget-1
