# 🎮 VIBE ARCADE — MASTER PLAN v2.0
### The Create-a-Game Platform for vibe/vibe Launchpad Tokens
#### *Burn-to-build · Play-to-earn · Rooms with friends · Bots welcome (where it's fun)*

**Document status:** Build specification — v2.0, supersedes v1.0
**Chain:** Robinhood Chain (Arbitrum Orbit L2) — testnet 46630 first, mainnet 4663 at launch
**Infra today:** Railway (3 live services) + Cloudflare DNS + `orbixcore.fun`
**Author:** built for GRINCH / Orbix

---

## 0. TL;DR — WHAT THIS IS

**One sentence:** A website where any token creator on **vibe/vibe** can spin up their own
customisable mini-game site in minutes — with entry fees, jackpots, live online rooms and
their own token as the reward — and where **creating a game requires burning OUR token**.

**The flywheel:**
```
Creator burns OUR token  →  unlocks the game builder
     ↓
Builds a fully custom game (rewards, criteria, timing, branding, bot policy)
     ↓
Their community joins LIVE ROOMS, pays entry in THEIR token
     ↓
Winners paid from an escrow pool (creator can't touch it — anti-rug by design)
     ↓
Rake → swapped to OUR token → BURNED 🔥
     ↓
Our supply shrinks, creators need more, repeat
```

**Why this wins:** we don't compete with the launchpad — we become **the utility layer on top
of every token it launches**. Every new token becomes a potential game, and every game burns
our supply. That's a network effect the launchpad itself doesn't have.

---

## 1. DEEP RESEARCH — WHAT WE LEARNED (verified, not assumed)

### 1.1 The ecosystem

| Fact | Detail |
|---|---|
| **vibe/vibe** | Token launchpad on **Robinhood Chain**, built by **SPARK LABS ORGANIZATION, S.A.** (Panama). Testnet live at `testnet.vibevibe.fun` |
| **The founder** | **Meta Alchemist** (@meta_alchemist) — *"5 years ago I founded Seedify, from an airdrop… Today we are announcing revival of Seedify with vibe/vibe on Robinhood chain. With a focus on ai & agentic building, real world utility, products."* |
| **Positioning** | Explicitly **AI & agentic building + real-world utility**. Not just another memecoin pad |
| **Testnet allocation** | **5%** of token supply reserved for testnet participants. Eligible groups: **traders with strong PnL, token creators, and active users** |
| **SPARK holders** | **25%** of vibe/vibe token → $SPARK holders (free). **Each 200k SPARK = 1 free vibe vibers NFT** |
| **NFT utility** | vibe vibers NFTs **gain XP and level up** via activity/quests/referrals — long-game asset |
| **Robinhood Chain** | Arbitrum Orbit L2. **Mainnet went live July 1, 2026.** ETH as gas. $1B DEX volume + 17M txs in first week. AI-native, RWA-focused. Mainnet chain ID **4663**, testnet **46630** |

### 1.2 ⭐ THE CRITICAL FINDING — vibe/vibe's fee architecture

This is the single most important thing in this document. **vibe/vibe has a "Builder Tier"
that splits trading fees by basis points:**

| Tier | Fee split |
|---|---|
| **Creator Tier** | 1.25% per trade → **0.75% creator**, 0.50% platform |
| **Builder Tier** | 1.25% per trade → **1.00% into a "Builder Pool"**, split across wallets **or X handles** by BPS (must total 10,000); 0.25% platform |
| **Campaign Vaults** | Attachable to Builder Tier launches; records public campaign code, claim target, 1% builder accrual, **180-day fallback timer** |

**What this means for us — the real money:**

1. **We can be registered as a Builder on every token we make a game for.** The creator
   allocates BPS to us in their fee shares → **we earn 1% of that token's trading volume,
   forever, claimable on-chain.** That is literally "getting a share of every launched
   token's utility" — the exact thing you asked about.
