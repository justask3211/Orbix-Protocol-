"""Preview is an asset shell and never allocates a practice match or room."""
import json
from fastapi.testclient import TestClient
from center.api import create_app, Auth
from center.admin_games import GameConfig
from center.games import ENGINES
from tools.center.generate_preview_fixtures import generate


def snapshot(store):
    with store.tx() as cx:
        return {r[0]:cx.execute('SELECT * FROM "'+r[0]+'"').fetchall() for r in cx.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()}


def test_every_preview_is_anonymous_read_only_and_never_creates_matches(tmp_path,monkeypatch):
    dist=tmp_path/'dist';dist.mkdir();(dist/'index.html').write_text('<html><body><div id="root"></div></body></html>')
    monkeypatch.setenv('CENTER_WEB_DIST',str(dist))
    app=create_app(db_path=str(tmp_path/'preview.db'),authenticator=Auth('test-preview'))
    with TestClient(app) as client:
        before=snapshot(app.state.store)
        for tid in ENGINES:
            result=client.get('/center/preview/'+tid)
            assert result.status_code==200
            assert result.headers["cache-control"]=="no-store"
            assert '<div id="root">' in result.text
        assert snapshot(app.state.store)==before
        assert not app.state.practice_matches and not app.state.runtimes
        assert client.get('/center/preview/made-up').status_code==404
    app.state.store.close()


def test_disabled_preview_route_is_rejected_without_room_writes(tmp_path,monkeypatch):
    dist=tmp_path/'dist';dist.mkdir();(dist/'index.html').write_text('<html>Assets</html>')
    monkeypatch.setenv('CENTER_WEB_DIST',str(dist))
    app=create_app(db_path=str(tmp_path/'preview.db'),authenticator=Auth('test-preview'))
    cfg=GameConfig().model_dump();cfg['modes']['preview']=False
    app.state.store.set_setting('game-config:number-hunt',cfg)
    with TestClient(app) as client:
        before=snapshot(app.state.store)
        assert client.get('/center/preview/number-hunt').status_code==404
        assert snapshot(app.state.store)==before
        assert not app.state.practice_matches
    app.state.store.close()


def test_bundled_fixtures_are_seed_generated_for_every_engine_without_storage():
    from pathlib import Path
    fixture=Path(__file__).resolve().parents[2]/'web/src/center/previewFixtures.json'
    generated=generate()
    assert set(generated)==set(ENGINES)
    assert json.loads(fixture.read_text())==json.loads(json.dumps(generated))
    assert generate()==generated
