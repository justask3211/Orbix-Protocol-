/* Frontend cross-field regressions against actual Python rule schemas.
 * Run with the project's Python environment: ORBIX_TEST_PYTHON=<python> node tools/tests/rematch-settings-regression.cjs
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { transformSync } = require('../../web/node_modules/rolldown/dist/utils-index.mjs')
const root = path.resolve(__dirname, '../..')
function load(file, modules, names) {
  const result = transformSync(file, fs.readFileSync(path.join(root, file), 'utf8'), { jsx: { runtime: 'automatic' }, target: 'es2022' })
  assert.deepEqual(result.errors, [])
  const source = result.code.replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, (_, fields, name) => `const {${fields.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(name)});`).replace(/import\s+['"][^'"]+\.css['"];?/g, '').replace(/\bexport\s+(?:default\s+)?(?=(?:function|const|class)\b)/g, '')
  return new Function('require', `${source}\nreturn {${names.join(',')}};`)(name => { if (!(name in modules)) throw new Error(`Unexpected import: ${name}`); return modules[name] })
}
const runtime = { jsx: () => null, jsxs: () => null, Fragment: null }, react = { useEffect() {}, useMemo: fn => fn(), useState: initial => [initial, () => {}], useId: () => 'fixture' }, icons = new Proxy({}, { get: () => () => null })
const { numericError } = load('web/src/center/ArcadeSettings.tsx', { react, 'react/jsx-runtime': runtime, 'lucide-react': icons }, ['numericError'])
const { TEMPLATE_FORMS } = load('web/src/center/wizardForms.tsx', { 'react/jsx-runtime': runtime }, ['TEMPLATE_FORMS'])
const { rematchDraft, validateRematch, previewRematchAllowed } = load('web/src/center/RematchSettings.tsx', { react, 'react/jsx-runtime': runtime, 'lucide-react': icons, './ArcadeSettings': { numericError }, './api': {}, './wizardForms': { TEMPLATE_FORMS }, './useModalFocus': {} }, ['rematchDraft', 'validateRematch', 'previewRematchAllowed'])
const fixtureCode = `
import json
from center.schema import TEMPLATE_RULES, RoomConfig
params={
 'number-hunt':dict(digits=4,min=1111,max=9999,guess_budget=10,duration_seconds=60),
 'token-catch':dict(duration_seconds=60,spawn_per_second=2,lanes=5,arena_mode=True,world_version=3),
 'boss-raid':dict(max_players=6,duration_seconds=120,arena_mode=True,world_version=3,team_mode='teams'),
 'combat-duel':dict(world_version=3),
 'reaction-duel':dict(),
}
out={}
for name,args in params.items():
 model=TEMPLATE_RULES[name];rules=model(**args)
 cfg=RoomConfig(template_id=name,name='Round one',rules=rules,admission={'player_cap':2 if 'duel' in name else 6,'min_ready_to_start':2},rewards={'slots':[{'rank':1,'points':600},{'rank':2,'points':100}]})
 out[name]={'config':cfg.public_dict(),'schema':model.model_json_schema()}
print(json.dumps(out))
`
const fixtures = JSON.parse(execFileSync(process.env.ORBIX_TEST_PYTHON || 'python', ['-c', fixtureCode], { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' }))
let checks = 0
const check = fn => { fn(); checks++ }
function room(name) { return { config: fixtures[name].config, rematch: { supported: true }, participants: [], roomId: 'room', owner: 'creator' } }
function draft(name) { return rematchDraft(room(name)) }
for (const name of Object.keys(fixtures)) check(() => assert.deepEqual(validateRematch(draft(name), fixtures[name].schema), {}, `${name} defaults must remain valid`))
check(() => { const config = draft('token-catch'); assert.equal(config.rules.world_version, 4); assert.equal(config.rules.arena_mode, true); assert.equal(config.rewards.slots[0].points, config.rules.loot_budget); assert.equal(fixtures['token-catch'].config.rules.world_version, 3) })
check(() => { const config = draft('boss-raid'); assert.equal(config.rewards.slots[0].points, 700); assert.equal(config.rules.max_players, config.admission.player_cap); assert.deepEqual(config.access, fixtures['boss-raid'].config.access); assert.deepEqual(config.branding, fixtures['boss-raid'].config.branding) })
check(() => { const config = draft('number-hunt'); config.rules.duration_seconds = 601; assert.ok(validateRematch(config, fixtures['number-hunt'].schema).duration_seconds) })
check(() => { const config = draft('number-hunt'); config.rules.digits = 6; assert.ok(validateRematch(config, fixtures['number-hunt'].schema).min) })
check(() => { const config = draft('number-hunt'); config.rules.hints = 'invalid'; assert.ok(validateRematch(config, fixtures['number-hunt'].schema).hints) })
check(() => { const config = draft('boss-raid'); config.rules.team_reward_shares = [60, 20, 15]; assert.ok(validateRematch(config, fixtures['boss-raid'].schema).team_reward_shares) })
check(() => { const config = draft('boss-raid'); config.rules.winning_teams = 2; assert.ok(validateRematch(config, fixtures['boss-raid'].schema).team_reward_shares) })
check(() => { const config = draft('boss-raid'); config.rules.min_contribution = config.rules.contribution_cap + 1; assert.ok(validateRematch(config, fixtures['boss-raid'].schema).min_contribution) })
check(() => { const config = draft('token-catch'); config.rules.loot_budget = 5; assert.ok(validateRematch(config, fixtures['token-catch'].schema).airdrop_count) })
check(() => { const config = draft('token-catch'); config.rules.loot_budget = 10000; config.rules.loot_chunk = 1; assert.ok(validateRematch(config, fixtures['token-catch'].schema).loot_chunk) })
check(() => { const config = draft('combat-duel'); config.admission.player_cap = 3; assert.ok(validateRematch(config, fixtures['combat-duel'].schema).player_cap) })
check(() => { const config = draft('boss-raid'); config.admission.player_cap = 51; assert.ok(validateRematch(config, fixtures['boss-raid'].schema).player_cap) })
check(() => { const config = draft('number-hunt'); config.community_settings.timed_hints = [{ delay_seconds: 20, text: '' }]; assert.ok(validateRematch(config, fixtures['number-hunt'].schema)['hint-text-0']) })
check(() => { const current = room('token-catch'); assert.equal(previewRematchAllowed(current), true); const unsafe = structuredClone(current); unsafe.config.entry.kind = 'erc20'; assert.equal(previewRematchAllowed(unsafe), false) })
check(() => { const current = room('boss-raid'); current.rematch.supported = false; assert.equal(previewRematchAllowed(current), false) })
process.stdout.write(`${checks} rematch settings checks passed against actual Python schemas.\n`)
