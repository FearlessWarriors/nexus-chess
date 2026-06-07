# nexus_server.ps1 - Persistent Server + Tunnel Launcher
# Keeps both the Node.js backend and SSH tunnel alive
# Usage: powershell -ExecutionPolicy Bypass -File nexus_server.ps1

$ErrorActionPreference = "Continue"
$NODE = "C:\Users\dikdi\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$SERVER_DIR = "D:\xiangmu\nexus_chess\server"
$TUNNEL_URL_FILE = "D:\xiangmu\nexus_chess\.tunnel_url.txt"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Nexus Chess - Persistent Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Start-Server {
    Write-Host "[server] Starting Node.js backend..." -ForegroundColor Green
    $global:ServerProcess = Start-Process -FilePath $NODE -ArgumentList "dist/index.js" -WorkingDirectory $SERVER_DIR -PassThru -NoNewWindow
    Start-Sleep -Seconds 2
    
    if ($global:ServerProcess.HasExited) {
        Write-Host "[server] FAILED to start (exit code: $($global:ServerProcess.ExitCode))" -ForegroundColor Red
        return $false
    }
    Write-Host "[server] Running (PID: $($global:ServerProcess.Id))" -ForegroundColor Green
    return $true
}

function Start-Tunnel {
    Write-Host "[tunnel] Establishing SSH tunnel..." -ForegroundColor Yellow
    
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "ssh"
    $psi.Arguments = "-o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 80:localhost:3001 nokey@localhost.run"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    
    $global:TunnelProcess = [System.Diagnostics.Process]::Start($psi)
    Start-Sleep -Seconds 5
    
    if ($global:TunnelProcess.HasExited) {
        Write-Host "[tunnel] FAILED to start" -ForegroundColor Red
        return $false
    }
    
    # Read tunnel URL from output
    $output = $global:TunnelProcess.StandardOutput.ReadToEnd()
    if ($output -match '(https://[a-z0-9]+\.lhr\.life)') {
        $global:TunnelUrl = $matches[1]
        Write-Host "[tunnel] URL: $global:TunnelUrl" -ForegroundColor Green
        $global:TunnelUrl | Out-File -FilePath $TUNNEL_URL_FILE -Encoding UTF8
    } else {
        Write-Host "[tunnel] Started but couldn't parse URL" -ForegroundColor Yellow
    }
    return $true
}

function Stop-All {
    Write-Host ""
    Write-Host "[shutdown] Stopping services..." -ForegroundColor Yellow
    
    if ($global:TunnelProcess -and !$global:TunnelProcess.HasExited) {
        $global:TunnelProcess.Kill()
        Write-Host "[tunnel] Stopped" -ForegroundColor Gray
    }
    if ($global:ServerProcess -and !$global:ServerProcess.HasExited) {
        $global:ServerProcess.Kill()
        Write-Host "[server] Stopped" -ForegroundColor Gray
    }
}

# Cleanup on exit
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-All }

# Main loop
$tunnelRetries = 0
$maxTunnelRetries = 99

while ($true) {
    # Start server if not running
    if (!$global:ServerProcess -or $global:ServerProcess.HasExited) {
        Write-Host "[watchdog] Server restarting..." -ForegroundColor Yellow
        Start-Server
    }
    
    # Start tunnel if not running
    if (!$global:TunnelProcess -or $global:TunnelProcess.HasExited) {
        if ($tunnelRetries -ge $maxTunnelRetries) {
            Write-Host "[watchdog] Max tunnel retries reached, restarting in 60s..." -ForegroundColor Red
            Start-Sleep -Seconds 60
            $tunnelRetries = 0
        }
        Write-Host "[watchdog] Tunnel reconnecting..." -ForegroundColor Yellow
        Start-Tunnel
        if (!$global:TunnelProcess -or $global:TunnelProcess.HasExited) {
            $tunnelRetries++
            Start-Sleep -Seconds 5
        } else {
            $tunnelRetries = 0
        }
    }
    
    # Status report
    $serverOk = $global:ServerProcess -and !$global:ServerProcess.HasExited
    $tunnelOk = $global:TunnelProcess -and !$global:TunnelProcess.HasExited
    $status = @()
    if ($serverOk) { $status += "Server: OK" } else { $status += "Server: DOWN" }
    if ($tunnelOk) { $status += "Tunnel: OK" } else { $status += "Tunnel: DOWN" }
    
    Write-Host "[watchdog] $($status -join ' | ') | $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor DarkGray
    
    Start-Sleep -Seconds 10
}
