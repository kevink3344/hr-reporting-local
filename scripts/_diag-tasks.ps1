# Diagnose the stuck HR-Reporting scheduled tasks.
# Writes everything to .logs\task-diag.txt because the invoking terminal gets
# cleaned up mid-run and truncates stdout.

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $repo '.logs\task-diag.txt'
New-Item -ItemType Directory -Force -Path (Join-Path $repo '.logs') | Out-Null

$lines = New-Object System.Collections.Generic.List[string]
function Say($t) { $lines.Add($t) }

Say "=== now: $(Get-Date -Format 'o') ==="
Say "user: $env:USERDOMAIN\$env:USERNAME   interactive-session: $([Environment]::UserInteractive)"

$task = Get-ScheduledTask -TaskName 'HR-Reporting-Backend' -ErrorAction SilentlyContinue
if (-not $task) {
    Say 'TASK NOT FOUND'
} else {
    Say ''
    Say '=== principal ==='
    $lines.Add(($task.Principal | Format-List * | Out-String).Trim())

    Say ''
    Say '=== actions ==='
    $lines.Add(($task.Actions | Format-List * | Out-String).Trim())

    Say ''
    Say '=== settings (subset) ==='
    Say "AllowStartIfOnBatteries : $($task.Settings.AllowStartIfOnBatteries)"
    Say "DisallowStartIfOnBatteries: $($task.Settings.DisallowStartIfOnBatteries)"
    Say "StartWhenAvailable      : $($task.Settings.StartWhenAvailable)"
    Say "MultipleInstances       : $($task.Settings.MultipleInstancesPolicy)"
    Say "ExecutionTimeLimit      : $($task.Settings.ExecutionTimeLimit)"
    Say "Enabled                 : $($task.Settings.Enabled)"

    Say ''
    Say '=== task info ==='
    $info = $task | Get-ScheduledTaskInfo
    Say "State          : $($task.State)"
    Say "LastRunTime    : $($info.LastRunTime)"
    Say "LastTaskResult : $($info.LastTaskResult)"
    Say "NextRunTime    : $($info.NextRunTime)"
    Say "NumberOfMissedRuns: $($info.NumberOfMissedRuns)"

    Say ''
    Say '=== last 12 TaskScheduler operational events ==='
    try {
        $ev = Get-WinEvent -LogName 'Microsoft-Windows-TaskScheduler/Operational' -MaxEvents 12 -ErrorAction Stop
        foreach ($e in $ev) { Say ("[{0}] id={1} {2}" -f $e.TimeCreated, $e.Id, ($e.Message -replace "`r?`n", ' | ')) }
    } catch {
        Say "could not read operational log: $($_.Exception.Message)"
    }
}

[System.IO.File]::WriteAllText($out, ($lines -join "`n") + "`n")
Write-Host "wrote $out"
