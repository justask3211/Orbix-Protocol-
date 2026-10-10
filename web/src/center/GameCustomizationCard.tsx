import { useEffect, useState } from 'react'
import { Gamepad2, Radio, Wrench } from 'lucide-react'
import { GameArtwork } from './GameArtwork'
import { BannerBadges } from './BannerBadges'
import { defaultGameConfig, OVERLAY_COLORS, type GameConfig, type SavedGameConfig } from './gameCustomization'

type Availability = { templateId: string; status: 'live' | 'maintenance' | 'offline'; message: string; config?: SavedGameConfig }
export function GameCustomizationCard({ game, availability, busy, onSave, onAvailability }: {
  game: { id: string; name: string; description: string; hue: string }
  availability: Availability; busy: boolean
  onSave: (config: GameConfig) => Promise<void>; onAvailability: (status: Availability['status']) => void
}) {
  const [draft, setDraft] = useState<GameConfig>(() => availability.config ?? defaultGameConfig())
  const [step, setStep] = useState(0)
  const [dirty, setDirty] = useState(false)
  const saved = availability.config ?? defaultGameConfig()
  useEffect(() => { if (!dirty) setDraft(availability.config ?? defaultGameConfig()) }, [availability.config, dirty])
  const edit = (patch: Partial<GameConfig>) => { setDraft(value => ({ ...value, ...patch })); setDirty(true) }
  const valid = draft.overlay.text.length <= 40 && draft.tag.text.length <= 40 && (draft.overlay.color in OVERLAY_COLORS || /^#[\da-f]{6}$/i.test(draft.overlay.color)) && Number.isInteger(draft.sort_order) && Math.abs(draft.sort_order) <= 100000
  const status = availability.status
  const save = async () => {
    // Saved metadata is never sent as an editable field to the strict endpoint.
    const config: GameConfig = { placement: draft.placement, overlay: draft.overlay, tag: draft.tag, modes: draft.modes, sort_order: draft.sort_order }
    await onSave(config); setDirty(false)
  }
  return <article className="ag-game-card">
    <div className="ag-game-art gc-banner"><GameArtwork id={game.id} color={game.hue}/><BannerBadges overlay={draft.overlay} tag={draft.tag}/></div>
    <div className="ag-game-body"><span className={`ag-state ag-state-${status}`}>{status === 'live' ? <Radio size={13}/> : <Wrench size={13}/>} {status}</span><h3>{game.name}</h3><p>{game.description}</p>
      {availability.message && <p className="ag-game-notice">{availability.message}</p>}
      <div className="ag-availability" role="group" aria-label={`${game.name} availability`}>{(['live', 'maintenance', 'offline'] as const).map(value => <button aria-pressed={status === value} className={status === value ? 'selected' : ''} key={value} disabled={busy} onClick={() => onAvailability(value)}>{value === 'live' ? 'Live' : value === 'maintenance' ? 'Tune-up' : 'Offline · hidden'}</button>)}</div>
      <details className="gc-editor"><summary>Customize display & play{dirty && <span>Unsaved</span>}</summary>
        <div className="gc-steps" role="group" aria-label={`${game.name} customization steps`}>{['Placement', 'Banner & tag', 'Play modes'].map((label, index) => <button key={label} aria-pressed={index === step} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</div>
        <fieldset disabled={busy} className="gc-fields">
          {step === 0 && <><label>Display location<select value={draft.placement} onChange={e => edit({placement: e.target.value as GameConfig['placement']})}><option value="catalog">Games · main catalog</option><option value="more">More games tab</option><option value="upcoming">Upcoming games · Coming soon</option><option value="hidden">Hidden</option></select></label><label>Sort order<input type="number" min={-100000} max={100000} step={1} value={Number.isNaN(draft.sort_order) ? '' : draft.sort_order} onChange={e => edit({sort_order: e.target.value === '' ? NaN : Number(e.target.value)})}/><small>Lower numbers appear first.</small></label><p>Upcoming games offer only offline preview when enabled. Hidden games have no public play options.</p></>}
          {step === 1 && <><label className="gc-toggle"><input type="checkbox" checked={draft.overlay.enabled} onChange={e => edit({overlay: {...draft.overlay, enabled: e.target.checked}})}/> Show banner overlay</label><label>Overlay text<input maxLength={40} value={draft.overlay.text} onChange={e => edit({overlay: {...draft.overlay, text: e.target.value}})}/><small>{draft.overlay.text.length}/40</small></label><label>Overlay color<input list={`colors-${game.id}`} value={draft.overlay.color} onChange={e => edit({overlay: {...draft.overlay, color: e.target.value}})} placeholder="blue or #2563eb"/><datalist id={`colors-${game.id}`}>{Object.keys(OVERLAY_COLORS).map(color => <option key={color} value={color}/>)}</datalist></label><label>Overlay corner<select value={draft.overlay.position} onChange={e => edit({overlay: {...draft.overlay, position: e.target.value as GameConfig['overlay']['position']}})}>{['top-left','top-right','bottom-left','bottom-right'].map(position => <option key={position}>{position}</option>)}</select></label><label className="gc-toggle"><input type="checkbox" checked={draft.tag.enabled} onChange={e => edit({tag: {...draft.tag, enabled: e.target.checked}})}/> Show game tag</label><label>Tag text<input maxLength={40} value={draft.tag.text} onChange={e => edit({tag: {...draft.tag, text: e.target.value}})}/><small>{draft.tag.text.length}/40</small></label><label>Tag style<select value={draft.tag.style} onChange={e => edit({tag: {...draft.tag, style: e.target.value as GameConfig['tag']['style']}})}>{['subtle','solid','outline'].map(style => <option key={style}>{style}</option>)}</select></label></>}
          {step === 2 && <>{(['practice', 'preview', 'create', 'join'] as const).map(mode => <label key={mode} className="gc-toggle"><input type="checkbox" checked={draft.modes[mode]} onChange={e => edit({modes: {...draft.modes, [mode]: e.target.checked}})}/><span>{({practice: 'Try now · server practice', preview: 'Preview · offline demo', create: 'Create room', join: 'Join room'})[mode]}</span></label>)}<p>Practice uses the server. Preview loads a local playground with no room, connection or saved scores.</p>{draft.placement === 'upcoming' && <p>Only the preview toggle applies while this game is upcoming.</p>}</>}
        </fieldset>
        {!valid && <p className="ag-error" role="alert">Use a color preset or #RRGGBB, and a whole sort order between −100000 and 100000.</p>}
        <div className="gc-save"><button className="ag-primary" disabled={busy || !dirty || !valid} onClick={() => void save().catch(() => {})}>Sign & save game</button><button className="ag-secondary" disabled={busy || !dirty} onClick={() => {setDraft(saved);setDirty(false)}}>Reset draft</button></div>
      </details>
      {draft.modes.preview && <a className="ag-trial" href={`/center/preview/${game.id}`}><Gamepad2 size={17}/> Open offline preview</a>}
    </div>
  </article>
}
