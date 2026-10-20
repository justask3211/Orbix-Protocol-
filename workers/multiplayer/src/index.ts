import { createHash } from "node:crypto";
import { DurableObject } from "cloudflare:workers";
import {
  adapters,
  TEMPLATE_IDS,
  validateBootstrap,
  type Bootstrap,
} from "./engines.ts";
import { bridgeHeaders } from "./bridge.ts";
import { V4Engine, type Dict } from "./v4.ts";
import { frame, decodeFrame } from "./protocol.ts";
import { verifyProvision, verifyTicket, type Claims } from "./security.ts";

export interface Env {
  ROOMS: DurableObjectNamespace<MultiplayerRoom>;
  ASSETS?: Fetcher;
  EDGE_TICKET_SECRET: string;
  PROVISION_SECRET: string;
  RESULT_SECRET: string;
  RAILWAY_ORIGIN: string;
  ALLOWED_ORIGINS: string;
}
const error = (code: string, status = 400) =>
  Response.json({ detail: { code, message: code } }, { status });
const validRoom = (id: string) => /^[0-9a-f]{16,64}$/.test(id);
const origins = (env: Env) =>
  env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
const safeMessage = (e: unknown) =>
  e instanceof Error ? e.message : "INTERNAL_ERROR";
type Attachment = {
  claims?: Claims;
  expiresAt: number;
  windowAt: number;
  count: number;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/multiplayer/health")
      return Response.json({
        ok: true,
        ready: true,
        transport: "durable-objects",
        protocol: 1,
        templates: TEMPLATE_IDS,
        simHz: 30,
        broadcastHz: 10,
        settlement: "railway-replay",
      });
    const provision =
      /^\/internal\/rooms\/([0-9a-f]+)\/(?:provision|control)$/.exec(
        url.pathname,
      );
    if (provision) {
      if (request.method !== "POST" || !validRoom(provision[1]))
        return error("NOT_FOUND", 404);
      const body = await boundedBody(request, 65536);
      if (body === null) return error("PAYLOAD_TOO_LARGE", 413);
      try {
        await verifyProvision(request, body, env.PROVISION_SECRET);
      } catch {
        return error("UNAUTHORIZED", 401);
      }
      return env.ROOMS.get(env.ROOMS.idFromName(provision[1])).fetch(
        new Request(request, { body }),
      );
    }
    const socket = /^\/multiplayer\/v1\/ws\/rooms\/([0-9a-f]+)$/.exec(
      url.pathname,
    );
    if (socket) {
      if (
        !validRoom(socket[1]) ||
        request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
      )
        return error("UPGRADE_REQUIRED", 426);
      if (!origins(env).includes(request.headers.get("Origin") ?? ""))
        return error("ORIGIN_FORBIDDEN", 403);
      return env.ROOMS.get(env.ROOMS.idFromName(socket[1])).fetch(request);
    }
    if (
      url.pathname.startsWith("/internal/") ||
      url.pathname.startsWith("/multiplayer/")
    )
      return error("NOT_FOUND", 404);
    if (url.pathname.startsWith("/api/center/")) {
      const origin = new URL(env.RAILWAY_ORIGIN);
      if (origin.protocol !== "https:" || origin.username || origin.password)
        return error("INVALID_RAILWAY_ORIGIN", 503);
      const target = new URL(url.pathname + url.search, origin);
      // Fixed upstream only, no user-selected proxy target and no internal secrets.
      const headers = new Headers(request.headers);
      for (const key of [...headers.keys()])
        if (key.toLowerCase().startsWith("x-orbix-")) headers.delete(key);
      headers.delete("host");
      return fetch(
        new Request(target, {
          method: request.method,
          headers,
          body: ["GET", "HEAD"].includes(request.method)
            ? undefined
            : request.body,
          redirect: "manual",
        }),
      );
    }
    // Vite is built with base=/center/. Asset binding stores paths without that prefix.
    if (url.pathname === "/center" || url.pathname.startsWith("/center/")) {
      if (!env.ASSETS)
        return fetch(
          new Request(
            new URL(url.pathname + url.search, env.RAILWAY_ORIGIN),
            request,
          ),
        );
      const asset = new URL(request.url);
      asset.pathname = url.pathname.replace(/^\/center\/?/, "/");
      const isNavigation =
        request.method === "GET" &&
        (request.headers.get("Accept") ?? "").includes("text/html");
      if (isNavigation && !asset.pathname.split("/").pop()?.includes("."))
        asset.pathname = "/index.html";
      const response = await env.ASSETS.fetch(new Request(asset, request));
      if (asset.pathname === "/index.html") {
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
      return response;
    }
    return error("NOT_FOUND", 404);
  },
} satisfies ExportedHandler<Env>;

