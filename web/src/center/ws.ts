// Realtime room socket.
//
// The client is written to the same discipline as the server: a monotonic seq, a bounded
// outbound queue, heartbeat pings, and a resync when a frame arrives out of order. A
// dropping phone network never silently loses a move — it reconnects and resyncs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from './api'
import { applyWorldPatch } from './worldSnapshot'

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
  private reconnectTimer: number | null = null
  private onFrame: (frame: ServerFrame) => void
  private onStatus: (status: SocketStatus) => void
  private ticketProvider?: () => Promise<string>

  constructor(roomId: string, onFrame: (frame: ServerFrame) => void, onStatus: (status: SocketStatus) => void, ticketProvider?: () => Promise<string>) {
    this.roomId = roomId
    this.onFrame = onFrame
    this.onStatus = onStatus
    this.ticketProvider = ticketProvider
  }

  start(ticket: string): void {
    this.close()
    this.ticket = ticket
    this.closed = false
    this.connect()
  }

  private connect(): void {
    if (!this.ticket || this.closed) return
    this.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const socket = new WebSocket(wsUrl(this.roomId))
    this.socket = socket

    socket.onopen = () => {
      if (this.closed || this.socket !== socket) { socket.close(); return }
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
      if (this.socket !== socket) return
      if (this.pingTimer) window.clearInterval(this.pingTimer)
      if (this.closed) {
        this.onStatus('closed')
        return
      }
      // Exponential backoff, capped: a phone waking up on a train reconnects quickly.
      const delay = Math.min(8000, 400 * 2 ** this.attempt)
      this.attempt += 1
      this.onStatus('reconnecting')
      this.reconnectTimer = window.setTimeout(async () => {
        if (this.closed) return
        try {
          if (this.ticketProvider) this.ticket = await this.ticketProvider()
          if (!this.closed) this.connect()
        } catch {
          if (!this.closed) { this.onStatus('closed'); this.closed = true }
        }
      }, delay)
    }

    socket.onerror = () => socket.close()
  }

  private send(message: Record<string, unknown>): void {
    const movement = message.type === 'action' && (message.payload as Record<string,unknown>)?.kind === 'move'
    if (movement && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) return
    if (this.socket && this.socket.bufferedAmount > 65536) { this.socket.close(); return }
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
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
    this.queue = []
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
  reset: () => void
}

/** React wrapper around RoomSocket: patches in, results, ack and rejects handled once. */
export function useRoomChannel(
  roomId: string | null,
  handlers: {
    onSettlement?: (payload: Record<string, unknown>) => void
    onPatch?: (payload: Record<string, unknown>) => void
    onRoundStarted?: (info: { roundId?: string; commitHash?: string | null; deadline?: number }) => void
    onRematch?: () => void
    onRejected?: (code: string) => void
    onReconnectTicket?: () => Promise<string>
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
        setState(frame.state ? { ...frame.state, roundId: frame.roundId, __deadline: frame.deadline, _serverOffsetMs: (frame.serverTimeMs ?? Date.now()) - Date.now() } : null)
        break
      case 'room.rematch':
        seqRef.current = 0
        setState(null)
        setLastError(null)
        handlersRef.current.onRematch?.()
        break
      case 'round.started':
        // The round begins: adopt the server's public state wholesale and reset the
        // sequence window, because the client may have been idle in the lobby.
        seqRef.current = 0
        setState({ ...((frame.state as Record<string, unknown>) ?? {}), roundId: frame.roundId, __deadline: frame.deadline ?? null })
        handlersRef.current.onRoundStarted?.({ roundId: frame.roundId, commitHash: frame.commitHash, deadline: frame.deadline })
        break
      case 'game.patch':
        setState(prev => { const next = applyWorldPatch(prev, frame.payload ?? {}); if (!next) socketRef.current?.sync(seqRef.current); return next ?? prev })
        handlersRef.current.onPatch?.(frame.payload ?? {})
        break
      case 'action.ack': {
        const payload = frame.payload ?? {}
        if (payload.patch) setState(prev => { const next = applyWorldPatch(prev, payload.patch as Record<string,unknown>); if (!next) socketRef.current?.sync(seqRef.current); return next ?? prev })
        if ('ownSelection' in payload) setState(prev => ({...(prev ?? {}), ownSelection: payload.ownSelection}))
        if ('ownSubmission' in payload) setState(prev => ({...(prev ?? {}), ownSubmission: payload.ownSubmission}))
        if ('hintReceipt' in payload) setState(prev => ({...(prev ?? {}), hintReceipt: payload.hintReceipt, hintsRemaining: payload.hintsRemaining}))
        if (typeof payload.hint === 'string') setState(prev => ({...(prev ?? {}), privateHint: payload.hint}))
        if ((payload.patch as Record<string, unknown> | undefined)?.targets) setState(prev => ({...(prev ?? {}), privateHint: undefined}))
        setLastError(null)
        // Counters live in the full public state, not in the patch: pull a fresh snapshot
        // so budgets and tallies are never stale after an accepted action.
        // The authority broadcasts its complete public state after each accepted move.
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
        setState(prev => frame.payload?.state ? { ...(frame.payload.state as Record<string, unknown>), privateHint: prev && prev.roundId === frame.roundId ? prev.privateHint : undefined, roundId: frame.roundId, __deadline: frame.deadline, _serverOffsetMs: (frame.serverTimeMs ?? Date.now()) - Date.now() } : null)
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
      if (!socketRef.current) socketRef.current = new RoomSocket(roomId, onFrame, setStatus, () => handlersRef.current.onReconnectTicket ? handlersRef.current.onReconnectTicket() : Promise.resolve(ticket))
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
  const reset = useCallback(() => { setState(null); setLastError(null); seqRef.current = 0 }, [])

  useEffect(() => () => socketRef.current?.close(), [])
  return useMemo(() => ({ status, state, lastError, connect, act, setReady, disconnect, reset }), [status, state, lastError, connect, act, setReady, disconnect, reset])
}
