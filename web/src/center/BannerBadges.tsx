import type { GameConfig } from './gameCustomization'
import { OVERLAY_COLORS } from './gameCustomization'
import './gameCustomization.css'

export function BannerBadges({ overlay, tag }: { overlay?: GameConfig['overlay']; tag?: GameConfig['tag'] }) {
  const color = OVERLAY_COLORS[overlay?.color ?? 'blue'] ?? overlay?.color ?? '#2563eb'
  // WCAG contrast chooses black or white for every validated custom hex color.
  const rgb = color.slice(1).match(/.{2}/g)?.map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  }) ?? [0, 0, 0]
  const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
  return <>
    {overlay?.enabled && <span className={`gc-overlay gc-${overlay.position}`} style={{ backgroundColor: color, color: luminance > .179 ? '#000' : '#fff' }}>{overlay.text}</span>}
    {tag?.enabled && <span className={`gc-tag gc-tag-${tag.style}`}>{tag.text}</span>}
  </>
}
