# Session Memory — Codex 2

**Date/time:** 2026-10-08 ~20:00–22:30 UTC (VPS local)
**Author:** Codex CLI (model `gpt-6.1-sol`, reasoning effort high) on the VPS, launched by the Hermes agent session
**Repository:** `/home/agentuser/vibeswap` → `github.com/justask3211/Orbix-Protocol-`
**Start revision:** `b8fa68e8` · **End revision:** `d6cd14ae` (8 commits) · **Deploy:** Railway (both services)

This file records the second Codex-driven upgrade pass on the Orbix Center: what the
user asked, what changed, why, where and when. It is written because the user
requires a session memory for every full upgrade round, pushed to GitHub.

---

## User instruction (verbatim intent)

> "Now I already used another chatgpt codex account to built our orbix website and
> improved, if we search and analyse the GitHub we used for orbix u can see update
> and prompt and md from other codex section, so sync with it and continue upgrade
> from everytime in memory the state it left read all and use it, now use model
> gpt 6.1 sol, high effort for our upgrade, the codex rebuilt website game and more,
> now I want to fix some bugs and glitch,
>
> first the profile image upload have bug fix all that related,
> next after match finished and winner celebration all comes in down, user need to
> scroll down see all, so if match finishes immediately auto scroll down to podium
> and say congratulations if the winner user and others shows result like that,
> next very big things, it have 3d game movement and improvement, I need to extract
> all from stumble guys game I need like stumble guys like graphics, movement
> because the movement here is so buggy glitch, due to ma delay? or what find all
> and fix, next gun and powers and powerup shield are like basic gem instead give a
> image or 3d item pickup if shield shield like one, next the game characters are
> robot, I need stumble guys style smooth cartoon animated characters same design
> apply, for the 3 4 games duel 2 vs 2, boss raid, token collector or catcher
> something, next mainly fix the wizard for creator token addition, it's simple give
> a good wizard section creator token fees add on, telling how it works clear
> contract interaction and wizard for room rewards what's the rewards type how
> creator setup and all graphical, rewards user wizard signup transaction and all
> improve, next the room id is so small I tell only numbers but not small, because
> random can join make it greater than 6 character, improve admin panel with same
> images of game, all this check GitHub its status skills used install that skills,
> use all, all this on codex, gpt 6.1 sol high"

**Intent summary:** continue the project from the state the previous Codex session
left on GitHub; fix specific defects (profile image upload, winner-result scroll,
glitchy 3D movement, primitive power-up pickups, robot-looking characters, thin
creator-token/reward wizard, too-short room IDs, plain admin panel) and raise the
presentation toward a Fall Guys / Stumble Guys cartoon-arcade quality bar — without
breaking server authority or money flows.

**Constraints given to Codex:** work the eight items in order, test after each
(`tsc -b --noEmit`, `npm run build`, pytest), commit after each, English only, no
copyrighted game assets, do not silently change money/server rules, push to GitHub
at the end but do not deploy.

---

## What changed, why and where

All work is in the repo; each item is one commit on `main` (pushed `master → main`).

### 1. `eea0f48e` — profile image upload (fix)
- **Why:** the real authenticated image POST returned `FUNDED_DISABLED` (409) for
  every valid raster, so no avatar could ever upload; plus 9 further defects found
  by code-path inspection.
- **Where:** profile/avatar API + storage (`center/` profile image endpoints,
  `deploy/center/requirements.txt`), frontend avatar/canvas upload path
  (`web/src/center/`), profile modal refresh.
- **How:** bounded PNG/JPEG/WebP decode + center-crop + 256² WebP via Pillow;
  unique temp files + atomic replace; complete-byte responses with ETag/revalidate;
  wallet-address validation; avatar upsert; removed the unrelated funded gate from
  the profile-image path only. UI: handle canvas/reader failures, clear stale
  selection, prevent races, refresh header/profile immediately. Also repaired a
  pre-existing npm lockfile omission of a required TypeScript peer.
- **Evidence:** 11 new regressions (failed before, pass after); 505 Python tests;
  tsc + build; local Chromium PNG select→crop→export→POST→header→reload→modal.

### 2. `dcf52cdb` — auto-scroll to podium + greeting (fix)
- **Why:** the finished-match podium/results mounted below the viewport and the
  user had to scroll manually; a lazy-mount layout race made a naive scroll land
  short.
- **Where:** `WinnerCelebration.tsx` + room result view (`web/src/center/`).
- **How:** stable result anchor focused+scrolled once per round **after** the lazy
  celebration DOM mounts; reduced motion → instant scroll. Winner sees
  "Congratulations"; others see their server rank (e.g. "You placed #9"), raid
  crews see placement, full server-ranked results below. No client winner math.
