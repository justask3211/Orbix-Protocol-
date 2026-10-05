---
name: orbix-game-engineering
description: Design and implement Orbix browser game environments, character animation, multiplayer movement, loading, and wallet reward UX in its React/Vite and Python architecture. Use for Orbix game-center work and its 3D asset pipeline.
---

# Orbix game engineering

The product is a colorful, joyful arcade where gameplay distributes tokens through verified settlement. The user's current vibrant brief supersedes older restrained graphite/orange design guidance. Begin with the actual game, audience, controls, camera and emotional identity. Avoid a generic crypto dashboard or applying landing-page taste rules to real-time gameplay.

For screens/art direction, read [experience.md](references/experience.md). For movement, assets, multiplayer and measurements, read [engineering.md](references/engineering.md). The repository's `GAME_DEVELOPMENT_GUIDE.md` records installed tools, sources and verified limits.

## Working method

1. Inspect the selected game's engine, room events, client component and actual player flow. Reuse contracts and server authority; do not treat the existing reward path as audited merely because it exists.
2. Give one flagship game a complete vertical slice: discovery, practice, create/join, lobby, loading, countdown, play, hints, results, settlement and replay. Distinguish these states in navigation and UI.
3. Keep the shared center shell consistent while giving each game its own environment, sound palette, camera, props and HUD. Preserve readable controls and trustworthy wallet states across themes.
4. Prototype graphics in `tools/game-lab` first. Its React 19 dependencies are isolated; check production React and Vite compatibility before integration. Do not copy dependencies into production blindly.
5. Verify real input, scene rendering, reconnect, resource cleanup and relevant asset formats. Measure the intended phone/browser/network and report observed performance rather than promise zero lag.

Only confirmed server outcomes can become rewards. Show distinct states for score/result, settlement pending, claim available, wallet signature, transaction submitted, receipt confirmed and failure; map them to the implemented API. Never label submitted transactions or optimistic client events as funds received. No blockchain requests in the render/simulation loop.

Community skills are references, not authoritative APIs. Check current primary documentation for version-specific code, and apply local corrections supplied with the five Three.js reference skills. Use frontend-design/ui-design for the game shell, React best practices for browser components, and taste-skill only when its landing-page scope fits.
