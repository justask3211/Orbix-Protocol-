"""Immutable v1 portfolio rules; every score-affecting number is a strict integer."""
from typing import Literal
from pydantic import Field, StrictInt, model_validator
from center.strict_base import Strict
from center.content_packs import PACKS,pack_digest

class PortfolioRules(Strict):
    hints:Literal['off','on']='on'
    hint_budget:StrictInt=Field(default=2,ge=1,le=2)
    duration_seconds:StrictInt=Field(default=115,ge=15,le=600)
    @model_validator(mode='before')
    @classmethod
    def duration(cls,values):
        if isinstance(values,dict):
            values=dict(values)
            numeric={'rounds','selection_seconds','result_seconds','rack_size','rows','columns','connect_length','turn_seconds','timeout_streak_limit','min_players','max_players','hint_budget','duration_seconds','starting_credits','set_bonus','grid_columns','grid_rows','hint_score_penalty'}
            if any(k in values and type(values[k]) is not int for k in numeric):raise ValueError('Rule numbers must be strict integers')
            if 'duration_seconds' not in values:
                def value(k):return values.get(k,cls.model_fields[k].default)
                values['duration_seconds']=value('rows')*value('columns')*value('turn_seconds')+value('result_seconds') if 'rows' in cls.model_fields else value('rounds')*(value('selection_seconds')+value('result_seconds'))
        return values
    @model_validator(mode='after')
    def frozen_duration(self):
        expected=self.rows*self.columns*self.turn_seconds+self.result_seconds if hasattr(self,'rows') else self.rounds*(self.selection_seconds+self.result_seconds)
        if self.duration_seconds!=expected:raise ValueError('Duration must equal the complete input/result budget')
        if hasattr(self,'pack_id') and PACKS.get(self.pack_id)!=self.template_id:raise ValueError('Unknown pack for this game')
        return self

class ClosestCallRules(PortfolioRules):
    template_id:Literal['closest-call']=Field(default='closest-call',alias='templateId')
    rounds:StrictInt=Field(default=5,ge=3,le=10)
    selection_seconds:StrictInt=Field(default=20,ge=15,le=40)
    result_seconds:StrictInt=Field(default=3,ge=3,le=6)
    max_players:StrictInt=Field(default=20,ge=1,le=20)
    pack_id:str=Field(default='closest-museum-v1',pattern=r'^[a-z0-9-]{1,60}$')
    pack_sha256:str=Field(default_factory=lambda:pack_digest('closest-museum-v1'),pattern=r'^[a-f0-9]{64}$')

class WordForgeRules(PortfolioRules):
    template_id:Literal['word-forge']=Field(default='word-forge',alias='templateId')
    rounds:StrictInt=Field(default=3,ge=3,le=6)
    rack_size:StrictInt=Field(default=8,ge=7,le=9)
    selection_seconds:StrictInt=Field(default=40,ge=30,le=60)
    result_seconds:StrictInt=Field(default=4,ge=3,le=6)
    duration_seconds:StrictInt=Field(default=132,ge=15,le=600)
    max_players:StrictInt=Field(default=20,ge=1,le=20)
    hint_budget:Literal[1]=1
    pack_id:str=Field(default='word-workshop-en-v1',pattern=r'^[a-z0-9-]{1,60}$')
    pack_sha256:str=Field(default_factory=lambda:pack_digest('word-workshop-en-v1'),pattern=r'^[a-f0-9]{64}$')

class PrismLinesRules(PortfolioRules):
    template_id:Literal['prism-lines']=Field(default='prism-lines',alias='templateId')
    rows:StrictInt=Field(default=5,ge=5,le=6)
    columns:StrictInt=Field(default=5,ge=5,le=7)
    connect_length:Literal[4]=4
    turn_seconds:StrictInt=Field(default=15,ge=10,le=20)
    result_seconds:StrictInt=Field(default=3,ge=3,le=6)
    timeout_streak_limit:Literal[2]=2
    duration_seconds:StrictInt=Field(default=378,ge=15,le=600)
    min_players:Literal[2]=2
    max_players:Literal[2]=2

class RelicAuctionRules(PortfolioRules):
    template_id:Literal['relic-auction']=Field(default='relic-auction',alias='templateId')
    rounds:StrictInt=Field(default=5,ge=3,le=8)
    selection_seconds:StrictInt=Field(default=20,ge=15,le=30)
    result_seconds:StrictInt=Field(default=4,ge=3,le=6)
    duration_seconds:StrictInt=Field(default=120,ge=15,le=600)
    starting_credits:StrictInt=Field(default=100,ge=50,le=200)
    set_bonus:StrictInt=Field(default=30,ge=10,le=40)
    min_players:Literal[2]=2
    max_players:StrictInt=Field(default=8,ge=2,le=8)

class AtlasQuestRules(PortfolioRules):
    template_id:Literal['atlas-quest']=Field(default='atlas-quest',alias='templateId')
    rounds:StrictInt=Field(default=5,ge=3,le=10)
    selection_seconds:StrictInt=Field(default=25,ge=15,le=40)
    result_seconds:StrictInt=Field(default=4,ge=3,le=6)
    duration_seconds:StrictInt=Field(default=145,ge=15,le=600)
    grid_columns:Literal[36]=36
    grid_rows:Literal[18]=18
    hint_score_penalty:Literal[100]=100
    max_players:StrictInt=Field(default=20,ge=1,le=20)
    pack_id:str=Field(default='atlas-world-v1',pattern=r'^[a-z0-9-]{1,60}$')
    pack_sha256:str=Field(default_factory=lambda:pack_digest('atlas-world-v1'),pattern=r'^[a-f0-9]{64}$')
