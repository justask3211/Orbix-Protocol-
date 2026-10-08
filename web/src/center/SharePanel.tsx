// Room share panel: shows the room ID (always) and the invite link (on demand),
// each with a one-tap copy button. The creator copies either; a joiner pastes
// either into the join-by-ID field on the catalog.

import { useState } from 'react'
import { copyText, roomShareUrl, inviteShareUrl } from './share'

export function SharePanel({ roomId, roomNumber, visibility, invite }: { roomId: string; roomNumber?: string; visibility: string; invite?: string }) {
  const [copiedWhat, setCopiedWhat] = useState<string | null>(null)

  const shareId = roomNumber ?? roomId
  const shareUrl = roomShareUrl(shareId)

  const doCopy = async (text: string, what: string) => {
    const ok = await copyText(text)
    if (ok) {
      setCopiedWhat(what)
      setTimeout(() => setCopiedWhat(null), 1600)
    }
  }

  return (
    <div className="share-panel">
      <div className="share-row">
        <span className="share-label">Room ID</span>
        <code className="share-value mono" translate="no">{roomNumber ?? 'Loading…'}</code>
        <button
          className="share-copy"
          onClick={() => roomNumber && void doCopy(roomNumber, 'roomId')}
          disabled={!roomNumber}
          aria-label="Copy room ID"
          title="Copy room ID"
        >
          {copiedWhat === 'roomId' ? '✓' : '⧉'}
        </button>
        <span className={`share-note${copiedWhat === 'roomId' ? ' on' : ''}`}>
          {copiedWhat === 'roomId' ? 'Copied' : `${visibility} room`}
        </span>
      </div>
      <div className="share-row">
        <span className="share-label">Share link</span>
        <code className="share-value mono" translate="no">{shareUrl}</code>
        <button
          className="share-copy"
          onClick={() => doCopy(shareUrl, 'link')}
          aria-label="Copy room link"
          title="Copy room link"
        >
          {copiedWhat === 'link' ? '✓' : '⧉'}
        </button>
        <span className={`share-note${copiedWhat === 'link' ? ' on' : ''}`}>
          {copiedWhat === 'link' ? 'Copied' : ''}
        </span>
      </div>
      {invite && (
        <div className="share-row invite-row">
          <span className="share-label">Invite link</span>
          <code className="share-value mono" translate="no">
            {inviteShareUrl(shareId, invite)}
          </code>
          <button
            className="share-copy"
            onClick={() => doCopy(inviteShareUrl(shareId, invite), 'invite')}
            aria-label="Copy invite link"
            title="Copy invite link"
          >
            {copiedWhat === 'invite' ? '✓' : '⧉'}
          </button>
          <span className={`share-note${copiedWhat === 'invite' ? ' on' : ''}`}>
            {copiedWhat === 'invite' ? 'Copied' : 'only for invited wallets'}
          </span>
        </div>
      )}
    </div>
  )
}
