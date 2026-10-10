import { isPortfolio, portfolioDuration } from './gamePortfolio'
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Sparkles, Users, X } from 'lucide-react'
import { ArcadeChoices, ArcadeNumber, ArcadeShares, ArcadeToggle, numericError, type NumericBounds } from './ArcadeSettings'
import { center, explainError, type RoomDetail } from './api'
import { TEMPLATE_FORMS, type RuleField } from './wizardForms'
import { useModalFocus } from './useModalFocus'
import './rematchSettings.css'

type Config = Record<string, any>
type SchemaField = NumericBounds & { enum?: unknown[]; const?: unknown; default?: unknown }
export type RematchRulesSchema = { properties?: Record<string, SchemaField> }
type Props = { room: RoomDetail; onSave: (config: Record<string, unknown>) => Promise<void>; onClose: () => void }
const ARENAS = new Set(['token-catch', 'boss-raid', 'combat-duel'])
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function previewRematchAllowed(room: RoomDetail): boolean {
  const config = room.config as Config
  return room.rematch?.supported === true && config.mode === 'preview' && config.entry?.kind === 'free' && config.access?.vault_mode === 'simulated' && config.rewards?.kind === 'preview-points'
}

/** New-match edits preserve the room's identity, access, fees, branding and unrelated metadata. */
export function rematchDraft(room: RoomDetail): Config {
  const config = clone(room.config) as Config, template = String(room.config.template_id)
  config.rules = { ...config.rules }
  if (ARENAS.has(template)) {
    config.rules.world_version = 4
    if (template !== 'combat-duel') config.rules.arena_mode = true
    if (template === 'boss-raid') { config.rules.team_mode = 'teams'; config.rules.max_players = config.admission.player_cap }
  }
  config.community_settings = { mute_chat: false, hide_players: false, hide_guesses: false, ...config.community_settings, timed_hints: [] }
  if (['token-catch', 'boss-raid'].includes(template)) {
    const points = template === 'token-catch' ? Number(config.rules.loot_budget ?? 500) : (config.rewards.slots ?? []).reduce((sum: number, slot: Config) => sum + Number(slot.points || 0), 0)
    config.rewards = { ...config.rewards, slots: [{ rank: 1, points }] }
  }
  return config
}

function fieldsFor(template: string, rules: Config): RuleField[] {
  const fields = (TEMPLATE_FORMS[template]?.fields ?? []).map(field => field.key === 'allow_gun' ? { ...field, key: 'allow_guns' } : field).filter(field => {
    if (Number(rules.world_version) >= 3 && template === 'token-catch' && ['lanes', 'fall_speed', 'combo_cap', 'spawn_per_second', 'win_threshold', 'top_n', 'catch_window_ms'].includes(field.key)) return false
    if (Number(rules.world_version) >= 3 && template === 'boss-raid' && ['top_n', 'reward_rule', 'team_mode'].includes(field.key)) return false
    return true
  })
  if (template === 'number-hunt') fields.push({ kind: 'select', key: 'hint_visibility', label: 'Who sees automatic clues', options: [{ value: 'public', label: 'Everyone', description: 'Direction clues appear in the shared log.' }, { value: 'private', label: 'The guesser', description: 'A direction clue is visible only to its guesser.' }], help: 'Applies when automatic warmer/colder clues are enabled.' })
  return fields
}

function boundsFor(field: Extract<RuleField, { kind: 'number' }>, config: Config, schema: RematchRulesSchema): NumericBounds {
  if (config.template_id === 'number-hunt' && ['min', 'max'].includes(field.key)) return Number(config.rules.digits) === 6 ? { minimum: 111111, maximum: 999999 } : { minimum: 1111, maximum: 9999 }
  return schema.properties?.[field.key] ?? { minimum: field.min, maximum: field.max, type: field.step && field.step < 1 ? 'number' : 'integer' }
}

