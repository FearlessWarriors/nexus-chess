# Nexus Chess Server — Persistent Launcher
$ErrorActionPreference = "Stop"

$serverDir = "D:\xiangmu\nexus_chess\server"

# Use the exact Node.js that built better-sqlite3
$nodePath = "C:\Users\dikdi\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$tsxPath = "$serverDir\node_modules\tsx\dist\cli.mjs"
$serverEntry = "$serverDir\src\index.ts"

if (-not (Test-Path $nodePath)) {
    # Fallback to system node
    $nodePath = "node"
}

Write-Host "Starting Nexus Chess server..."
Write-Host "  Node: $nodePath"
Write-Host "  Dir:  $serverDir"

$proc = Start-Process -FilePath $nodePath `
    -ArgumentList "`"$tsxPath`" `"$serverEntry`"" `
    -WorkingDirectory $serverDir `
    -WindowStyle Minimized `
    -PassThru

Start-Sleep -Seconds 3

# Verify
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/health" -TimeoutSec 5
    Write-Host "SUCCESS: $($r | ConvertTo-Json -Compress)"
    Write-Host "Server PID: $($proc.Id)"
} catch {
    Write-Host "FAIL: Server did not respond. Check terminal window."
}
