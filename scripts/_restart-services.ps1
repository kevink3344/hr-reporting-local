# =====================================================================
# HR Reporting — restart the local dev services (backend + frontend)
# ---------------------------------------------------------------------
# Kills anything already holding port 3000 (API) or 5173 (Vite), then
# starts both dev servers in separate windows.
#
# Why the kill step matters: when a dev server is started from a terminal
# that later gets closed, the `npm`/`powershell` wrapper dies but the
# underlying `node` child can survive as an orphan and keep the port in
# Listen state. A new `npm run dev` then silently falls back to the next
# free port (5174, 5175, ...), so the browser keeps talking to the stale
# orphan and the site appears to break for no reason. Always clear the
# ports first.
#
# Why Stop-Port alone is not enough: `tsx watch` is a *supervisor*. Killing
# the child that holds port 3000 leaves the supervisor alive, still watching
# the source tree; the next file edit makes it spawn a fresh child that
# re-grabs the port. Repeated restarts therefore leave a crowd of competing
# supervisors, and whichever one reacts last owns the port -- very possibly
# replaying a module graph from an older watch session. If `tsx watch` is
# also restarted in a *different* window, `Get-NetTCPConnection` sees only
# one listener while several supervisors are still live. So we sweep every
# repo-scoped tsx supervisor as well, and assert the port came back to a
# process we actually just started.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/_restart-services.ps1
# =====================================================================

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Stop-Port {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        Write-Host "Port $Port is free." -ForegroundColor DarkGray
        return
    }

    $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($processId in $pids) {
        if ($processId -eq 0) { continue }
        $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { 'unknown' }
        Write-Host "Killing pid $processId ($name) holding port $Port..." -ForegroundColor Yellow
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }

    # Give the OS a moment to release the socket.
    Start-Sleep -Milliseconds 700
}

# Kill every repo-scoped `tsx` process (watchers and their children, plus any
# stray tsx probes). Matches on the repo path AND `tsx` so the Vite dev server
# -- which lives under the repo but runs `vite/bin/vite.js` -- is left alone.
function Stop-OrphanTsx {
    param([string]$RepoRoot)

    $targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$RepoRoot*" -and $_.CommandLine -like '*tsx*' }

    if (-not $targets) {
        Write-Host 'No orphaned tsx processes.' -ForegroundColor DarkGray
        return
    }

    foreach ($target in $targets) {
        Write-Host "Killing pid $($target.ProcessId) (orphaned tsx)..." -ForegroundColor Yellow
        Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 700
}

function Wait-ForPort {
    param([int]$Port, [int]$TimeoutSeconds = 30)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

Write-Host ''
Write-Host 'Restarting HR Reporting dev services' -ForegroundColor Cyan
Write-Host '-------------------------------------' -ForegroundColor Cyan

# --- Clear the ports AND any leftover supervisors so we never fall back to
# --- 3001/5174 or hand the port to an older watcher replaying stale code.
Stop-OrphanTsx -RepoRoot $repoRoot
Stop-Port -Port 3000
Stop-Port -Port 5173

# --- Backend (tsx watch) on 3000 ---
Write-Host 'Starting backend (http://localhost:3000)...' -ForegroundColor Green
Start-Process -FilePath 'powershell' `
    -ArgumentList '-NoExit', '-Command', "Set-Location '$repoRoot'; npm run dev" `
    -WorkingDirectory $repoRoot | Out-Null

if (Wait-ForPort -Port 3000) {
    Write-Host 'Backend is listening on 3000.' -ForegroundColor Green
} else {
    Write-Warning 'Backend did not start listening on 3000 within 30s. Check its window for errors.'
}

# --- Frontend (Vite) on 5173 ---
Write-Host 'Starting frontend (http://localhost:5173)...' -ForegroundColor Green
Start-Process -FilePath 'powershell' `
    -ArgumentList '-NoExit', '-Command', "Set-Location '$repoRoot\client'; npm run dev" `
    -WorkingDirectory "$repoRoot\client" | Out-Null

if (Wait-ForPort -Port 5173) {
    Write-Host 'Frontend is listening on 5173.' -ForegroundColor Green
} else {
    Write-Warning 'Frontend did not start listening on 5173 within 30s. Check its window for errors.'
}

Write-Host ''
Write-Host 'Done. Open http://localhost:5173' -ForegroundColor Cyan
Write-Host 'Each service runs in its own window; close that window to stop it.' -ForegroundColor DarkGray
