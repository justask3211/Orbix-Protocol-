# Orbix Blender authoring prerequisites

This setup reuses the installed Blender 3.4.1. The unofficial MIT server is
`mcp-for-blender==2.1.8`, installed in an isolated Python 3.11 environment:

```text
C:\Users\santh\.codex\orbix-tooling\blender-mcp\.venv
C:\Users\santh\AppData\Roaming\Blender Foundation\Blender\3.4\scripts\addons\blender_mcp.py
```

The addon file is installed but not enabled in saved Blender preferences. To open
an authoring session with it loaded for that process, run:

```powershell
.\tools\game-lab\blender\launch.ps1
```

In Blender's 3D viewport, press `N`, open **MCP for Blender**, and start its server
when needed. Keep Blender open while using its MCP tools. The bridge stays on
localhost; stop it from the same sidebar when finished. Paid generation providers
and automatic bridge startup remain disabled by the session helper.

Run the repeatable isolated verification:

```powershell
& "$env:USERPROFILE\.codex\orbix-tooling\blender-mcp\.venv\Scripts\python.exe" .\tools\game-lab\blender\verify.py
```

Verification checks addon registration, a named mesh and material, a valid GLB,
real MCP initialization, tool enumeration, scene inspection, an allowed `bpy`
script, and rejection of an `os` import by safe mode. Output stays
under `.codex/orbix-tooling/blender-mcp/artifacts`, outside the application repo.
The verifier terminates only the Blender subprocess it launches. It starts from
factory defaults and never loads, saves or modifies existing scenes/preferences.

Upstream disables its native socket bridge in `--background` because Blender
timers cannot dispatch commands there. The verifier therefore uses a bounded,
test-only localhost socket that dispatches the installed addon's commands on the
main thread; this is not verification of interactive viewport rendering.

Set MCP server environment `BLENDER_MCP_SAFE_MODE=1`, `DISABLE_TELEMETRY=true`,
`BLENDER_MCP_DISABLE_TELEMETRY=true`, and `PYTHONUTF8=1`. Safe mode is an MCP-side
script validator, not an operating-system sandbox: the unauthenticated localhost
addon socket and permitted Blender file operators retain broad access. Keep
asset writes in approved project authoring folders and do not expose the bridge
on a network. Only one plugin/server entry should connect to a given Blender.

`requirements.lock.txt` records the exact installed Windows Python 3.11 package
set. Recreate it in a fresh venv with `uv pip install --python <venv-python>
-r tools/game-lab/blender/requirements.lock.txt`. Installed addon SHA256:
`eb0facf69781a30e69792532087d8d41c6a14fcd323353250abe7988ee297fa5`.

Sources: [upstream](https://github.com/ahujasid/mcp-for-blender),
[safe-mode implementation](https://github.com/ahujasid/mcp-for-blender/blob/main/src/blender_mcp/safe_mode.py),
[privacy settings](https://github.com/ahujasid/mcp-for-blender/blob/main/TERMS_AND_CONDITIONS.md).
