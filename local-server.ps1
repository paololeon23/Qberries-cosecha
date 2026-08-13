#Requires -Version 5.1
<#
  Servidor local para pruebas (Live Server NO soporta POST a Netlify Functions).
  Uso (PowerShell en esta carpeta):
    .\local-server.ps1

  Abra: http://127.0.0.1:5500
  Variables: archivo .env (igual que Netlify)
#>
param(
  [int]$Port = 5500
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$EnvFile = Join-Path $Root ".env"
$EnvExample = Join-Path $Root ".env.example"

if (-not (Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
  Copy-Item $EnvExample $EnvFile
  Write-Host "Creado .env desde .env.example"
}

function Import-DotEnv([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
      $v = $v.Substring(1, $v.Length - 2)
    }
    $map[$k] = $v
  }
  return $map
}

$EnvMap = Import-DotEnv $EnvFile
function Get-EnvVal([string]$Name) {
  $fromProcess = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ($fromProcess) { return [string]$fromProcess }
  if ($EnvMap.ContainsKey($Name)) { return [string]$EnvMap[$Name] }
  return ""
}

$Mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".webp" = "image/webp"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".map"  = "application/json"
}

function Send-Json($Response, [int]$Status, $Obj) {
  $json = ($Obj | ConvertTo-Json -Depth 20 -Compress)
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $Response.StatusCode = $Status
  $Response.ContentType = "application/json; charset=utf-8"
  $Response.Headers.Add("Access-Control-Allow-Origin", "*")
  $Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
  $Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Response.OutputStream.Close()
}

