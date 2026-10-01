## 2026-10-01 Design system and audit pass

- Installed Vercel Web Interface Guidelines review skill and refreshed its current command checklist.
- Installed getdesign.md Vercel reference as `VERCEL_DESIGN_REFERENCE.md`; added Awesome Design MD collection to the taste skill references.
- Added Orbix-specific source of truth `DESIGN.md` and `docs/center/DESIGN.md`. Vercel is used as a quality reference, not copied blindly: Center remains dark, game-first and trust-oriented.
- Browser audit evidence: desktop Center rendered 19 formats and real creator routes; create wizard exposed format → room → per-game rules → vault/rewards; mobile 390px showed wallet controls extending beyond the visible header row; global copy incorrectly said all balances/rewards were simulated; Number Hunt was the only configurable public/private hint feed.
- Implemented this pass: mode-truth banner, dynamic catalog count, truthful hero copy, skip link + main landmark, consistent focus-visible styling, mobile two-row header/wallet layout, stronger reduced-motion block, game-specific hint policy panel with honest inactive states, and documented Orbix design tokens/flows.
- Verification: TypeScript clean, Vite build clean, 117 Python tests green. Live deployment still requires the normal site deploy and post-deploy browser verification.
