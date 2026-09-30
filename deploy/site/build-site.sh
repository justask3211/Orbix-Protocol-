#!/usr/bin/env bash
# Build and assemble the static bundle that the orbixcore service serves.
#
# Two Vite builds are needed from the SAME source tree:
#   1. the cockpit at /            -> base "/"     delivers /assets/index-*.js
#   2. the Center SPA at /center/  -> base "/center/" delivers /center/assets/index-*.js
# The cockpit's index.html is NOT taken from the build: deploy/site/index.template.html
# is the tracked source (it carries the WIP marquee banner), and this script injects the
# fresh hashed asset refs into it. Without that step the HTML keeps pointing at stale
# filenames and every asset request falls through to the SPA catch-all -> white page.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
OUT="$ROOT/deploy/site"
WEB="$ROOT/web"

echo "==> cockpit build (base=/)"
(cd "$WEB" && npx vite build --base=/ >/dev/null)

echo "==> center build (base=/center/)"
(cd "$WEB" && npx vite build >/dev/null)

# --- center SPA -> deploy/site/center-dist ---------------------------------
rm -rf "$OUT/center-dist"
mkdir -p "$OUT/center-dist"
# the second build above left dist/ with /center/ refs, copy as-is
cp -r "$WEB/dist/." "$OUT/center-dist/"

# --- cockpit -> deploy/site/assets + deploy/site/index.html ----------------
echo "==> assembling cockpit"
rm -rf "$WEB/dist"
(cd "$WEB" && npx vite build --base=/ >/dev/null)
rm -rf "$OUT/assets"
mkdir -p "$OUT/assets"
cp -r "$WEB/dist/assets/." "$OUT/assets/"
# static art the cockpit references by name
for f in card-swap.jpg card-bridge.jpg card-pools.jpg card-launch.jpg card-center.jpg \
         favicon.png orbix-icon-256.png orbix-icon-512.png orbix-icon-1024.png; do
  [ -f "$WEB/dist/$f" ] && cp "$WEB/dist/$f" "$OUT/$f"
done

# regenerate index.html from the template, injecting the hashed refs
python3 - "$WEB/dist/index.html" "$OUT/index.template.html" "$OUT/index.html" <<'PY'
import re, sys
built, template, dest = sys.argv[1], sys.argv[2], sys.argv[3]
html = open(built).read()
refs = re.findall(r'<(?:script|link)[^>]+(?:src|href)="(/assets/[^"]+)"[^>]*>', html)
if not refs:
    raise SystemExit("no /assets/ refs found in the built index.html")
tags = []
for m in re.finditer(r'<script[^>]+src="/assets/[^"]+"[^>]*>\s*</script>|<(?:link)[^>]+(?:src|href)="/assets/[^"]+"[^>]*>', html):
    tags.append(re.sub(r'>\s*</script>$', '></script>', m.group(0).strip()))
tpl = open(template).read()
if "<!--ASSET_REFS-->" not in tpl:
    raise SystemExit("template is missing the <!--ASSET_REFS--> placeholder")
open(dest, "w").write(tpl.replace("<!--ASSET_REFS-->", "\n  ".join(tags)))
print(f"injected {len(tags)} asset refs")
PY

echo "==> done: $OUT"
