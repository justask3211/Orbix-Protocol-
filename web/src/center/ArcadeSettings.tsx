import { useId, useState } from 'react'
import { Check, Coins, Eye, EyeOff, Globe, Heart, Info, Link, LockKeyhole, Shield, Sparkles, Target, Timer, Users, VolumeX, Zap } from 'lucide-react'

type Choice = { value: string; label: string; description?: string }
/** A separate disclosure button never toggles the setting or submits the wizard. */
export function ArcadeInfo({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <span className="ct-setting-info">
    <button type="button" className="ct-info-button" aria-label={`About ${label}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}><Info size={16} /></button>
    {open && <span id={id} className="ct-info-explanation" role="note"><strong>{label}</strong>{text}</span>}
  </span>
}
function choiceIcon(value: string, index: number) {
  if (value === 'public') return Globe
  if (value === 'private') return LockKeyhole
  if (value === 'unlisted') return Link
  if (value === 'on' || value === 'now') return Zap
  if (value === 'off') return EyeOff
  if (value === 'schedule') return Timer
  if (value.includes('split') || value === 'teams') return Users
  if (value.includes('hit') || value.includes('contribut')) return Target
  return [Sparkles, Shield, Eye][index % 3]
}

/** Native radios retain arrow-key navigation; the whole illustration card is clickable. */
export function ArcadeChoices({ label, value, options, onChange, help, className = '' }: {
  label: string; value: string; options: Choice[]; onChange: (value: string) => void; help?: string; className?: string
}) {
  const id = useId()
  return <fieldset className={`ct-choice-field ${className}`}>
    <legend><span>{label}</span><ArcadeInfo label={label} text={help ?? options.map(option => `${option.label}: ${option.description ?? 'Select this option for the room.'}`).join(' ')} /></legend>
    <div className="ct-choice-grid">{options.map((option, index) => {
      const Icon = choiceIcon(option.value, index)
      return <label className={`ct-choice-card ct-choice-tone-${index % 3}${value === option.value ? ' is-selected' : ''}`} key={option.value}>
        <input type="radio" name={id} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
        <span className={`ct-choice-art ct-choice-art-${index % 3}`} aria-hidden="true"><Icon size={24} /><i /></span>
        <span className="ct-choice-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
        <span className="ct-choice-check" aria-hidden="true">{value === option.value && <Check size={14} />}</span>
      </label>
    })}</div>
    {help && <small className="ct-field-help">{help}</small>}
  </fieldset>
}

export function ArcadeToggle({ label, description, checked, onChange, kind = 'shield' }: {
  label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; kind?: 'chat' | 'eye' | 'shield'
}) {
  const Icon = kind === 'chat' ? VolumeX : kind === 'eye' ? EyeOff : Shield
  return <div className={`ct-toggle-field${checked ? ' is-selected' : ''}`}><label className={`ct-toggle-card${checked ? ' is-selected' : ''}`}>
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span className="ct-choice-art" aria-hidden="true"><Icon size={23} /></span>
    <span className="ct-choice-copy"><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <span className="ct-toggle-switch" aria-hidden="true"><i /></span>
  </label><ArcadeInfo label={label} text={description ?? `Turn ${label.toLowerCase()} on to enable it for this room. Turn it off to leave it disabled.`} /></div>
}

export type NumericBounds = { minimum?: number; maximum?: number; type?: string }
export function ArcadeShares({ label, value, count, onChange, error, help }: {
  label: string; value: number[]; count: number; onChange: (value: number[]) => void; error?: string; help?: string
}) {
  const id = useId()
  const total = value.reduce((sum, share) => sum + (Number.isFinite(share) ? share : 0), 0)
  const message = error ?? (value.length !== count || value.some(share => !Number.isInteger(share) || share < 0 || share > 100) ? 'Use a whole percentage from 0 to 100 for each winning crew.' : total !== 100 ? `Shares total ${total}%. Adjust them to exactly 100%.` : undefined)
  return <fieldset className={`ct-share-field${message ? ' is-invalid' : ''}`} aria-describedby={`${id}-help`}>
    <legend>{label}<ArcadeInfo label={label} text={help ?? 'Divide the total prize pool between the winning crews. All shares together must equal 100%. Each crew then shares its allocation using the selected member rule.'} /></legend>
    <div className="ct-share-grid">{Array.from({length: count}, (_, index) => <label key={index} className={`ct-share-place ct-share-place-${index}`}><span>{['First crew', 'Second crew', 'Third crew'][index]}</span><div><input aria-label={`${['First', 'Second', 'Third'][index]} crew reward percent`} type="number" min={0} max={100} step={1} value={Number.isFinite(value[index]) ? value[index] : ''} aria-invalid={Boolean(message)} onChange={event => onChange(Array.from({length: count}, (_, place) => place === index ? event.target.value === '' ? NaN : Number(event.target.value) : value[place] ?? 0))} /><b aria-hidden="true">%</b></div></label>)}</div>
    <small id={`${id}-help`} className={message ? 'ct-field-error' : 'ct-field-help'} aria-live="polite">{message ?? `100% allocated across ${count} winning ${count === 1 ? 'crew' : 'crews'}.`}</small>
  </fieldset>
}
export function numericError(value: unknown, bounds: NumericBounds, label = 'Value'): string | undefined {
  const number = typeof value === 'number' ? value : value === '' || value == null ? NaN : Number(value)
  if (!Number.isFinite(number)) return `${label}: enter a number.`
  if (bounds.type !== 'number' && !Number.isSafeInteger(number)) return `${label}: use a whole number.`
  if (bounds.minimum !== undefined && number < bounds.minimum || bounds.maximum !== undefined && number > bounds.maximum) {
    if (bounds.minimum !== undefined && bounds.maximum !== undefined) return `Out of range. ${bounds.minimum}–${bounds.maximum} supported${/seconds|length/i.test(label) ? ' seconds' : ''}.`
    return bounds.minimum !== undefined ? `Use at least ${bounds.minimum}.` : `Only up to ${bounds.maximum} supported.`
  }
  return undefined
}

export function ArcadeNumber({ label, value, onChange, minimum, maximum, error, help, step = 1 }: {
  label: string; value: number; onChange: (value: number) => void; minimum?: number; maximum?: number; error?: string; help?: string; step?: number
}) {
  const id = useId()
  const range = minimum !== undefined && maximum !== undefined ? `Supported range: ${minimum}–${maximum}.` : minimum !== undefined ? `Minimum: ${minimum}.` : maximum !== undefined ? `Maximum: ${maximum}.` : 'The value is saved with this room.'
  const validation = error ?? numericError(value, {minimum, maximum, type: step < 1 ? 'number' : 'integer'}, label)
  const Icon = /health/i.test(label) ? Heart : /damage|attack|shot|guess|target/i.test(label) ? Target : /loot|coin|point|fee|reward/i.test(label) ? Coins : /player|crew|team/i.test(label) ? Users : Timer
  return <div className={`ct-number-field${validation ? ' is-invalid' : ''}`}>
    <div className="ct-setting-label"><label htmlFor={id}>{label}</label><ArcadeInfo label={label} text={`${help ?? 'Set this value before publishing your room.'} ${range}`} /></div>
    <div className="ct-number-control"><input id={id} type="number" min={minimum} max={maximum} step={step} value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.value === '' ? NaN : Number(event.target.value))} aria-invalid={Boolean(validation)} aria-describedby={`${id}-help`} /><span className="ct-number-emblem" aria-hidden="true"><Icon size={20} /></span></div>
    <small id={`${id}-help`} className={validation ? 'ct-field-error' : 'ct-field-help'} aria-live="polite">{validation ?? help ?? (minimum !== undefined && maximum !== undefined ? `${minimum}–${maximum} supported` : '')}</small>
  </div>
}
