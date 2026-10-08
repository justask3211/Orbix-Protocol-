# October 8: Center bug fixes and arcade UX upgrade

User request: eight tasks in order, checks and a commit after each, final push
from master to main, no pull and no Railway deployment. Starting revision b8fa68e8.
The Orbix engineering and design taste skills inform the existing arcade style.
No external art or new game/money rules are authorized by this work.

## Task 1 — profile images

Reproduction: the real authenticated image POST returned FUNDED_DISABLED (409)
for every valid raster and malformed input: 11 new regressions failed before fixes.
Code-path inspection also found unchecked null canvas exports, missing reader
errors, selection races, stale previews/cache, a modal flag never fetched,
UPDATE-only avatar persistence before profile creation, arbitrary bytes stored
as WebP, unsafe address input, and truncating concurrent writes.

Fixed bounded PNG/JPEG/WebP decoding, center crop and 256-square WebP conversion
with Pillow; unique temp files and atomic replacement; complete-byte responses
with revalidation/ETag; wallet address validation; avatar upsert/public flag.
The UI handles failed canvas/reader operations, clears old selections, prevents
selection/upload races and refreshes header/profile metadata immediately.
Removed the unrelated funded gate only from profile images. Payment authority
and financial flags are untouched. Added Pillow to deployment requirements.
Repaired the pre-existing npm lockfile omission of a required TypeScript peer.

Evidence: 505 Python tests passed (center + community); tsc -b --noEmit and
npm run build passed. Canvas error/crop regression passed. Local Chromium
verified actual PNG selection/crop/export/POST, header avatar, reload and modal
reopen. Concurrent writes, strict bad-input rejection, limits and auth tested.
Production volume permissions/availability remain untested; no live upload made.
