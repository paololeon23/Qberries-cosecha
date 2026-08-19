# Configura Capacitor + Android (ejecutar en PowerShell con Node.js instalado)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "Instale Node.js 20+ desde https://nodejs.org y vuelva a ejecutar este script."
}

Write-Host "→ npm install"
npm install

Write-Host "→ build:web (copia raiz → mobile/www)"
npm run build:web

if (-not (Test-Path "mobile\android")) {
  Write-Host "→ cap add android"
  npx cap add android
} else {
  Write-Host "→ cap sync android"
  npx cap sync android
}

Write-Host ""
Write-Host "Listo. Abra Android Studio con: npm run cap:open:android"
Write-Host "APK debug: npm run cap:apk"
