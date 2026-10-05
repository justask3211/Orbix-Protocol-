# Free starter character assets

One small [Kenney Animated Characters Protagonists](https://kenney.nl/assets/animated-characters-protagonists)
pack is installed in the local development cache:

```text
C:\Users\santh\.codex\orbix-tooling\assets\kenney-animated-characters-protagonists
```

The official download was **581,441 bytes**; archive SHA256:
`ec3787de70fa2200256848d74201b10f6b6c3126594e9857bf989753312c2b84`.
All archive paths were validated before extraction. `asset-pack.json` records
the exact URL, license, original file inventory and hashes. Every original
was subsequently compared with its ZIP entry and remains unchanged.

The embedded `License.txt` explicitly permits personal, educational and
commercial use under [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
Credit to Kenney is optional. No payment, donation, account or API key was used.
The embedded license identifies version 1.1; the webpage update list says 1.0.

## What is available

- One FBX character mesh: 804 vertices, 826 faces, 58 bones, 32 weighted groups.
- Four PNG skins and their editable SVG sources: criminal male, cyborg female,
  skater female and skater male.
- Separate FBX clips: Idle (32-frame span at 30 FPS), Run (16 at 24 FPS),
  Jump (12 at 24 FPS), plus targeting poses used in each animation source.
- A separate derived GLB with the skater female skin, embedded texture and
  58-joint rig: `derived/skater-female-rigged.glb` (131,596 bytes).

The original pack contains **no GLB**. The derived GLB is an authoring starter
and contains **no animation clips**. Identical bone names do not establish
matching rest transforms: a direct clip-transfer check found differing bind
poses and was rejected. Animation integration requires deliberate retargeting
and visual review. Structural GLB checks passed; browser appearance, animation
and gameplay suitability have not been visually approved.

## Reproduce local inspection and derived export

From the repository root, with the source cache present:

```powershell
$orbixBlender = 'C:\Program Files\Blender Foundation\Blender 3.4\blender.exe'
$orbixAssetCache = "$env:USERPROFILE\.codex\orbix-tooling\assets\kenney-animated-characters-protagonists"
& $orbixBlender --background --factory-startup --python-exit-code 1 --python .\tools\game-lab\assets\inspect_kenney.py -- --root $orbixAssetCache
& $orbixBlender --background --factory-startup --python-exit-code 1 --python .\tools\game-lab\assets\convert_kenney.py -- --root $orbixAssetCache
python .\tools\game-lab\assets\record_inventory.py --root $orbixAssetCache
```

Derived output stays in the cache. These scripts leave original assets and
saved Blender scenes/preferences untouched. Future game integrations should
copy only reviewed assets into the application's asset tree, retain provenance,
and apply project texture/geometry budgets before serving them to players.
