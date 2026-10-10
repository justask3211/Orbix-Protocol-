# Orbix Center build validation

## Phase 1

Version 2 trusted-server duel sealing retains the private SHA-256 preimage and resolves on logical deadlines. Version 1 reducers remain selectable for existing rooms and snapshots. New UI has no reveal action; legacy UI remains for version 1. Runtime checkpoints timed transitions atomically with snapshot/input, reads the durable round-scoped transcript, and enters recovery if observed service/scheduler gaps reach one full selection window. Player disconnects do not trigger recovery.

Validation: 164 focused legacy/duel/practice/result tests passed; 61 version-2 vectors and zero-client restart/outage tests passed; room integration tests passed apart from an invalid-address fixture corrected before rerun; TypeScript passed. Full center regressions also run throughout the build.

Deliberate fixture changes: test_engines, test_late_engines, test_full_rounds, test_duel_hints, test_game_world_mechanics and the drawn-duel case in test_result_placements now explicitly pin template_version=1 for historical manual reveal semantics. New version-2 behavior is covered in test_sealed_duel. Financial allocation code is unchanged.

Device/browser support and performance targets remain measurement requirements, not claims based on headless/source checks. No Railway deployment.
