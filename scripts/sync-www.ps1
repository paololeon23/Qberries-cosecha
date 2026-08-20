# Copia la PWA (raíz) → mobile/www para Capacitor / APK
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "mobile\www"

New-Item -ItemType Directory -Force -Path $dest | Out-Null

$files = @("app.js", "styles.css", "sw.js", "manifest.json", "icons.js", "index.html", "native-bridge.js")
foreach ($f in $files) {
  Copy-Item (Join-Path $root $f) (Join-Path $dest $f) -Force
}

$dirs = @("inicio", "registro", "vinculo", "instalar", "vendor", "assets")
foreach ($d in $dirs) {
  $src = Join-Path $root $d
  if (-not (Test-Path $src)) { continue }
  $target = Join-Path $dest $d
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Copy-Item $src $target -Recurse -Force
}

$dataSrc = Join-Path $root "data"
$dataDest = Join-Path $dest "data"
New-Item -ItemType Directory -Force -Path $dataDest | Out-Null
Get-ChildItem -LiteralPath $dataSrc -Filter "*.json" -File | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $dataDest $_.Name) -Force
}

Write-Output "mobile/www sincronizado desde la raiz (Netlify)"