2. **X-handle fee shares exist** — meaning we can accrue fees under `@orbixcore` on X and
   claim once linked. Distribution channel built into the protocol.
3. **Campaign Vaults + 180-day fallback** = a legit mechanism for airdrop/game campaigns
   attached to a launch. Our "launch a game, airdrop your token" flow maps onto this natively.

**This turns the business model from one revenue stream into three:**
- (a) **Burn revenue** — creators burn OUR token for builder access
- (b) **Rake** — 5–10% of every game entry pool
- (c) **Builder-tier fee share** — 1% of every sponsored token's lifetime trading volume

### 1.3 Competitive landscape (who else is on Robinhood Chain / adjacent)

| Player | What they do | Our edge over them |
|---|---|---|
| **play.fun** | "Monetize your vibecoded games" — Solana game SDK, MCP tools, game tokens, leaderboards, anti-cheat | Solana-only, no launchpad tie-in, no burn loop, no multi-creator hosted sites |
| **hood.fun** | Fair-launch pump.fun-style pad for Robinhood Chain | Launchpad, not games |
| **robinhood.fun** | Bonding-curve launchpad + **Gacha** + farming | Has a gacha minigame, but closed — not a creator platform |
| **vybes.fun** | Launchpad on Solana/Base/Robinhood, AI visuals, agent tools | Launchpad only; no game builder |
| **trench.today** | Launchpad with tax-revenue router | No games |

**Our wedge is uncontested: "arcade as a service" for launchpad tokens.** Nobody offers
*creators* a no-code way to publish their own branded, customisable game site funded by
their own token, with live multiplayer rooms.

### 1.4 Why now

- Robinhood Chain mainnet is **live but young** → almost no utility dApps exist
- The founder is publicly funding **builder/utility projects** for grants and LLM
  subscriptions (posted to agentic builders & vibe coders)
- vibe/vibe is handing **5% of supply** to testnet participants — *including token creators
  and active users*. We are literally building the thing that makes us qualify
- The culture is **burn-native** (auto buyback & burn is default) → a burn-to-access model
  is native, not bolted on
- **We're already in the room**: member of the community, the raid-alert channel, the raid
  bot, and we know the cadence of the drops

---

## 2. THE PRODUCT — THREE USERS, ONE PLATFORM

### 2.1 The Creator (token teams, KOLs, communities)
- **Burns X of OUR token** → unlocks the Game Builder (tiered — see §7)
- **No-code wizard**: pick a game template → set the rules → brand it → burn & publish
- Gets a **shareable site**: `orbixcore.fun/play/<their-token>` with their logo, colors, banner
- Full per-game customisation (the heart of the product):
  - **Entry fee** — amount + which token (theirs, ours, or any ERC-20)
  - **Reward token + pool size** — their token, ours, or anything; who funds the pot
  - **Win criteria** — number range, guess budget, time limit, rounds, score thresholds
  - **Bot / AI / agent policy** — banned · whitelist-only · fully allowed
  - **Round schedule** — always-on · hourly · scheduled events · one-off tournament
  - **Anti-whale caps** — max entries per wallet, max stake per round
  - **Branding** — logo, theme colors, game name, custom win/lose messages, banner art
  - **Airdrop hook** — auto-airdrop their token to top players (their own growth engine)

### 2.2 The Player
- Connects wallet → picks a room → pays entry → plays → wins get paid from escrow
- **Live rooms**: see other players join, watch the guess feed, feel the competition
- Profile: stats, badges, leaderboard rank, cosmetics (all burn sinks)
- Plays free in casual rooms, or staked in token rooms

### 2.3 The Watcher (our community)
- **Public burn dashboard** — total burned, burn/day, per-game breakdown
- Public fairness: every round's seed hash on-chain, verifiable by anyone
- This is marketing, not a feature: people love watching a supply number fall

---

## 3. GAME CATALOG

