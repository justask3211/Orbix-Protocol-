# Experience and reusable prompts

## Design direction

Build a stylized arcade world with saturated color families, expressive silhouettes, soft readable lighting and tactile controls. Color distinguishes games and states, while typography, spacing, navigation and settlement language stay coherent. Avoid uniform neon gradients as a substitute for art direction. Use a small intentional palette per game, rather than limiting the whole center to one accent.

Create distinct screen compositions for center discovery, game home, practice, create/join, lobby, scene loading, countdown, active match, pause/reconnect, contextual hints, results and rewards. Keep admin operations discoverable to authorized users without making the player interface an administration console.

Suggested starting worlds are a candy-colored obstacle island for Runner, toy-box maze for Maze, and floating card observatory for Memory. These are proposals to prototype, not approved final artwork. Keep Typing and other text games readable; a 3D environment must serve their mechanics.

## Art-direction prompt

"Inspect Orbix's existing [game] engine and client. Develop a joyful [world] with a distinct silhouette language, [palette], camera and sound identity. Show a complete desktop and mobile screen map: discover, practice, create/join, lobby, load, countdown, play, hints, reconnect, results and verified rewards. Define shared shell tokens and game-specific exceptions. Build one reviewable vertical slice without inventing rewards or player counts. Use authentic gameplay objects and legible controls, with reduced-motion support and a practical mobile quality tier."

## Character brief

"Create a coherent stylized Orbix character family for [game], with identifiable silhouettes at gameplay distance. Specify dimensions/units, rig naming, grounded root, collider, texture atlas, approximate mobile asset budget, and idle/walk/run/jump/land/celebrate clips. Produce a GLB and source/license manifest. Preview neutral pose and animation transitions. Keep imported animations compatible with the skeleton; verify clip names instead of assuming them."

## UX and motion

Use motion to communicate cause and state: ready feedback, countdown, movement, collision, progress and result. Keep decorative movement subordinate to play and respect prefers-reduced-motion for nonessential effects. Unlock audio after a user gesture, offer mute and volume, and avoid sudden autoplay.

Provide keyboard focus, semantic DOM controls, adequate contrast, comfortably sized touch controls, safe-area support and readable HUDs. Keep essential instructions outside Canvas; expose a useful fallback if WebGL is unavailable. Loading progress is real bytes/assets when measurable; otherwise use a named stage instead of fabricated percentages. A ready shell should not wait for every game asset.

Keep the create flow short, with defaults and an advanced section. Joining a room should explain eligibility, required token amount and wallet action before submission. Lobby feedback should show actual presence, ready state and start conditions. Hints should relate to current gameplay and be reachable without obscuring controls.
