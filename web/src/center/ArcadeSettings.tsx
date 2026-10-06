import { useId } from 'react'
import { Check, Eye, EyeOff, Globe, Link, LockKeyhole, Shield, Sparkles, Target, Timer, Users, VolumeX, Zap } from 'lucide-react'

type Choice = { value: string; label: string; description?: string }
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
    <legend>{label}</legend>
    <div className="ct-choice-grid">{options.map((option, index) => {
      const Icon = choiceIcon(option.value, index)
      return <label className={`ct-choice-card${value === option.value ? ' is-selected' : ''}`} key={option.value}>
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
  return <label className={`ct-toggle-card${checked ? ' is-selected' : ''}`}>
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span className="ct-choice-art" aria-hidden="true"><Icon size={23} /></span>
    <span className="ct-choice-copy"><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <span className="ct-toggle-switch" aria-hidden="true"><i /></span>
  </label>
}

export type NumericBounds = { minimum?: number; maximum?: number; type?: string }
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
  return <label className={`ct-number-field${error ? ' is-invalid' : ''}`}>
    <span>{label}</span>
    <div className="ct-number-control"><input type="number" min={minimum} max={maximum} step={step} value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.value === '' ? NaN : Number(event.target.value))} aria-invalid={Boolean(error)} aria-describedby={`${id}-help`} /><span className="ct-number-emblem" aria-hidden="true"><Timer size={20} /></span></div>
    <small id={`${id}-help`} className={error ? 'ct-field-error' : 'ct-field-help'} aria-live="polite">{error ?? help ?? (minimum !== undefined && maximum !== undefined ? `${minimum}–${maximum} supported` : '')}</small>
  </label>
}
