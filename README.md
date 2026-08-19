# QBerries · Supervisores Cosecha

PWA para registro de cosecha de arándanos (Netlify + APK Android).

## Estructura del proyecto

```
Supervisores/
├── app.js, index.html, styles.css, sw.js   ← PWA (Netlify publica la raíz)
├── inicio/ registro/ vinculo/ instalar/     ← pantallas
├── data/ vendor/ assets/                  ← datos y librerías
├── backend/
│   ├── netlify/functions/                 ← login, sync, trabajadores
│   └── apps-script/Code.gs                ← Google Sheets
├── mobile/
│   ├── www/                               ← copia para APK (sync automático)
│   └── android/                           ← proyecto Capacitor / Gradle
├── dev/                                   ← servidor local y ABRIR-APP.bat
├── scripts/                               ← ordenar JSON, sync www, setup Android
└── docs/                                  ← guías
```

## Acceso (como app real)

1. Escanea el carnet QR (solo Supervisores de Cosecha).
2. Ingresa la contraseña personal (validada en Netlify, no en el celular).
3. La sesión queda en ese dispositivo hasta **Cerrar sesión**.

## Variables de entorno (Netlify)

| Variable | Uso |
|----------|-----|
| `LOGIN_PIN` | Contraseña de prueba compartida |
| `SUPERVISOR_PINS` | Opcional: `{"DNI":"clave",...}` |
| `API_TOKEN` | Token hacia Apps Script + firma de sesión |
| `APPS_SCRIPT_URL` | URL del Web App de Google Apps Script |

Plantilla: `.env.example`

## Desplegar en Netlify

1. Suba este repo a GitHub (o arrastre la carpeta a Netlify).
2. Build: publish `.` · functions `backend/netlify/functions` (`netlify.toml`).
3. Configure variables en Netlify (nunca en el código).

## Local

```bash
npm start          # http://127.0.0.1:5500
# o: npm run dev:ps
# o: dev\ABRIR-APP.bat
```

## APK Android

```bash
npm run build:web   # raíz → mobile/www
npm run cap:sync    # sync + Capacitor
npm run cap:apk     # genera APK debug
```

Primera vez (descarga herramientas): `scripts/setup-android.ps1`

## Instalar PWA con QR

`/instalar/` · QR: `assets/qr-instalar-app.png`
