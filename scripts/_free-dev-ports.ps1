# =====================================================================
# HR Reporting - free the dev ports before restarting (kill only).
# ---------------------------------------------------------------------
# Companion to _restart-services.ps1: that script kills AND relaunches via
# `Start-Process`, which produces detached windows that die as soon as the
# terminal that issued them is torn down (exit 0xC000013A). When the dev
# servers are owned by VS Code background tasks instead, only the KILL half
# is wanted -- VS Code owns the restart.
#
# Sweeps:
#   1. every repo-scoped `node.exe` whose command line mentions `tsx`
#      (`tsx watch` is a supervisor: killing the port holder alone leaves the
#      supervisor alive to respawn a fresh child on the next file edit)
#   2. whatever is actually listening on :3000 and :5173
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/_free-dev-ports.ps1
# =====================================================================

$repoRoot = Split-Path -Parent $PSScriptRoot
$log = New-Object System.Collections.Generic.List[string]
$log.Add("repoRoot = $repoRoot")

function Stop-Tree {
    param([int]$ProcessId, [string]$Reason)

    if ($ProcessId -eq 0) { return }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { 'unknown' }
    $log.Add("  kill pid=$ProcessId ($name) - $Reason")
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

# --- 1. repo-scoped tsx supervisors (backend watcher + its children) ---------
$tsxTargets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$repoRoot*" -and $_.CommandLine -like '*tsx*' }

if ($tsxTargets) {
    $log.Add("[tsx supervisors]")
    foreach ($t in $tsxTargets) { Stop-Tree -ProcessId $t.ProcessId -Reason 'repo-scoped tsx' }
} else {
    $log.Add('[tsx supervisors] none found')
}

# --- 2. port holders --------------------------------------------------------
$log.Add('[port holders]')
foreach ($port in 3000, 5173) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { $log.Add("  port $port already free"); continue }
    foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
        Stop-Tree -ProcessId $procId -Reason "listening on $port"
    }
}

Start-Sleep -Seconds 2

# --- 3. verify --------------------------------------------------------------
$log.Add('[after kill]')
foreach ($port in 3000, 5173) {
    $still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    $log.Add("  port ${port}: " + $(if ($still) { 'STILL LISTENING' } else { 'free' }))
}

$out = Join-Path $repoRoot '_restart-step1.txt'
[System.IO.File]::WriteAllText($out, ($log -join "`r`n") + "`r`n")
Write-Host "wrote $out"
