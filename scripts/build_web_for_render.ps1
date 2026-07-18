# Build patient + doctor web UIs into backend/static for single-URL Render host.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$static = Join-Path $root "backend\static"

Write-Host "==> Building doctor dashboard..."
Set-Location (Join-Path $root "doctor-dashboard")
if (-not (Test-Path "node_modules")) { npm install }
npm run build
New-Item -ItemType Directory -Force -Path (Join-Path $static "doctor") | Out-Null
Copy-Item -Recurse -Force "dist\*" (Join-Path $static "doctor")

Write-Host "==> Building patient web app..."
Set-Location (Join-Path $root "patient-app")
if (-not (Test-Path "node_modules")) { npm install }
$env:EXPO_PUBLIC_API_BASE = ""
npx expo export -p web
New-Item -ItemType Directory -Force -Path (Join-Path $static "patient") | Out-Null
if (Test-Path "dist") {
  Copy-Item -Recurse -Force "dist\*" (Join-Path $static "patient")
} elseif (Test-Path "web-build") {
  Copy-Item -Recurse -Force "web-build\*" (Join-Path $static "patient")
} else {
  throw "Expo export did not create dist/ or web-build/"
}

Write-Host "==> Done. Push backend/static to GitHub, then redeploy Render."
Write-Host "    Live links after deploy:"
Write-Host "    https://YOUR-APP.onrender.com/"
Write-Host "    https://YOUR-APP.onrender.com/patient/"
Write-Host "    https://YOUR-APP.onrender.com/doctor/"
