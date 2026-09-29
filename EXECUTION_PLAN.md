# Orbix full build-out — execution plan (2026-09-29 overnight run)

Autonomy granted by user. Work top-to-bottom. Every item needs real evidence (test output, tx hash, browser readback) before being marked done. Status lives at the bottom.

## W — Wallet & connectivity (frontend core)
1. W1 Injected-wallet connect + auto-restore previous session
2. W2 accountsChanged / chainChanged listeners with UI state
3. W3 Network switch/add 46630 with inline retry
4. W4 Wrong-network banner on every transacting page
5. W5 Balance readout (ETH + FREE) after connect
6. W6 Tx toast notifications: submitted / confirmed / failed, instant
7. W7 Explorer links for every tx hash
8. W8 Central address registry file (no hardcoded dupes)

## S — Swap (complete the flow)
9. S1 Live quote with debounced input refresh
10. S2 Price-impact display
11. S3 Minimum-received + deadline shown before send
12. S4 Allowance check + approve flow (token side)
13. S5 Simulation before broadcast; decoded revert reason
14. S6 Pending state with block confirmation count
15. S7 Success receipt + explorer link
16. S8 Failure state with retry
17. S9 Token→ETH and token→token paths via FREE
18. S10 Browser E2E: quote readback from public page

## L — Launch: deploy + wire
19. L1 Deploy script for OrbixLaunchpad (factory, router, treasury, 0.001 ETH fee, 7d lock)
20. L2 Broadcast to 46630 with vibes-test keystore
21. L3 Bytecode/readback verification of deployed launchpad
22. L4 Record address in DEPLOYMENT.md + setCollateral(FREE, true)
23. L5 Frontend launch form wired to real address
24. L6 Approval + creation-fee tx flow with states
25. L7 Launch receipt: show returned token + pair addresses
26. L8 Readback: fetch getLaunch(id) and render
27. L9 Launch errors surfaced (fee, collateral, lock)
28. L10 Browser E2E on the form (disabled→enabled after deploy)

## B — Bonding curve UI (ORBIX curve, read-only first)
29. B1 Resolve curve via vibevibe launchIdOfToken for ORBIX
30. B2 Curve stats page: raised, target, progress bar, price
31. B3 Quote buy/sell preview from curve contract
32. B4 Buy/sell actions (ORBIX transfers locked pre-graduation — label state clearly)
33. B5 Graduation status + migration receipt display
34. B6 Curve E2E readback

## K — Staking (MasterChef wiring)
35. K1 Pool discovery via poolLength()/poolInfo
36. K2 Staked balance + pending ECO readout
37. K3 LP balance + approval for chef
38. K4 Deposit (stake) flow with states
39. K5 Withdraw flow
40. K6 Harvest flow with pending preview
41. K7 Reward-solvency warning if chef ECO balance < pending
42. K8 Staking E2E readback

## D — Bridge (lock-only, honestly labeled)
43. D1 Bridge page reads BridgeOut config
44. D2 Lock FREE flow: approve + lock(nonce)
45. D3 Transfer ID displayed + explorer link
46. D4 Total locked readout
47. D5 Permanent "destination settlement not live" banner
48. D6 No unlock UI (signer path hidden)
49. D7 Bridge E2E readback

## N — NFT Orbix666 (read + actions where contract supports)
50. N1 NFT page: supply stats per tier (HUMAN/BOT/GPU)
51. N2 Holder check: balanceOf, feeDiscountBps display
52. N3 GPU PoW miner page: salt, difficulty, nonce search, submit
53. N4 BOT burn-to-mint flow (ECO approve + burn price read)
54. N5 HUNT page link to hunt server (:8400) with claim flow
55. N6 Mint receipts + explorer links
56. N7 NFT E2E readback

## M — Marketplace
57. M1 Market page: listings read from OrbixMarket
58. M2 List NFT form (price, approve, list)
59. M3 Buy listing flow with fee display
60. M4 Cancel listing (seller only)
61. M5 Holder discount (25%) applied + shown for Orbix666 holders
62. M6 Listing/activity states (empty, pending, error)
63. M7 Marketplace E2E readback

## P — Pools & liquidity
64. P1 Pool list from factory allPairs
65. P2 Reserves/price readout per pair
66. P3 Add liquidity flow (approve both, router add)
67. P4 Remove liquidity flow
68. P5 LP positions page
69. P6 Pools E2E readback

## I — Indexer / backend API
70. I1 Node service: event watcher for LaunchCreated, Locked, Deposits, Market events
71. I2 In-memory cache + TTL, single upstream RPC loop
72. I3 REST endpoints: /launches /pools /activity /nft-stats
73. I4 Health endpoint
74. I5 Serve frontend + API from one process, port 8302
75. I6 Rate-limit + error handling
76. I7 Frontend Overview consumes live API
77. I8 Restart-survivable (durable JSON state file)

## V — Verification gates
78. V1 forge test 38/38 stays green
79. V2 npm build + node --test green
80. V3 Playwright pass on all new pages at 1440 + 390
81. V4 Console error check on every page
82. V5 All tx flows show real states (no fake toggles)
83. V6 Docs updated: DEPLOYMENT.md, REBUILD_STATUS.md, MASTER_TASKS.md
84. V7 Final live-URL smoke test of every section

## Status
- [x] W1-W8
- [x] S1-S10
- [ ] L1-L10
- [ ] B1-B6
- [ ] K1-K8
- [ ] D1-D7
- [ ] N1-N7
- [ ] M1-M7
- [ ] P1-P6
- [ ] I1-I8
- [ ] V1-V7
