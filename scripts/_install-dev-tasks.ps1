# Register + start the HR Reporting dev servers as Windows scheduled tasks.
#
# WHY a scheduled task: every server launched from a VS Code agent terminal dies
# with that terminal's job object (observed: frontend.log ending in "^C^C", and
# a detached Invoke-CimMethod launch with the same fate). Task Scheduler runs
# the process under the Schedule service, so it survives terminal teardown.
#
# WHY these settings:
#   AllowStartIfOnBatteries + DontStopIfGoingOnBatteries
#     The default DisallowStartIfOnBatteries=$true leaves the task stuck in
#     "Queued" forever on a laptop that is not plugged in. This was the actual
#     bug on the first attempt.
#   ExecutionTimeLimit 0
#     A dev server runs indefinitely; the default PT72H would kill it.
#   MultipleInstances IgnoreNew
#     Prevents a crowd of competing watchers on repeat runs.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/_install-dev-tasks.ps1

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $repo '.logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

$report = New-Object System.Collections.Generic.List[string]
function Say($t) { $report.Add($t); Write-Host $t }

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$svcs = @(
    @{ Name = 'HR-Reporting-Backend';  Script = '_run-backend.cmd';  Port = 3000 },
    @{ Name = 'HR-Reporting-Frontend'; Script = '_run-frontend.cmd'; Port = 5173 }
)

foreach ($svc in $svcs) {
    $existing = Get-ScheduledTask -TaskName $svc.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Stop-ScheduledTask -TaskName $svc.Name -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $svc.Name -Confirm:$false -ErrorAction SilentlyContinue
    }

    $action = New-ScheduledTaskAction -Execute (Join-Path $repo "scripts\$($svc.Script)") `
        -WorkingDirectory $repo
    Register-ScheduledTask -TaskName $svc.Name -Action $action -Principal $principal `
        -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $svc.Name
    Say "registered + started $($svc.Name)"
}

# --- wait for both ports -------------------------------------------------
$deadline = (Get-Date).AddSeconds(60)
$pending = @(3000, 5173)
while ((Get-Date) -lt $deadline -and $pending.Count -gt 0) {
    $pending = @($pending | Where-Object {
        -not (Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue)
    })
    if ($pending.Count -gt 0) { Start-Sleep -Milliseconds 1000 }
}

Say ''
Say "=== $(Get-Date -Format 'o') ==="
foreach ($svc in $svcs) {
    $t = Get-ScheduledTask -TaskName $svc.Name -ErrorAction SilentlyContinue
    $i = $t | Get-ScheduledTaskInfo
    $listen = Get-NetTCPConnection -LocalPort $svc.Port -State Listen -ErrorAction SilentlyContinue
    Say ("{0,-22} state={1,-8} lastResult={2} listening={3}" -f `
        $svc.Name, $t.State, $i.LastTaskResult, [bool]$listen)
}

$out = Join-Path $logs 'install-dev-tasks.txt'
[System.IO.File]::WriteAllText($out, ($report -join "`n") + "`n")
Write-Host "wrote $out"
