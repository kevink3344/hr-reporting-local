# Show the exact indentation characters used in .vscode/tasks.json
$path = Join-Path (Split-Path -Parent $PSScriptRoot) '.vscode\tasks.json'
$lines = [System.IO.File]::ReadAllLines($path)
$out = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]
    if ($l -match 'dev: (backend|frontend)|"file"|"owner"|"regexp"|"background"') {
        $prefix = [System.Text.RegularExpressions.Regex]::Match($l, '^\s*').Value
        $desc = ($prefix.ToCharArray() | ForEach-Object { if ($_ -eq "`t") { '<TAB>' } else { '<SP>' } }) -join ''
        $out.Add(("{0,4}: [{1}] {2}" -f ($i + 1), $desc, $l.Trim()))
    }
}
[System.IO.File]::WriteAllText((Join-Path (Split-Path -Parent $PSScriptRoot) '_tasks-indent.txt'), ($out -join "`r`n") + "`r`n")
Write-Host 'ok'
