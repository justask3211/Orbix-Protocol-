/** V4 field-v1 reducer port. Python snapshot keys and RNG bytes are the replay contract.
 * Source: center/games/{arena,field_arena,terrain_arena,terrain}.py. No money logic.
 */
import { createHash } from "node:crypto";
// Dynamic dictionaries intentionally mirror the versioned Python snapshot schema.
export type Dict = Record<string, any>;
const STEP = 1 / 30,
  TAU = Math.PI * 2;
const weapons: Dict = {
  hands: [1.8, 8],
  sword: [2.6, 16],
  spear: [3.8, 12],
  gun: [12, 12],
};
const finite = (n: any) => typeof n === "number" && Number.isFinite(n);
const clamp = (n: number) => Math.max(-19.45, Math.min(19.45, n));
const distance = (a: Dict, b: Dict) => Math.hypot(a.x - b.x, a.z - b.z);
const round = (n: number, p = 3) => Number(n.toFixed(p));
const ok = (): { accepted: boolean; error?: string } => ({ accepted: true }),
  no = (error: string) => ({ accepted: false, error });
const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function ground(x: number, z: number, theme: string) {
  const r = Math.hypot(x, z),
    fade = smooth(5, 11, r);
  if (theme === "courtyard")
    return fade * (0.16 + 0.12 * Math.sin(x * 0.18) * Math.sin(z * 0.16));
  const ripple = 0.16 * (1 + Math.sin(x * 0.23 + 0.4) * Math.sin(z * 0.19));
  if (theme === "guardian")
    return fade * (ripple + 1.05 * Math.exp(-(((r - 16) / 5) ** 2)));
  return (
    fade *
    (ripple +
      1.45 * Math.exp(-((x + 12) ** 2 + (z - 10) ** 2) / 42) +
      1.1 * Math.exp(-((x - 13) ** 2 + (z + 11) ** 2) / 36) +
      0.38 * smooth(16, 25, r))
  );
}
export class StreamRNG {
  counter = 0;
  buf = Buffer.alloc(0);
  seed: string;
  constructor(seed: string) {
    this.seed = seed;
  }
  below(limit: number): number {
    if (limit === 1) return 0;
    const n = Math.ceil((Math.floor(Math.log2(limit)) + 1) / 8),
      size = 256 ** n,
      ceiling = size - (size % limit);
    while (true) {
      while (this.buf.length < n) {
        const c = Buffer.alloc(8);
        c.writeBigUInt64BE(BigInt(this.counter++));
        this.buf = Buffer.concat([
          this.buf,
          createHash("sha256")
            .update(this.seed)
            .update("orbix-center/stream/v1")
            .update(c)
            .digest(),
        ]);
      }
      const value = this.buf.readUIntBE(0, n);
      this.buf = this.buf.subarray(n);
      if (value < ceiling) return value % limit;
    }
  }
  between(lo: number, hi: number) {
    return lo + this.below(hi - lo + 1);
  }
  choice(items: any[]) {
    return items[this.below(items.length)];
  }
}
export class V4Engine {
  s: Dict;
  r: Dict;
  template: string;
  theme: string;
  rng: StreamRNG;
  constructor(template: string, rules: Dict, seed: string, snapshot: Dict) {
    this.template = template;
    this.r = rules;
    this.s = structuredClone(snapshot);
    this.theme = (
      {
        "token-catch": "island",
        "boss-raid": "guardian",
        "combat-duel": "courtyard",
      } as Dict
    )[template];
    this.rng = new StreamRNG(seed);
    this.rng.counter = this.s.rng_counter;
    this.rng.buf = Buffer.from(this.s.rng_buf, "hex");
  }
  get finished() {
    return this.s.finished;
  }
  get elapsed() {
    return Math.max(
      0,
      Math.trunc((this.s.last_tick - this.s.started_at) * 1000 + 1e-5),
    );
  }
  floor(x: number, z: number) {
    return ground(x, z, this.theme);
  }
  alive(who: string, ms = this.s.last_tick * 1000) {
    const b = this.s.bodies[who];
    return !this.s.suspended.includes(who) && b.hp > 0 && b.respawnAt <= ms;
  }
  event(
    kind: string,
    who: string | null = null,
    target: string | null = null,
    x = 0,
    z = 0,
  ) {
    this.s.events.push({
      id: ++this.s.event_id,
      kind,
      who,
      target,
      x: round(x),
      z: round(z),
      at: this.elapsed,
    });
    this.s.events = this.s.events.slice(-40);
  }
  drop(
    kind: string,
    x: number,
    z: number,
    at: number,
    fall = 0,
    value = 1,
    sourceId: string | null = null,
  ) {
    const d = {
      id: `drop-${++this.s.object_id}`,
      kind,
      x: round(x),
      z: round(z),
      spawnAt: at,
      landAt: at + fall,
      expiresAt: this.r.duration_seconds * 1000 + 1000,
      value,
      sourceId,
      y: 0,
    };
    d.y = this.floor(d.x, d.z);
    this.s.drops.push(d);
    return d;
  }
  canWalk(x: number, z: number, b: Dict) {
    return (
      !this.s.crates.some(
        (c: Dict) =>
          c.hp > 0 &&
          (b.y ?? 0) < (c.y ?? 0) + 1.1 &&
          Math.abs(x - c.x) < 0.85 &&
          Math.abs(z - c.z) < 0.85,
      ) &&
      !(this.s.boss?.hp > 0 && Math.hypot(x, z) < 1.8) &&
      !this.s.obstacles.some(
        (o: Dict) =>
          (b.y ?? 0) < (o.baseY ?? 0) + o.height &&
          Math.abs(x - o.x) < o.width / 2 + 0.32 &&
          Math.abs(z - o.z) < o.depth / 2 + 0.32,
      )
    );
  }
  rect(a: Dict, b: Dict, o: Dict) {
    let enter = 0,
      leave = 1;
    for (const [axis, size] of [
      ["x", "width"],
      ["z", "depth"],
    ]) {
      const lo = o[axis] - o[size] / 2,
        hi = o[axis] + o[size] / 2,
        d = b[axis] - a[axis];
      if (Math.abs(d) < 1e-9) {
        if (!(lo <= a[axis] && a[axis] <= hi)) return false;
      } else {
        const near = Math.min((lo - a[axis]) / d, (hi - a[axis]) / d),
          far = Math.max((lo - a[axis]) / d, (hi - a[axis]) / d);
        enter = Math.max(enter, near);
        leave = Math.min(leave, far);
        if (enter > leave) return false;
      }
    }
    return true;
  }
  clear(a: Dict, b: Dict) {
    const h =
      Math.min(a.y ?? this.floor(a.x, a.z), b.y ?? this.floor(b.x, b.z)) + 0.9;
    for (let i = 1; i < 12; i++)
      if (
        this.floor(a.x + ((b.x - a.x) * i) / 12, a.z + ((b.z - a.z) * i) / 12) >
        h
      )
        return false;
    return !this.s.obstacles.some(
      (o: Dict) => (o.baseY ?? 0) + o.height > h && this.rect(a, b, o),
    );
  }
  facing(a: Dict, b: Dict) {
    const d = distance(a, b);
    return (
      d < 0.01 ||
      (Math.sin(a.yaw) * (b.x - a.x) + Math.cos(a.yaw) * (b.z - a.z)) / d >=
        0.35
    );
  }
  scatter(who: string) {
    const b = this.s.bodies[who],
      loss = Math.floor(b.score / 2);
    b.score -= loss;
    if (!loss) return;
    const count = Math.min(16, loss, Math.max(1, 450 - this.s.drops.length));
    if (this.s.drops.length >= 450) {
      const coins = this.s.drops
        .filter((d: Dict) => d.kind === "coin")
        .sort((a: Dict, c: Dict) => distance(b, a) - distance(b, c));
      if (coins.length) {
        coins[0].value += loss;
        this.event("scatter", who, null, b.x, b.z);
        return;
      }
    }
    for (let i = 0; i < count; i++)
      this.drop(
        "coin",
        clamp(b.x + Math.sin((i * TAU) / count) * 1.5),
        clamp(b.z + Math.cos((i * TAU) / count) * 1.5),
        this.elapsed,
        400,
        Math.floor(loss / count) + (i < loss % count ? 1 : 0),
      );
    this.event("scatter", who, null, b.x, b.z);
  }
  down(who: string, seconds: number, attacker: string | null = null) {
    const b = this.s.bodies[who];
    b.hp = 0;
    b.respawnAt = b.downedUntil =
      Math.trunc(this.s.last_tick * 1000) + seconds * 1000;
    b.blocking = b.moving = false;
    b.y = this.floor(b.x, b.z);
    b.vy = 0;
    delete this.s.inputs[who];
    this.event("knockout", attacker, who, b.x, b.z);
  }
  hurt(who: string, damage: number, attacker: string | null = null) {
    const b = this.s.bodies[who],
      ms = this.s.last_tick * 1000;
    if (b.dodgeUntil > ms) return;
    if (this.template === "token-catch") {
      if (b.shieldUntil > ms) return;
      this.down(who, this.r.gun_knockout_seconds, attacker);
      return;
    }
    if (b.shieldUntil > ms) damage = Math.max(1, Math.floor(damage / 4));
    else if (b.blocking) damage = Math.max(1, Math.floor((damage * 2) / 5));
    const dealt = Math.min(b.hp, damage);
    b.hp -= dealt;
    if (attacker) this.s.damage[attacker] += dealt;
    this.event("hit", attacker, who, b.x, b.z);
    if (b.hp <= 0) {
      this.event("knockout", attacker, who, b.x, b.z);
      if (this.template === "combat-duel") {
        this.s.finished = true;
        this.s.winner = attacker && attacker !== who ? attacker : null;
      } else {
        b.respawnAt = Math.trunc(ms) + 2200;
        b.weapon = "hands";
        b.weaponUses = 0;
        b.blocking = false;
        delete this.s.inputs[who];
        this.down(who, this.r.knockout_seconds, attacker);
      }
    }
  }
  bossDamage(who: string, n: number) {
    const actual = Math.min(
      n,
      this.s.boss.hp,
      Math.max(0, this.r.contribution_cap - this.s.damage[who]),
    );
    this.s.damage[who] += actual;
    this.s.boss.hp -= actual;
    this.event("boss-hit", who);
    if (this.s.boss.hp <= 0) this.finish();
  }
  teamDamage() {
    const out: Dict = {};
    for (const team of [
      ...new Set(Object.values(this.s.teams)),
    ].sort() as string[])
      out[team] = this.s.participants
        .filter((p: string) => this.s.teams[p] === team)
        .reduce((n: number, p: string) => n + this.s.damage[p], 0);
    return out;
  }
  scores() {
    return Object.fromEntries(
      this.s.participants.map((p: string) => [
        p,
        this.template === "token-catch"
          ? this.s.bodies[p].score
          : this.s.damage[p],
      ]),
    );
  }
  ranking() {
    const scores = this.scores();
    return [...this.s.participants].sort(
      (a, b) => scores[b] - scores[a] || a.localeCompare(b),
    );
  }
  teamRankings() {
    const totals = this.teamDamage(),
      shares = this.s.boss ? this.r.team_reward_shares : [],
      out: Dict[] = [];
    let pos = 0;
    for (const damage of [
      ...new Set(Object.values(totals).filter((n) => n > 0)),
    ].sort((a, b) => b - a)) {
      const tied = Object.keys(totals)
          .filter((t) => totals[t] === damage)
          .sort(),
        num = shares
          .slice(pos, pos + tied.length)
          .reduce((a: number, b: number) => a + b, 0);
      for (const team of tied)
        out.push({
          team,
          rank: pos + 1,
          damage,
          rewardShare: num / tied.length,
          shareNumerator: num,
          shareDenominator: tied.length,
          eligible: num > 0,
        });
      pos += tied.length;
    }
    return out;
  }
  eligible() {
    if (!this.finished) return [];
    if (this.template === "token-catch")
      return this.s.participants.filter(
        (p: string) =>
          !this.s.suspended.includes(p) && this.s.bodies[p].score > 0,
      );
    if (this.s.boss) {
      const teams = this.teamRankings()
        .filter((r) => r.eligible)
        .map((r) => r.team);
      return this.s.participants.filter(
        (p: string) =>
          !this.s.suspended.includes(p) &&
          teams.includes(this.s.teams[p]) &&
          this.s.damage[p] >= this.r.min_contribution,
      );
    }
    return this.s.winner && !this.s.suspended.includes(this.s.winner)
      ? [this.s.winner]
      : [];
  }
  finish() {
    this.s.finished = true;
    if (this.s.boss) {
      const d = this.teamDamage(),
        best = Math.max(0, ...Object.values(d)),
        leaders = Object.keys(d).filter((t) => d[t] === best);
      this.s.winning_team =
        best > 0 && leaders.length === 1 ? leaders[0] : null;
    } else if (this.template === "combat-duel" && !this.s.winner) {
      const players = this.s.participants.filter(
          (p: string) => !this.s.suspended.includes(p),
        ),
        max = Math.max(0, ...players.map((p: string) => this.s.bodies[p].hp)),
        leaders = players.filter((p: string) => this.s.bodies[p].hp === max);
      this.s.winner =
        leaders.length === 1 && this.s.damage[leaders[0]] > 0
          ? leaders[0]
          : null;
    }
  }
  schedule() {
    const budget = this.r.loot_budget,
      count = this.r.airdrop_count,
      end = this.r.duration_seconds * 1000;
    while (this.s.drop_index < count) {
      const i = this.s.drop_index,
        land = Math.trunc(((i + 1) * (end - 6000)) / count),
        spawn = Math.max(0, land - 2500);
      if (this.elapsed < spawn) break;
      const value = Math.floor(budget / count) + (i < budget % count ? 1 : 0);
      this.s.object_id++;
      let x = this.rng.between(-150, 150) / 10,
        z = this.rng.between(-150, 150) / 10,
        found = false;
      for (let j = 0; j < 20; j++) {
        if (
          this.canWalk(x, z, { y: 0 }) &&
          Array.from({ length: 8 }, (_, k) => k).every((k) =>
            this.canWalk(
              x + Math.sin((k * TAU) / 8) * 1.3,
              z + Math.cos((k * TAU) / 8) * 1.3,
              { y: 0 },
            ),
          )
        ) {
          found = true;
          break;
        }
        x = this.rng.between(-150, 150) / 10;
        z = this.rng.between(-150, 150) / 10;
      }
      if (!found) x = z = 0;
      this.s.airdrops.push({
        id: `airdrop-${this.s.object_id}`,
        x,
        z,
        spawnAt: spawn,
        landAt: land,
        opened: false,
        coinValue: value,
        y: this.floor(x, z),
      });
      this.s.dropped_value += value;
      this.s.drop_index++;
      this.event("airdrop-inbound", null, null, x, z);
    }
  }
  open(who: string, id: any) {
    const b = this.s.bodies[who],
      c = this.s.airdrops.find((d: Dict) => d.id === id);
    if (!c) return no("NO_AIRDROP");
    if (c.landAt > this.elapsed) return no("AIRDROP_NOT_LANDED");
    if (c.opened) return no("AIRDROP_ALREADY_OPEN");
    if (distance(b, c) > 3 || !this.clear(b, c)) return no("LOOT_OUT_OF_REACH");
    c.opened = true;
    let remaining = c.coinValue,
      i = 0;
    while (remaining) {
      const value = Math.min(this.r.loot_chunk, remaining);
      remaining -= value;
      const angle = i * 2.39996,
        r = 0.25 + Math.min(0.95, Math.sqrt(i) * 0.18);
      this.drop(
        "coin",
        c.x + Math.sin(angle) * r,
        c.z + Math.cos(angle) * r,
        this.elapsed,
        0,
        value,
        c.id,
      );
      i++;
    }
    if (this.rng.below(100) < this.r.hazard_chance_pct)
      this.drop("bomb", c.x + 0.35, c.z, this.elapsed, 0, 1, c.id);
    if (this.rng.below(100) < this.r.gun_spawn_chance_pct)
      this.drop("gun", c.x - 0.35, c.z, this.elapsed, 0, 1, c.id);
    this.event("airdrop-open", who, null, c.x, c.z);
    return ok();
  }
  loot(who: string, id: any, now: number) {
    const b = this.s.bodies[who],
      d = this.s.drops.find((d: Dict) => d.id === id);
    if (!d) return no("LOOT_ALREADY_TAKEN");
    if (d.landAt > this.elapsed) return no("LOOT_NOT_LANDED");
    if (
      distance(b, d) > 3 ||
      Math.abs(b.y - (d.y ?? 0)) > 2 ||
      !this.clear(b, d)
    )
      return no("LOOT_OUT_OF_REACH");
    if (b.lootReadyAt > now * 1000) return no("LOOT_COOLDOWN");
    b.lootReadyAt = Math.trunc(now * 1000) + 100;
    this.s.drops = this.s.drops.filter((a: Dict) => a !== d);
    const kind = d.kind;
    if (kind === "coin") b.score += d.value;
    else if (kind === "bomb") {
      this.scatter(who);
      b.stunnedUntil = Math.trunc(now * 1000) + 2000;
    } else if (kind === "shield") b.shieldUntil = Math.trunc(now * 1000) + 7000;
    else if (kind === "heal") b.hp = Math.min(b.maxHp, b.hp + 35);
    else if (kind === "push") b.pushCharges = Math.min(3, b.pushCharges + 1);
    else if (kind === "upgrade") {
      b.weaponLevel = Math.min(4, b.weaponLevel + 1);
      if (this.s.boss) {
        b.weapon = "gun";
        b.weaponUses = -1;
      }
    } else if (kind in weapons) {
      b.weapon = kind;
      b.weaponUses = this.s.boss ? -1 : kind === "gun" ? this.r.gun_shots : 30;
    }
    this.event("pickup-" + kind, who, null, d.x, d.z);
    return ok();
  }
  segment(a: Dict, b: Dict, p: Dict) {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      den = dx * dx + dz * dz,
      t = den
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / den))
        : 0;
    return [Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz), t];
  }
  bullets() {
    const keep = [];
    for (const b of this.s.projectiles) {
      if (this.s.suspended.includes(b.who)) continue;
      const prev = { ...b };
      b.x += Math.sin(b.yaw) * Math.cos(b.pitch ?? 0) * 28 * STEP;
      b.z += Math.cos(b.yaw) * Math.cos(b.pitch ?? 0) * 28 * STEP;
      b.y += Math.sin(b.pitch ?? 0) * 28 * STEP;
      if (
        this.elapsed >= b.expiresAt ||
        Math.abs(b.x) > 20 ||
        Math.abs(b.z) > 20 ||
        b.y < this.floor(b.x, b.z)
      )
        continue;
      if (
        this.s.obstacles.some(
          (o: Dict) =>
            (o.baseY ?? 0) + o.height > Math.min(prev.y, b.y) &&
            this.rect(prev, b, o),
        )
      )
        continue;
      const crate = this.s.crates.find(
        (c: Dict) =>
          c.hp > 0 &&
          this.segment(prev, b, c)[0] < 0.8 &&
          b.y < (c.y ?? 0) + 1.4,
      );
      if (crate) {
        crate.hp = Math.max(0, crate.hp - b.damage);
        if (!crate.hp)
          this.drop(
            this.rng.choice(
              this.s.boss
                ? ["heal", "shield", "upgrade"]
                : ["gun", "heal", "shield"],
            ),
            crate.x,
            crate.z,
            this.elapsed,
          );
        continue;
      }
      if (
        this.s.boss?.hp > 0 &&
        this.segment(prev, b, this.s.boss)[0] < 1.8 &&
        b.y < 4
      ) {
        this.bossDamage(b.who, b.damage);
        continue;
      }
      let hit = false;
      if (!this.s.boss)
        for (const [p, body] of Object.entries(this.s.bodies) as [
          string,
          Dict,
        ][]) {
          const [d, t] = this.segment(prev, b, body),
            y = prev.y + (b.y - prev.y) * t;
          if (
            p !== b.who &&
            this.alive(p) &&
            d < 0.5 &&
            body.y <= y &&
            y <= body.y + 1.8
          ) {
            this.hurt(p, b.damage, b.who);
            hit = true;
            break;
          }
        }
      if (!hit) keep.push(b);
    }
    this.s.projectiles = keep.slice(-150);
  }
  bossAttacks() {
    for (const a of this.s.attacks) {
      if (a.resolved || this.elapsed < a.hitAt) continue;
      a.resolved = true;
      for (const [p, b] of Object.entries(this.s.bodies) as [string, Dict][]) {
        if (!this.alive(p)) continue;
        const d = distance(b, a);
        let hit = d < a.radius;
        if (a.kind === "wave")
          hit = d < a.radius && b.y - this.floor(b.x, b.z) < 0.7;
        else if (a.kind === "beam") {
          const dx = b.x - a.x,
            dz = b.z - a.z,
            along = dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw),
            side = Math.abs(dx * Math.cos(a.yaw) - dz * Math.sin(a.yaw));
          hit =
            along >= 0 &&
            along <= a.radius &&
            side < a.width / 2 &&
            this.clear(a, b);
        }
        if (hit) this.hurt(p, a.damage);
      }
      this.event("boss-" + a.kind, null, null, a.x, a.z);
    }
    this.s.attacks = this.s.attacks.filter(
      (a: Dict) => a.expiresAt > this.elapsed,
    );
    this.s.boss.phase = this.s.attacks.some((a: Dict) => !a.resolved)
      ? "windup"
      : "idle";
    if (this.elapsed >= this.s.next_boss_attack) {
      const alive = this.s.participants.filter((p: string) => this.alive(p));
      if (alive.length) {
        const target = this.s.bodies[this.rng.choice(alive)],
          kind = ["slam", "wave", "beam", "meteor"][this.s.attack_index++ % 4],
          x = ["wave", "beam"].includes(kind) ? 0 : target.x,
          z = ["wave", "beam"].includes(kind) ? 0 : target.z,
          a = {
            id: `boss-attack-${++this.s.object_id}`,
            kind,
            x,
            z,
            yaw: Math.atan2(target.x, target.z),
            radius: ({ slam: 3, wave: 11, beam: 25, meteor: 4 } as Dict)[kind],
            width: 2.5,
            warnAt: this.elapsed,
            hitAt: this.elapsed + 1800,
            expiresAt: this.elapsed + 2600,
            damage: ({ slam: 32, wave: 25, beam: 40, meteor: 45 } as Dict)[
              kind
            ],
            resolved: false,
          };
        this.s.attacks.push(a);
        Object.assign(this.s.boss, {
          phase: "windup",
          attackKind: kind,
          attackAt: a.hitAt,
          attackX: x,
          attackZ: z,
          radius: a.radius,
        });
        this.s.next_boss_attack =
          this.elapsed + Math.max(3000, 6000 - this.s.upgrade_phase * 750);
      }
    }
    for (const a of this.s.attacks) a.y = this.floor(a.x, a.z);
    if (this.s.attacks.length)
      this.s.boss.yaw = this.s.attacks.at(-1).yaw ?? this.s.boss.yaw ?? 0;
  }
  step() {
    const ms = this.s.last_tick * 1000;
    this.s.tick_id++;
    for (const [p, b] of Object.entries(this.s.bodies) as [string, Dict][]) {
      if (this.s.suspended.includes(p)) {
        b.moving = false;
        continue;
      }
      if (b.respawnAt && ms >= b.respawnAt) {
        Object.assign(b, {
          hp: b.maxHp,
          respawnAt: 0,
          downedUntil: 0,
          y: 0,
          vy: 0,
          blocking: false,
          ...this.s.spawn_points[p],
          stunnedUntil: Math.trunc(ms) + 400,
        });
        b.y = this.floor(b.x, b.z);
        this.event("respawn", p, null, b.x, b.z);
      }
      const active = this.alive(p) && b.stunnedUntil <= ms,
        inp = this.s.inputs[p] ?? {},
        leased = active && (inp.until ?? 0) > ms,
        dx = leased ? (inp.dx ?? 0) : 0,
        dz = leased ? (inp.dz ?? 0) : 0;
      b.moving = Boolean(dx || dz);
      b.sprinting = Boolean(leased && inp.sprint && !b.blocking);
      const floor = this.floor(b.x, b.z),
        grounded = Math.abs(b.y - floor) < 0.001 && b.vy === 0;
      if (active && (b.y > floor || b.vy > 0)) {
        b.vy -= 18 * STEP;
        b.y = Math.max(floor, b.y + b.vy * STEP);
        if (b.y === floor) b.vy = 0;
      }
      if (active) {
        const scale = STEP * (b.sprinting ? 8 : 5) * (b.blocking ? 0.5 : 1),
          x = clamp(b.x + dx * scale),
          z = clamp(b.z + dz * scale);
        if (this.canWalk(x, b.z, b)) b.x = x;
        if (this.canWalk(b.x, z, b)) b.z = z;
        const f = this.floor(b.x, b.z);
        if (grounded || b.y < f) {
          b.y = f;
          b.vy = 0;
        }
        if (!this.canWalk(b.x, b.z, b))
          for (const o of this.s.obstacles)
            if (
              Math.abs(b.x - o.x) < o.width / 2 + 0.32 &&
              Math.abs(b.z - o.z) < o.depth / 2 + 0.32
            ) {
              b.y = (o.baseY ?? 0) + o.height;
              b.vy = 0;
            }
      }
    }
    if (this.template === "token-catch") this.schedule();
    if (this.elapsed >= this.s.next_drop) {
      this.s.next_drop = this.elapsed + 7000;
      let kind = this.rng.choice(
        this.template === "token-catch"
          ? ["gun", "shield", "heal"]
          : this.s.boss
            ? ["heal", "shield", "upgrade"]
            : ["heal", "shield", "sword", "spear"],
      );
      if (
        this.template === "combat-duel" &&
        this.r.allow_guns &&
        this.rng.below(100) < 30
      )
        kind = "gun";
      if (
        this.s.drops.length < 440 &&
        (kind !== "gun" ||
          this.template !== "token-catch" ||
          this.rng.below(100) < this.r.gun_spawn_chance_pct)
      ) {
        const x = this.rng.between(-160, 160) / 10,
          z = this.rng.between(-160, 160) / 10;
        if (this.canWalk(x, z, { y: 0 }))
          this.drop(kind, x, z, this.elapsed, 1500);
      }
    }
    this.bullets();
    if (this.s.boss?.hp > 0) {
      this.bossAttacks();
      const phase = Math.min(
        3,
        Math.trunc((1 - this.s.boss.hp / this.s.boss.maxHp) * 4),
      );
      if (this.elapsed >= this.s.next_upgrade || phase > this.s.upgrade_phase) {
        this.s.upgrade_phase = Math.max(phase, this.s.upgrade_phase);
        this.s.next_upgrade =
          this.elapsed + this.r.upgrade_interval_seconds * 1000;
        const n = Math.max(3, Math.min(12, Object.keys(this.s.bodies).length));
        for (
          let i = 0;
          i < Math.min(n, Math.max(0, 450 - this.s.drops.length));
          i++
        )
          this.drop(
            "upgrade",
            Math.sin((i * TAU) / n) * 7,
            Math.cos((i * TAU) / n) * 7,
            this.elapsed,
            1000,
          );
        this.event("boss-upgrades");
      }
    }
    if (
      this.elapsed >= this.r.duration_seconds * 1000 ||
      (this.s.boss && this.s.boss.hp <= 0)
    )
      this.finish();
  }
  advance(now: number) {
    if (this.finished || !finite(now) || now < this.s.last_tick) return;
    if (now - this.s.last_tick > 2) {
      this.s.inputs = {};
      this.s.last_tick = now - Math.min(0.25, now - this.s.last_tick);
    }
    const n = Math.min(60, Math.trunc((now - this.s.last_tick + 1e-8) / STEP));
    for (let i = 0; i < n; i++) {
      this.s.last_tick += STEP;
      this.step();
      if (this.finished) break;
    }
  }
  act(who: string, a: Dict, now: number) {
    this.advance(now);
    const b = this.s.bodies[who],
      floor = b ? this.floor(b.x, b.z) : 0,
      grounded = b && Math.abs(b.y - floor) < 0.001 && b.vy === 0,
      weapon = b?.weapon ?? "hands";
    if (
      b &&
      a.kind === "interact" &&
      !this.finished &&
      this.alive(who, now * 1000) &&
      b.stunnedUntil <= now * 1000 &&
      !this.s.crates.some(
        (c: Dict) => c.hp > 0 && distance(b, c) < 2.5 && this.clear(b, c),
      )
    )
      return no("NO_CRATE_IN_REACH");
    const res = this.action(who, a, now);
    if (res.accepted && b) {
      if (grounded && a.kind === "dodge") b.y = this.floor(b.x, b.z);
      if (["attack", "punch", "push", "interact"].includes(a.kind)) {
        b.lastAttackWeapon = ["punch", "push", "interact"].includes(a.kind)
          ? "hands"
          : weapon;
        b.lastAttackKind = a.kind;
      }
      if (["loot", "open_airdrop", "interact"].includes(a.kind))
        b.lastInteractAt = Math.trunc(now * 1000);
    }
    for (const o of Object.values(this.s.bodies) as Dict[])
      if (o.vy === 0 && o.y < this.floor(o.x, o.z)) o.y = this.floor(o.x, o.z);
    return res;
  }
  action(who: string, a: Dict, now: number) {
    const b = this.s.bodies[who],
      ms = now * 1000,
      kind = a.kind;
    if (!b) return no("NOT_ADMITTED");
    if (this.finished) return no("ROUND_NOT_OPEN");
    if (kind === "block" && a.active === false) {
      if (!b.blocking) return no("NO_CHANGE");
      b.blocking = false;
      return ok();
    }
    if (this.s.suspended.includes(who)) return no("PLAYER_SUSPENDED");
    if (kind === "equip") {
      if (!this.characters.includes(a.character))
        return no("UNKNOWN_CHARACTER");
      if (a.character === b.character) return no("NO_CHANGE");
      if (b.equipReadyAt > ms) return no("CONTROL_RATE_LIMIT");
      b.equipReadyAt = Math.trunc(ms) + 250;
      b.character = a.character;
      return ok();
    }
    if (!this.alive(who, ms)) return no("RESPAWNING");
    if (kind === "move") {
      if (a.sprint !== undefined && typeof a.sprint !== "boolean")
        return no("INVALID_SPRINT");
      const pitch = a.aimPitch ?? b.aimPitch;
      if (!finite(pitch) || Math.abs(pitch) > 1.1) return no("INVALID_AIM");
      const { dx, dz, seq, yaw } = a;
      if (!finite(dx) || !finite(dz) || Math.abs(dx) > 1 || Math.abs(dz) > 1)
        return no("INVALID_DIRECTION");
      if (!Number.isSafeInteger(seq) || seq <= 0)
        return no("INVALID_INPUT_SEQUENCE");
      if (seq <= b.inputSeq) return no("STALE_INPUT");
      if (yaw !== undefined && (!finite(yaw) || Math.abs(yaw) > TAU * 2))
        return no("INVALID_FACING");
      const prev = this.s.inputs[who] ?? {},
        stopping =
          dx === 0 &&
          dz === 0 &&
          ((prev.dx ?? 0) !== 0 || (prev.dz ?? 0) !== 0);
      if (!stopping && ms - (prev.at ?? -1000) < 35)
        return no("INPUT_RATE_LIMIT");
      const norm = Math.max(1, Math.hypot(dx, dz));
      this.s.inputs[who] = {
        dx: dx / norm,
        dz: dz / norm,
        at: ms,
        until: ms + 250,
        sprint: Boolean(a.sprint),
      };
      b.inputSeq = seq;
      if (yaw !== undefined) b.yaw = yaw;
      else if (dx || dz) b.yaw = Math.atan2(dx, dz);
      b.aimPitch = pitch;
      return ok();
    }
    if (kind === "block") {
      if (typeof a.active !== "boolean") return no("INVALID_BLOCK");
      if (a.active === b.blocking) return no("NO_CHANGE");
      if (a.active && b.controlReadyAt > ms) return no("CONTROL_RATE_LIMIT");
      if (a.active) b.controlReadyAt = Math.trunc(ms) + 100;
      b.blocking = a.active;
      return ok();
    }
    if (b.stunnedUntil > ms) return no("STUNNED");
    if (["attack", "punch", "push", "dodge"].includes(kind)) {
      const yaw = a.yaw ?? b.yaw,
        pitch = a.aimPitch ?? b.aimPitch;
      if (!finite(yaw) || Math.abs(yaw) > TAU * 2) return no("INVALID_FACING");
      if (!finite(pitch) || Math.abs(pitch) > 1.1) return no("INVALID_AIM");
      b.yaw = yaw;
      b.aimPitch = pitch;
    }
    if (kind === "jump") {
      const surface =
        Math.abs(b.y - this.floor(b.x, b.z)) < 0.001 ||
        this.s.obstacles.some(
          (o: Dict) => Math.abs(b.y - ((o.baseY ?? 0) + o.height)) < 0.01,
        );
      if (!surface || b.vy !== 0) return no("ALREADY_AIRBORNE");
      if (b.jumpReadyAt > ms) return no("COOLDOWN");
      b.vy = 7.5;
      b.jumpReadyAt = Math.trunc(ms) + 700;
      this.event("jump", who, null, b.x, b.z);
      return ok();
    }
    if (kind === "dodge") {
      if (b.dodgeReadyAt > ms) return no("COOLDOWN");
      b.dodgeReadyAt = Math.trunc(ms) + 2200;
      b.dodgeUntil = Math.trunc(ms) + 350;
      const x = clamp(b.x + Math.sin(b.yaw) * 2.2),
        z = clamp(b.z + Math.cos(b.yaw) * 2.2);
      if (this.canWalk(x, z, b) && this.clear(b, { x, z, y: b.y })) {
        b.x = x;
        b.z = z;
      }
      this.event("dodge", who, null, b.x, b.z);
      return ok();
    }
    if (kind === "open_airdrop" && this.template === "token-catch")
      return this.open(who, a.dropId);
    if (kind === "loot") return this.loot(who, a.dropId, now);
    if (!["attack", "punch", "push", "interact"].includes(kind))
      return no("UNKNOWN_ACTION");
    if (kind === "push" && b.pushCharges <= 0) return no("NO_PUSH_POWER");
    if (b.attackReadyAt > ms) return no("COOLDOWN");
    const style = a.style ?? "light";
    if (!["light", "heavy", "kick"].includes(style))
      return no("INVALID_ATTACK_STYLE");
    const weapon = ["punch", "push"].includes(kind) ? "hands" : b.weapon;
    let cooldown =
      this.r.attack_cooldown_ms ?? this.r.action_cooldown_ms ?? 500;
    if (this.s.boss)
      cooldown = Math.max(
        150,
        Math.trunc(cooldown / (1 + 0.15 * b.weaponLevel)),
      );
    if (style === "heavy") cooldown = Math.trunc(cooldown * 1.7);
    b.attackReadyAt = Math.trunc(ms) + cooldown;
    b.combo = b.comboUntil > ms ? Math.min(3, b.combo + 1) : 1;
    b.comboUntil = Math.trunc(ms) + (this.r.combo_window_ms ?? 800);
    b.lastAttackAt = Math.trunc(ms);
    b.lastAttackStyle = kind === "attack" ? style : "punch";
    if (kind === "push") b.pushCharges--;
    let [reach, damage] = weapons[weapon];
    if (this.s.boss && weapon === "gun")
      damage = Math.trunc(
        this.r.starting_gun_damage * (1 + 0.25 * b.weaponLevel),
      );
    else if (!this.s.boss)
      damage = Math.trunc(
        damage *
          (1 + 0.15 * (b.combo - 1)) *
          (style === "heavy" ? 1.7 : style === "kick" ? 1.15 : 1),
      );
    if (style === "kick") reach += 0.5;
    this.event("attack", who, null, b.x, b.z);
    if (kind === "interact") {
      const c = this.s.crates.find(
        (c: Dict) => c.hp > 0 && distance(b, c) < 2.5 && this.clear(b, c),
      );
      if (!c) return no("NO_CRATE_IN_REACH");
      c.hp = Math.max(0, c.hp - 20);
      if (!c.hp)
        this.drop(this.s.boss ? "upgrade" : "shield", c.x, c.z, this.elapsed);
      return ok();
    }
    if (weapon === "gun")
      this.s.projectiles.push({
        id: `bullet-${++this.s.object_id}`,
        who,
        x: b.x,
        z: b.z,
        y: b.y + 1.3,
        yaw: b.yaw,
        pitch: b.aimPitch,
        damage,
        expiresAt: this.elapsed + 1600,
      });
    else if (this.s.boss) {
      if (
        distance(b, this.s.boss) <= reach + 1 &&
        this.facing(b, this.s.boss) &&
        this.clear(b, this.s.boss)
      )
        this.bossDamage(who, damage);
    } else
      for (const [target, o] of Object.entries(this.s.bodies) as [
        string,
        Dict,
      ][]) {
        if (
          target === who ||
          !this.alive(target, ms) ||
          Math.abs(b.y - o.y) > 1.5
        )
          continue;
        if (distance(b, o) <= reach && this.facing(b, o) && this.clear(b, o)) {
          if (this.template === "token-catch") {
            if (o.shieldUntil > ms || o.dodgeUntil > ms) continue;
            o.stunnedUntil = Math.trunc(ms) + this.r.punch_stun_seconds * 1000;
            delete this.s.inputs[target];
            const x = clamp(o.x + Math.sin(b.yaw) * 1.5),
              z = clamp(o.z + Math.cos(b.yaw) * 1.5);
            if (this.canWalk(x, z, o)) {
              o.x = x;
              o.z = z;
            }
            this.event("punch", who, target, o.x, o.z);
          } else this.hurt(target, damage, who);
          break;
        }
      }
    if (weapon !== "hands" && b.weaponUses > 0) {
      b.weaponUses--;
      if (b.weaponUses === 0) b.weapon = "hands";
    }
    return ok();
  }
  characters: string[] = [];
  checkpoint() {
    return structuredClone({
      ...this.s,
      rng_counter: this.rng.counter,
      rng_buf: this.rng.buf.toString("hex"),
    });
  }
  publicState() {
    const s = this.s,
      bodies = structuredClone(s.bodies);
    for (const [p, b] of Object.entries(bodies) as [string, Dict][]) {
      let surface = this.floor(b.x, b.z);
      for (const o of s.obstacles)
        if (
          Math.abs(b.x - o.x) < o.width / 2 + 0.32 &&
          Math.abs(b.z - o.z) < o.depth / 2 + 0.32
        )
          surface = Math.max(surface, (o.baseY ?? 0) + o.height);
      const a = s.inputs[p] ?? {};
      Object.assign(b, {
        inputDx: a.dx ?? 0,
        inputDz: a.dz ?? 0,
        inputAt: a.at ?? 0,
        inputUntil: a.until ?? 0,
        groundHeight: surface,
        onGround: Math.abs(b.y - surface) < 0.05 && b.vy === 0,
      });
    }
    const state: Dict = {
      template: this.template,
      arena: true,
      arenaKind: this.template,
      bounds: { width: 40, depth: 40 },
      nowMs: this.elapsed,
      serverTimeMs: Math.trunc(s.last_tick * 1000),
      startedAt: s.started_at,
      duration: this.r.duration_seconds,
      tick: s.tick_id,
      players: s.participants,
      bodies,
      drops: s.drops,
      crates: s.crates,
      projectiles: s.projectiles,
      events: s.events,
      teams: s.teams,
      teamDamage: this.teamDamage(),
      boss: s.boss,
      finished: s.finished,
      scores: this.scores(),
      winner: s.winner,
      winningTeam: s.winning_team,
      weaponCooldownMs:
        this.r.attack_cooldown_ms ?? this.r.action_cooldown_ms ?? 500,
      minContribution: this.r.min_contribution ?? 0,
      winThreshold: this.r.win_threshold ?? 0,
      worldVersion: 4,
      obstacles: s.obstacles,
      airdrops: s.airdrops,
      attacks: s.attacks,
      spawnPoints: s.spawn_points,
      terrain: { kind: "field-v1", theme: this.theme },
    };
    if (this.template === "token-catch")
      Object.assign(state, {
        lootBudget: this.r.loot_budget,
        droppedValue: s.dropped_value,
        remainingScheduled: this.r.loot_budget - s.dropped_value,
        unclaimedValue:
          s.dropped_value -
          Object.values(s.bodies).reduce((n: number, b: any) => n + b.score, 0),
        lootChunk: this.r.loot_chunk,
        lootRadius: 3,
      });
    if (s.boss)
      Object.assign(state, {
        teamRankings: this.teamRankings(),
        rankedRewardShares: this.r.team_reward_shares,
      });
    return structuredClone(state);
  }
}
