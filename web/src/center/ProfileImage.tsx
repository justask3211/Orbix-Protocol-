// Profile image upload: client-side canvas resize to 256x256 WebP, then upload.
// Shows a circular preview before upload. Compresses to keep files small
// (typically 5-15KB) so they load instantly from the Railway volume.

import { useState, useRef } from 'react'
import { center, API_BASE } from './api'

const MAX_DIM = 256
const MAX_QUALITY = 0.85

/** Read a File, resize via canvas to MAX_DIM x MAX_DIM, export as WebP blob. */
export async function resizeAndCompress(file: File): Promise<Blob> {
  const img = new Image()
  const url = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not read image'))
      img.src = url
    })
    // Calculate crop to square (center crop)
    const size = Math.min(img.naturalWidth, img.naturalHeight)
    const sx = (img.naturalWidth - size) / 2
    const sy = (img.naturalHeight - size) / 2
    const canvas = document.createElement('canvas')
    canvas.width = MAX_DIM
    canvas.height = MAX_DIM
    const ctx = canvas.getContext('2d')
    if (!ctx || !size) throw new Error('Image canvas is unavailable.')
    ctx.drawImage(img, sx, sy, size, size, 0, 0, MAX_DIM, MAX_DIM)
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('Could not export image.'))
        else if (!['image/webp', 'image/png', 'image/jpeg'].includes(blob.type)) reject(new Error('Unsupported image export.'))
        else resolve(blob)
      }, 'image/webp', MAX_QUALITY)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ProfileImageUpload({ address, token, hasImage, onUploaded }: {
  address: string
  token: string
  hasImage: boolean
  onUploaded: () => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [version, setVersion] = useState(() => Date.now())
  const selection = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const imageUrl = hasImage
    ? `${API_BASE}/profile/image/${address}?v=${version}`
    : null

  const pickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // Selecting the same file must trigger another change.
    const picked = ++selection.current
    setPreview(null)
    setErr(null)
    if (file.size > 20 * 1024 * 1024) { setErr('Choose an image under 20 MB.'); return }
    if (!file.type.startsWith('image/')) {
      setErr('Please choose an image file.')
      return
    }
    setProcessing(true)
    try {
      const blob = await resizeAndCompress(file)
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('Could not read resized image.'))
        reader.onabort = () => reject(new Error('Image reading was cancelled.'))
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })
      if (picked === selection.current) setPreview(b64)
    } catch (e: any) {
      if (picked === selection.current) setErr(e.message ?? 'Could not process image.')
    } finally {
      if (picked === selection.current) setProcessing(false)
    }
  }

  const upload = async () => {
    if (!preview) return
    setBusy(true)
    setErr(null)
    try {
      await center.uploadProfileImage(token, preview)
      setVersion(Date.now())
      window.dispatchEvent(new Event('orbix-profile-changed'))
      onUploaded()
      setPreview(null)
    } catch (e: any) {
      setErr(e?.detail?.message ?? e?.message ?? 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const displaySrc = preview ?? imageUrl

  return (
    <div className="pf-image-upload">
      <div className="pf-image-preview" style={{ width: 96, height: 96 }}>
        {displaySrc ? (
          <img src={displaySrc} alt="Profile" width={96} height={96}
               style={{ borderRadius: '50%', objectFit: 'cover', width: 96, height: 96 }} />
        ) : (
          <div style={{ borderRadius: '50%', width: 96, height: 96, background: '#1a1d14',
                        display: 'grid', placeItems: 'center', color: '#5a5d61', fontSize: 28 }}>
            ?
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          ref={fileRef} type="file" accept="image/*"
          onChange={pickFile} style={{ display: 'none' }}
          aria-label="Choose profile image"
        />
        <button className="btn-ghost" style={{ fontSize: 11.5 }}
                disabled={busy || processing} onClick={() => fileRef.current?.click()}>
          {processing ? 'Preparing image…' : hasImage ? 'Change image' : 'Choose image'}
        </button>
        {preview && (
          <button className="btn-primary" style={{ fontSize: 11.5 }} onClick={upload} disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        )}
        {preview && (
          <small style={{ color: '#7c8085', fontSize: 10 }}>
            Cropped to 256×256 WebP. Typically 5-15 KB.
          </small>
        )}
        {err && <p className="err" role="alert" style={{ fontSize: 10.5 }}>{err}</p>}
      </div>
    </div>
  )
}
