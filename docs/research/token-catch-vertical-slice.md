# Sunnydrop Token Catch vertical slice — Phase S

Token Catch exercises every upgraded presentation system: supply pickups,
confirmed loot disappearance, terrain hills, cover, jump/dodge, weapons/combat
and health. Its discovery, practice, live-room launch, loading, reconnect and
results/verified reward paths already exist and remain the same.

Composition: a beach arc and hill loop join the two crossing supply paths inside
the existing 40×40 authority bounds. Ground vertex colors carry sandy routes,
slope stone and green terrain variation; shared procedural normal/grain textures
supply detail without external imagery. Instanced thin stones, flower patches,
inset mosaic and cover rails/panels distinguish routes and the outpost. Warm key,
cool hemisphere, procedural atmosphere and existing horizon trees/water provide
depth with no extra shadow or postprocessing passes. Collision volumes/heights
stay the published field-v1 values. Other games keep their map composition.

Movement uses existing input replay and interpolation. Bounded velocity response
smooths camera lead, gait speed/lean animate acceleration/deceleration, terrain
stance IK aligns feet to slopes and published step tops. Jump and dodge clips
follow accepted state; visual contact windows drive a strike accent. There is no
new client damage, invulnerability, physical cover autostep or velocity rule.
Physical acceleration/autostep/roll displacement changes would require a new
server rules version; they are deliberately not represented as implemented.

Shared confirmed-health delta observers give players and boss the same health
bar, hit intensity and damage numbers. Published movement supplies knockback;
visual recoil/flash never moves the prediction origin. Reduced motion removes
recoil, impact shells, contact accents and look-ahead while retaining damage
numbers, telegraphs and essential movement/grounding.

The absent ChatGPT review cannot substantiate exact Phase 1–4 compliance. This
slice implements the concrete supplied checklist within the authority constraint;
reference-phone/thermal/network and full offline-editor GLB roundtrips remain
follow-up verification. Before/after captures and actual acceptance results live
in framework-validation.md and tools/tests/evidence/rst.