async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  let count = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    count += value.length;
    if (count > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(count);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(bytes);
}

export class MultiplayerRoom extends DurableObject<Env> {
  bootstrap: Bootstrap | undefined;
  engine: V4Engine | undefined;
  journal: Dict[] = [];
  settlement: Dict | undefined;
  settings: Dict = {};
  timer: ReturnType<typeof setInterval> | undefined;
  busy = false;
  lastCheckpoint = 0;
  lastBroadcast = 0;
  bridgeBusy = false;
  lastBridgeError:string|null=null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.bootstrap = await ctx.storage.get<Bootstrap>("bootstrap");
      const saved = await ctx.storage.get<Dict>("checkpoint");
      if (this.bootstrap && saved) {
        this.engine = adapters[this.bootstrap.config.template_id].create({
          ...this.bootstrap,
          snapshot: saved.snapshot,
        });
        this.journal = saved.journal;
        this.settlement = saved.settlement;
        this.settings = saved.settings ?? this.bootstrap.settings ?? {};
      }
      if (this.engine && !this.settlement) this.loop();
    });
  }
  loop() {
    if (!this.timer)
      this.timer = setInterval(() => {
        void this.pump();
      }, 1000 / 30);
  }
  state() {
    return this.engine?.publicState() ?? null;
  }
  send(ws: WebSocket, type: string, fields: Dict = {}) {
    try {
      const viewer = (ws.deserializeAttachment() as Attachment)?.claims?.sub;
      const visible = (value: any): any => {
        if (viewer === this.bootstrap?.owner) return value;
        if (
          typeof value === "string" &&
          this.settings.hidePlayers &&
          /^0x[0-9a-fA-F]{40}$/.test(value) &&
          value.toLowerCase() !== viewer
        )
          return (
            "player-" +
            createHash("sha256")
              .update(value.toLowerCase())
              .digest("hex")
              .slice(0, 8)
          );
        if (Array.isArray(value)) return value.map(visible);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value)
              .filter(
                ([k]) =>
                  !(
                    this.settings.hideGuesses &&
                    ["guessLog", "lastGuess"].includes(k)
                  ),
              )
              .map(([k, v]) => [visible(k), visible(v)]),
          );
        return value;
      };
      const output = [
        "game.patch",
        "action.ack",
        "session.ready",
        "round.started",
        "room.snapshot",
      ].includes(type)
        ? visible(fields)
        : fields;
      ws.send(frame(type, { roundId: this.bootstrap?.roundId, ...output }));
    } catch {
      ws.close(1011, "SEND_FAILED");
    }
  }
  broadcast(type: string, fields: Dict = {}) {
    for (const ws of this.ctx.getWebSockets())
      if ((ws.deserializeAttachment() as Attachment)?.claims)
        this.send(ws, type, fields);
  }
  async checkpoint() {
    if (!this.engine) return;
    await this.ctx.storage.put("checkpoint", {
      snapshot: this.engine.checkpoint(),
      journal: this.journal,
      settlement: this.settlement,
      settings: this.settings,
    });
    this.lastCheckpoint = Date.now();
  }
  async pump() {
    if (this.busy || !this.engine || this.settlement) return;
    this.busy = true;
    try {
      if (!this.engine.finished) {
        const at = Date.now() / 1000;
        this.journal.push({ at });
        this.engine.advance(at);
      }
      const now = Date.now();
      if (now - this.lastBroadcast >= 100 || this.engine.finished) {
        this.broadcast("game.patch", { payload: this.state() });
        this.lastBroadcast = this.lastBroadcast ? this.lastBroadcast+100 : now;
        if(now-this.lastBroadcast>1000)this.lastBroadcast=now;
      }
      if (now - this.lastCheckpoint >= 1000 || this.engine.finished)
        await this.checkpoint();
      if (this.engine.finished) {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        await this.deliver();
      }
    } finally {
      this.busy = false;
    }
  }
  async deliver() {
    if (
      this.bridgeBusy ||
      this.settlement ||
      !this.engine?.finished ||
      !this.bootstrap
    )
      return;
    this.bridgeBusy = true;
    try {
      // Durable outbox is the finished checkpoint. Every retry gets a fresh MAC nonce.
      await this.ctx.storage.setAlarm(Date.now() + 15000);
      const path = `/api/center/v1/internal/multiplayer/rooms/${this.bootstrap.roomId}/results`;
      const body = JSON.stringify({
        roundId: this.bootstrap.roundId,
        configHash: this.bootstrap.configHash,
        journal: this.journal,
        snapshot: this.engine.checkpoint(),
      });
      const target = new URL(path, this.env.RAILWAY_ORIGIN);
      if (!["http:", "https:"].includes(target.protocol))
        throw new Error("INVALID_RAILWAY_ORIGIN");
      const response = await fetch(target, {
        method: "POST",
        headers: await bridgeHeaders(this.env.RESULT_SECRET, path, body),
        body,
        signal: AbortSignal.timeout(20000),
        redirect: "manual",
      });
      if (!response.ok) throw new Error(`RESULT_BRIDGE_${response.status}`);
      const result = (await response.json()) as Dict;
      if (
        result.type !== "settlement.finalized" ||
        result.roundId !== this.bootstrap.roundId
      )
        throw new Error("INVALID_SETTLEMENT_RESPONSE");
      this.settlement = result;
      await this.checkpoint();
      this.broadcast("settlement.finalized", { payload: result.payload });
    } catch (e) {
      this.lastBridgeError=safeMessage(e);
      await this.ctx.storage.put("bridge-error",this.lastBridgeError);
      console.error("result bridge retry", this.lastBridgeError);
    } finally {
      this.bridgeBusy = false;
    }
  }
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/internal/")) {
      const body = await boundedBody(request, 65536);
      if (body === null) return error("PAYLOAD_TOO_LARGE", 413);
      try {
        const auth = await verifyProvision(
          request,
          body,
          this.env.PROVISION_SECRET,
        );
        if (url.pathname.endsWith("/control")) {
          const control = JSON.parse(body);
          if(control.diagnostics)return Response.json({roundId:this.bootstrap?.roundId,finished:this.engine?.finished,tick:this.engine?.s.tick_id,busy:this.busy,bridgeBusy:this.bridgeBusy,journalLength:this.journal.length,lastCheckpoint:this.lastCheckpoint,lastBridgeError:this.lastBridgeError??await this.ctx.storage.get('bridge-error'),settled:Boolean(this.settlement)})
          if (!this.bootstrap || control.roundId !== this.bootstrap.roundId)
            return error("ROUND_COMMITMENT_MISMATCH", 409);
          if (
            !Array.isArray(control.suspended) ||
            control.suspended.some(
              (p: unknown) => typeof p !== "string" || !/^0x[0-9a-f]{40}$/.test(p),
            )
          )
            return error("INVALID_SUSPENSION");
          if (await this.ctx.storage.get("provision:" + auth.nonce))
            return error("PROVISION_REPLAY", 409);
          await this.ctx.storage.put(
            "provision:" + auth.nonce,
            auth.expires * 1000,
          );
          for (const socket of this.ctx.getWebSockets()) {
            const who = (socket.deserializeAttachment() as Attachment)?.claims?.sub;
            if (who && control.suspended.includes(who)) socket.close(4403, "SUSPENDED");
          }
          this.settings = control.settings ?? {};
          if (
            !this.engine!.finished &&
            JSON.stringify(control.suspended) !==
              JSON.stringify(this.engine!.s.suspended)
          ) {
            this.journal.push({
              at: Date.now() / 1000,
              suspended: control.suspended,
            });
            this.engine!.s.suspended = control.suspended;
            for (const who of control.suspended)
              delete this.engine!.s.inputs[who];
          }
          if (control.cancelled) {
            if (this.timer) clearInterval(this.timer);
            this.timer = undefined;
            this.settlement = {
              type: "room.cancelled",
              payload: { reason: "railway-cancelled" },
            };
            this.broadcast("room.cancelled", {
              payload: this.settlement.payload,
            });
          }
          await this.checkpoint();
          return Response.json({ ok: true });
        }
        const id = url.pathname.split("/")[3],
          b = validateBootstrap(JSON.parse(body), id);
        if (
          !b.snapshot ||
          b.snapshot.finished ||
          b.snapshot.participants.join(",") !== b.participants.join(",")
        )
          return error("INVALID_INITIAL_SNAPSHOT");
        const existing = this.bootstrap;
        if (
          existing &&
          existing.roundId === b.roundId &&
          JSON.stringify(existing) !== JSON.stringify(b)
        )
          return error("ROOM_COMMITMENT_CONFLICT", 409);
        if (existing && existing.roundId !== b.roundId && !this.settlement)
          return error("ROUND_STILL_ACTIVE", 409);
        await this.ctx.storage.transaction(async (tx) => {
          if (await tx.get("provision:" + auth.nonce))
            throw new Error("PROVISION_REPLAY");
          await tx.put("provision:" + auth.nonce, auth.expires * 1000);
          await tx.put("bootstrap", b);
        });
        if (!existing || existing.roundId !== b.roundId) {
          this.bootstrap = b;
          this.engine = adapters[b.config.template_id].create(b);
          this.journal = [];
          this.settlement = undefined;
          this.settings = b.settings ?? {};
          await this.checkpoint();
        }
        await this.ctx.storage.setAlarm(Date.now() + 10000);
        this.loop();
        return Response.json({
          roomId: b.roomId,
          roundId: b.roundId,
          provisioned: true,
          ready: true,
          engineReady: true,
        });
      } catch (e) {
        return error(safeMessage(e), 400);
      }
    }
    if (!this.bootstrap) return error("ROOM_NOT_PROVISIONED", 404);
    if (!origins(this.env).includes(request.headers.get("Origin") ?? ""))
      return error("ORIGIN_FORBIDDEN", 403);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return error("UPGRADE_REQUIRED", 426);
    if (this.ctx.getWebSockets().length >= 64)
      return error("ROOM_CONNECTION_LIMIT", 429);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      expiresAt: Date.now() + 10000,
      windowAt: Date.now(),
      count: 0,
    } satisfies Attachment);
    await this.ctx.storage.setAlarm(Date.now() + 10000);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    try {
      const a = ws.deserializeAttachment() as Attachment,
        now = Date.now(),
        b = this.bootstrap!;
      if (now - a.windowAt >= 1000) {
        a.windowAt = now;
        a.count = 0;
      }
      if (++a.count > 60) {
        ws.close(4429, "RATE_LIMITED");
        return;
      }
      ws.serializeAttachment(a);
      const msg = decodeFrame(raw);
      if (!a.claims) {
        if (now > a.expiresAt || msg.type !== "session.hello") {
          ws.close(4401, "SESSION_HELLO_REQUIRED");
          return;
        }
        const claims = await verifyTicket(
          msg.ticket,
          this.env.EDGE_TICKET_SECRET,
          b.roomId,
          b.roundId,
        );
        if ((claims.role === "player" && !b.participants.includes(claims.sub)) || this.engine!.s.suspended.includes(claims.sub)) {
          ws.close(4403, "NOT_ADMITTED");
          return;
        }
        await this.ctx.storage.transaction(async (tx) => {
          if (await tx.get("ticket:" + claims.nonce))
            throw new Error("TICKET_REPLAY");
          await tx.put("ticket:" + claims.nonce, claims.exp * 1000);
        });
        a.claims = claims;
        ws.serializeAttachment(a);
        this.send(ws, "session.ready", {
          roomId: b.roomId,
          status: this.settlement ? "claimable" : "running",
          state: this.state(),
          serverTimeMs: now,
          deadline:
            this.engine!.s.started_at + Number(b.config.rules.duration_seconds),
          commitHash: b.commitHash,
          revision: 1,
        });
        if (this.settlement)
          this.send(ws, this.settlement.type, {
            payload: this.settlement.payload,
          });
        else this.loop();
        return;
      }
      if (a.claims.round !== b.roundId) {
        ws.close(4401, "ROUND_CHANGED");
        return;
      }
      if (msg.type === "connection.ping") {
        this.send(ws, "connection.pong", { serverTimeMs: now });
        return;
      }
      if (msg.type === "room.sync") {
        this.send(ws, "room.snapshot", {
          deadline:
            this.engine!.s.started_at + Number(b.config.rules.duration_seconds),
          serverTimeMs: now,
          payload: { state: this.state() },
        });
        return;
      }
      if (msg.type === "action") {
        if (a.claims.role !== "player") {
          this.send(ws, "action.rejected", {payload: {accepted: false, error: "NOT_PLAYER"}});
          return;
        }
        if (this.engine!.finished) {
          this.send(ws, "action.rejected", {
            payload: { accepted: false, error: "ROUND_NOT_OPEN" },
          });
          return;
        }
        if (this.journal.length >= 100000) {
          this.send(ws, "action.rejected", {
            payload: { accepted: false, error: "ROOM_JOURNAL_LIMIT" },
          });
          return;
        }
        const at = now / 1000,
          payload = msg.payload!,
          result = this.engine!.act(a.claims.sub, payload, at);
        this.journal.push({
          at,
          who: a.claims.sub,
          action: payload,
          accepted: result.accepted,
          error: result.error ?? null,
        });
        this.send(ws, result.accepted ? "action.ack" : "action.rejected", {
          actionId: payload.actionId,
          payload: {
            ...result,
            ackInputSeq: this.engine!.s.bodies[a.claims.sub].inputSeq,
            serverTimeMs: now,
          },
        });
        // Critical input and RNG effects become durable before their acknowledgement is released (DO output gate).
        if (payload.kind !== "move" || now - this.lastCheckpoint >= 1000)
          await this.checkpoint();
        if (this.engine!.finished) await this.pump();
        return;
      }
      this.send(ws, "error", {
        payload: { code: "USE_RAILWAY_CONTROL_CHANNEL" },
      });
    } catch (e) {
      this.send(ws, "error", { payload: { code: safeMessage(e) } });
      ws.close(4400, "INVALID_FRAME_OR_SESSION");
    }
  }
  async alarm() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (!a.claims && a.expiresAt <= now) ws.close(4401, "AUTH_TIMEOUT");
    }
    const remove: string[] = [];
    for (const prefix of ["ticket:", "provision:"])
      for (const [key, expires] of await this.ctx.storage.list<number>({
        prefix,
      }))
        if (expires <= now) remove.push(key);
    if (remove.length) await this.ctx.storage.delete(remove);
    if (this.engine && !this.settlement) {
      await this.pump();
      await this.ctx.storage.setAlarm(now + 15000);
      if (!this.engine.finished) this.loop();
    } else if (this.ctx.getWebSockets().length)
      await this.ctx.storage.setAlarm(now + 60000);
  }
  webSocketClose(ws: WebSocket, code: number) {
    ws.close(code === 1005 ? 1000 : code);
  }
  webSocketError(ws: WebSocket) {
    ws.close(1011, "SOCKET_ERROR");
  }
}
