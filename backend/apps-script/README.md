# Apps Script · DATA-SUPERVISORES

Misma lógica/seguridad que **Tarjeta Pallet** (token + proxy Netlify).

## Setup
1. Pegue `Code.gs` completo en el Sheet **DATA-SUPERVISORES**
2. Propiedades del script → `API_TOKEN` = mismo que Netlify
3. Implementar → **Nueva versión** → Aplicación web
4. URL `/exec` → Netlify `APPS_SCRIPT_URL`

## Columnas
| DNI | NOMBRE | CELULAR | GRUPO LIC | GRUPO | NOMBRE SUPERVISOR GLOBAL | DNI INICIO SESION | ULTIMA HORA REGISTRO |

## Endpoints
- `ping`
- `registrarVinculo` (POST, upsert por DNI)
- `listarVinculos` / `existeVinculo`

## Prueba en editor
Solo `testPing` / `myFunction` (rápido). **No** hay `testRegistrar`.
