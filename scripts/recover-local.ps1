# Recover local API + Postgres after hung queries, then resume crawls.
$ErrorActionPreference = "Continue"
$root = "C:\Users\Pc\Downloads\gca"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$pgCtl = "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe"

Write-Host "Killing hung psql clients..."
cmd /c "taskkill /F /IM psql.exe" 2>$null

# Cancel backends that have been running > 2 minutes (except autovacuum)
$env:PGPASSWORD = "kmcheck_local"
if (Test-Path $psql) {
  & $psql -h 127.0.0.1 -U postgres -d vdip -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='vdip' AND pid <> pg_backend_pid() AND state <> 'idle' AND now() - xact_start > interval '2 minutes';"
}

# Free port 5000 (old API)
$conns = netstat -ano | Select-String ":5000\s+.*LISTENING"
foreach ($line in $conns) {
  $parts = ($line.Line -split "\s+") | Where-Object { $_ }
  $listenPid = $parts[-1]
  if ($listenPid -match "^\d+$") {
    Write-Host "Killing PID $listenPid on :5000"
    cmd /c "taskkill /F /PID $listenPid"
  }
}

Start-Sleep -Seconds 3
Write-Host "Starting API..."
Set-Location $root
Start-Process -FilePath "pnpm" -ArgumentList "--filter","@workspace/api-server","run","dev" -WorkingDirectory $root -WindowStyle Hidden

Write-Host "Waiting for API healthz..."
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/healthz" -TimeoutSec 5 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}
if (-not $ok) { Write-Host "API healthz not up yet"; exit 1 }
Write-Host "API is up"

# Start 4-hour crawl health watch if not already running
$watchRunning = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "im-crawl-health\.mjs" -and $_.CommandLine -match "--watch" }
if (-not $watchRunning) {
  Write-Host "Starting crawl-health watch (every 3h)..."
  Start-Process -FilePath "pnpm" -ArgumentList "crawl-health:watch" -WorkingDirectory $root -WindowStyle Hidden
} else {
  Write-Host "crawl-health:watch already running (PID $($watchRunning.ProcessId))"
}

Write-Host "Running immediate crawl-health check..."
Start-Process -FilePath "pnpm" -ArgumentList "crawl-health" -WorkingDirectory $root -Wait -NoNewWindow
