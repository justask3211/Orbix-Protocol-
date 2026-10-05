param(
    [string]$BlenderPath = 'C:\Program Files\Blender Foundation\Blender 3.4\blender.exe'
)
$ErrorActionPreference = 'Stop'
$orbixSessionScript = Join-Path $PSScriptRoot 'session.py'
if (-not (Test-Path -LiteralPath $BlenderPath)) { throw "Blender not found: $BlenderPath" }
$env:DISABLE_TELEMETRY = 'true'
$env:BLENDER_MCP_DISABLE_TELEMETRY = 'true'
$env:BLENDER_MCP_SAFE_MODE = '1'
# Interactive invocation on request. No scheduled service or saved preferences.
& $BlenderPath --factory-startup --python $orbixSessionScript