> **Design rule:** every game is a **template with parameter slots**. One engine, many
> games. Creators fill the slots; the platform never needs new code per game.

### 3.1 Wave 1 — MVP (ship first)

**G1. Number Jackpot** ⭐ *(already built & deployed — see §12)*
- Creator sets: range (e.g. 111111–999999), guess budget (e.g. 20), time limit (60s),
  pot size, reward token
- Player pays entry → gets N guesses → hits the secret number → splits the pot
- **Higher/lower hints** make it a genuine deduction game, not pure luck
- Multiple winners split; unclaimed pots **roll over** (rollover = FOMO machine)
- ✅ *Live now as the proof-of-loop*

**G2. Hash Hunt** ⭐⭐ *(the flagship differentiator)*
- Server publishes `SHA256(secret_nonce)` at round start. Players submit guesses; any guess
  whose hash lands under the difficulty target scores (Bitcoin-mining, gamified)
- **Hashing happens in the player's browser** — the server only verifies. This is the single
  biggest scaling decision in the whole platform: **the server never mines**
- **Bots and AI agents ALLOWED and encouraged** → becomes an AI-agent battleground, exactly
  matching vibe/vibe's explicitly agentic culture
- Adjustable difficulty = adjustable pot pacing
- "Script mining" energy, gamified → highly clippable, highly shareable

**G3. Token Rain**
- 60-second arcade: tokens fall, catch them with mouse/finger, each catch = points
- Top N scorers split the round pool. Zero skill floor, maximum dopamine
- Bots **banned** (input-entropy detection)

### 3.2 Wave 2 — differentiators

**G4. Duel Arena** — best-of-5 PvP with staked entry, winner takes pot minus rake.
Provably fair via committed seeds. Infinitely replayable, trivially social.

**G5. 6-Digit Grid** — grid of tiles hiding randomised reward values; player buys reveals
(burn per reveal). Instant gratification, pure burn sink.

**G6. Liquidation Dash** — fake/real price chart wicks violently; 10-second rounds;
long/short chips; survive N rounds → split pot. Launchpad-native language.

### 3.3 Wave 3 — the fun stack (small, cheap, addictive)

| Game | Mechanic | Why it works |
|---|---|---|
| **G7. Lucky Wheel** | Spinning-wheel with creator-set prize segments | Clippable, instant, zero learning curve |
| **G8. Plinko Drop** | Ball drops through pegs into multiplier slots | Hypnotic, endless replay, classic degen |
| **G9. Crash Multiplier** | Shared rising multiplier, cash out before it busts | The single most addictive degen game format |
| **G10. Emoji Prediction** | Bet on which emoji the RNG reveals; streak multipliers | 3-second rounds, ultra-casual |
| **G11. Candle Guess** | Guess next 1-min candle direction (up/down/flat) | Teaches price action while paying |
| **G12. Reaction Tap** | Reflex duel — first to tap wins the duel pot | Pure human-vs-human, bots banned |
| **G13. Memory Grid** | Match pairs of token logos under time pressure | Branded with creator's own logo set |
| **G14. Hoard the Pot** | Last player standing collecting/not-greedy wins | Social chaos, great for streams |
| **G15. Boss Raid** | Community pools entries to damage a boss; drops by contribution | The "we all win together" moment |
| **G16. Idle Rig Tycoon** | Build a virtual mining rig; hourly server-wide "hacker events" | Retention layer; NFT-holder multipliers |

### 3.4 Wave 4 — nerd/edu (viral on CT)

| Game | Hook |
|---|---|
| **G17. MEV Rush** | Snipe valuable "pending txs" before AI bots do |
| **G18. Contract Detective** | Spot the honeypot in a fake contract — deeply shareable |
| **G19. Gas Golf** | Optimise a tx to lowest gas in fewest steps |
| **G20. Rug Radar** | Score a token's rug-risk faster than the timer |

---

## 4. ARCHITECTURE

### 4.1 High level

