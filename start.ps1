# BACKTEST — start backend + frontend together (Windows PowerShell).
# Backend opens in its own window; frontend runs here. Close the window / Ctrl+C to stop.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not (Test-Path "$root\backend\.venv") -or -not (Test-Path "$root\frontend\node_modules")) {
  Write-Error "Not installed yet - run .\install.ps1 first."
  exit 1
}

Write-Host "-> Backend starting on http://localhost:8000 (give it ~15s to import)"
Start-Process -FilePath "$root\backend\.venv\Scripts\uvicorn.exe" `
  -ArgumentList "app.main:app", "--port", "8000", "--reload" `
  -WorkingDirectory "$root\backend"

Write-Host "-> Frontend on http://localhost:5173"
Set-Location "$root\frontend"
npm run dev
