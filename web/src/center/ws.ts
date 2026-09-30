// Realtime room socket.
//
// The client is written to the same discipline as the server: a monotonic seq, a bounded
// outbound queue, heartbeat pings, and a resync when a frame arrives out of order. A
// dropping phone network never silently loses a move — it reconnects and resyncs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from './api'

export type ServerFrame = {
  v: number
  type: string
  roundId?: string
  seq?: number
  actionId?: string
  status?: string
  commitHash?: string | null
  revision?: number
  serverTimeMs?: number
  deadline?: number
  state?: Record<string, unknown> | null
  payload?: Record<string, unknown>
}

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

function wsUrl(roomId: string): string {
  const base = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`
  return `${base.replace(/^http/, 'ws')}/ws/rooms/${roomId}`
}

export class RoomSocket {
  private socket: WebSocket | null = null
  private ticket: string | null = null
  private roomId: string
  private queue: string[] = []
  private attempt = 0
  private closed = false
  private pingTimer: number | null = null
  private onFrame: (frame: ServerFrame) => void
  private onStatus: (status: SocketStatus) => void

  constructor(roomId: string, onFrame: (frame: ServerFrame) => void, onStatus: (status: SocketStatus) => void) {
    this.roomId = roomId
    this.onFrame = onFrame
    this.onStatus = onStatus
  }

  start(ticket: string): void {
    this.ticket = ticket
    this.closed = false
    this.connect()
  }

  private connect(): void {
    if (!this.ticket) return
    this.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const socket = new WebSocket(wsUrl(this.roomId))
    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
      this.onStatus('open')
      this.send({ type: 'session.hello', ticket: this.ticket })
      const pending = this.queue
      this.queue = []
      pending.forEach((raw) => socket.send(raw))
      this.pingTimer = window.setInterval(() => this.send({ type: 'connection.ping' }), 15000)
    }

    socket.onmessage = (event) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(event.data as string) as ServerFrame
      } catch {
        return
      }
      this.onFrame(frame)
    }

    socket.onclose = () => {
      if (this.pingTimer) window.clearInterval(this.pingTimer)
      if (this.closed) {
        this.onStatus('closed')
        return
      }
      // Exponential backoff, capped: a phone waking up on a train reconnects quickly.
      const delay = Math.min(8000, 400 * 2 ** this.attempt)
      this.attempt += 1
      this.onStatus('reconnecting')
      window.setTimeout(() => this.connect(), delay)
    }

    socket.onerror = () => socket.close()
  }

  private send(message: Record<string, unknown>): void {
    const raw = JSON.stringify(message)
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(raw)
    } else {
      if (this.queue.length > 32) this.queue.shift()
      this.queue.push(raw)
    }
  }

  action(payload: Record<string, unknown>): string {
    const actionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    this.send({ type: 'action', payload: { ...payload, actionId } })
    return actionId
  }

  ready(ready: boolean): void {
    this.send({ type: 'participant.ready', ready })
  }

  sync(sinceSeq: number): void {
    this.send({ type: 'room.sync', seq: sinceSeq })
  }

  close(): void {
    this.closed = true
    if (this.pingTimer) window.clearInterval(this.pingTimer)
    this.socket?.close()
  }
}

export type RoomChannel = {
  status: SocketStatus
  state: Record<string, unknown> | null
  lastError: string | null
  connect: (ticket: string) => void
  act: (payload: Record<string, unknown>) => void
  setReady: (ready: boolean) => void
  disconnect: () => void
}

/** React wrapper around RoomSocket: patches in, results, ack and rejects handled once. */
export function useRoomChannel(
  roomId: string | null,
  handlers: {
    onSettlement?: (payload: Record<string, unknown>) => void
    onPatch?: (payload: Record<string, unknown>) => void
    onRoundStarted?: (info: { roundId?: string; commitHash?: string | null; deadline?: number }) => void
    onRejected?: (code: string) => void
  },
): RoomChannel {
  const [status, setStatus] = useState<SocketStatus>('idle')
  const [state, setState] = useState<Record<string, unknown> | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const socketRef = useRef<RoomSocket | null>(null)
  const seqRef = useRef(0)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const onFrame = useCallback((frame: ServerFrame) => {
    if (typeof frame.seq === 'number') {
      if (frame.seq > seqRef.current + 1 && socketRef.current) {
        // A gap means frames were missed while the socket was down: ask for the delta.
        socketRef.current.sync(seqRef.current)
      }
      seqRef.current = Math.max(seqRef.current, frame.seq)
    }
    switch (frame.type) {
      case 'session.ready':
        setState((frame.state as Record<string, unknown> | null) ?? null)
        break
      case 'round.started':
        // The round begins: adopt the server's public state wholesale and reset the
        // sequence window, because the client may have been idle in the lobby.
        seqRef.current = 0
        setState({ ...((frame.state as Record<string, unknown>) ?? {}), __deadline: frame.deadline ?? null })
        handlersRef.current.onRoundStarted?.({ roundId: frame.roundId, commitHash: frame.commitHash, deadline: frame.deadline })
        break
      case 'game.patch':
        setState((prev) => ({ ...(prev ?? {}), ...(frame.payload ?? {}) }))
        handlersRef.current.onPatch?.(frame.payload ?? {})
        break
      case 'action.ack': {
        const payload = frame.payload ?? {}
        if (payload.patch) setState((prev) => ({ ...(prev ?? {}), ...(payload.patch as Record<string, unknown>) }))
        if (typeof payload.points === 'number') setLastError(`+${payload.points}`)
        // Counters live in the full public state, not in the patch: pull a fresh snapshot
        // so budgets and tallies are never stale after an accepted action.
        socketRef.current?.sync(seqRef.current)
        break
      }
      case 'action.rejected':
        setLastError(String((frame.payload ?? {}).error ?? 'REJECTED'))
        handlersRef.current.onRejected?.(String((frame.payload ?? {}).error ?? 'REJECTED'))
        break
      case 'room.cancelled':
        setState((prev) => ({ ...(prev ?? {}), finished: true, cancelled: true }))
        break
      case 'settlement.finalized':
        setState((prev) => ({ ...(prev ?? {}), finished: true }))
        handlersRef.current.onSettlement?.(frame.payload ?? {})
        break
      case 'room.snapshot':
        setState((frame.payload?.state as Record<string, unknown> | null) ?? null)
        break
      case 'resync.required':
        socketRef.current?.sync(seqRef.current)
        break
      default:
        break
    }
  }, [])

  const connect = useCallback(
    (ticket: string) => {
      if (!roomId) return
      if (!socketRef.current) socketRef.current = new RoomSocket(roomId, onFrame, setStatus)
      socketRef.current.start(ticket)
    },
    [roomId, onFrame],
  )

  const act = useCallback((payload: Record<string, unknown>) => socketRef.current?.action(payload), [])
  const setReady = useCallback((ready: boolean) => socketRef.current?.ready(ready), [])
  const disconnect = useCallback(() => {
    socketRef.current?.close()
    socketRef.current = null
    setStatus('idle')
  }, [])

  useEffect(() => () => socketRef.current?.close(), [])
  return useMemo(() => ({ status, state, lastError, connect, act, setReady, disconnect }), [status, state, lastError, connect, act, setReady, disconnect])
}
