# Ordena data/trabajadores.json y data/supervisores-cosecha.json por DNI (UTF-8).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ordenar-data.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $PSScriptRoot) { $root = "c:\Users\TatianaLeón\Desktop\Supervisores" }
$dataDir = Join-Path $root "data"
$wwwDir = Join-Path $root "mobile\www\data"
$utf8 = New-Object System.Text.UTF8Encoding $false
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

function Escape-Json([string]$s) {
  if ($null -eq $s) { return "" }
  return $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
}

function Write-Utf8([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, $utf8)
}

function Read-GitUtf8([string]$repo, [string]$path) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "git"
  $psi.Arguments = "-C `"$repo`" show HEAD:$path"
  $psi.RedirectStandardOutput = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  $text = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  if ($p.ExitCode -ne 0 -or -not $text) { throw "No se pudo leer git:$path" }
  return $text
}

function Parse-ByDniMap([string]$raw) {
  $map = [ordered]@{}
  $rx = [regex] '"(\d+)"\s*:\s*\{([^{}]*)\}'
  foreach ($m in $rx.Matches($raw)) {
    $dni = $m.Groups[1].Value
    $body = $m.Groups[2].Value
    $nombre = ""
    $cargo = ""
    $cel = ""
    $glob = ""
    $enc = ""
    $nm = [regex]::Match($body, '"nombre"\s*:\s*"((?:\\.|[^"\\])*)"')
    if ($nm.Success) { $nombre = [regex]::Unescape($nm.Groups[1].Value) }
    $cm = [regex]::Match($body, '"cargo"\s*:\s*"((?:\\.|[^"\\])*)"')
    if ($cm.Success) { $cargo = [regex]::Unescape($cm.Groups[1].Value) }
    $tm = [regex]::Match($body, '"celular"\s*:\s*"((?:\\.|[^"\\])*)"')
    if ($tm.Success) { $cel = [regex]::Unescape($tm.Groups[1].Value) }
    $gm = [regex]::Match($body, '"supervisorGlobal"\s*:\s*"((?:\\.|[^"\\])*)"')
    if ($gm.Success) { $glob = [regex]::Unescape($gm.Groups[1].Value) }
    $em = [regex]::Match($body, '"encargadoDni"\s*:\s*"((?:\\.|[^"\\])*)"')
    if ($em.Success) { $enc = [regex]::Unescape($em.Groups[1].Value) }
    if (-not $nombre) { continue }
    $map[$dni] = @{
      nombre = $nombre.ToUpper()
      cargo  = $cargo
      celular = $cel
      supervisorGlobal = $glob
      encargadoDni = $enc
    }
  }
  return $map
}

# Restaurar trabajadores desde git (UTF-8 original) y volver a sumar altas.
$gitTrab = Read-GitUtf8 $root "data/trabajadores.json"
$trabMap = Parse-ByDniMap $gitTrab

$altas = @(
  @('40484206','SALVATIERRA GERVACIO EULALIA'),
  @('48391318','HERNANDEZ GOMEZ DIANIRA'),
  @('76592371','BECERRA AGUINAGA JUAN JESUS'),
  @('47915416','ANGULO GUTIERREZ VICTOR JONATHAN'),
  @('72314546','PASCUAL EUGENIO KETY AIME'),
  @('61478589','AKINTUI ANAG YAMIR ALEXANDER'),
  @('42429184','CRUZADO PICHEN FELICITA ERNESTINA'),
  @('75578561','LOPEZ SALVATIERRA YANIRA GERALDINE'),
  @('27158553','TENA NAMOC CLAUDIO'),
  @('74308960','AREVALO MENDOZA YULEISI MARELY'),
  @('60268391','AREVALO MENDOZA GREISI ANAI'),
  @('70831723','FABIAN JUAREZ ALEXANDRA CAROLINA'),
  @('60830594','MARTOS ROJAS JORGE ALMILCAR'),
  @('77020976','CHAVEZ NAMOC ELVIS ANGELITO'),
  @('43925530','PALACIOS MOSTACERO ALEXANDER'),
  @('60284325','MENDOZA CRUZADO BRENDA ESMERALDA'),
  @('45132488','CRUZADO MENDEZ SONIA MARGARITA'),
  @('75025917','ZARATE FLORES EBERT FELIPE'),
  @('62709137','PIZARRO MAZA ESTEFANY ELIZABETH'),
  @('48076591','VARGAS GARCIA JOSE ALEJANDRO'),
  @('47737889','CUEVA VENTURA FABIOLA'),
  @('45105622','JAUREGUI RUBIO DORIS MARGARITA'),
  @('73073877','MURGA REYES LUSMILA'),
  @('40677476','GONZALES CEDANO LILY ROSITA'),
  @('47262874','GONZALES CRUZ SABINA'),
  @('80166094','ARAUJO CARRERA ELITA'),
  @('74478201','LARA HOYOS YONER'),
  @('19701363','BENITES REYES ANTOLINO EUFEMIO'),
  @('71103624','IPARRAGUIRRE CHILCHO SEGUNDO'),
  @('71117322','CASANA ALVA DANY ALEXANDER'),
  @('44478858','MARCELO MINANO EDI GIOVANA'),
  @('77147639','SILVA REYES WENDY ESTEFANI'),
  @('76247477','OBANDO MAZA JOSE DE CARMEN'),
  @('62480774','LEIVA SANCHEZ MARLON ALEXANDER'),
  @('62480778','CUSQUISIVAN SANCHEZ BRANDO BANI SAMUEL'),
  @('61353459','ARANDA ZAVALETA YASUMI SELENE'),
  @('75813499','LEON CHAVEZ WILFREDO ABIMAEL'),
  @('61025851','SILVA ESPINAL HAROD MICHEL')
)
foreach ($w in $altas) {
  if (-not $trabMap.Contains($w[0])) {
    $trabMap[$w[0]] = @{ nombre = $w[1]; cargo = 'COSECHA'; celular = ''; supervisorGlobal = ''; encargadoDni = '' }
  }
}

$curTrabPath = Join-Path $dataDir "trabajadores.json"
if (Test-Path $curTrabPath) {
  $curRaw = [System.IO.File]::ReadAllText($curTrabPath, $utf8)
  $curMap = Parse-ByDniMap $curRaw
  foreach ($dni in $curMap.Keys) {
    if (-not $trabMap.Contains($dni)) {
      $trabMap[$dni] = $curMap[$dni]
    }
  }
}

$trabKeys = @($trabMap.Keys) | Sort-Object { [long]$_ }
$trabBlocks = foreach ($dni in $trabKeys) {
  $p = $trabMap[$dni]
  $nombre = Escape-Json $p.nombre
  $cargo = Escape-Json ($(if ($p.cargo) { $p.cargo } else { 'COSECHA' }))
  "    `"$dni`": {`n      `"nombre`": `"$nombre`",`n      `"cargo`": `"$cargo`"`n    }"
}
$trabJson = @"
{
  "tipo": "trabajadores",
  "uso": "Solo cosecha. Se buscan por DNI en Agregar trabajador. NO poner supervisores aqui.",
  "comoAgregar": "Pegar en byDni un DNI de 8 digitos con nombre y cargo COSECHA.",
  "source": "reporte-horas.xlsx + trabajadores.xlsx + altas manuales",
  "filtro": {
    "actividad": "COSECHA",
    "excluye": "SUPERVISOR DE COSECHA"
  },
  "count": $($trabKeys.Count),
  "updatedAt": "$now",
  "byDni": {
$($trabBlocks -join ",`n")
  }
}
"@
Write-Utf8 (Join-Path $dataDir "trabajadores.json") $trabJson