export function validateRematch(config: Config, schema: RematchRulesSchema = {}, cap?: { min: number | null; max: number | null }): Record<string, string> {
  const errors: Record<string, string> = {}, rules = config.rules ?? {}, template = String(config.template_id), add = (key: string, message?: string) => { if (message) errors[key] = message }
  const duel = ['combat-duel', 'reaction-duel', 'rps-duel', 'prism-lines'].includes(template), arena = ARENAS.has(template), minimum = duel ? 2 : Math.max(1, cap?.min ?? (template === 'boss-raid' ? 2 : 1)), maximum = duel ? 2 : Math.min(arena ? 50 : 100, cap?.max ?? 100)
  if (String(config.name || '').trim().length < 3 || String(config.name || '').trim().length > 60) errors.name = 'Use a room name with 3–60 characters.'
  add('player_cap', numericError(config.admission?.player_cap, { minimum, maximum }, 'Player cap'))
  add('min_ready_to_start', numericError(config.admission?.min_ready_to_start, { minimum, maximum: Number(config.admission?.player_cap) }, 'Ready players'))
  if (rules.duration_seconds !== undefined) add('duration_seconds', numericError(rules.duration_seconds, schema.properties?.duration_seconds ?? { minimum: template === 'boss-raid' ? 60 : 15, maximum: 600 }, 'Round length'))
  for (const field of fieldsFor(template, rules)) {
    const property = schema.properties?.[field.key]
    if (field.kind === 'number') add(field.key, numericError(rules[field.key] ?? property?.default, boundsFor(field, config, schema), field.label))
    if (field.kind === 'select') {
      const options = property?.enum ?? field.options.map(option => option.value)
      if (!options.some(value => String(value) === String(rules[field.key] ?? property?.default))) errors[field.key] = `Choose a supported ${field.label.toLowerCase()} option.`
    }
  }
  if (template === 'number-hunt') {
    if (Number(rules.max) <= Number(rules.min)) errors.max = 'Range end must be higher than range start.'
    if (Number(rules.target_count) > Number(rules.max) - Number(rules.min) + 1) errors.target_count = 'Use fewer hidden targets than the available numbers.'
  }
  if (template === 'boss-raid') {
    if (Number(rules.min_contribution) > Number(rules.contribution_cap)) errors.min_contribution = 'Minimum contribution cannot exceed the per-player cap.'
    const shares = rules.team_reward_shares
    if (!Array.isArray(shares) || shares.length !== Number(rules.winning_teams) || shares.some(value => !Number.isInteger(value) || value < 0 || value > 100) || shares.reduce((sum, value) => sum + value, 0) !== 100) errors.team_reward_shares = 'Prize shares must match the winning crews and total exactly 100%.'
  }
  if (template === 'token-catch') {
    if (Number(rules.airdrop_count) > Number(rules.loot_budget)) errors.airdrop_count = 'Use at least one loot point per airdrop.'
    if (Math.ceil(Number(rules.loot_budget) / Number(rules.loot_chunk)) + Number(rules.airdrop_count) > 400) errors.loot_chunk = 'Use larger loot piles: up to 400 piles are supported.'
  }
  for (const [index, slot] of (config.rewards?.slots ?? []).entries()) add(`reward-${index}`, numericError(slot.points, { minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, `Rank ${slot.rank} preview points`))
  for (const [index, hint] of (config.community_settings?.timed_hints ?? []).entries()) {
    add(`hint-delay-${index}`, numericError(hint.delay_seconds, { minimum: 0, maximum: Math.min(3600, Number(rules.duration_seconds) || 3600) }, 'Hint delay'))
    if (!String(hint.text || '').trim() || String(hint.text).length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(String(hint.text))) errors[`hint-text-${index}`] = 'Use a readable hint with 1–500 characters.'
  }
  return errors
}

export default function RematchSettings({ room, onSave, onClose }: Props) {
  const [config, setConfig] = useState<Config>(() => rematchDraft(room)), [schema, setSchema] = useState<RematchRulesSchema>({}), [cap, setCap] = useState<{ min: number | null; max: number | null }>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const allowed = previewRematchAllowed(room), dialog = useModalFocus(() => { if (!busy) onClose() }), template = String(room.config.template_id), rules = config.rules
  const fields = useMemo(() => fieldsFor(template, rules), [template, rules]), errors = validateRematch(config, schema, cap)
  useEffect(() => {
    let active = true
    if (!allowed) { setLoading(false); return }
    center.templateRules(template).then(result => {
      if (!active) return
      setSchema(result.fields as RematchRulesSchema); setCap(result.playerCap); setLoading(false)
      const properties = (result.fields as RematchRulesSchema).properties ?? {}
      setConfig(previous => {
        const next = { ...previous, rules: { ...previous.rules } }
        for (const [key, property] of Object.entries(properties)) if (!['templateId', 'template_id'].includes(key) && next.rules[key] === undefined && property.default !== undefined) next.rules[key] = property.default
        return next
      })
    }).catch(cause => { if (active) { setError(explainError(cause)); setLoading(false) } })
    return () => { active = false }
  }, [template, allowed])
  const changeRule = (key: string, value: unknown, patch?: Config) => setConfig(previous => {
    const next: Config = { ...previous, rules: { ...previous.rules, ...patch, [key]: value } }
    if (isPortfolio(template)) next.rules.duration_seconds = portfolioDuration(template,next.rules)
    if (template === 'token-catch' && key === 'loot_budget') next.rewards = { ...previous.rewards, slots: [{ rank: 1, points: value }] }
    return next
  })
  const changeAdmission = (key: string, value: number) => setConfig(previous => ({ ...previous, admission: { ...previous.admission, [key]: value }, rules: template === 'boss-raid' && key === 'player_cap' ? { ...previous.rules, max_players: value } : previous.rules }))
  const save = async () => {
    if (!allowed || busy || loading || Object.keys(errors).length) return
    setBusy(true); setError(null)
    try { const next = clone(config); next.name = String(next.name).trim(); next.community_settings.timed_hints = next.community_settings.timed_hints.map((hint: Config) => ({ ...hint, text: String(hint.text).trim() })); await onSave(next); onClose() }
    catch (cause) { setError(explainError(cause)) }
    finally { setBusy(false) }
  }
  const setHint = (index: number, patch: Config) => setConfig(previous => ({ ...previous, community_settings: { ...previous.community_settings, timed_hints: previous.community_settings.timed_hints.map((hint: Config, at: number) => at === index ? { ...hint, ...patch } : hint) } }))
  const hints = config.community_settings.timed_hints as Config[], duel = ['combat-duel', 'reaction-duel', 'rps-duel', 'prism-lines'].includes(template), poolGame = ['token-catch', 'boss-raid'].includes(template)
  return <div className="rm-backdrop" role="presentation" onClick={() => { if (!busy) onClose() }}><section className="rm-modal" role="dialog" aria-modal="true" aria-label="Edit next match settings" tabIndex={-1} ref={dialog} onClick={event => event.stopPropagation()}>
    <header className="rm-heading"><span className="rm-emblem" aria-hidden><RefreshCw size={26} /></span><div><small>NEXT MATCH · SAME ROOM</small><h2>{TEMPLATE_FORMS[template]?.label ?? template}</h2><p>Your room code and game stay together.</p></div><button type="button" className="rm-close" aria-label="Close next match settings" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    {!allowed ? <div className="rm-notice"><strong>This room needs a fresh funded match.</strong><p>Changing settings here is available for free preview rooms. Create a new room for paid entry or funded rewards.</p></div> : <>
      <div className="rm-notice"><Users size={20} /><p>Everyone will press <strong>Ready</strong> again. Previous results and claims stay attached to their finished match. Preparing the next preview match does not charge a new creator fee.</p></div>
      {ARENAS.has(template) && <p className="rm-world-note"><Sparkles size={16} /> Updated 3D world · the next match uses the current characters, terrain and movement.</p>}
      {loading ? <p role="status">Loading this game’s supported settings…</p> : <div className="rm-settings">
        <section><h3>The room</h3><label className="rm-text-label">Room name<input value={String(config.name ?? '')} maxLength={60} aria-invalid={Boolean(errors.name)} onChange={event => setConfig(previous => ({ ...previous, name: event.target.value }))} /></label>{errors.name && <p className="ct-field-error">{errors.name}</p>}
          <div className="rm-grid"><ArcadeNumber label="Player cap" value={Number(config.admission.player_cap)} minimum={duel ? 2 : cap?.min ?? (template === 'boss-raid' ? 2 : 1)} maximum={duel ? 2 : Math.min(ARENAS.has(template) ? 50 : 100, cap?.max ?? 100)} onChange={value => changeAdmission('player_cap', value)} error={errors.player_cap} help="Maximum players admitted to this room. Existing players retain their profiles and must ready again." /><ArcadeNumber label="Ready players to start" value={Number(config.admission.min_ready_to_start)} minimum={duel ? 2 : cap?.min ?? (template === 'boss-raid' ? 2 : 1)} maximum={Number(config.admission.player_cap)} onChange={value => changeAdmission('min_ready_to_start', value)} error={errors.min_ready_to_start} help="Only connected, ready players take part in the next match." /></div>
          {isPortfolio(template)&&<p>Total match budget: {portfolioDuration(template,rules)} seconds, computed from game windows.</p>}
          {!isPortfolio(template)&&rules.duration_seconds !== undefined && <ArcadeNumber label="Round length (seconds)" value={Number(rules.duration_seconds)} minimum={schema.properties?.duration_seconds?.minimum ?? (template === 'boss-raid' ? 60 : 15)} maximum={schema.properties?.duration_seconds?.maximum ?? 600} onChange={value => changeRule('duration_seconds', value)} error={errors.duration_seconds} help="Choose the next match’s clock. Up to ten minutes is supported." />}
        </section>
        <section><h3>Game rules</h3><div className="rm-grid">{fields.map(field => {
          const value = rules[field.key] ?? schema.properties?.[field.key]?.default
          if (field.kind === 'number') { const bounds = boundsFor(field, config, schema); return <ArcadeNumber key={field.key} label={field.label} value={Number(value)} minimum={bounds.minimum} maximum={bounds.maximum} step={field.step ?? 1} help={field.help} error={errors[field.key]} onChange={number => changeRule(field.key, number)} /> }
          if (field.kind === 'select') return <div key={field.key} className="rm-wide"><ArcadeChoices label={field.label} value={String(value)} options={field.options} help={field.help} onChange={selection => { const property = schema.properties?.[field.key], chosen = property?.enum?.find(option => String(option) === selection); changeRule(field.key, chosen ?? (property?.type === 'integer' ? Number(selection) : selection), field.options.find(option => option.value === selection)?.patch) }} />{errors[field.key] && <p className="ct-field-error">{errors[field.key]}</p>}</div>
          if (field.kind === 'toggle') return <ArcadeToggle key={field.key} label={field.label} description={field.help} checked={Boolean(value)} onChange={checked => changeRule(field.key, checked)} />
          if (field.kind === 'shares') return <div key={field.key} className="rm-wide"><ArcadeShares label={field.label} value={Array.isArray(value) ? value : []} count={Math.max(1, Math.min(3, Number(rules.winning_teams) || 3))} onChange={shares => changeRule(field.key, shares)} error={errors[field.key]} help={field.help} /></div>
          return null
        })}</div></section>
        <section><h3>Preview prizes</h3><p className="muted">These are game points. Wallet assets and entry payments cannot be changed in this editor.</p><div className="rm-grid">{(config.rewards.slots ?? []).map((slot: Config, index: number) => <ArcadeNumber key={slot.rank} label={poolGame ? 'Total preview prize pool' : `Rank ${slot.rank} preview points`} value={Number(slot.points)} minimum={0} maximum={template === 'token-catch' ? 10000 : Number.MAX_SAFE_INTEGER} error={errors[`reward-${index}`]} help={template === 'token-catch' ? 'Synced with total airdrop loot. Players collect their share from the same pool.' : template === 'boss-raid' ? 'The podium percentages divide this complete pool, then winning crews share it.' : 'Preserves this existing reward rank for the next match.'} onChange={points => { if (template === 'token-catch') changeRule('loot_budget', points); else setConfig(previous => ({ ...previous, rewards: { ...previous.rewards, slots: previous.rewards.slots.map((reward: Config, at: number) => at === index ? { ...reward, points } : reward) } })) }} />)}</div></section>
        <section><h3>Room atmosphere & hints</h3><div className="rm-grid">{([{ key: 'mute_chat', label: 'Mute player chat', kind: 'chat', help: 'Your own announcements and hints stay available.' }, { key: 'hide_players', label: 'Hide players', kind: 'eye', help: 'Hide player identities from the shared roster.' }, { key: 'hide_guesses', label: 'Hide guess log', kind: 'eye', help: 'Keep the live shared guess feed private during the round.' }] as const).map(option => <ArcadeToggle key={option.key} label={option.label} kind={option.kind} description={option.help} checked={Boolean(config.community_settings[option.key])} onChange={checked => setConfig(previous => ({ ...previous, community_settings: { ...previous.community_settings, [option.key]: checked } }))} />)}</div>
          {!isPortfolio(template)&&<><p className="muted">New match hints start empty. Add fresh clues here; they appear only when their scheduled time arrives.</p>
          {hints.map((hint, index) => <div className="rm-hint" key={index}><ArcadeNumber label={`Hint ${index + 1} after (seconds)`} value={Number(hint.delay_seconds)} minimum={0} maximum={Math.min(3600, Number(rules.duration_seconds) || 3600)} error={errors[`hint-delay-${index}`]} onChange={delay_seconds => setHint(index, { delay_seconds })} /><label className="rm-text-label">Hint message<textarea rows={2} maxLength={500} value={String(hint.text)} aria-invalid={Boolean(errors[`hint-text-${index}`])} onChange={event => setHint(index, { text: event.target.value })} />{errors[`hint-text-${index}`] && <small className="ct-field-error">{errors[`hint-text-${index}`]}</small>}</label><button type="button" className="btn-ghost" aria-label={`Remove hint ${index + 1}`} onClick={() => setConfig(previous => ({ ...previous, community_settings: { ...previous.community_settings, timed_hints: previous.community_settings.timed_hints.filter((_: Config, at: number) => at !== index) } }))}><X size={16} /></button></div>)}
          <button type="button" className="btn-ghost" disabled={hints.length >= 20} onClick={() => setConfig(previous => ({ ...previous, community_settings: { ...previous.community_settings, timed_hints: [...previous.community_settings.timed_hints, { delay_seconds: 15, text: '' }] } }))}>Add a timed hint</button></>}
        </section>
      </div>}
    </>}
      {error && <p className="err rm-error" role="alert">{error}</p>}
    <footer className="rm-footer"><div role="status" aria-live="polite">{allowed && !loading && Object.keys(errors).length > 0 ? `${Object.keys(errors).length} setting${Object.keys(errors).length === 1 ? '' : 's'} need attention.` : allowed ? 'Same game. Fresh match. Everyone readies again.' : 'No changes will be saved.'}</div><button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>Back</button>{allowed && <button type="button" className="btn-primary" disabled={loading || busy || Object.keys(errors).length > 0 || !Object.keys(schema).length} onClick={() => { void save() }}>{busy ? 'Preparing match…' : 'Save & prepare next match'}</button>}</footer>
  </section></div>
}