```
┌────────────────────────────────────────────────────────────┐
│  CLIENT — Next.js / Vite + Tailwind + wagmi/viem           │
│  Creator Wizard │ Game Player │ Live Rooms │ Burn Dashboard│
│  WebSocket client (10–20 Hz) │ Wallet connect (RainbowKit) │
└───────────┬───────────────────────────────┬────────────────┘
            │ HTTPS + WSS                   │ RPC (Robinhood Chain)
┌───────────▼────────────────────┐  ┌───────▼─────────────────┐
│  ROOM SERVER — FastAPI+uvicorn │  │  SMART CONTRACTS        │
│  • rooms, matchmaking, presence│  │  • GameRegistry         │
│  • game-logic authority        │  │  • EscrowPool (per game)│
│  • anti-bot scoring            │  │  • BurnRouter (rake→🔥) │
│  • rate limiting (token bucket)│  │  • FairRNG (commit-     │
│  • verifies hashes (never mines)│ │    reveal)              │
└──────┬──────────────┬──────────┘  │  • AccessNFT / Cosmetics│
       │              │             └─────────────────────────┘
┌──────▼─────┐  ┌─────▼──────┐
│ Postgres   │  │ Redis      │   ← rooms, pub/sub, presence,
│ (Neon free)│  │ (Upstash)  │     rate limits — DB only for
│ settlements│  │            │     settled results
└────────────┘  └────────────┘
```

### 4.2 Stack decisions (chosen for free-tier survival)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Vite + React + Tailwind** (or Next.js if SEO matters more) | Vite = tiny builds, instant HMR, deployable to Cloudflare Pages free |
| Realtime | **FastAPI + uvicorn WebSockets** | Async, ideal for room relays; already proven today |
| DB | **Postgres** — Neon free tier | Only settled rounds get written; batched |
| Rooms/cache | **Redis** — Upstash free tier | Presence, pub/sub sharding, rate limits |
| Hosting | **Railway** now → Oracle Always Free VPS later | Same Dockerfile, no rewrite |
| Static | **Cloudflare Pages** (free, unlimited traffic) | Offload ~70% of serving from Railway |
| Media | **Cloudflare R2/CDN** | Railway serves zero images |
| Chain | viem/ethers + Robinhood Chain | Testnet 46630 → mainnet 4663 |
| RNG | Commit-reveal + block hash | Provable fairness, verifiable by players |

### 4.3 The room model (zero-lag multiplayer)

