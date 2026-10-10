"""Shared immutable v1 selection/result clock and durable private receipt discipline.

Game-specific validators, content, hints, scoring and eligibility stay in each reducer.
RNG domains are template/v1/deck and template/v1/tie; decks are drawn once at start.
"""
import copy
import hashlib
import json
import re
from center.games.base import Engine, ActionResult, StreamRNG
from center.content_packs import load_pack,validate_pack

class SealedRoundsEngine(Engine):
    version=1
    timed_sealed=True
    index_key='challengeIndex'
    action_kind=''
    action_fields=set()
    hint_kind=''
    def __init__(self,config,round_id,seed,participants):
        super().__init__(config,round_id,seed,sorted(p.lower() for p in participants))
        self.rules=config.rules
        self.index=0;self.phase='selection';self.phase_started=0;self.server_time=0
        self.deck=[];self.history=[];self.transitions=[];self.tie_order=[]
        self.submissions={p:{} for p in self.participants};self.hints={p:{} for p in self.participants}
        self.receipts={p:{} for p in self.participants};self.totals={p:0 for p in self.participants}
        self.qualified=set();self.pack_raw=None;self.pack=None
    def stream(self,domain):return StreamRNG(self.seed,f'{self.template_id}/v1/{domain}'.encode())
    def start(self,now=0):
        if not getattr(self.rules,'min_players',1)<=len(self.participants)<=self.rules.max_players or len(set(self.participants))!=len(self.participants):raise ValueError('INVALID_PARTICIPANT_ROSTER')
        self.phase_started=self.server_time=now
        self.tie_order=self.stream('tie').shuffled(self.participants)
        if hasattr(self.rules,'pack_id'):self.pack_raw,self.pack=load_pack(self.rules)
        self.deck=self.build_deck(self.stream('deck'))
        if len(self.deck)!=self.rules.rounds:raise ValueError('INSUFFICIENT_DISTINCT_CHALLENGES')
    def phase_deadline(self):return self.phase_started+(self.rules.selection_seconds if self.phase=='selection' else self.rules.result_seconds)
    def tick(self,now):
        self.server_time=now;changed=False
        for _ in range(2*self.rules.rounds):
            if self.finished or now<self.phase_deadline():break
            deadline=self.phase_deadline();phase=self.phase;index=self.index
            if self.phase=='selection':
                result=self.resolve_challenge(self.deck[self.index],deadline)
                self.history.append({self.index_key:self.index,'resolvedAt':deadline,**result})
                self.phase='result'
            elif self.index+1==self.rules.rounds:self.phase='done';self.finished=True
            else:self.index+=1;self.phase='selection'
            self.phase_started=deadline
            self.transitions.append({'roundId':self.round_id,'index':index,'phase':phase,'at':deadline})
            changed=True
        return ActionResult(True,patch=self.public_state(),finished=self.finished,scores=self.scores()) if changed else None
    def _identity(self,action):return json.dumps(action,sort_keys=True,separators=(',',':'),ensure_ascii=True)
    def _receipt(self,who,action,private):
        identity=self._identity(action)
        receipt={'receiptId':hashlib.sha256(f'{self.template_id}/v1/receipt/{self.round_id}/{who}/{identity}'.encode()).hexdigest(),'actionId':action['actionId'],self.index_key:self.index,'locked':True}
        receipt.update(private)
        return receipt
    def act(self,who,action,now):
        self.tick(now)
        if who not in self.participants:return ActionResult(False,'NOT_ADMITTED')
        if not isinstance(action,dict) or action.get('roundId')!=self.round_id:return ActionResult(False,'STALE_MATCH')
        aid=action.get('actionId')
        if not isinstance(aid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',aid):return ActionResult(False,'BAD_ACTION_ID')
        existing=self.receipts[who].get(aid)
        if existing:
            if existing['identity']!=self._identity(action):return ActionResult(False,'ACTION_ID_CONFLICT')
            return ActionResult(True,patch=self.public_state(),private=copy.deepcopy(existing['private']))
        if self.finished:return ActionResult(False,'ROUND_FINISHED')
        if type(action.get(self.index_key)) is not int or action[self.index_key]!=self.index:return ActionResult(False,'STALE_PHASE')
        if self.phase!='selection' or now<self.phase_started:return ActionResult(False,'ROUND_NOT_OPEN')
        common={'kind','actionId','roundId',self.index_key}
        if action.get('kind')=='hint':
            if set(action)-common-{'hintKind'} or action.get('hintKind')!=self.hint_kind:return ActionResult(False,'BAD_ACTION')
            if self.rules.hints=='off':return ActionResult(False,'HINTS_OFF')
            stored=self.hints[who].get(str(self.index))
            if stored:private={'hintReceipt':stored,'hintsRemaining':self.rules.hint_budget-len(self.hints[who])}
            else:
                if len(self.hints[who])>=self.rules.hint_budget:return ActionResult(False,'HINT_BUDGET_EXHAUSTED')
                stored=self._receipt(who,action,{'hintKind':self.hint_kind,'payload':self.hint_payload(who,self.deck[self.index])})
                self.hints[who][str(self.index)]=stored
                private={'hintReceipt':stored,'hintsRemaining':self.rules.hint_budget-len(self.hints[who])}
        else:
            if action.get('kind')!=self.action_kind or set(action)-common-self.action_fields:return ActionResult(False,'BAD_ACTION')
            value,error=self.validate_submission(who,action,self.deck[self.index])
            if error:return ActionResult(False,error)
            stored=self.submissions[who].get(str(self.index))
            if stored:
                if stored['value']!=value:return ActionResult(False,'SUBMISSION_LOCKED')
                receipt=stored['receipt']
            else:
                receipt=self._receipt(who,action,{'submission':value})
                self.submissions[who][str(self.index)]={'value':value,'receipt':receipt}
            private={'ownSubmission':receipt}
        self.receipts[who][aid]={'identity':self._identity(action),'private':copy.deepcopy(private)}
        return ActionResult(True,patch=self.public_state(),private=copy.deepcopy(private))
    def private_state(self,who):
        if who not in self.participants:return {}
        submission=self.submissions[who].get(str(self.index));hint=self.hints[who].get(str(self.index))
        return {'ownSubmission':copy.deepcopy(submission['receipt']) if submission else None,'hintReceipt':copy.deepcopy(hint),'hintsRemaining':max(0,self.rules.hint_budget-len(self.hints[who]))}
    def public_state(self):
        return {'template':self.template_id,'version':1,'roundId':self.round_id,'phase':self.phase,self.index_key:self.index,'index':self.index,'rounds':self.rules.rounds,
                'phaseStartedAt':self.phase_started,'phaseDeadline':self.phase_deadline(),'serverTimeMs':int(self.server_time*1000),
                'players':self.participants,'challenge':self.public_challenge(self.deck[self.index]) if self.deck else None,
                'submitted':{p:str(self.index) in self.submissions[p] for p in self.participants},
                'hintUsed':{p:str(self.index) in self.hints[p] for p in self.participants},'scores':self.scores(),'history':copy.deepcopy(self.history),'finished':self.finished,
                'tieOrder':list(self.tie_order) if self.finished else [],'tieRule':'Equal scores use the round’s seeded tie order.','hints':self.rules.hints,'hintKind':self.hint_kind,'hintBudget':self.rules.hint_budget,**self.public_extra()}
    def public_extra(self):return {}
    def scores(self):return dict(self.totals)
    def ranking(self):return sorted(self.participants,key=lambda p:(-self.scores()[p],self.tie_order.index(p)))
    def eligible(self):return set(self.qualified)
    def value(self,who):return self.submissions[who].get(str(self.index),{}).get('value')
    def hinted(self,who):return str(self.index) in self.hints[who]
    def snapshot(self):
        return copy.deepcopy({'version':1,'template':self.template_id,'participants':self.participants,'index':self.index,'phase':self.phase,'phaseStartedAt':self.phase_started,'serverTime':self.server_time,
          'deck':self.deck,'packRaw':self.pack_raw.decode() if self.pack_raw else None,'history':self.history,'transitions':self.transitions,'tieOrder':self.tie_order,'submissions':self.submissions,'hints':self.hints,'receipts':self.receipts,'totals':self.totals,'qualified':sorted(self.qualified),'finished':self.finished,'extra':self.snapshot_extra()})
    def snapshot_extra(self):return {}
    def load_extra(self,extra):pass
    def _load(self,s):
        if s.get('version')!=1 or s.get('template')!=self.template_id:raise ValueError('INCOMPATIBLE_PORTFOLIO_SNAPSHOT')
        self.pack_raw=s['packRaw'].encode() if s.get('packRaw') else None
        if self.pack_raw:self.pack=validate_pack(self.pack_raw,self.rules.pack_id,self.rules.pack_sha256)
        self.index=s['index'];self.phase=s['phase'];self.phase_started=s['phaseStartedAt'];self.server_time=s['serverTime']
        self.deck=copy.deepcopy(s['deck']);self.history=copy.deepcopy(s['history']);self.transitions=copy.deepcopy(s['transitions']);self.tie_order=list(s['tieOrder'])
        self.submissions=copy.deepcopy(s['submissions']);self.hints=copy.deepcopy(s['hints']);self.receipts=copy.deepcopy(s['receipts']);self.totals=dict(s['totals']);self.qualified=set(s['qualified']);self.finished=s['finished']
        self.load_extra(copy.deepcopy(s['extra']))
