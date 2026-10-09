# V4 graphics depth — 2026-10-09

All three featured action games share FieldEnvironment and SkeletalActors, while preserving courtyard / guardian sanctuary / seaside outpost identities. Existing collision cover is drawn from server obstacle volumes; scenery beyond the boundary is presentation only. Original vertex wind animates instanced crowns and grasses without per-frame instance uploads. One 24-instance horizon batch supplies birds, guardian motes or outpost kites. Reduced motion freezes ambient animation. Confirmed hit cues layer a decaying procedural recoil above disjoint upper/lower skeleton tracks. Existing crossfades, LoopOnce cues, gait synchronization, distance rig detail and 20 Hz distant mixer updates are retained. No score or reward logic moved to the browser.

Duel, Boss Raid and Token Catch all pass through GameWorld's renderer-loading and character/terrain-loading overlays. Loading reports stages rather than fabricated percentages. Native fullscreen/mobile immersion partial work was retained; phone play requires landscape with clear notice that live rounds continue. Results retain responsive portrait/landscape podiums.

Three original raster banners now match V4's grounded worlds and warm lighting; fallback/admin SCENES also reflect those palettes and landmarks. Art provenance is in web/public/center-art/provenance.json. Built-in image_gen created the pictures; ffmpeg only downscaled/encoded 960 × 640 WebP. No assets were imported from research references.

## Techniques studied and adopted

- [Three.js additive skinning example](https://threejs.org/examples/webgl_animation_skinning_additive_blending.html): separate animation influences rather than replacing locomotion for every attack. Orbix keeps its existing disjoint track layers and adds presentation recoil without moving the controller root. Example model assets were not copied.
- [Three.js dynamic instancing source](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_instancing_dynamic.html): bounded batches with a reused transform and explicit matrix uploads. Adopted for horizon life; static foliage uses a shader uniform instead of CPU matrix rewrites.
- [Fiber scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance): cached geometry, selective detail, demand rendering for still scenes, practical draw-call budgets. Existing DPR 1 / 1.5 / 2 and desktop-only shadows remain.
- [pmndrs ecctrl](https://github.com/pmndrs/ecctrl) / installed lab source: camera boom and movement-animation separation. Existing reconciled camera/actor positions remain authoritative; no additional physics engine introduced.

Lighting retains a warm key, cool hemisphere/fill, fog horizon and contact shadows rather than a costly postprocessing stack. Particle economy stays bounded to a single new 24-instance batch. This pass adds no terrain triangles or downloaded textures. Loading and browser evidence are recorded in the session report; software Chromium measurements do not establish physical phone FPS.
