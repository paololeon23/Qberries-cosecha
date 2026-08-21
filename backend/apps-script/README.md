# Apps Script · DATA-SUPERVISORES + GUÍAS (separado)

## 1) Supervisores / cosecha / manuales → `Code.gs`
1. Pegue `Code.gs` en el Sheet **DATA-SUPERVISORES**
2. Propiedades → `API_TOKEN` = mismo que Netlify
3. Implementar → Nueva versión → Aplicación web
4. URL `/exec` → Netlify `APPS_SCRIPT_URL`

La app llega ahí vía **Netlify Functions** (`/.netlify/functions/sync`).

## 2) Guías (OTRO script, OTRO Sheet) → `Code-guias.gs`
Para no juntar ni ralentizar vínculos/cosecha:

```
Celular (app en Netlify)
        ↓
api-config.js     ← QB_SCRIPT.GUIAS = …/exec
        ↓
app.js            ← fetch POST directo
        ↓
Code-guias.gs     ← doPost → registrarGuias_
        ↓
Google Sheet DATA-GUIAS
```

**Netlify solo sirve HTML/JS.** Guías **no** pasan por Netlify Functions.

1. Cree un Sheet nuevo, ej. **DATA-GUIAS-QBERIES**
2. Pegue **solo** `Code-guias.gs`
3. Implementar → Nueva versión → Aplicación web  
   - Ejecutar como: **Yo**  
   - Quién tiene acceso: **Cualquier persona**
4. Pegue la URL `/exec` en **`api-config.js`** → `QB_SCRIPT.GUIAS`
5. Suba de nuevo el sitio a Netlify

**Sin API_TOKEN.** POST: `{ action: "registrarGuias", data: {...} }`

### URL actual (Guías)
```
https://script.google.com/macros/s/AKfycbxVryHDgOjOdiYRhFjBN1dxy6ozSzCwRMFKRW-6QM9h97Fraclys4ftTCM6Z9-vL5BX/exec
```

### Prueba ping (sin token)
```
…/exec?action=ping
```
Debe devolver: `{"ok":true,"api":"guias",…}`  
Si dice `UNAUTHORIZED` / `Falta configurar API_TOKEN`, el deploy en Google es viejo: pegue de nuevo `Code-guias.gs` y **Nueva versión → Implementar**.

### Columnas DATA-GUIAS (cada guardado = fila nueva)
| NOMBRE | DNI | FECHA | FUNDO | GRUPO LIC | TOTAL JARRAS | TOTAL JABAS | TOTAL GUIAS | LOTES | N° GUIAS | HORA |
|---|---|---|---|---|---|---|---|---|---|---|
| … | … | … | Licapa / Licapa II | LIC 01 | 156 | 13 | 2 | LT5-M1-T1 | 111111 | hora |

### Anti-duplicado / offline
- **Sheet:** cada subida **agrega** una fila (12:00 y 18:00 = 2 filas). No pisa.
- **App:** cola local; cada guardado tiene id único y se reenvía al reconectar.

## Endpoints supervisores (`Code.gs`)
- `ping`
- `registrarVinculo` / `listarVinculos` / `existeVinculo`
- `registrarCosecha` / `registrarManual`

## Endpoints guías (`Code-guias.gs`)
- `ping`
- `registrarGuias`

## 3) Excel → carpeta Drive → `Code-excel-drive.gs`
Sube el `.xlsx` a Drive **por tipo** (no se mezclan):

| Tipo app | Carpeta Drive |
|----------|----------------|
| Suma | Subcarpeta `SUMAR JARRAS` (se crea sola) |
| Resta | Subcarpeta `DESCUENTO JARRAS` (se crea sola) |
| Descarte | Subcarpeta `DESCARTE - DESHIDRATADO` (se crea sola) |

```
PWA  →  api-config.js (QB_SCRIPT.EXCEL_DRIVE)
     →  Code-excel-drive.gs
     →  Carpeta Drive padre (DRIVE_FOLDER_LINK)
         ├── SUMAR JARRAS
         ├── DESCUENTO JARRAS
         └── DESCARTE - DESHIDRATADO
```

1. Copie el enlace de su carpeta Drive padre  
2. Péguelo en `DRIVE_FOLDER_LINK` dentro de `Code-excel-drive.gs`  
3. Apps Script nuevo → pegar archivo → Implementar → **Nueva versión** → Aplicación web (Yo / Cualquier persona)  
4. URL `/exec` → `api-config.js` → `EXCEL_DRIVE: "…/exec"`  
5. Redeploy Netlify  

Botón en la app: **Subir a Drive**. La app envía `tipo` para elegir carpeta.

## Prueba en editor
Solo `testPing` / `myFunction` (rápido).
