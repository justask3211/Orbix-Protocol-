import { useEffect, useState } from 'react'
import { GameBanner } from './bannerArt'

/** Original shipped artwork, with the shared vector banner for other templates. */
export function GameArtwork({ id, color, eager = false }: { id: string; color: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [id])
  return failed
    ? <GameBanner templateId={id} hue={color}/>
    : <img src={`${import.meta.env.BASE_URL}center-art/${id}.webp`} alt="" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} decoding="async" width={960} height={640} onError={() => setFailed(true)}/>
}
