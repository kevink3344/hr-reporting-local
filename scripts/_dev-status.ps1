# Status of the HR Reporting dev servers + their scheduled tasks.
#
# NOTE: never use Invoke-WebRequest here -- PowerShell 5.1 raises an interactive
# "Security Warning: Script Execution Risk" prompt that silently stalls the
# terminal and backgrounds the command. curl.exe with -o does not prompt.
#
# The report is flushed after every section so a mid-run teardown still leaves
# whatever was gathered.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/_dev-status.ps1

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $repo '.logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$out = Join-Path $logs 'dev-status.txt'
$L   = New-Object System.Collections.Generic.List[string]

function Say($t) {
    $L.Add($t)
    [System.IO.File]::WriteAllText($out, ($L -join "`n") + "`n")
}

Say "=== $(Get-Date -Format 'o') ==="
Say ''

foreach ($svc in @(@{n='HR-Reporting-Backend'; p=3000}, @{n='HR-Reporting-Frontend'; p=5173})) {
    $t = Get-ScheduledTask -TaskName $svc.n -ErrorAction SilentlyContinue
    if (-not $t) { Say "$($svc.n): NOT REGISTERED"; continue }
    $i = $t | Get-ScheduledTaskInfo
    $conn = Get-NetTCPConnection -LocalPort $svc.p -State Listen -ErrorAction SilentlyContinue
    Say ("{0}: state={1} lastResult={2} lastRun={3} listening={4}" -f `
        $svc.n, $t.State, $i.LastTaskResult, $i.LastRunTime, [bool]$conn)
}

Say ''
Say '=== ports ==='
$listen = Get-NetTCPConnection -LocalPort 3000,5173 -State Listen -ErrorAction SilentlyContinue
if ($listen) {
    foreach ($c in $listen) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        Say ("  {0} -> pid {1} ({2})" -f $c.LocalPort, $c.OwningProcess, $p.ProcessName)
    }
} else { Say '  (nothing listening on 3000 or 5173)' }

Say ''
Say '=== http (curl.exe) ==='
foreach ($u in @('http://localhost:3000/api/health', 'http://localhost:5173/')) {
    $code = (& curl.exe -s -o $null -w '%{http_code}' --max-time 7 $u) 2>$null
    Say ("  {0} -> HTTP {1}" -f $u, $code)
}

Say ''
Say '=== logs ==='
Get-ChildItem $logs -ErrorAction SilentlyContinue |
    Select-Object Name, Length, LastWriteTime |
    ForEach-Object { Say ("  {0,-24} {1,7} bytes  {2}" -f $_.Name, $_.Length, $_.LastWriteTime) }

Say ''
Say '--- backend.log (tail 12) ---'
Get-Content (Join-Path $logs 'backend.log') -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { Say "  $_" }
Say '--- frontend.log (tail 12) ---'
Get-Content (Join-Path $logs 'frontend.log') -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { Say "  $_" }

Write-Host "wrote $out"
