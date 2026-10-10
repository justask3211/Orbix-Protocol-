"""Allowlisted immutable server-only packs. Never imported by browser bundles."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
PACKS={'closest-museum-v1':'closest-call','word-workshop-en-v1':'word-forge','atlas-world-v1':'atlas-quest'}
ROOT=Path(__file__).with_name('content')

def pack_bytes(pack_id):
    if pack_id not in PACKS: raise ValueError('UNKNOWN_CONTENT_PACK')
    raw=(ROOT/(pack_id+'.json')).read_bytes()
    if len(raw)>8_000_000: raise ValueError('CONTENT_PACK_TOO_LARGE')
    return raw

def pack_digest(pack_id): return hashlib.sha256(pack_bytes(pack_id)).hexdigest()

def validate_pack(raw,pack_id,expected):
    if pack_id not in PACKS or hashlib.sha256(raw).hexdigest()!=expected: raise ValueError('CONTENT_PACK_HASH_MISMATCH')
    doc=json.loads(raw)
    if doc.get('pack_id')!=pack_id or doc.get('version')!=1: raise ValueError('INCOMPATIBLE_CONTENT_PACK')
    tid=PACKS[pack_id]
    def integer(value,lo,hi):return type(value) is int and lo<=value<=hi
    if tid=='word-forge':
        words=doc['dictionary'];racks=doc['racks']
        if not 1<=len(words)<=100000 or len(set(words))!=len(words) or any(not isinstance(w,str) or not re.fullmatch('[a-z]{3,9}',w) for w in words): raise ValueError('INVALID_DICTIONARY')
        if not 1<=len(racks)<=10000: raise ValueError('INVALID_RACK_BANK')
        identifiers=[]
        for rack in racks:
            identifiers.append(rack['id']);letters=rack['letters']
            if not re.fullmatch('[a-z]{7,9}',letters) or not any(not (Counter(w)-Counter(letters)) for w in words): raise ValueError('UNSOLVABLE_RACK')
        if len(set(identifiers))!=len(identifiers): raise ValueError('DUPLICATE_PACK_ID')
    else:
        records=doc['records']
        if not 1<=len(records)<=10000 or len({r['id'] for r in records})!=len(records): raise ValueError('INVALID_PACK_RECORDS')
        for r in records:
            if not isinstance(r['id'],str) or not re.fullmatch('[a-z0-9-]{1,60}',r['id']) or not isinstance(r['prompt'],str) or not 1<=len(r['prompt'])<=200: raise ValueError('INVALID_PACK_RECORD')
            if tid=='closest-call':
                lo,hi,answer=r['lower'],r['upper'],r['answer']
                if not integer(lo,0,9999) or not integer(hi,lo+1,10000) or not integer(answer,lo,hi) or r['scene_kind'] not in {'jar-count','tower-count','scale-estimate'} or not 1<=len(r['unit'])<=20: raise ValueError('INVALID_EXHIBIT')
                if len(r['display']['objects'])!=answer or r['display']['reference']!=10: raise ValueError('EXHIBIT_ANSWER_MISMATCH')
                if any(not all(integer(o[k],0,100) for k in ['x','y']) or not integer(o['tone'],0,3) for o in r['display']['objects']): raise ValueError('INVALID_EXHIBIT_LAYOUT')
            else:
                col,row=r['answer_col'],r['answer_row']
                if not integer(col,0,35) or not integer(row,0,17) or not integer(r['latitude_arcseconds'],-324000,324000) or not integer(r['longitude_arcseconds'],-648000,648000): raise ValueError('INVALID_ATLAS_CELL')
                expected_col=((r['longitude_arcseconds']+648000)%1296000)//36000
                expected_row=min(17,(324000-r['latitude_arcseconds'])//36000)
                if (col,row)!=(expected_col,expected_row) or r['hemisphere']!=('north' if row<9 else 'south') or not r['source'].startswith('https://www.wikidata.org/wiki/Q'): raise ValueError('ATLAS_PROJECTION_MISMATCH')
    return doc

def load_pack(rules):
    raw=pack_bytes(rules.pack_id)
    return raw,validate_pack(raw,rules.pack_id,rules.pack_sha256)

def validate_config_pack(config):
    if hasattr(config.rules,'pack_id'):
        raw,doc=load_pack(config.rules)
        records=doc.get('records', [r for r in doc.get('racks',[]) if len(r['letters'])==getattr(config.rules,'rack_size',8)])
        if len(records)<config.rules.rounds: raise ValueError('INSUFFICIENT_DISTINCT_CHALLENGES')