function Read-RequestBody($Request) {
  if ($Request.ContentLength64 -le 0) { return "" }
  $reader = New-Object IO.StreamReader($Request.InputStream, [Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

function Get-Digits([string]$v) { return ([regex]::Replace([string]$v, '\D', '')) }
function Get-CleanText([string]$v) {
  $t = ([string]$v).Trim() -replace '\s+', ' '
  return $t.ToUpper()
}

function Sanitize-Vinculo($src) {
  if (-not $src) { $src = @{} }
  $dni = Get-Digits $src.dni
  $cel = Get-Digits $(if ($src.celular) { $src.celular } else { $src.telefono })
  $dniSes = Get-Digits $(if ($src.dniSesion) { $src.dniSesion } elseif ($src.dniInicioSesion) { $src.dniInicioSesion } else { $dni })
  if (-not $dniSes) { $dniSes = $dni }
  $sup = Get-CleanText $(
    if ($src.supervisorGlobal) { $src.supervisorGlobal }
    elseif ($src.nombreSupervisorGlobal) { $src.nombreSupervisorGlobal }
    elseif ($src.encargado) { $src.encargado }
    else { "" }
  )
  $hora = [string]$(if ($src.horaRegistro) { $src.horaRegistro } elseif ($src.hora) { $src.hora } else { "" })
  return [ordered]@{
    dni               = $dni
    nombre            = (Get-CleanText $(if ($src.nombre) { $src.nombre } else { $src.name }))
    celular           = $cel
    supervisorGlobal  = $sup
    dniSesion         = $dniSes
    horaRegistro      = $hora.Trim()
    hora              = $hora.Trim()
  }
}

function Get-LocalTrabajadores {
  $p = Join-Path $Root "data\trabajadores.json"
  if (-not (Test-Path $p)) {
    return @{ ok = $true; byDni = @{}; count = 0; source = "empty" }
  }
  $data = Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json
  $byDni = $data.byDni
  if (-not $byDni) { $byDni = $data }
  $count = @($byDni.PSObject.Properties).Count
  return @{
    ok = $true
    byDni = $byDni
    count = $count
    source = "local-trabajadores.json"
    cachedAt = (Get-Date).ToString("o")
  }
}

function Handle-Login($Request, $Response) {
  $pinExpected = (Get-EnvVal "LOGIN_PIN").Trim()
  $bodyRaw = Read-RequestBody $Request
  $pin = ""
  try {
    $body = $bodyRaw | ConvertFrom-Json
    $pin = [string]$body.pin
  } catch {}
  if (-not $pinExpected) {
    Send-Json $Response 200 @{ ok = $true; local = $true }
    return
  }
  if ($pin -ne $pinExpected) {
    # probe __probe__ u otros → 401 (la app lo usa para detectar API)
    Send-Json $Response 401 @{ ok = $false; error = "Contraseña incorrecta" }
    return
  }
  Send-Json $Response 200 @{ ok = $true }
}

function Handle-Trabajadores($Request, $Response) {
  $scriptUrl = (Get-EnvVal "TRABAJADORES_SCRIPT_URL").Trim()
  if (-not $scriptUrl) {
    Send-Json $Response 200 (Get-LocalTrabajadores)
    return
  }
  # Si hay URL remota, igual priorizamos local en pruebas para no romper
  Send-Json $Response 200 (Get-LocalTrabajadores)
}

function Handle-Sync($Request, $Response) {
  $scriptUrl = (Get-EnvVal "APPS_SCRIPT_URL").Trim()
  $apiToken = (Get-EnvVal "API_TOKEN").Trim()
  $loginPin = (Get-EnvVal "LOGIN_PIN").Trim()

  if (-not $scriptUrl -or -not $apiToken) {
    Send-Json $Response 500 @{
      ok = $false
      error = "APPS_SCRIPT_URL o API_TOKEN no configurados en .env"
    }
    return
  }

  $bodyRaw = Read-RequestBody $Request
  try { $body = $bodyRaw | ConvertFrom-Json } catch {
    Send-Json $Response 400 @{ ok = $false; error = "JSON inválido" }
    return
  }

  if ($loginPin -and $body.pin -and ([string]$body.pin -ne $loginPin)) {
    Send-Json $Response 401 @{ ok = $false; error = "Sesión / PIN inválido" }
    return
  }

  $action = if ($body.action) { [string]$body.action } else { "registrarVinculo" }
  $rawData = $body.data
  if (-not $rawData) { $rawData = $body.payload }
  if (-not $rawData) { $rawData = $body }

  if ($action -eq "registrarVinculo") {
    $data = Sanitize-Vinculo $rawData
    if (-not $data.dni -or $data.dni.Length -lt 8) {
      Send-Json $Response 400 @{ ok = $false; error = "DNI inválido" }
      return
    }
    if ($data.celular -notmatch '^9\d{8}$') {
      Send-Json $Response 400 @{ ok = $false; error = "Celular inválido: 9 dígitos comenzando con 9" }
      return
    }
    if (-not $data.supervisorGlobal -or $data.supervisorGlobal.Length -lt 3) {
      Send-Json $Response 400 @{ ok = $false; error = "Falta nombre del supervisor global" }
      return
    }
  } else {
    $data = $rawData
  }

  $outbound = @{
    source = "supervisores"
    action = $action
    token = $apiToken
    data = $data
    payload = $data
    at = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 10 -Compress

  try {
    $resp = Invoke-WebRequest -Uri $scriptUrl -Method POST -Body $outbound -ContentType "application/json; charset=utf-8" -Headers @{
      Authorization = "Bearer $apiToken"
      "X-Api-Token" = $apiToken
    } -UseBasicParsing
    $parsed = $null
    try { $parsed = $resp.Content | ConvertFrom-Json } catch { $parsed = @{ raw = $resp.Content } }
    $ok = ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) -and ($parsed.ok -ne $false)
    Send-Json $Response $(if ($ok) { 200 } else { 502 }) @{
      ok = [bool]$ok
      status = [int]$resp.StatusCode
      data = $parsed
      local = $true
    }
  } catch {
    Send-Json $Response 502 @{
      ok = $false
      error = $_.Exception.Message
      local = $true
    }
  }
}

function Serve-Static($Request, $Response) {
  $rel = [Uri]::UnescapeDataString($Request.Url.AbsolutePath.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
  $full = [IO.Path]::GetFullPath((Join-Path $Root $rel))
  if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
    $Response.StatusCode = 403
    $Response.Close()
    return
  }
  if ((Test-Path $full) -and (Get-Item $full).PSIsContainer) {
    $full = Join-Path $full "index.html"
  }
  if (-not (Test-Path $full)) {
    $Response.StatusCode = 404
    $Response.Close()
    return
  }
  $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
  $type = if ($Mime.ContainsKey($ext)) { $Mime[$ext] } else { "application/octet-stream" }
  $bytes = [IO.File]::ReadAllBytes($full)
  $Response.StatusCode = 200
  $Response.ContentType = $type
  $Response.Headers.Add("Access-Control-Allow-Origin", "*")
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Response.OutputStream.Close()
}

$prefix = "http://127.0.0.1:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "No se pudo abrir el puerto $Port. Cierre Live Server u otro proceso en ese puerto."
  Write-Host $_.Exception.Message
  exit 1
}

Write-Host ""
Write-Host "  QBerries Supervisores · local (PowerShell)"
Write-Host "  → $prefix"
Write-Host ("  APPS_SCRIPT_URL: " + $(if ((Get-EnvVal 'APPS_SCRIPT_URL').Trim()) { 'OK' } else { 'FALTA en .env' }))
Write-Host ("  API_TOKEN:       " + $(if ((Get-EnvVal 'API_TOKEN').Trim()) { 'OK' } else { 'FALTA en .env' }))
Write-Host "  Cierre Live Server. Aquí sí funcionan los POST."
Write-Host "  Ctrl+C para detener."
Write-Host ""

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    if ($req.HttpMethod -eq "OPTIONS") {
      $res.StatusCode = 204
      $res.Headers.Add("Access-Control-Allow-Origin", "*")
      $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
      $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      $res.Close()
      continue
    }

    $path = $req.Url.AbsolutePath
    if ($path -like "/.netlify/functions/*") {
      $name = $path.Substring("/.netlify/functions/".Length).Trim("/").ToLowerInvariant()
      if ($req.HttpMethod -ne "POST") {
        Send-Json $res 405 @{ ok = $false; error = "Method Not Allowed" }
        continue
      }
      switch ($name) {
        "login" { Handle-Login $req $res }
        "trabajadores" { Handle-Trabajadores $req $res }
        "sync" { Handle-Sync $req $res }
        default { Send-Json $res 404 @{ ok = $false; error = "Function not found" } }
      }
      continue
    }

    if ($req.HttpMethod -ne "GET" -and $req.HttpMethod -ne "HEAD") {
      Send-Json $res 405 @{ ok = $false; error = "Method Not Allowed" }
      continue
    }
    Serve-Static $req $res
  } catch {
    try { Send-Json $res 500 @{ ok = $false; error = $_.Exception.Message } } catch {}
  }
}
