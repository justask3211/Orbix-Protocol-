"""Local-only corrected-home inventory using the unchanged admin configuration shape."""
from tools.tests.tournaments_hold_fixture import app
from center.admin_games import GameConfig, GameOverlay, GameModes, GameTag

for template_id in ('closest-call', 'word-forge', 'prism-lines', 'atlas-quest', 'reaction-duel', 'rps-duel'):
    app.state.store.set_setting(f'game-config:{template_id}', GameConfig(overlay=GameOverlay(enabled=False)).model_dump())
app.state.store.set_setting('game-config:token-catch', GameConfig(placement='more', overlay=GameOverlay(enabled=False)).model_dump())
app.state.store.set_setting('game-config:boss-raid', GameConfig(placement='upcoming', overlay=GameOverlay(text='80% built'), tag=GameTag(enabled=True, text='Squad play incoming', style='solid'), modes=GameModes(create=False, join=False, practice=False)).model_dump())
app.state.store.set_setting('game-config:combat-duel', GameConfig(placement='hidden', overlay=GameOverlay(text='In development', color='amber')).model_dump())
app.state.store.set_setting('game-config:number-hunt', GameConfig(overlay=GameOverlay(enabled=False), modes=GameModes(create=False, join=False, practice=False)).model_dump())
