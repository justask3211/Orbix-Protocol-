"""Prism Lines v1 — bounded gravity turns, explicit idle/no-contest policy."""
import copy
import hashlib
import json
import re
from center.games.base import Engine,ActionResult,StreamRNG

class PrismLinesEngine(Engine):
    template_id='prism-lines';version=1;timed_sealed=True
    def __init__(self,config,round_id,seed,participants):
        super().__init__(config,round_id,seed,sorted(p.lower() for p in participants))
        self.rules=config.rules;self.seats=[];self.board=[[None]*self.rules.columns for _ in range(self.rules.rows)]
        self.turn_index=0;self.phase='selection';self.phase_started=0;self.server_time=0
        self.winner=None;self.reason=None;self.winning_cells=[];self.history=[];self.transitions=[]
        self.legal={p:0 for p in self.participants};self.streak={p:0 for p in self.participants};self.hints={p:{} for p in self.participants};self.receipts={p:{} for p in self.participants};self.last_move={p:None for p in self.participants}
    def start(self,now=0):
        if len(self.participants)!=2 or len(set(self.participants))!=2:raise ValueError('EXACTLY_TWO_PLAYERS_REQUIRED')
        self.seats=StreamRNG(self.seed,b'prism-lines/v1/seats').shuffled(self.participants);self.phase_started=self.server_time=now
    @property
    def current_player(self):return self.seats[self.turn_index%2] if self.seats and self.phase=='selection' else None
    def phase_deadline(self):return self.phase_started+(self.rules.turn_seconds if self.phase=='selection' else self.rules.result_seconds)
    def _end(self,reason,winner,at):
        self.reason=reason;self.winner=winner;self.phase='result';self.phase_started=at
    def _transition(self,at,reason):self.transitions.append({'roundId':self.round_id,'index':self.turn_index,'phase':reason,'at':at})
    def _next(self,at):
        if self.turn_index+1>=self.rules.rows*self.rules.columns or all(cell is not None for row in self.board for cell in row):self._end('draw',None,at)
        else:self.turn_index+=1;self.phase_started=at
    def tick(self,now):
        self.server_time=now;changed=False
        for _ in range(self.rules.rows*self.rules.columns+1):
            if self.finished or now<self.phase_deadline():break
            deadline=self.phase_deadline()
            if self.phase=='result':self._transition(deadline,'result');self.phase='done';self.finished=True
            else:
                who=self.current_player;opponent=next(p for p in self.seats if p!=who)
                self.streak[who]+=1
                self.history.append({'turnIndex':self.turn_index,'who':who,'column':None,'reason':'timeout','at':deadline})
                self._transition(deadline,'timeout')
                if self.streak[who]>=self.rules.timeout_streak_limit:
                    self._end('forfeit' if self.legal[opponent]>0 else 'no-contest',opponent if self.legal[opponent]>0 else None,deadline)
                else:self._next(deadline)
            changed=True
        return ActionResult(True,patch=self.public_state(),finished=self.finished,scores=self.scores()) if changed else None
    def legal_columns(self):return [c for c in range(self.rules.columns) if self.board[0][c] is None]
    def _line(self,who,row,col):
        for dr,dc in [(1,0),(0,1),(1,1),(1,-1)]:
            cells=[(row,col)]
            for sign in [-1,1]:
                rr,cc=row+sign*dr,col+sign*dc
                while 0<=rr<self.rules.rows and 0<=cc<self.rules.columns and self.board[rr][cc]==who:
                    cells.append((rr,cc));rr+=sign*dr;cc+=sign*dc
            if len(cells)>=4:return [list(cell) for cell in sorted(cells)]
        return []
    def act(self,who,action,now):
        self.tick(now)
        if who not in self.participants:return ActionResult(False,'NOT_ADMITTED')
        if not isinstance(action,dict) or action.get('roundId')!=self.round_id:return ActionResult(False,'STALE_MATCH')
        aid=action.get('actionId')
        if not isinstance(aid,str) or not re.fullmatch('[A-Za-z0-9_-]{1,80}',aid):return ActionResult(False,'BAD_ACTION_ID')
        identity=json.dumps(action,sort_keys=True,separators=(',',':'))
        saved=self.receipts[who].get(aid)
        if saved:
            if saved['identity']!=identity:return ActionResult(False,'ACTION_ID_CONFLICT')
            return ActionResult(True,patch=self.public_state(),private=copy.deepcopy(saved['private']))
        if self.finished:return ActionResult(False,'ROUND_FINISHED')
        if type(action.get('turnIndex')) is not int or action['turnIndex']!=self.turn_index:return ActionResult(False,'STALE_PHASE')
        if self.phase!='selection' or now<self.phase_started:return ActionResult(False,'ROUND_NOT_OPEN')
        if who!=self.current_player:return ActionResult(False,'NOT_YOUR_TURN')
        common={'kind','actionId','roundId','turnIndex'}
        receipt={'receiptId':hashlib.sha256(f'prism-lines/v1/receipt/{self.round_id}/{who}/{identity}'.encode()).hexdigest(),'actionId':aid,'turnIndex':self.turn_index,'locked':True}
        if action.get('kind')=='hint':
            if set(action)-common-{'hintKind'} or action.get('hintKind')!='legal-columns':return ActionResult(False,'BAD_ACTION')
            if self.rules.hints=='off':return ActionResult(False,'HINTS_OFF')
            receipt=self.hints[who].get(str(self.turn_index)) or {**receipt,'hintKind':'legal-columns','payload':{'columns':self.legal_columns()}}
            if str(self.turn_index) not in self.hints[who]:
                if len(self.hints[who])>=self.rules.hint_budget:return ActionResult(False,'HINT_BUDGET_EXHAUSTED')
                self.hints[who][str(self.turn_index)]=receipt
            private={'hintReceipt':receipt,'hintsRemaining':self.rules.hint_budget-len(self.hints[who])}
        elif action.get('kind')=='drop':
            column=action.get('column')
            if set(action)-common-{'column'} or type(column) is not int or not 0<=column<self.rules.columns:return ActionResult(False,'BAD_DROP')
            if column not in self.legal_columns():return ActionResult(False,'COLUMN_FULL')
            row=next(r for r in range(self.rules.rows-1,-1,-1) if self.board[r][column] is None)
            self.board[row][column]=who;self.legal[who]+=1;self.streak[who]=0
            receipt.update(submission={'column':column,'row':row});self.last_move[who]=receipt
            self.history.append({'turnIndex':self.turn_index,'who':who,'column':column,'row':row,'reason':'drop','at':now});self._transition(now,'drop')
            self.winning_cells=self._line(who,row,column)
            if self.winning_cells:self._end('line',who,now)
            else:self._next(now)
            private={'ownSubmission':receipt}
        else:return ActionResult(False,'BAD_ACTION')
        self.receipts[who][aid]={'identity':identity,'private':copy.deepcopy(private)}
        return ActionResult(True,patch=self.public_state(),private=copy.deepcopy(private),scores=self.scores())
    def private_state(self,who):
        if who not in self.participants:return {}
        return {'ownSubmission':copy.deepcopy(self.last_move[who]),'hintReceipt':copy.deepcopy(self.hints[who].get(str(self.turn_index))),'hintsRemaining':self.rules.hint_budget-len(self.hints[who])}
    def public_state(self):
        return {'template':self.template_id,'version':1,'roundId':self.round_id,'phase':self.phase,'turnIndex':self.turn_index,'index':self.turn_index,'phaseStartedAt':self.phase_started,'phaseDeadline':self.phase_deadline(),'serverTimeMs':int(self.server_time*1000),
                'board':copy.deepcopy(self.board),'rows':self.rules.rows,'columns':self.rules.columns,'currentPlayer':self.current_player or '','players':list(self.seats),'seatOrder':list(self.seats),'scores':self.scores(),'winner':self.winner or '', 'reason':self.reason or '', 'winningCells':self.winning_cells,'history':copy.deepcopy(self.history),'finished':self.finished,'legalDrops':dict(self.legal),'timeouts':dict(self.streak),'hints':self.rules.hints,'hintBudget':self.rules.hint_budget,'hintKind':'legal-columns','tieRule':'A draw or no-contest awards nobody.'}
    def scores(self):return {p:int(p==self.winner) for p in self.participants}
    def ranking(self):return sorted(self.seats,key=lambda p:p!=self.winner)
    def eligible(self):return {self.winner} if self.winner and self.legal[self.winner]>0 else set()
    def snapshot(self):
        return copy.deepcopy({'template':self.template_id,'version':1,'participants':self.participants,'seats':self.seats,'board':self.board,'turnIndex':self.turn_index,'phase':self.phase,'phaseStartedAt':self.phase_started,'serverTime':self.server_time,'winner':self.winner,'reason':self.reason,'winningCells':self.winning_cells,'history':self.history,'transitions':self.transitions,'legal':self.legal,'streak':self.streak,'hints':self.hints,'receipts':self.receipts,'lastMove':self.last_move,'finished':self.finished})
    def _load(self,s):
        if s.get('version')!=1 or s.get('template')!=self.template_id:raise ValueError('INCOMPATIBLE_PRISM_SNAPSHOT')
        for attr,key in [('seats','seats'),('board','board'),('turn_index','turnIndex'),('phase','phase'),('phase_started','phaseStartedAt'),('server_time','serverTime'),('winner','winner'),('reason','reason'),('winning_cells','winningCells'),('history','history'),('transitions','transitions'),('legal','legal'),('streak','streak'),('hints','hints'),('receipts','receipts'),('last_move','lastMove'),('finished','finished')]:setattr(self,attr,copy.deepcopy(s[key]))
