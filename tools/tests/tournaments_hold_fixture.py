from center.api import create_app
from center.tests.test_hold_gate import RPC
from center.tests.test_tournaments import cfg,wallet
from center.hold_gate import SETTING
from eth_account import Account
import time
app=create_app(db_path=':memory:',admin_address=Account.from_key('ab'*32).address)
app.state.hold_gate.rpc=RPC(10*10**18)
app.state.store.set_setting(SETTING,{'orbix_hold_create_threshold':2,'orbix_hold_join_threshold':3,'orbix_hold_tournament_threshold':4})
owner=Account.from_key('ab'*32).address.lower()
app.state.vault.deposit(owner,10000)
t=app.state.tournaments.create(owner,cfg(8,registration_close=int(time.time())+86400),'browser-nonce')
app.state.tournaments.edit(t['id'],owner,{'banner':{'text':'Orbix Community Cup','placement':'front','size':'large','style':'gold'}})