- **Rooms live in Redis**, never the DB. DB only records settled results
- **Entry flow:** sign tx → escrow → backend watches event → player appears in the room
  *immediately* (don't wait for confirmations to let them see the room)
- **Broadcast 10–20 Hz**, client interpolates → no rubber-banding
- **Lag killers:**
  - message payloads < 1 KB, compact JSON (switch to binary if needed)
  - region-aware server, ping displayed per room
  - client-side prediction for casual games
  - **Hashing is client-side** (Hash Hunt) → server is a verifier, not a miner
  - Redis pub/sub sharding above ~500 concurrent players per room-set
- **Hard caps:** max entrants, hard max round duration — no infinite loops, ever

### 4.4 Anti-lag budget (what the box actually has to do)
Games are **I/O bound**, not CPU bound. Sizing:
- ~50 KB RAM per connected player → **500 concurrent players ≈ 25 MB**
- Node/Python process overhead ~100–300 MB
- **Total realistic: < 1 GB RAM** — the free tiers in §9 are genuinely enough

---

## 5. SMART CONTRACTS (the trust layer)

| Contract | Responsibility |
|---|---|
| **GameRegistry** | Creators register game sites: game → config hash → escrow address. One source of truth |
| **EscrowPool** | Holds entry fees + prize pools per game/room. **Creator CANNOT withdraw player entries.** Payouts only to winners per signed round results. Creator deposits prizes *upfront* → **anti-rug by construction** |
| **BurnRouter** | Takes the rake, swaps via DEX to OUR token, sends to a dead address. Emits `Burned(amount)` for the public counter |
| **FairRNG** | Commit-reveal: seed hash published before the round, revealed after. Anyone can verify any outcome. No "admin picked the winner" |
| **AccessNFT** | Optional: burn-to-mint passes/cosmetics. Pure burn sink. Pairs with the existing Orbix 666 NFT tiers |
| **BuilderFeeShare** ⭐ | Wires us into vibe/vibe's **Builder Tier** (1% of trading fees, split by BPS) and Campaign Vaults. *New in v2 — see §1.2* |

**Non-negotiable security rules:**
- Reentrancy guards on every payout path
- **Pull payments** for winners (never push in a loop)
- Circuit-breaker pause: abnormal volume → halt new rounds + alert
- Timelock + delay on upgrades
- Cap single-round pool size at launch (blast-radius limit)
- Audited before mainnet
- **No admin key can move escrowed player funds. Ever.**

---

## 6. ANTI-BOT / ANTI-ABUSE / FAIRNESS

### 6.1 Wallet security
- **One entry per wallet per round** — enforced **on-chain** in EscrowPool
- Per-wallet entry caps (creator-configurable anti-whale)
- Sybil dampening: slight entry-fee scaling for wallets funded < 24h ago or from the same
  funding source (on-chain heuristic)

### 6.2 Bot policy (creator-configurable per game)
- **Banned** (casual/skill): Token Rain, Duel, Reaction Tap → input-rate anomalies = kick +
  stake forfeit
- **Allowed & encouraged**: Hash Hunt, MEV Rush, Gas Golf → *bots ARE the fun*; matches the
  agentic culture
- **Whitelist-only**: creator allowlists specific agent addresses/namespaces
- **Detection**: input timing entropy, mouse-move variance, request fingerprinting,
  behavioural scoring. Detected banned bots: **entry forfeited into the pot** (a bounty for
  the humans they played against)

### 6.3 Fairness (non-negotiable)
- Commit-reveal RNG for every round; seed hash published **pre-round on-chain**
- All round results posted on-chain; anyone can verify any game outcome
- Open-source verifier script so sceptics can check our math themselves

### 6.4 Operational
- Redis token-bucket rate limits per IP **and** per wallet
- Circuit breaker + alerting (we already have the cron/alert pattern from the raid monitor)
- Secrets only in Railway env vars — never in code, never in chat
- Regular dependency audits

---

## 7. BURN-TO-ACCESS TIERS (our token utility)

| Tier | Burn cost | Unlocks |
|---|---|---|
| **Free** | 0 | Play any game (paying entry in the room's token) |
| **Creator I** | small fixed amount | 1 game site · 2 game types · basic branding |
| **Creator II** | 2× Creator I | 3 sites · all game types · custom domain · bot policy control |
| **Studio** | 5× Creator II | Unlimited sites · tournaments · **API access for AI agents** · rake revenue share |
| **Cosmetics** | per item | Badges, avatars, name colours, animated frames |

**Tuning rule:** start low on testnet; on mainnet price burns against the real token price so
cost is meaningful but not a wall. **Never make burn a one-time price whales can hoard** —
burns are per-site and per-item, so supply keeps draining.

**Rake design:** 5–10% of every entry pool →
**60% burn** · 25% treasury · 15% creator rebates (top creators earn OUR token = they market
for us).

**Plus (from §1.2):** Builder-tier fee share = **1% of every sponsored token's lifetime
trading volume**, claimable on-chain.

---

## 8. UI / UX DESIGN SYSTEM

### 8.1 Visual language
- **Style:** dark neon-arcade. Deep charcoal base (`#0b0e14`), electric green (`#00ff9d`) +
  magenta (`#ff3df5`) accents, **CRT glow** on wins
- **Type:** display font (Space Grotesk / Chakra Petch) + clean body (Inter)
- **Feel rules:**
  - every action gets ≤ 100 ms visual feedback
  - win = screen shake + particle burst + sound
  - leaderboard always visible
  - **burn counter prominent** — people love watching a supply number fall
- **Mobile-first**: 90% of Telegram-native traffic is mobile → touch controls, portrait layouts

### 8.2 Creator wizard (no-code, no jargon)
`① Pick game → ② Set the rules → ③ Brand it → ④ Burn & publish`
Step-by-step with a **live preview pane** on the right. Every field has a plain-English
helper line. Rewards/timing/criteria are dropdowns and sliders, not JSON.

### 8.3 Assets
- Procedurally generated + AI-generated sprites/backgrounds — cheap, unique, no licensing
  issues. Stored on R2/CDN
- Per-game OG images auto-generated so every share link looks premium

### 8.4 Toolchain for building the UI (what we'll actually use)
- **Skills**: `ui-ux-pro-max`, `design-taste-frontend`, `minimalist-ui`,
  `frontend-design`, `motion-primitives`, `uicolors`, `frontend-toolbox`
- **MCP servers**: `shadcn` (component registry + audit checklist), `iconify`
  (icon sets/snippets), `context7` (up-to-date framework docs)
- **Verification**: `playwright` MCP + our browser tooling — **every UI claim gets
  browser-verified before it ships** (standing rule)

---

## 9. DEPLOYMENT ON FREE INFRA — DONE SMART

Railway's free/trial quota is finite, so efficiency is an engineering requirement:

| Decision | Saving |
|---|---|
| **Static frontend on Cloudflare Pages/Vercel** | Railway only hosts the API → **~70% less Railway usage** |
| **Single container** running API + WS (uvicorn) | one service, one billing unit |
| **Neon Postgres free** (0.5 GB, autosuspend) | batch round settlement, no per-event writes |
| **Upstash Redis free** (10k cmds/day) | pipelined commands, sparing pub/sub |
| **Keep-alive ping only on the API** | Neon/Upstash allowed to suspend when idle |
| **CDN everything** (R2/Pages) | Railway serves zero media |
| **Hashing client-side** (Hash Hunt) | the big one — server never mines |
| **Targets** | **< 512 MB RAM**, near-zero idle CPU |

**Rotation plan (your idea, formalised):** everything ships as a Dockerfile + one deploy
script, and all game state is deliberately **ephemeral/disposable**. Rotating hosts monthly
is a 10-minute redeploy, not a rebuild.

**Scaling path:** Railway → Oracle Always Free (2 ARM / 12 GB) → paid VPS. Same Dockerfile.

---

## 10. TOKENOMICS (OUR TOKEN)

- **Launch on vibe/vibe** (testnet first, mainnet at their launch) — inherits Spark airdrop
  distribution + the default buyback/burn culture
- **Fixed supply. No mint function. Ever.**
- **Value sinks:** creator burns (tiers) · cosmetic burns · per-reveal burns (Grid, Plinko) ·
  **60% of all rake burned**
- **Value sources:** every creator who wants a game site · tournament sponsors · every AI
  agent needing Studio-tier API access · builder-tier fee share from sponsored tokens
- **Public burn dashboard:** total burned, burn rate/day, per-game split → transparency *is*
  marketing
- The token relaunch (new CA with proper metadata: name, description, logo) is the natural
  moment to bind the token to this platform: **"the Vibe Arcade token"**

---

## 11. ROADMAP

| Phase | Scope | Status |
|---|---|---|
| **0 — Now** | Domain + infra live · Number Jackpot playable · spec contracts | ✅ mostly done today |
| **1 — MVP** | Number Jackpot + Token Rain public on testnet · escrow + FairRNG · creator wizard v1 · burn-to-create · CF Pages frontend | next |
| **2 — Differentiator** | **Hash Hunt** with full bot support + agent API · Duel Arena · tournaments v1 · public burn dashboard | |
| **3 — Flywheel** | Creator storefronts for every vibe/vibe token · Airdrop Arcade (play-to-claim) · Lucky Wheel/Plinko/Crash · cosmetic sinks · creator rebate program | |
| **4 — Mainnet** | Audited contracts · our token launch · day-one marketing: *"the arcade for Robinhood Chain"* · seeded tournament with real prize pools | |
| **5 — Expand** | Boss Raids, Idle Rig Tycoon, MEV Rush, Contract Detective · multi-chain (any EVM launchpad) · mobile app | |

---

## 12. ✅ WHAT IS ALREADY BUILT AND LIVE (as of 2026-09-29)

| Asset | Where | Verified |
|---|---|---|
| **Domain** | `orbixcore.fun` — Cloudflare NS, grey-cloud CNAME → Railway, valid Let's Encrypt cert | ✅ HTTPS 200, `CN=orbixcore.fun` |
| **Main site** (dapp sneak peek) | `orbixcore.fun` → Railway `orbixcore` service | ✅ 200, WIP banner rendering |
| **Hunt backend** | `orbix-hunt-backend-production.up.railway.app` — `/api/status`, `/check` | ✅ real state returned |
| **⭐ ARCADE ROOM SERVER** | `orbix-arcade-production.up.railway.app` — FastAPI + WebSockets | ✅ health + rooms + live play tested |
| **Number Jackpot game** | Live rooms, join, guesses, higher/lower hints, winner broadcast, pot split | ✅ **played to a jackpot win in a real browser** |
| **WIP banner** | "🚧 WORK IN PROGRESS — SNEAK PEEK ONLY. Do not interact" on the site | ✅ |
| **Arcade link** | "🎮 PLAY THE ARCADE" button on the main site | ✅ |
| **Orbix DeFi stack** | AMM, staking, bridge, NFT, launchpad contracts on Robinhood testnet | ✅ from earlier phases |

**Play it now:** open `https://orbixcore.fun` → click **PLAY THE ARCADE**, or go straight to
the room server and click *Demo Jackpot*.

### 12.1 Bugs found & fixed during today's build (worth remembering)
- `_json` helper set `Content-Length` but never wrote the body → Railway edge 502s.
  **Rule: always write the body.**
- Seeded demo room was keyed `"demo"` while the UI used the room's random hex id → joins
  403'd. **Rule: key rooms by their own id, always.**
- Railway trial caps **1 custom domain per service** → `www` needs a Cloudflare redirect
  rule instead of a second Railway domain
- New Railway services need: **GraphQL `serviceCreate`**, **`PORT` env var**, and a
  **domain `targetPort`** update — all scriptable

---

## 13. METRICS THAT MATTER

1. **Creator sites published** — *the* real growth metric
2. Weekly unique players + **D7 retention**
3. **Total OUR token burned** — the story we tell
4. Rake revenue + creator rebates paid + builder-fee-share accrued
5. Avg concurrent players per room (lag/perf health)
6. Time-to-publish for a new creator (must be < 10 minutes, ideally < 5)

---

## 14. RISKS & HONEST NOTES

- **vibe/vibe mainnet is live but their token TGE is still future.** Their own T&Cs say
  launches can fail. → Build on testnet cheaply; keep contracts **chain-agnostic EVM** so
  redeploying to Base/Arbitrum is a config change
- **Gambling regulation is real.** Skill-based games (Hash Hunt, MEV Rush, Candle Guess) are
  safer than pure chance. → Lead with skill games; **geo-fence pure-chance games**; jurisdiction
  check before mainnet
- **Free tiers throttle.** The architecture above survives it, but budget ~$20–40/mo once real
  traffic arrives
- **Clone risk is high.** The moat is **the burn loop + creator network effects + builder-fee
  share contracts**, not the individual games. Move fast on creator acquisition
- **Bot policy is a two-edged sword** — "bots allowed" is a feature in Hash Hunt and a
  liability elsewhere. The per-game creator setting is what keeps it sane
- **Never promise fixed returns.** Prizes come from entry pools and creator-funded pots; keep
  language strictly non-investment

---

## 15. IMMEDIATE NEXT STEPS

### 15.1 ✅ Already done
1. Domain live (`orbixcore.fun`) with HTTPS
2. Room server + Number Jackpot deployed and **played end-to-end**
3. Main site live with WIP banner + arcade link
4. Deep research on vibe/vibe, Spark, Meta Alchemist, Builder Tier fees, competitors

### 15.2 Next (in order)
1. **Wire the arcade into the domain path**: `orbixcore.fun/play` → room server (or a
   `play.` subdomain), so the arcade lives under our brand
2. **Polish the room UI**: particles, sound, pot animation, mobile layout, live player list,
   "burn counter" header
3. **Creator wizard v1** (frontend only, publishes a room via `POST /rooms`)
4. **Token relaunch on vibe/vibe v6**: new CA with logo + description, metadata JSON hosted
   on `orbixcore.fun`, then register our **Builder Tier fee share**
5. **Escrow + FairRNG contracts** on testnet, replacing the off-chain sneak-peek entries
6. **Hash Hunt prototype** — client-side hashing, server verification, bot-friendly
7. **Public burn dashboard** page
8. **Soft-launch to the vibe/vibe testnet community** — they're farming testnet activity right
   now; free first users, and our activity feeds the 5% allocation

### 15.3 What we need from you
- Decide: **arcade under `orbixcore.fun/play`** or a **separate `play.orbixcore.fun`
  subdomain** (I recommend the subdomain — cleaner separation, and Railway allows it)
- Confirm the **token name + ticker** for the relaunch so the logo/metadata can be made
- When Oracle approves the account, hand me the instance details and I'll move the
  long-term home there (SSH from here), keeping Railway for month-1

---

## APPENDIX A — Repository layout

```
vibeswap/
├── arcade/
│   ├── server/            # FastAPI room server  (deployed: orbix-arcade)
│   │   ├── main.py        # rooms, WS, game logic
│   │   ├── static/index.html  # lobby + game UI
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── web/               # (future) creator wizard, Next.js/Vite
├── deploy/
│   ├── site/              # main dapp static site (deployed: orbixcore)
│   └── hunt/              # Orbix 666 hunt backend (deployed: orbix-hunt-backend)
├── src/                   # Solidity: AMM, staking, bridge, NFT, launchpad
├── script/                # Foundry deploy scripts
├── web/                   # source of the main dApp frontend
└── VIBE_ARCADE_MASTER_PLAN_V2.md   # this document
```

## APPENDIX B — Live endpoints

| Service | URL | Purpose |
|---|---|---|
| Main site | `https://orbixcore.fun` | Dapp sneak peek + arcade link |
| Arcade rooms | `https://orbix-arcade-production.up.railway.app` | Number Jackpot rooms + WS |
| Hunt backend | `https://orbix-hunt-backend-production.up.railway.app` | Orbix 666 hunt |

## APPENDIX C — Game template parameter schema (for the builder)

```jsonc
{
  "game": "number_jackpot",          // template id
  "name": "My Token Jackpot",
  "branding": { "logo": "url", "primary": "#00ff9d", "banner": "url" },
  "entry": { "token": "0x…", "amount": "100", "maxPerWallet": 3 },
  "reward": { "token": "0x…", "pool": "50000", "fundedBy": "creator" },
  "rules": {
    "range": [111111, 999999],
    "guesses": 20,
    "seconds": 60,
    "rollover": true
  },
  "schedule": { "mode": "always_on" },        // always_on | hourly | scheduled | tournament
  "bots": { "policy": "banned" },             // banned | whitelist | allowed
  "messages": { "win": "You cracked it!", "lose": "So close — run it back" }
}
```

*— End of Master Plan v2.0 —*