# Supervisores: leer archivo actual UTF-8 (ya tiene eñes)
$supRaw = [System.IO.File]::ReadAllText((Join-Path $dataDir "supervisores-cosecha.json"), $utf8)
$supMap = Parse-ByDniMap $supRaw
$supKeys = @($supMap.Keys) | Sort-Object { [long]$_ }
$supBlocks = foreach ($dni in $supKeys) {
  $p = $supMap[$dni]
  $nombre = Escape-Json $p.nombre
  $cargo = Escape-Json ($(if ($p.cargo) { $p.cargo } else { "SUPERVISOR DE COSECHA" }))
  $cel = Escape-Json $p.celular
  $glob = Escape-Json $p.supervisorGlobal
  $enc = Escape-Json $p.encargadoDni
  @"
    "$dni": {
      "nombre": "$nombre",
      "cargo": "$cargo",
      "celular": "$cel",
      "supervisorGlobal": "$glob",
      "encargadoDni": "$enc"
    }
"@
}
$supJson = @"
{
  "tipo": "supervisores",
  "uso": "Solo login QR. NO van en trabajadores.json.",
  "comoAgregar": "Pegar en byDni un DNI de 8 digitos con nombre y cargo SUPERVISOR DE COSECHA. No mezclar con trabajadores.",
  "source": "Reporte_Horas + altas manuales",
  "filtro": {
    "macroPartida": "COSTO DE COSECHA",
    "actividad": "SUPERVISOR DE COSECHA"
  },
  "count": $($supKeys.Count),
  "updatedAt": "$now",
  "byDni": {
$($supBlocks -join ",`n")
  },
  "supervisorGlobalDefault": {
    "nombre": "VERDE PINILLOS LUIS PABLITO",
    "dni": "77795510"
  }
}
"@
Write-Utf8 (Join-Path $dataDir "supervisores-cosecha.json") $supJson

New-Item -ItemType Directory -Force -Path $wwwDir | Out-Null
Copy-Item (Join-Path $dataDir "trabajadores.json") (Join-Path $wwwDir "trabajadores.json") -Force
Copy-Item (Join-Path $dataDir "supervisores-cosecha.json") (Join-Path $wwwDir "supervisores-cosecha.json") -Force

Write-Output "supervisores=$($supKeys.Count)"
Write-Output "trabajadores=$($trabKeys.Count)"
Write-Output "ok"
