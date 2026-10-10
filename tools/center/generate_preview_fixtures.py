"""Build-time fixtures only. No Store, API, room runtime or real match seed."""
import json
from pathlib import Path
from center.schema import RoomConfig, TEMPLATE_RULES, SOLO_TEMPLATES
from center.games import engine_for
from center.practice import RULES, PLAYER, BOTS

SEED = 'orbix-offline-demo-v1'



def generate():
    fixtures={}
    for tid, model in TEMPLATE_RULES.items():
        rules=dict(RULES[tid])
        # Required primitive fields use their schema lower bound. Game-specific
        # content above is authored here; no database or user content is read.
        for key, field in model.model_fields.items():
            if field.is_required() and key not in rules:
                prop=model.model_json_schema()['properties'][field.alias or key]
                rules[key]=prop.get('minimum',1)
        players=[PLAYER] if tid in SOLO_TEMPLATES else [PLAYER,BOTS[0]]
        config=RoomConfig(name='Offline demo',template_id=tid,rules={'templateId':tid,**rules},
            admission={'player_cap':len(players),'min_ready_to_start':len(players)},access={'required_amount':0})
        engine=engine_for(config)(config,'offline-'+tid,SEED,players)
        engine.start(0)
        if getattr(engine,'arena',False):engine.tick(5)
        state=engine.public_state()
        if hasattr(engine,'private_state'):state.update(engine.private_state(PLAYER))
        fixtures[tid]={'me':PLAYER,'players':players,'state':state}
    return fixtures


if __name__=='__main__':
    target=Path(__file__).resolve().parents[2]/'web/src/center/previewFixtures.json'
    target.write_text(json.dumps(generate(),sort_keys=True,separators=(',',':'))+'\n')
    print(f'Wrote {target.name}')