- **Evidence:** 7 presentation regressions + 14 verified-podium cases; 505 Python
  tests; tsc/build.

### 3. `08bbea01` — movement prediction + interpolation (fix, largest)
- **Why:** V4 worlds felt delayed/stuttery — the PoseMotion extrapolator reset
  "age" on every state patch (even non-position patches) then damped toward the
  changing target; there was no remote snapshot buffer; body "moving" flags ran
  feet into walls; run playback ignored real speed; a selected action never
  updated its `timeScale`; combat/jump cues read a frozen snapshot clock; camera
  damping added lag; unrestricted camera turns eventually failed server validation.
- **Where:** new `web/src/center/worlds/motion.ts`, `WorldScene.tsx`,
  `SkeletalActors.tsx`, V4 snapshot fields server-side (presentation metadata
  only).
- **How:** immediate local direction integration + bounded 64-input send history +
  replay from acknowledged positions + bounded-rate correction easing; V4 public
  snapshots carry accepted input direction/lease/timestamp; opponents use a 100 ms
  buffer with ≤150 ms extrapolation; respawn/large corrections snap; prediction
  stops after 250 ms without authority sample; bounded speculative jump; yaw wrap;
  FPV follows predicted root, TPV settles faster; animation cadence calibrated to
  measured GLTF stance-foot velocity (Run 5.12, Sprint 8.57 u/s). 30 Hz sim, 10 Hz
  broadcast, speed/gravity/collision/health/inventory/money remain server-owned.
- **Evidence:** 9 netcode regressions; real GLTF/StrictMode/Kick/lifecycle test;
  synthetic 120 ms RTT + 0–35 ms jitter at 30/60/144 Hz (initial 0.256-unit
  backward correction reproduced then removed); min per-frame forward movement
  0.1167/0.0583/0.0243 units; 506 Python tests; tsc/build; Chromium rendered all
  three V4 practice worlds with held-key movement/jump/stop.
- **Unproven:** real-device FPS, extended human multiplayer under loss/jitter,
  perfect contact on every retargeted animation.

### 4. `745791aa` — real item pickups + equipment (feature)
- **Why:** shields/guns/power-ups rendered as plain gems.
- **Where:** new `ItemAssets.ts` + `ItemMeshes`, `SkeletalActors.tsx` grip bones.
- **How:** nine original merged colored meshes (6,656 tris: coin, bomb, shield,
  toy blaster, medkit, boxing glove, battery, sword, spear) with scale-pop,
  hover-bob, shader dissolve on authoritative removal; `hand_r`/`hand_l` drive
  actual grip position/orientation in both LODs; gun axis checked against
  PistolAim's wrist basis. No stats/logic/collision/money changed.
- **Evidence:** geometry/buffer/triangle/wrist/dissolve + skeletal lifecycle
  regressions; 506 Python tests; tsc/build; Chromium Duel render.

### 5. `01f9ce10` — cartoon character restyle (feature)
- **Why:** characters read as robots; user wants Stumble Guys-style smooth cartoon.
- **Where:** new `cartoonStyle.ts`, material handling in `SkeletalActors.tsx`.
- **How:** shared peach/cyan/lime/lilac suit palettes, light armor, existing team
  accent rules; only actor-owned Suit/Armor/Accent materials lose tactical maps
  and gain matte roughness + soft contour shading. Face/skin/eyes, source
  textures, skeletons, clips, cached geometry untouched; rig scale preserved so
  bones/attachments stay valid; both LODs + podium styled.
- **Evidence:** all four cosmetic IDs + both GLBs pass tint/phase/cadence/
  idle/Kick/lifecycle regressions; 506 Python tests; tsc/build; Chromium render.

### 6. `424af73b` — creator token + reward wizard explanations (feature)
- **Why:** the creator-token fee section was too plain; the user wants it
  graphical with a clear explanation of the contract interaction, and the same
  for room rewards.
- **Where:** wizard step 4 (`wizardForms.tsx` + wizard CSS).
- **How:** live illustrated diagram of ERC-20 selection → whole-token entry
  amount → joiner approval/payment → creator/custom/burn destination; a contract
  strip explaining allowance approval then `join(roomId)` with publish/binding
  kept separate; burn copy describes an unavailable destination (no false
  totalSupply claim); reward types and claim modes illustrated with Lucide icons
  and original CSS (no diagram library).
- **Evidence:** tsc/build; responsive wizard layout browser check.

### 7. `6eb2f910` — six-digit room codes (fix)
- **Why:** room IDs were 3 digits (user said too short/guessable; random users
  could join). User asked for greater than 6 characters.
