# Fusiona trabajadores COSECHA desde Reporte_Horas .xlsx → data/trabajadores.json
param(
  [Parameter(Mandatory = $true)]
  [string[]]$Files
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$jsonPath = Join-Path $root "data\trabajadores.json"
$wwwPath = Join-Path $root "mobile\www\data\trabajadores.json"
$tmpDir = Join-Path $env:TEMP "qb-merge-trabajadores"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

function Get-Digits([string]$v) {
  return ($v -replace '\D', '')
}

function Get-CleanName([string]$v) {
  if (-not $v) { return "" }
  return ($v.Trim() -replace '\s+', ' ').ToUpper()
}

function Test-IsCosecha([string]$actividad, [string]$cargo) {
  $a = if ($actividad) { $actividad.ToUpper() } else { "" }
  $c = if ($cargo) { $cargo.ToUpper() } else { "" }
  if ($a -match "SUPERVISOR" -or $c -match "SUPERVISOR") { return $false }
  if ($a -match "COSECHA" -or $c -match "COSECHA") { return $true }
  return $false
}

function Export-XlsxToCsv([string]$xlsxPath, [string]$csvPath) {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $wb = $null
  try {
    $wb = $excel.Workbooks.Open($xlsxPath)
    if (Test-Path -LiteralPath $csvPath) { Remove-Item -LiteralPath $csvPath -Force }
    # 6 = xlCSV
    $wb.SaveAs($csvPath, 6)
  }
  finally {
    if ($wb) { $wb.Close($false) | Out-Null }
    $excel.Quit() | Out-Null
    if ($wb) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

function Find-Prop($row, [string[]]$names) {
  $props = $row.PSObject.Properties
  foreach ($n in $names) {
    $hit = $props | Where-Object { $_.Name.Trim().ToUpper() -eq $n.ToUpper() } | Select-Object -First 1
    if ($hit) { return [string]$hit.Value }
  }
  foreach ($n in $names) {
    $hit = $props | Where-Object { $_.Name.Trim().ToUpper() -like ("*" + $n.ToUpper() + "*") } | Select-Object -First 1
    if ($hit) { return [string]$hit.Value }
  }
  return ""
}

function Read-WorkersFromCsv([string]$csvPath, [string]$label) {
  $map = @{}
  $first = Get-Content -LiteralPath $csvPath -TotalCount 1 -Encoding Default
  $delim = if ($first -match ";") { ";" } else { "," }
  $rows = Import-Csv -LiteralPath $csvPath -Delimiter $delim -Encoding Default
  foreach ($row in $rows) {
    $dniRaw = Find-Prop $row @("Documento", "DNI", "Nro Documento", "Número Documento")
    $dni = Get-Digits $dniRaw
    if ($dni.Length -gt 8) { $dni = $dni.Substring($dni.Length - 8) }
    if ($dni.Length -lt 8 -and $dni.Length -gt 0) { $dni = $dni.PadLeft(8, "0") }
    if ($dni.Length -ne 8 -or $dni -match "^0+$") { continue }

    $nombre = Get-CleanName (Find-Prop $row @("Trabajador", "Apellidos y Nombres", "Nombres y Apellidos", "Nombre Completo", "Nombres"))
    if ($nombre.Length -lt 3) { continue }

    $act = Find-Prop $row @("Actividad")
    $cargo = Find-Prop $row @("Cargo", "Puesto")
    $macro = Find-Prop $row @("Macro Partida")
    # Solo personal de cosecha (no supervisores)
    $ok = Test-IsCosecha $act $cargo
    if (-not $ok -and $macro -match "COSECHA" -and $act -notmatch "SUPERVISOR") {
      # respaldo: si está en macro cosecha y actividad no es supervisor
      if ($act -match "^COSECHA$") { $ok = $true }
    }
    if (-not $ok) { continue }

    $map[$dni] = @{ nombre = $nombre; cargo = "COSECHA" }
  }
  Write-Host ("{0} → {1} únicos COSECHA" -f $label, $map.Count)
  return $map
}

# --- main ---
$data = Get-Content -Raw -Encoding UTF8 $jsonPath | ConvertFrom-Json
$byDni = @{}
if ($data.byDni) {
  foreach ($p in $data.byDni.PSObject.Properties) {
    $byDni[$p.Name] = @{
      nombre = [string]$p.Value.nombre
      cargo  = if ($p.Value.cargo) { [string]$p.Value.cargo } else { "COSECHA" }
    }
  }
}
$before = $byDni.Count
$added = 0
$updated = 0
$sample = New-Object System.Collections.Generic.List[string]

$i = 0
foreach ($f in $Files) {
  if (-not (Test-Path -LiteralPath $f)) { throw "No existe: $f" }
  $i++
  $csv = Join-Path $tmpDir ("file-$i.csv")
  Write-Host ("Exportando {0} ..." -f (Split-Path $f -Leaf))
  Export-XlsxToCsv $f $csv
  $map = Read-WorkersFromCsv $csv (Split-Path $f -Leaf)
  foreach ($kv in $map.GetEnumerator()) {
    $dni = $kv.Key
    $info = $kv.Value
    if (-not $byDni.ContainsKey($dni)) {
      $byDni[$dni] = $info
      $added++
      if ($sample.Count -lt 25) { [void]$sample.Add("$dni $($info.nombre)") }
    }
    elseif ((Get-CleanName $byDni[$dni].nombre) -ne $info.nombre) {
      $byDni[$dni].nombre = $info.nombre
      $byDni[$dni].cargo = "COSECHA"
      $updated++
    }
  }
}

$ordered = [ordered]@{}
foreach ($k in ($byDni.Keys | Sort-Object)) {
  $ordered[$k] = @{
    nombre = $byDni[$k].nombre
    cargo  = $byDni[$k].cargo
  }
}

$outObj = [pscustomobject]@{
  tipo        = [string]$data.tipo
  uso         = [string]$data.uso
  comoAgregar = [string]$data.comoAgregar
  source      = "reporte-horas.xlsx + trabajadores.xlsx + altas manuales"
  filtro      = $data.filtro
  count       = $ordered.Count
  updatedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  byDni       = [pscustomobject]$ordered
}

$json = $outObj | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($jsonPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
if (Test-Path (Split-Path $wwwPath -Parent)) {
  [System.IO.File]::WriteAllText($wwwPath, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

Write-Host ""
Write-Host "ANTES:  $before"
Write-Host "DESPUES:$($ordered.Count)"
Write-Host "NUEVOS: $added"
Write-Host "NOMBRES ACTUALIZADOS: $updated"
if ($sample.Count) {
  Write-Host "Muestra nuevos:"
  $sample | ForEach-Object { Write-Host "  $_" }
}
