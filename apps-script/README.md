# Apps Script · DATA-SUPERVISORES

Pegue `Code.gs` en el Sheet **DATA-SUPERVISORES**.

## Columnas (Hoja 1)
| DNI | NOMBRE | CELULAR | NOMBRE SUPERVISOR GLOBAL | DNI INICIO SESION | ULTIMA HORA REGISTRO |

- **DNI** + **NOMBRE**: del carnet QR
- **CELULAR**: exactamente 9 dígitos y debe comenzar con **9**
- **NOMBRE SUPERVISOR GLOBAL**: lo escriben ellos (solo nombre)
- **DNI INICIO SESION**: DNI del QR que inició sesión
- **ULTIMA HORA REGISTRO**: última vez que se guardó (Lima)

Upsert por DNI (sin duplicados). Cada guardado actualiza celular y hora.

## Netlify
- `APPS_SCRIPT_URL` = URL `/exec`
- `API_TOKEN` = el mismo token que en Propiedades del script (solo en Netlify env, no en el código)
