param(
    [ValidateSet('install', 'dev', 'build', 'verify', 'audit', 'assets:inspect', 'assets:optimize')]
    [string]$Action = 'verify',
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ToolArguments
)
$ErrorActionPreference = 'Stop'
$runtimeNode = 'C:\Users\santh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$npmCli = 'C:\Users\santh\.codex\orbix-tooling\npm\node_modules\npm\bin\npm-cli.js'
if (!(Test-Path -LiteralPath $runtimeNode) -or !(Test-Path -LiteralPath $npmCli)) {
    throw 'Verified Node 22.12+ and npm are required. Update these local runtime paths before running.'
}
# Scope PATH to this process so npm child processes use the compatible bundled Node.
$originalPath = $env:PATH
Push-Location $PSScriptRoot
try {
    $env:PATH = (Split-Path -Parent $runtimeNode) + ';C:\Users\santh\.codex\orbix-tooling\npm\node_modules\.bin;' + $originalPath
    if ($Action -eq 'install') { & $runtimeNode $npmCli ci --ignore-scripts }
    elseif ($Action -eq 'audit') { & $runtimeNode $npmCli audit --audit-level=high @ToolArguments }
    else { & $runtimeNode $npmCli run $Action -- @ToolArguments }
    if ($LASTEXITCODE -ne 0) { throw "Game lab $Action failed with exit code $LASTEXITCODE." }
} finally {
    $env:PATH = $originalPath
    Pop-Location
}