- **Where:** `room_codes` allocation + `/rooms/resolve/{code}` (`center/room*.py`),
  frontend share/join assumptions.
- **How:** allocation now starts in the 6-digit range; uniqueness enforced by DB
  constraint with retry; legacy short codes remain resolvable; resolve stays
  navigation-only and never bypasses invite/paid-entry verification.
- **Evidence:** allocation + legacy-compat regressions; 508 Python tests.

### 8. `d6cd14ae` — admin panel upgrade (feature)
- **Why:** user asked for game images in the admin panel and a better layout.
- **Where:** `AdminPanel.tsx`, new `adminGames.css`.
- **How:** game cards now use the banner art (`GameBanner`, reusing the SCENES
  art) beside each template's availability controls; live room overview with
  running/waiting filters and counts; validated fee drafts (creator/joiner) with
  change tracking; signed `X-Admin-Proof` flow and audit trail preserved.
- **Evidence:** browser checks on responsive admin layouts; tsc/build.

---

## Verification performed

- **508 Python tests** passed (center + community suites).
- **`tsc -b --noEmit`** and **`npm run build`** passed.
- **Local Chromium** checks: avatar upload→reload, podium auto-scroll, all three
  V4 worlds render and accept movement/jump/stop, wizard + admin responsive.
- **Not performed (honest gaps):** physical-phone performance, sustained human
  multiplayer, live funded transactions on-chain.

## Invariants held

- Server authority over movement, hits, scores, winners, inventory and money was
  not moved to the client (only presentation metadata was added to snapshots).
- No copyrighted game assets were used; art is original geometry plus the existing
  CC0 Quaternius-derived rig.
- No reward/economy rule was changed by this pass.

## Deployment

Deployed to Railway by the Hermes agent session after this file was pushed:
- `orbixcore` (static site + Center SPA)
- `orbix-center` (Python API)

---

## 2026-10-09 — Phase F: funded rewards client flow

**User intent:** "creator sets auto claim, winner gets claim prompt + claim later code redeemable against the same contract".

**What / why:** Added confirmed creator funding and durable room ↔ RewardEngine pool binding; a CreatorEconomy-style funding strip and winner preview; winner claim cards, signed wallet-bound codes, and profile My rewards with lookup/list/claim. Browser wallets use the deployed methods, approve only when needed, simulate calls and wait for status `0x1` receipts. The backend verifies creator, room key, mode, deadline, receipt deposit event and exact pool inventory before publishing. Claims are indexed by winner and verified on chain, including the exact claim simulation. Retries keep the original funding intent and pending hashes. Errors explain allowance, rejection, RewardEngine selectors and ORBIX curve lock.

**Where:** `center/reward_flow.py`, API/schema/settlement/store integration, `FundedRewards.tsx`, `rewardWallet.ts`, `fundedRewards.css`, client API, wizard/results and profile integration. Full details and evidence: [Phase F record](2026-10-09-phase-f-funded-rewards.md).

**Contract constraints:** The requested Auto prompt uses Code mode on the same engine because deployed Auto cannot redeem a code. Creator-only `setAllocation` is exposed as a confirmed host-wallet step after authoritative results. Merkle recipients must be committed before funding. Open pools do not reserve rewards for winners. Private-key delivery remains unimplemented; its UI explains off-chain setup and blocks publishing it as a funded pool.

**Verification:** 525 pytest tests, 15 mocked-wallet tests, `tsc -b --noEmit` and production build passed; desktop/390/320 px Chromium verified the non-money UI. Live `eth_call` verified RewardEngine authority and zero pool count on Robinhood 46630; pool/claim paths used mocked chain readers. **No live transactions were performed. No Railway deployment.** Unrelated pre-existing source and build edits were excluded from these commits.

## 2026-10-09 — Phase G + H: waitlist collection and wallet overhaul

User intent (verbatim summary): waitlist collection option + wallet import/recovery + connector overhaul.

Phase G adds optional `waitlist.enabled` and a creator message of up to 280 characters. After an authoritative finished match, every actual participant can explicitly submit any valid EVM address; no address is collected automatically, and no reward is promised. The first entry is retained per player per room. Owner-only JSON and CSV reads include submission/unique-address counts, with durable rate limiting and hash-chain audit entries. Step 4, results and creator room listings expose the flow. Waitlist metadata does not alter gameplay or settlement commitments.

Phase G checks: eight backend regressions pass (disabled/bounds, winner and non-winner, arbitrary address, validation, explicit submission, dedupe, persistence, owner-only CSV/JSON, rate limit and audit integrity); `tsc --noEmit` passes. Final full-suite and browser evidence will be recorded with Phase H. Existing working-tree edits and generated artifacts were present at task start and are preserved outside the phase commit.
